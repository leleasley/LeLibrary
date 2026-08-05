const axios = require('axios');

const TORBOX_BASE = 'https://api.torbox.app/v1/api';

let usenetUnavailableLogged = false;

async function torboxGet(path, apiKey, params = {}) {
  if (!apiKey || apiKey.length < 10) {
    console.error('[TorBox] API key invalid or missing');
    return { error: 'API key invalid', status: 401 };
  }
  
  const headers = { Authorization: `Bearer ${apiKey}` };
  
  try {
    const res = await axios.get(`${TORBOX_BASE}${path}`, { 
      headers, 
      params, 
      timeout: 45000,
      validateStatus: (status) => status < 500
    });
    return { data: res.data, status: res.status };
  } catch (err) {
    const status = err.response?.status ?? null;
    const message = err.response?.data?.detail || err.response?.data?.error || err.message;
    console.error(`[TorBox] Error ${status}: ${message}`);
    return { error: message, status };
  }
}

async function getTorBoxDownloads(apiKey) {
  const params = { bypass_cache: true };

  const [torrentsResult, usenetResult] = await Promise.all([
    torboxGet('/torrents/mylist', apiKey, params),
    torboxGet('/usenet/mylist',   apiKey, params),
  ]);

  if (torrentsResult.error) {
    const s = torrentsResult.status;
    const msg = s === 403
      ? '[TorBox] Torrents: access denied (403). Check that your API key is correct and active.'
      : s === 401
      ? '[TorBox] Torrents: API key invalid (401).'
      : `[TorBox] Torrents: error ${s ?? 'unknown'} — ${torrentsResult.error}`;
    console.error(msg);
    throw new Error(msg);
  }

  let items = [];

  {
    const data = torrentsResult.data?.data;
    const list = Array.isArray(data) ? data : (data ? [data] : []);
    items = items.concat(list.map(t => ({ ...t, source: 'torrent' })));
  }

  if (!usenetResult.error) {
    const data = usenetResult.data?.data;
    const list = Array.isArray(data) ? data : (data ? [data] : []);
    items = items.concat(list.map(u => ({ ...u, source: 'usenet' })));
  } else {
    const s = usenetResult.status;
    if (s === 403 || s === 401) {
      if (!usenetUnavailableLogged) {
        console.log('[TorBox] Usenet: not available on this plan (ignoring).');
        usenetUnavailableLogged = true;
      }
    } else {
      console.error(`[TorBox] Usenet: error ${s ?? 'unknown'} — ${usenetResult.error}`);
    }
  }

  const completed = items.filter(i => {
    const state = (i.download_state || '').toLowerCase();
    return (
      state === 'completed'  ||
      state === 'seeding'    ||
      state === 'cached'     ||
      state === 'finalized'  ||
      i.download_finished === true ||
      i.download_present === true
    );
  });

  console.log(`[TorBox] Downloads: ${items.length} fetched → ${completed.length} available`);

  return completed;
}

// Cache requestdl links per file so we don't re-request TorBox for the same
// file on every stream build, and back off (circuit breaker) when TorBox
// rate-limits us (429) instead of hammering — a shared server IP can otherwise
// get throttled to the point where every user sees "no streams".
const TBDL_TTL = 21600; // requestdl links are temporary URLs; safe to reuse for 6h
const TBDL_THROTTLE_MS = 30000; // pause 30s after a 429 so TorBox can recover
let tbdThrottledUntil = 0;

function tbdHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function getTorBoxStreamLink(apiKey, source, itemId, fileId) {
  const cache = require('./cache');
  const ck = cache.makeKey('tbdl', tbdHash(apiKey), source, itemId, fileId);
  const cached = await cache.get(ck);
  if (cached) return cached;

  // Circuit open: TorBox just throttled us — don't add to the pile, wait it out.
  if (Date.now() < tbdThrottledUntil) {
    console.log(`[TorBox] requestdl skipped (throttled, resume in ${Math.ceil((tbdThrottledUntil - Date.now()) / 1000)}s)`);
    return null;
  }

  const headers = { Authorization: `Bearer ${apiKey}` };
  const endpoint = source === 'torrent'
    ? `${TORBOX_BASE}/torrents/requestdl`
    : `${TORBOX_BASE}/usenet/requestdl`;

  const params = source === 'torrent'
    ? { token: apiKey, torrent_id: itemId, file_id: fileId, zip_link: false }
    : { token: apiKey, usenet_id: itemId,  file_id: fileId, zip_link: false };

  try {
    const res = await axios.get(endpoint, { headers, params, timeout: 30000 });
    const url = res.data?.data || null;
    if (url) {
      await cache.set(ck, url, TBDL_TTL);
      tbdThrottledUntil = 0; // healthy again
    }
    return url;
  } catch (err) {
    const s = err.response?.status;
    if (s === 429) {
      tbdThrottledUntil = Date.now() + TBDL_THROTTLE_MS;
      console.error(`[TorBox] requestdl 429 — throttled, backing off ${TBDL_THROTTLE_MS / 1000}s (${source} id=${itemId} file=${fileId})`);
    } else {
      console.error(`[TorBox] requestdl erro ${s ?? '?'} (${source} id=${itemId} file=${fileId}): ${err.message}`);
    }
    return null;
  }
}

async function getTorBoxFiles(apiKey, source, itemId) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const endpoint = source === 'torrent'
    ? `${TORBOX_BASE}/torrents/mylist`
    : `${TORBOX_BASE}/usenet/mylist`;

  try {
    const res = await axios.get(endpoint, {
      headers,
      params: { id: itemId, bypass_cache: false },
      timeout: 30000,
    });
    const data = res.data?.data;
    const item = Array.isArray(data) ? data[0] : data;
    return item?.files || [];
  } catch (err) {
    const s = err.response?.status;
    console.error(`[TorBox] Files erro ${s ?? '?'} (${source} id=${itemId}): ${err.message}`);
    return [];
  }
}

const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.ts', '.wmv', '.webm'];

function isVideoFile(name = '') {
  return VIDEO_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));
}

// Junk files commonly bundled in torrents (samples, trailers, featurettes).
// Matches "sample"/"trailer" as a tag token, optionally with a digit suffix
// (sample2, samples), e.g. "Movie.2024.SAMPLE.mkv". The caller only drops these
// when real files remain, so a legit movie literally titled "The.Sample.Movie"
// still plays if it's the only video file.
const JUNK_VIDEO_RE = /(?:^|[\s._\-/\[\(])(?:sample|trailer|featurette|behindthescenes|behind.the.scenes)s?\d*(?:[\s._\-/\[\]\)]|$)/i;

function isJunkVideo(name = '') {
  return JUNK_VIDEO_RE.test(name.toLowerCase());
}

module.exports = { getTorBoxDownloads, getTorBoxStreamLink, getTorBoxFiles, isVideoFile, isJunkVideo };
