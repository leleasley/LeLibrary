// ── API Proxy Functions ──────────────────────────────────────

const API = {
  TORBOX: '/api/torbox',
  RD: '/api/realdebrid',
  AD: '/api/alldebrid',
  PM: '/api/premiumize',
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

// ── AllDebrid ─────────────────────────────────────────────────
async function adGet(path, apiKey) {
  const res = await fetch(API.AD + path, { headers: { 'Authorization': 'Bearer ' + apiKey } });
  if (!res.ok) {
    let msg;
    if (res.status === 401) msg = 'Invalid AllDebrid API key';
    else if (res.status === 403) msg = 'AllDebrid access denied';
    else msg = 'AllDebrid API error: ' + res.status;
    const err = new Error(msg); err.status = res.status; throw err;
  }
  const data = await res.json();
  if (data.status === 'error') { const e = new Error('AllDebrid: ' + (data.error?.message || data.error?.code || 'Request failed')); e.status = res.status; throw e; }
  return data;
}

async function adPost(path, body, apiKey) {
  const res = await fetch(API.AD + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (data.status === 'error') { const e = new Error('AllDebrid: ' + (data.error?.message || data.error?.code || 'Request failed')); e.status = res.status; throw e; }
  if (!res.ok) { const e = new Error('AllDebrid API error: ' + res.status); e.status = res.status; throw e; }
  return data;
}

async function adDelete(path, apiKey) {
  const id = parseInt(path.split('/').pop(), 10);
  await adPost('/v4/magnet/delete', { ids: id }, apiKey);
  return true;
}

// ── Premiumize ────────────────────────────────────────────────
// Turn a Premiumize error payload into a JS error. If Premiumize demands
// device authorization (new IP), attach needPin/pin/deviceUrl so the UI can
// walk the user through it.
function pmError(data, status) {
  const msg = data?.message || data?.code || 'Premiumize request failed';
  let pin = data?.pin || null;
  if (!pin && typeof msg === 'string') {
    const m = msg.match(/pin[:\s]+([A-Za-z0-9-]+)/i);
    if (m) pin = m[1];
  }
  const err = new Error(pin ? 'Premiumize needs authorization — enter the PIN' : 'Premiumize: ' + msg);
  err.status = status;
  if (pin) { err.needPin = true; err.pin = pin; err.deviceUrl = 'https://www.premiumize.me/device'; }
  return err;
}

async function pmGet(path, apiKey) {
  const res = await fetch(API.PM + path, { headers: { 'Authorization': 'Bearer ' + apiKey } });
  if (!res.ok) {
    let msg;
    if (res.status === 401 || res.status === 403) msg = 'Invalid Premiumize API key — authorize it on premiumize.me';
    else msg = 'Premiumize API error: ' + res.status;
    const err = new Error(msg); err.status = res.status; throw err;
  }
  const data = await res.json();
  if (data.status === 'error') throw pmError(data, res.status);
  return data;
}

async function pmPost(path, body, apiKey) {
  const res = await fetch(API.PM + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (data.status === 'error') throw pmError(data, res.status);
  if (!res.ok) { const e = new Error('Premiumize API error: ' + res.status); e.status = res.status; throw e; }
  return data;
}

async function pmDelete(path, apiKey) {
  const id = path.split('/').pop();
  await pmPost('/transfer/delete', { id }, apiKey);
  return true;
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

// Add a magnet to AllDebrid
async function addAlldebridMagnet(magnet, apiKey) {
  const data = await adPost('/v4/magnet/upload', { magnet }, apiKey);
  if (!data.data?.magnets?.[0]?.id) throw new Error('No torrent id returned from AllDebrid');
  return data;
}

// Add a magnet to Premiumize
async function addPremiumizeMagnet(magnet, apiKey) {
  const data = await pmPost('/transfer/create', { src: magnet }, apiKey);
  if (!data.data?.id) throw new Error('No transfer id returned from Premiumize');
  return data;
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
  const { torboxKey, rdKey, adKey, pmKey } = App.keys;
  const results = await Promise.allSettled([
    torboxKey ? torboxGet('/torrents/mylist', torboxKey) : Promise.resolve([]),
    torboxKey ? torboxGet('/usenet/mylist', torboxKey) : Promise.resolve([]),
    rdKey ? rdGet('/torrents', rdKey) : Promise.resolve([]),
    adKey ? adPost('/v4.1/magnet/status', { ids: 'all' }, adKey) : Promise.resolve(null),
    pmKey ? pmGet('/transfer/list', pmKey) : Promise.resolve(null),
  ]);

  const torrents = results[0];
  const usenet = results[1];
  const rdTorrents = results[2];
  const adMagnets = results[3];
  const pmTransfers = results[4];

  // Auth failures (401/403) are fatal — surface them so the user knows their
  // key is wrong. Transient network/server errors just degrade to empty lists
  // so the other providers' content still shows.
  const isAuthErr = e => e && e.status && (e.status === 401 || e.status === 403);
  if (torboxKey) {
    const authErr = [torrents, usenet].find(r => r.status === 'rejected' && isAuthErr(r.reason))?.reason;
    if (authErr) throw authErr;
  }
  if (rdKey && rdTorrents.status === 'rejected' && isAuthErr(rdTorrents.reason)) throw rdTorrents.reason;
  if (adKey && adMagnets.status === 'rejected' && isAuthErr(adMagnets.reason)) throw adMagnets.reason;
  if (pmKey && pmTransfers.status === 'rejected') {
    // Premiumize device authorization — show the PIN modal and keep going with
    // the other providers; once authorized, onDone reloads the library.
    if (pmTransfers.reason?.needPin) {
      showPinModal(pmTransfers.reason.pin, pmTransfers.reason.deviceUrl, () => loadLibrary());
    } else if (isAuthErr(pmTransfers.reason)) {
      throw pmTransfers.reason;
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
  if (adMagnets.status === 'fulfilled' && adMagnets.value?.data?.magnets) {
    for (const m of adMagnets.value.data.magnets) {
      if (m.statusCode !== 5) continue; // only fully downloaded
      items.push({
        id: String(m.id),
        name: m.filename || m.name || '',
        filename: m.filename || m.name || '',
        size: m.size || 0,
        source: 'alldebrid',
        download_state: 'completed',
        download_finished: true,
        created_at: m.uploadDate ? new Date(m.uploadDate * 1000).toISOString() : undefined,
        _adHash: m.hash || null,
      });
    }
  }
  if (pmTransfers.status === 'fulfilled' && pmTransfers.value?.data?.transfers) {
    for (const t of pmTransfers.value.data.transfers) {
      if (t.status !== 'finished' && t.status !== 'seeding') continue;
      items.push({
        id: String(t.id),
        name: t.name || '',
        filename: t.name || '',
        source: 'premiumize',
        download_state: t.status === 'seeding' ? 'seeding' : 'completed',
        download_finished: true,
        progress: 1,
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

// ── Per-item actions (files, downloads, magnets, edit) ────────

function itemMagnetShort(item) {
  const hash = item.hash || item._rdHash || item._adHash || item.info_hash || '';
  if (!hash) return null;
  const h = String(hash).toLowerCase();
  return 'magnet:?xt=urn:btih:' + h;
}
function itemMagnetFull(item) {
  const short = itemMagnetShort(item);
  if (!short) return null;
  // Prefer the provider's own magnet string when we have it
  return (item.magnet && String(item.magnet).includes('btih')) ? item.magnet : short;
}

async function downloadItem(item, fileId) {
  const src = item.source;
  let url = null;
  showDownloadBar('Preparing download…', true);
  try {
    if (src === 'torrent' || src === 'usenet') {
      url = await tbDownloadUrl(item.id, fileId, false, src === 'usenet');
    } else if (src === 'realdebrid') {
      url = await rdItemDownloadUrl(item.id, fileId);
    } else if (src === 'alldebrid') {
      url = await adItemDownloadUrl(item.id, fileId);
    } else if (src === 'premiumize') {
      url = await pmItemDownloadUrl(item.id, fileId);
    }
  } catch (err) {
    hideDownloadBar();
    throw err;
  }
  if (!url) { hideDownloadBar(); throw new Error('No download link available for this item'); }
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  showDownloadBar('Download started');
  return url;
}

async function downloadItemZip(item) {
  if (item.source !== 'torrent' && item.source !== 'usenet') throw new Error('ZIP download is only available on TorBox');
  showDownloadBar('Creating ZIP…', true);
  let url;
  try {
    url = await tbDownloadUrl(item.id, null, true, item.source === 'usenet');
  } catch (err) {
    hideDownloadBar();
    throw err;
  }
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  showDownloadBar('ZIP download started');
  return url;
}

async function getItemFiles(item) {
  const src = item.source;
  if (src === 'torrent' || src === 'usenet') return tbItemFiles(item.id, src === 'usenet');
  if (src === 'realdebrid') return rdItemFiles(item.id);
  if (src === 'alldebrid') return adItemFiles(item.id);
  if (src === 'premiumize') return pmItemFiles(item.id);
  return [];
}

// ── TorBox file/download helpers ──
async function tbItemFiles(id, isUsenet) {
  const res = await fetch(API.TORBOX + (isUsenet ? '/usenet/mylist?id=' : '/torrents/mylist?id=') + id, {
    headers: { 'Authorization': 'Bearer ' + App.keys.torboxKey }
  });
  const d = await res.json();
  if (!d.success) throw new Error(d.detail || 'Could not load files');
  const item = Array.isArray(d.data) ? d.data[0] : d.data;
  return (item?.files || []).map(f => ({
    id: f.id,
    name: f.name || f.short_name || '',
    size: f.size || 0,
    link: null,
  }));
}

async function tbDownloadUrl(id, fileId, zip, isUsenet) {
  const p = new URLSearchParams();
  p.set(isUsenet ? 'usenet_id' : 'torrent_id', String(id));
  if (fileId) p.set('file_id', String(fileId));
  if (zip) p.set('zip_link', 'true');
  p.set('redirect', 'false');
  const res = await fetch(API.TORBOX + (isUsenet ? '/usenet/requestdl?' : '/torrents/requestdl?') + p.toString(), {
    headers: { 'Authorization': 'Bearer ' + App.keys.torboxKey }
  });
  const d = await res.json();
  if (!d.success) throw new Error(d.detail || d.error || 'TorBox download failed');
  return d.data?.download_url || d.data;
}

async function tbEditTorrent(id, fields) {
  const res = await fetch(API.TORBOX + '/torrents/edittorrent', {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + App.keys.torboxKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ torrent_id: Number(id), ...fields }),
  });
  const d = await res.json();
  if (!d.success) throw new Error(d.detail || d.error || 'TorBox edit failed');
  return d;
}

// ── Real-Debrid file/download helpers ──
async function rdItemFiles(id) {
  const d = await rdGet('/torrents/info/' + id, App.keys.rdKey);
  return (d.files || []).filter(f => f.selected === 1).map((f, i) => ({
    id: f.id,
    name: f.path?.split('/').pop() || f.path || '',
    size: f.bytes || 0,
    link: d.links?.[i] || null,
  }));
}

async function rdItemDownloadUrl(id, fileId) {
  const files = await rdItemFiles(id);
  const link = (files.find(f => String(f.id) === String(fileId)) || files[0])?.link;
  if (!link) throw new Error('No file link on Real-Debrid');
  const d = await rdPost('/unrestrict/link', { link }, App.keys.rdKey);
  return d.download || null;
}

// ── AllDebrid file/download helpers ──
async function adItemFiles(id) {
  const d = await adPost('/v4/magnet/files', { magnet: id }, App.keys.adKey);
  return (d.data?.files || []).filter(f => !f.error).map(f => ({
    id: String(f.id),
    name: f.filename || f.n || '',
    size: f.size || f.s || 0,
    link: f.link || f.l || null,
  }));
}

async function adItemDownloadUrl(id, fileId) {
  const files = await adItemFiles(id);
  const link = (files.find(f => String(f.id) === String(fileId)) || files[0])?.link;
  if (!link) throw new Error('No file link on AllDebrid');
  const d = await adPost('/v4/link/unlock', { link }, App.keys.adKey);
  return d.data?.link || null;
}

// ── Premiumize file/download helpers ──
async function pmItemFiles(id) {
  const list = await pmGet('/transfer/list', App.keys.pmKey);
  const t = (list.data?.transfers || []).find(x => String(x.id) === String(id));
  if (!t) return [];
  if (t.file_id) {
    const det = await pmGet('/item/details?id=' + t.file_id, App.keys.pmKey);
    if (det.data?.id) return [{ id: String(det.data.id), name: det.data.name || '', size: det.data.size || 0, link: det.data.link || null }];
    return [];
  }
  if (!t.folder_id) return [];
  const folder = await pmGet('/folder/list?id=' + t.folder_id, App.keys.pmKey);
  const content = folder.data?.content || [];
  const files = [];
  for (const c of content) {
    if (c.type === 'file') files.push({ id: String(c.id), name: c.name || '', size: c.size || 0, link: c.link || null });
    else if (c.type === 'folder') {
      const sub = await pmGet('/folder/list?id=' + c.id, App.keys.pmKey);
      (sub.data?.content || []).forEach(f => {
        if (f.type === 'file') files.push({ id: String(f.id), name: f.name || '', size: f.size || 0, link: f.link || null });
      });
    }
  }
  return files;
}

async function pmItemDownloadUrl(id, fileId) {
  const files = await pmItemFiles(id);
  const link = (files.find(f => String(f.id) === String(fileId)) || files[0])?.link;
  if (!link) throw new Error('No file link on Premiumize');
  return link;
}

// ── Copy / export magnet ──
async function copyMagnetText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

function exportMagnetFile(item) {
  const magnet = itemMagnetFull(item) || itemMagnetShort(item);
  if (!magnet) throw new Error('No magnet available to export');
  const name = (item.name || item.filename || 'torrent').replace(/[\\/:*?"<>|]/g, '_');
  const blob = new Blob([magnet], { type: 'application/x-bittorrent' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name + '.magnet';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
