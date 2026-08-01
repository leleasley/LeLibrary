// ── API Proxy Functions ──────────────────────────────────────

const API = {
  TORBOX: '/api/torbox',
  RD: '/api/realdebrid',
  TMDB: '/api/tmdb',
};

// ── TorBox ────────────────────────────────────────────────────
async function torboxGet(path, apiKey) {
  const res = await fetch(API.TORBOX + path, {
    headers: { 'Authorization': 'Bearer ' + apiKey }
  });
  if (!res.ok) {
    let msg;
    if (res.status === 401) msg = 'Invalid TorBox API key — check your key at torbox.app/settings';
    else if (res.status === 403) msg = 'TorBox access denied — your API key may be expired or inactive';
    else if (res.status === 429) msg = 'Rate limited by TorBox — try again in a minute';
    else if (res.status >= 500) msg = 'TorBox server error — try again later';
    else msg = 'TorBox API error: ' + res.status;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  // TorBox signals failures in the body too (success:false + detail) — don't
  // swallow those and return an empty list, or a broken key looks like an
  // empty library.
  if (data && data.success === false) {
    const err = new Error('TorBox: ' + (data.detail || data.error || 'Request failed'));
    err.status = res.status;
    throw err;
  }
  if (data && data.error) {
    const err = new Error('TorBox: ' + data.error);
    err.status = res.status;
    throw err;
  }
  return data.data || [];
}

async function torboxPost(path, body, apiKey) {
  const res = await fetch(API.TORBOX + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.detail || data.error || 'TorBox request failed');
  return data;
}

async function torboxPostJson(path, body, apiKey) {
  const res = await fetch(API.TORBOX + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.detail || data.error || 'TorBox request failed');
  return data;
}

async function torboxDelete(path, apiKey) {
  // TorBox uses POST /torrents/controltorrent (or /usenet/controlusenetdownload) to delete
  const isUsenet = path.startsWith('/usenet/');
  const id = parseInt(path.split('/').pop(), 10);
  const endpoint = isUsenet ? '/usenet/controlusenetdownload' : '/torrents/controltorrent';
  const body = isUsenet ? { operation: 'delete', usenet_id: id } : { operation: 'delete', torrent_id: id };
  await torboxPostJson(endpoint, body, apiKey);
  return true;
}

// ── Real-Debrid ───────────────────────────────────────────────
async function rdGet(path, apiKey) {
  const res = await fetch(API.RD + path, {
    headers: { 'Authorization': 'Bearer ' + apiKey }
  });
  if (!res.ok) {
    let msg;
    if (res.status === 401) msg = 'Invalid Real-Debrid API key';
    else if (res.status === 403) msg = 'Access denied by Real-Debrid';
    else msg = 'Real-Debrid API error: ' + res.status;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function rdDelete(path, apiKey) {
  const res = await fetch(API.RD + path, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + apiKey }
  });
  if (!res.ok) {
    let msg;
    if (res.status === 401) msg = 'Invalid Real-Debrid API key';
    else if (res.status === 403) msg = 'Real-Debrid access denied';
    else if (res.status === 404) msg = 'Item not found on Real-Debrid — it may already be gone';
    else msg = 'Real-Debrid delete failed: ' + res.status;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return true;
}

async function rdPost(path, body, apiKey) {
  const res = await fetch(API.RD + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Real-Debrid request failed: ' + res.status);
  return data;
}

// ── Adding downloads ──────────────────────────────────────────
// Add a magnet/link to TorBox
async function addTorboxMagnet(magnet, apiKey) {
  const data = await torboxPost('/torrents/createtorrent', { magnet }, apiKey);
  return data;
}

// Add a magnet to Real-Debrid, then auto-select all files
async function addRdMagnet(magnet, apiKey) {
  const added = await rdPost('/torrents/addMagnet', { magnet }, apiKey);
  if (!added.id) throw new Error('No torrent id returned');
  await rdPost('/torrents/selectFiles/' + added.id, { files: 'all' }, apiKey);
  return added;
}

// Upload a .torrent file to TorBox with upload progress callback
function uploadTorrentFile(file, apiKey, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', API.TORBOX + '/torrents/createtorrent');
    xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.onload = () => {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch { data = {}; }
      if (xhr.status >= 400 || !data.success) {
        reject(new Error(data.detail || data.error || 'Upload failed: ' + xhr.status));
        return;
      }
      if (onProgress) onProgress(100);
      resolve(data);
    };
    xhr.onerror = () => reject(new Error('Upload failed — network error'));
    xhr.send(fd);
  });
}

// ── TMDB ──────────────────────────────────────────────────────

// TMDB v4 "Read Access Tokens" are JWTs (eyJ….<segment>.<segment>) and
// expire/aren't accepted where a v3 API key (32-char hex string) is expected.
function looksLikeV4Token(key) {
  return /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(key || '');
}

function tmdbKeyError() {
  return 'TMDB rejected your key. If you entered a v4 "Read Access Token", use your v3 API key instead — the 32-character key from your TMDB account settings (themoviedb.org/settings/api).';
}

async function tmdbGet(path) {
  const tmdbKey = App.keys.tmdbKey;
  if (!tmdbKey) throw new Error('TMDB API key required — add it on the login screen.');
  if (looksLikeV4Token(tmdbKey)) throw new Error(tmdbKeyError());
  const cleanPath = path.replace(/^\/+/, '/');
  const res = await fetch(API.TMDB + cleanPath, {
    headers: { 'x-tmdb-key': tmdbKey }
  });
  if (!res.ok) {
    let msg;
    if (res.status === 401) msg = tmdbKeyError();
    else if (res.status === 429) msg = 'TMDB rate limit reached — wait a minute and try again.';
    else if (res.status >= 500) msg = 'TMDB is having issues right now — try again in a moment.';
    else msg = 'TMDB error: ' + res.status;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ── Scrapers ──────────────────────────────────────────────────
async function scrapeSource(name, query) {
  const res = await fetch('/api/scrape/' + name + '?q=' + encodeURIComponent(query));
  return res.ok ? await res.json() : [];
}

// ── Pre-computed library index ─────────────────────────────────
// Built once on load so lookups are O(1)
let _libNameSet = null;    // Set of normalized names for isInLibrary()
let _libStats = null;      // { movieCount, seriesCount, totalSize }

function buildLibraryIndex() {
  const items = App.allItems || [];
  const nameSet = new Set();
  let movieCount = 0, seriesCount = 0, totalSize = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const name = item.name || item.filename || '';
    totalSize += item.size || 0;

    // Add normalized name variants to set for fast lookup
    const clean = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (clean) nameSet.add(clean);

    // Count movies vs series
    if (isSeries(name)) seriesCount++;
    else movieCount++;
  }

  _libNameSet = nameSet;
  _libStats = { movieCount, seriesCount, totalSize };
}

function isInLibrary(title) {
  if (!_libNameSet) return false;
  const clean = title.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  if (!clean) return false;
  // O(1) lookup in Set
  if (_libNameSet.has(clean)) return true;
  // Fallback: check substrings for partial matches (slower but rare)
  for (const name of _libNameSet) {
    if (name.includes(clean) || clean.includes(name)) return true;
  }
  return false;
}

function getLibStats() {
  if (!_libStats) {
    const items = App.allItems || [];
    let movieCount = 0, seriesCount = 0, totalSize = 0;
    for (const item of items) {
      totalSize += item.size || 0;
      if (isSeries(item.name || item.filename || '')) seriesCount++;
      else movieCount++;
    }
    _libStats = { movieCount, seriesCount, totalSize };
  }
  return _libStats;
}

// ── Load library from providers ───────────────────────────────
async function loadLibraryFromProviders() {
  const { torboxKey, rdKey } = App.keys;
  const results = await Promise.allSettled([
    torboxKey ? torboxGet('/torrents/mylist', torboxKey) : Promise.resolve([]),
    torboxKey ? torboxGet('/usenet/mylist', torboxKey) : Promise.resolve([]),
    rdKey ? rdGet('/torrents', rdKey) : Promise.resolve([]),
  ]);

  const torrents = results[0];
  const usenet = results[1];
  const rdTorrents = results[2];

  // Auth failures (401/403) are fatal — surface them so the user knows their
  // key is wrong. Transient network/server errors just degrade to empty lists
  // so the other provider's content still shows.
  const isAuthErr = e => e && e.status && (e.status === 401 || e.status === 403);
  if (torboxKey) {
    const authErr = [torrents, usenet].find(r => r.status === 'rejected' && isAuthErr(r.reason))?.reason;
    if (authErr) throw authErr;
  }
  if (rdKey && rdTorrents.status === 'rejected' && isAuthErr(rdTorrents.reason)) {
    throw rdTorrents.reason;
  }

  let items = [];
  if (torrents.status === 'fulfilled') {
    items = items.concat(torrents.value.map(i => ({ ...i, source: 'torrent' })));
  }
  if (usenet.status === 'fulfilled') {
    items = items.concat(usenet.value.map(i => ({ ...i, source: 'usenet' })));
  }
  if (rdTorrents.status === 'fulfilled' && Array.isArray(rdTorrents.value)) {
    for (const t of rdTorrents.value) {
      items.push({
        id: t.id,
        name: t.filename,
        filename: t.filename,
        size: t.bytes,
        source: 'realdebrid',
        download_state: t.status === 'downloaded' ? 'completed' : t.status,
        download_finished: t.status === 'downloaded',
        created_at: t.added,
        _rdHash: t.hash,
      });
    }
  }

  return items.filter(i => {
    if (i.source === 'realdebrid') return i.download_finished === true;
    const state = (i.download_state || '').toLowerCase();
    return state === 'completed' || state === 'seeding' || state === 'cached' || state === 'finalized'
      || i.download_finished === true || i.download_present === true;
  });
}
