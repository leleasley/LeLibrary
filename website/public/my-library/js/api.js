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

async function torboxDelete(path, apiKey) {
  const res = await fetch(API.TORBOX + path, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + apiKey }
  });
  if (!res.ok) throw new Error('Delete failed: ' + res.status);
  return true;
}

async function torboxPost(path, body, apiKey) {
  const res = await fetch(API.TORBOX + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.detail || 'TorBox request failed');
  return data;
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
