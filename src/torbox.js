const axios = require('axios');
const crypto = require('crypto');

const TORBOX_BASE = 'https://api.torbox.app/v1/api';

let usenetUnavailableLogged = false;
let webdlUnavailableLogged = false;

// ── Rate limiting / circuit breaker ────────────────────────────────────
// TorBox limits: 300 req/min per API token across ALL endpoints (documented).
// requestdl is stricter (~100 calls before 429, measured May 2026).
// 429 is a cliff: 100% requests fail for ~5 minutes (Retry-After: 300).
// The budget is per token, not per IP: multiple instances sharing a key
// must split the 300/min.  Default 120/min (safe for 2+ instances);
// set TORBOX_RATE_LIMIT to use the full budget on a single instance.

const TB_RATE_LIMIT   = parseInt(process.env.TORBOX_RATE_LIMIT, 10) || 120; // req/min
const TB_RATE_WINDOW  = 60_000;
const TB_MAX_CONCURRENT = parseInt(process.env.TORBOX_MAX_CONCURRENT, 10) || 16;
const TB_429_DEFAULT_BACKOFF = 300_000; // 5 minutes if no Retry-After header

// Token bucket: refills smoothly over the window
let tbTokens = TB_RATE_LIMIT;
let tbLastRefill = Date.now();
// requestdl has a much tighter TorBox limit than catalog/list endpoints. Keep
// their backoffs separate so a burst of playback requests cannot blank a
// user's library catalogue.
let tbDataCircuitOpenUntil = 0;
// requestdl has its own, much lower limit. Keep this limiter per account: a
// 429 from one hosted user must never suppress another user's playback.
const TB_REQUESTDL_RATE = parseInt(process.env.TORBOX_REQUESTDL_RATE, 10) || 30; // per minute/account
const TB_REQUESTDL_BURST = Math.max(1, parseInt(process.env.TORBOX_REQUESTDL_BURST, 10) || 3);
const TB_REQUESTDL_MAX_CONCURRENT = Math.max(1, parseInt(process.env.TORBOX_REQUESTDL_MAX_CONCURRENT, 10) || 2);
const TB_REQUESTDL_MAX_ACCOUNTS = 1000;

function createRequestDlLimiter({ ratePerMinute = TB_REQUESTDL_RATE, burst = TB_REQUESTDL_BURST, maxConcurrent = TB_REQUESTDL_MAX_CONCURRENT, now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const gates = new Map();
  const refillPerMs = ratePerMinute / TB_RATE_WINDOW;

  function getGate(identity) {
    const at = now();
    let gate = gates.get(identity);
    if (!gate) {
      // Bound account state in the long-running hosted process. The oldest
      // inactive entry is disposable because it only contains rate metadata.
      if (gates.size >= TB_REQUESTDL_MAX_ACCOUNTS) {
        let oldestKey = null;
        let oldestAt = Infinity;
        for (const [key, value] of gates) {
          if (value.inFlight === 0 && value.lastUsed < oldestAt) { oldestAt = value.lastUsed; oldestKey = key; }
        }
        if (oldestKey) gates.delete(oldestKey);
      }
      gate = { tokens: burst, lastRefill: at, inFlight: 0, cooldownUntil: 0, lastUsed: at };
      gates.set(identity, gate);
    }
    const elapsed = Math.max(0, at - gate.lastRefill);
    gate.tokens = Math.min(burst, gate.tokens + elapsed * refillPerMs);
    gate.lastRefill = at;
    gate.lastUsed = at;
    return gate;
  }

  async function acquire(identity) {
    while (true) {
      const gate = getGate(identity);
      const at = now();
      // A TorBox 429 is a hard backoff, not a queue: Nuvio needs an immediate
      // empty response so it can retry later rather than holding the player
      // request open for minutes.
      if (at < gate.cooldownUntil) return false;
      if (at >= gate.cooldownUntil && gate.inFlight < maxConcurrent && gate.tokens >= 1) {
        gate.tokens -= 1;
        gate.inFlight += 1;
        return true;
      }
      const cooldownWait = Math.max(0, gate.cooldownUntil - at);
      const tokenWait = gate.tokens >= 1 ? 0 : Math.ceil((1 - gate.tokens) / refillPerMs);
      // Another request releases its concurrency slot shortly; polling keeps
      // the queue simple without retaining unresolved per-request callbacks.
      const concurrencyWait = gate.inFlight >= maxConcurrent ? 25 : 0;
      await sleep(Math.max(25, cooldownWait, tokenWait, concurrencyWait));
    }
  }

  function release(identity) {
    const gate = gates.get(identity);
    if (gate) { gate.inFlight = Math.max(0, gate.inFlight - 1); gate.lastUsed = now(); }
  }

  function cooldown(identity, durationMs) {
    const gate = getGate(identity);
    gate.cooldownUntil = Math.max(gate.cooldownUntil, now() + Math.max(0, durationMs));
  }

  function status(identity) {
    const gate = getGate(identity);
    return { inFlight: gate.inFlight, cooldownUntil: gate.cooldownUntil, tokens: gate.tokens };
  }

  return { acquire, release, cooldown, status };
}

function requestDlIdentity(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey || '')).digest('hex').slice(0, 16);
}

const requestDlLimiter = createRequestDlLimiter();

function tbRefill() {
  const now = Date.now();
  const elapsed = now - tbLastRefill;
  if (elapsed > 0) {
    tbTokens = Math.min(TB_RATE_LIMIT, tbTokens + (elapsed / TB_RATE_WINDOW) * TB_RATE_LIMIT);
    tbLastRefill = now;
  }
}

async function tbAcquire() {
  while (true) {
    tbRefill();
    if (tbTokens >= 1) {
      tbTokens -= 1;
      return;
    }
    // Wait until the next token arrives
    const waitMs = Math.ceil((1 - tbTokens) / (TB_RATE_LIMIT / TB_RATE_WINDOW));
    await new Promise(r => setTimeout(r, Math.max(waitMs, 50)));
  }
}

// Concurrency gate: max TB_MAX_CONCURRENT in-flight requests
let tbInFlight = 0;
const tbQueue = [];

function tbConcurrencyWait() {
  return new Promise(resolve => {
    if (tbInFlight < TB_MAX_CONCURRENT) { tbInFlight++; resolve(); return; }
    tbQueue.push(resolve);
  });
}

function tbConcurrencyRelease() {
  tbInFlight = Math.max(0, tbInFlight - 1);
  if (tbQueue.length > 0) {
    tbInFlight++;
    tbQueue.shift()();
  }
}

// ── Core HTTP helper ───────────────────────────────────────────────────

async function torboxGet(path, apiKey, params = {}) {
  if (!apiKey || apiKey.length < 10) {
    console.error('[TorBox] API key invalid or missing');
    return { error: 'API key invalid', status: 401 };
  }

  // Circuit open: bail immediately, don't add to the pile
  if (Date.now() < tbDataCircuitOpenUntil) {
    const waitSec = Math.ceil((tbDataCircuitOpenUntil - Date.now()) / 1000);
    return { error: `TorBox throttled, retry in ${waitSec}s`, status: 429 };
  }

  await tbAcquire();
  await tbConcurrencyWait();

  // Library refreshes pass `bypass_cache=true`, but send the HTTP directives
  // too.  Some intermediary/CDN paths have historically served a stale list
  // response even when the query flag was present; a library poll must always
  // observe TorBox's current state before we decide whether Redis can stay
  // warm.
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Cache-Control': 'no-cache, no-store, max-age=0',
    Pragma: 'no-cache',
  };

  try {
    const res = await axios.get(`${TORBOX_BASE}${path}`, {
      headers,
      params,
      timeout: 45000,
      validateStatus: (status) => status < 500
    });
    tbConcurrencyRelease();
    return { data: res.data, status: res.status };
  } catch (err) {
    tbConcurrencyRelease();
    const status = err.response?.status ?? null;
    const message = err.response?.data?.detail || err.response?.data?.error || err.message;

    if (status === 429) {
      // Respect Retry-After header; fall back to 5 minutes (measured default)
      const retryAfter = parseInt(err.response?.headers?.['retry-after'], 10);
      const backoff = (retryAfter && retryAfter > 0 ? retryAfter : 300) * 1000;
      tbDataCircuitOpenUntil = Date.now() + backoff;
      console.error(`[TorBox] 429: circuit breaker open for ${Math.round(backoff / 1000)}s (${path})`);
    } else {
      console.error(`[TorBox] Error ${status}: ${message}`);
    }

    return { error: message, status };
  }
}

async function torboxPost(path, apiKey, data = {}, params = {}) {
  if (!apiKey || apiKey.length < 10) {
    return { error: 'API key invalid', status: 401 };
  }
  if (Date.now() < tbDataCircuitOpenUntil) {
    const waitSec = Math.ceil((tbDataCircuitOpenUntil - Date.now()) / 1000);
    return { error: `TorBox throttled, retry in ${waitSec}s`, status: 429 };
  }

  await tbAcquire();
  await tbConcurrencyWait();

  const headers = { Authorization: `Bearer ${apiKey}` };

  try {
    const res = await axios.post(`${TORBOX_BASE}${path}`, data, {
      headers, params, timeout: 45000,
      validateStatus: (status) => status < 500
    });
    tbConcurrencyRelease();
    return { data: res.data, status: res.status };
  } catch (err) {
    tbConcurrencyRelease();
    const status = err.response?.status ?? null;
    const message = err.response?.data?.detail || err.response?.data?.error || err.message;
    if (status === 429) {
      const retryAfter = parseInt(err.response?.headers?.['retry-after'], 10);
      const backoff = (retryAfter && retryAfter > 0 ? retryAfter : 300) * 1000;
      tbDataCircuitOpenUntil = Date.now() + backoff;
      console.error(`[TorBox] 429: circuit breaker open for ${Math.round(backoff / 1000)}s (${path})`);
    } else {
      console.error(`[TorBox] Error ${status}: ${message}`);
    }
    return { error: message, status };
  }
}

// Fetch all pages from a paginated TorBox endpoint.  The API caps at 1000
// items per request; this loops until an empty page is returned.
async function torboxPaginate(path, apiKey, params = {}, limit = 1000) {
  let offset = 0;
  const all = [];
  while (true) {
    const result = await torboxGet(path, apiKey, { ...params, offset, limit });
    if (result.error) return result;
    const data = result.data?.data;
    const list = Array.isArray(data) ? data : (data ? [data] : []);
    all.push(...list);
    if (list.length < limit) break;
    offset += limit;
  }
  return { data: { data: all }, status: 200 };
}

async function getTorBoxDownloads(apiKey) {
  const params = { bypass_cache: true };

  // Fetch each endpoint sequentially to stay within the shared 300/min budget.
  // Parallel requests across endpoints can burst past the limit.
  const torrentsResult = await torboxPaginate('/torrents/mylist', apiKey, params);
  const usenetResult   = await torboxPaginate('/usenet/mylist',   apiKey, params);
  const webdlResult    = await torboxPaginate('/webdl/mylist',    apiKey, params);

  if (torrentsResult.error) {
    const s = torrentsResult.status;
    const msg = s === 403
      ? '[TorBox] Torrents: access denied (403). Check that your API key is correct and active.'
      : s === 401
      ? '[TorBox] Torrents: API key invalid (401).'
      : `[TorBox] Torrents: error ${s ?? 'unknown'}: ${torrentsResult.error}`;
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
      console.error(`[TorBox] Usenet: error ${s ?? 'unknown'}: ${usenetResult.error}`);
    }
  }

  if (!webdlResult.error) {
    const data = webdlResult.data?.data;
    const list = Array.isArray(data) ? data : (data ? [data] : []);
    items = items.concat(list.map(w => ({ ...w, source: 'webdl' })));
  } else {
    const s = webdlResult.status;
    if (s === 403 || s === 401) {
      if (!webdlUnavailableLogged) {
        console.log('[TorBox] Web Downloads: not available on this plan (ignoring).');
        webdlUnavailableLogged = true;
      }
    } else {
      console.error(`[TorBox] Web Downloads: error ${s ?? 'unknown'}: ${webdlResult.error}`);
    }
  }

  // Log all unique fields across items to spot blocked/restricted indicators
  const allKeys = new Set();
  items.forEach(i => Object.keys(i).forEach(k => allKeys.add(k)));
  const knownStateKeys = ['id','name','hash','size','torrent_name','files','download_state','download_finished','download_present','seeders','leechers','ratio',' seeds','peers','progress','download_speed','upload_speed','eta','abort','active','last_state_change','created_at','updated_at','source'];
  const unknownKeys = [...allKeys].filter(k => !knownStateKeys.includes(k) && !k.startsWith('cached'));
  if (unknownKeys.length > 0 && items.length > 0) {
    console.log(`[TorBox] Download extra fields: ${unknownKeys.join(', ')}`);
    // Sample: dump availability, error, tracker_message for first 3 items
    items.slice(0, 3).forEach(i => console.log(`  SAMPLE id=${i.id} availability=${JSON.stringify(i.availability)} error=${JSON.stringify(i.error)} tracker_message=${JSON.stringify(i.tracker_message)?.substring(0, 80)}`));
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

  // Filter out torrents TorBox marks as errored/unavailable at CDN level
  const healthy = completed.filter(i => {
    if (i.error) {
      console.log(`[TorBox] Skipping errored torrent id=${i.id} name=${(i.name || '').substring(0, 60)} error=${JSON.stringify(i.error)}`);
      return false;
    }
    return true;
  });

  const blockedCount = completed.length - healthy.length;
  console.log(`[TorBox] Downloads: ${items.length} fetched → ${completed.length} available${blockedCount > 0 ? ` (${blockedCount} errored/blocked)` : ''}`);

  return healthy;
}

// Cache requestdl links per file so we don't re-request TorBox for the same
// file on every stream build. requestdl uses its own stricter 429 backoff so
// playback throttling cannot block catalogue/list requests.
const TBDL_TTL = 21600; // requestdl links are temporary URLs; safe to reuse for 6h

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

  const endpoint = source === 'torrent'
    ? `${TORBOX_BASE}/torrents/requestdl`
    : source === 'webdl'
    ? `${TORBOX_BASE}/webdl/requestdl`
    : `${TORBOX_BASE}/usenet/requestdl`;

  const params = source === 'torrent'
    ? { token: apiKey, torrent_id: itemId, file_id: fileId, zip_link: false }
    : source === 'webdl'
    ? { token: apiKey, web_id: itemId,    file_id: fileId, zip_link: false }
    : { token: apiKey, usenet_id: itemId,  file_id: fileId, zip_link: false };

  const limiterIdentity = requestDlIdentity(apiKey);
  // Cache lookup deliberately happens before this queue: a six-hour cached
  // playback link is free and should never wait behind new link creation.
  const permitted = await requestDlLimiter.acquire(limiterIdentity);
  if (!permitted) {
    const { cooldownUntil } = requestDlLimiter.status(limiterIdentity);
    console.log(`[TorBox] requestdl skipped for this account (cooldown ${Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))}s)`);
    return null;
  }
  await tbAcquire();
  await tbConcurrencyWait();

  try {
    const headers = { Authorization: `Bearer ${apiKey}` };
    const res = await axios.get(endpoint, { headers, params, timeout: 30000 });
    tbConcurrencyRelease();
    requestDlLimiter.release(limiterIdentity);
    const url = res.data?.data || null;
    const respErr = res.data?.error;
    const respDetail = res.data?.detail;
    if (respErr || respDetail) {
      console.log(`[TorBox] requestdl hint (${source} id=${itemId} file=${fileId}): error=${JSON.stringify(respErr)} detail=${JSON.stringify(respDetail)}`);
    }
    if (url) await cache.set(ck, url, TBDL_TTL);
    return url;
  } catch (err) {
    tbConcurrencyRelease();
    requestDlLimiter.release(limiterIdentity);
    const s = err.response?.status;
    if (s === 429) {
      const retryAfter = parseInt(err.response?.headers?.['retry-after'], 10);
      const backoff = (retryAfter && retryAfter > 0 ? retryAfter : 300) * 1000;
      requestDlLimiter.cooldown(limiterIdentity, backoff);
      console.error(`[TorBox] requestdl 429: this account paused for ${Math.round(backoff / 1000)}s (${source} id=${itemId} file=${fileId})`);
    } else {
      const body = err.response?.data?.detail || err.response?.data?.message || err.response?.data?.error || '';
      console.error(`[TorBox] requestdl error ${s ?? '?'} (${source} id=${itemId} file=${fileId}): ${body || err.message}`);
    }
    if (s && s !== 429) await cache.del(ck);
    return null;
  }
}

async function getTorBoxFiles(apiKey, source, itemId) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const endpoint = source === 'torrent'
    ? `${TORBOX_BASE}/torrents/mylist`
    : source === 'webdl'
    ? `${TORBOX_BASE}/webdl/mylist`
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

const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.ts', '.wmv', '.webm', '.m2ts', '.mpg', '.mpeg', '.flv', '.vob', '.divx'];

function isVideoFile(name = '') {
  return VIDEO_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));
}

// Junk files commonly bundled in torrents (samples, trailers, featurettes).
// Previous broad regex flagged any occurrence of "sample" bounded by delimiters
// anywhere in the path ("The.Sample.Movie.2024.1080p.mkv" was incorrectly junk).
// Now: only a Sample *folder* (/Sample/) or a sample/trailer suffix right before
// the video extension ("movie-sample.mkv", "Sample.mkv") counts as junk. This
// satisfies the "/Sample/" + "-sample.mkv" requirement without hiding a legit
// film literally titled "The Sample".
function isJunkVideo(name = '') {
  if (!name) return false;
  // Folder case: Sample/  Samples/ at any depth
  if (/[\/\\]samples?[\/\\]/i.test(name) || /^samples?[\/\\]/i.test(name)) return true;
  const lower = String(name).toLowerCase();
  const base = lower.split('/').pop().split('\\').pop();
  const ext = '(?:mkv|mp4|avi|mov|m4v|ts|wmv|webm|m2ts|mpg|mpeg|flv|vob|divx)';
  // Suffix case: sample/trailer/featurette directly before the extension
  // e.g. "movie-sample.mkv", "movie.sample.mkv", "Sample.mkv", "trailer2.mkv"
  if (new RegExp(`(^|[\\s._-])samples?\\d*\\.${ext}$`, 'i').test(base)) return true;
  if (new RegExp(`(^|[\\s._-])(?:trailer|featurette|behindthescenes|behind\\.the\\.scenes)s?\\d*\\.${ext}$`, 'i').test(base)) return true;
  return false;
}

module.exports = { getTorBoxDownloads, getTorBoxStreamLink, getTorBoxFiles, isVideoFile, isJunkVideo, torboxRateStatus };

function torboxRateStatus() {
  return {
    circuitOpen: Date.now() < tbDataCircuitOpenUntil,
    circuitOpenUntil: tbDataCircuitOpenUntil,
    circuitWaitSec: Math.max(0, Math.ceil((tbDataCircuitOpenUntil - Date.now()) / 1000)),
    inFlight: tbInFlight,
    queued: tbQueue.length,
    tokens: Math.floor(tbTokens),
  };
}

// Exported only for deterministic unit tests; runtime callers use the module
// singleton above and never receive raw API-key material.
module.exports.__test = { createRequestDlLimiter, requestDlIdentity };
