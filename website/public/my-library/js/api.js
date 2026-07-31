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
    if (res.status === 401) throw new Error('Invalid API key — check your key at torbox.app/settings');
    if (res.status === 403) throw new Error('Access denied — your API key may be expired or inactive');
    if (res.status === 429) throw new Error('Rate limited by TorBox — try again in a minute');
    if (res.status >= 500) throw new Error('TorBox server error — try again later');
    throw new Error('TorBox API error: ' + res.status);
  }
  const data = await res.json();
  if (data.error) throw new Error('TorBox: ' + data.error);
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
    if (res.status === 401) throw new Error('Invalid Real-Debrid API key');
    if (res.status === 403) throw new Error('Access denied by Real-Debrid');
    throw new Error('Real-Debrid API error: ' + res.status);
  }
  return res.json();
}

async function rdDelete(path, apiKey) {
  const res = await fetch(API.RD + path, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + apiKey }
  });
  if (!res.ok) throw new Error('Delete failed: ' + res.status);
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
async function tmdbGet(path) {
  const tmdbKey = App.keys.tmdbKey;
  if (!tmdbKey) throw new Error('TMDB API key required');
  const cleanPath = path.replace(/^\/+/, '/');
  const sep = cleanPath.includes('?') ? '&' : '?';
  const res = await fetch(API.TMDB + cleanPath + sep + 'api_key=' + tmdbKey);
  if (!res.ok) throw new Error('TMDB error: ' + res.status);
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

  if ((torrents.status === 'rejected' || torrents.value?.length === 0) &&
      (usenet.status === 'rejected' || usenet.value?.length === 0) &&
      (rdTorrents.status === 'rejected' || rdTorrents.value?.length === 0)) {
    if (torrents.status === 'rejected' && usenet.status === 'rejected' && rdTorrents.status === 'rejected') {
      throw new Error('Failed to load: ' + (torrents.reason?.message || rdTorrents.reason?.message || 'Unknown error'));
    }
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
