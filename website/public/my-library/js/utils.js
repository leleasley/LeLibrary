// ── Utilities ────────────────────────────────────────────────

// Escape HTML
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Surface a meaningful error message when we have one, otherwise fall back to
// a generic message. Raw network errors ("Failed to fetch") shouldn't be shown
// verbatim.
function friendlyError(err, fallback) {
  const m = err && err.message;
  if (!m) return fallback;
  if (/^TMDB/.test(m) || /^TorBox/.test(m) || /^Real-Debrid/.test(m)
      || m.includes('API key') || m.includes('rate limit') || m.includes('Rate limited')) {
    return m;
  }
  return fallback;
}

// Format bytes to human readable
function formatBytes(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1024 / 1024 / 1024;
  return gb >= 1 ? gb.toFixed(1) + ' GB' : (bytes / 1024 / 1024).toFixed(0) + ' MB';
}

// Detect if name is a series
function isSeries(name) {
  return /\bS\d{1,2}E\d{1,2}\b/i.test(name) || /\bS\d{1,2}\b/.test(name) ||
    /\bSeason\s+\d+\b/i.test(name) || /\bComplete\b/i.test(name);
}

// Provider display labels + badge classes for library items
function providerLabel(source) {
  return { torrent: 'Torrent', usenet: 'Usenet', realdebrid: 'RD', alldebrid: 'AD', premiumize: 'PM' }[source] || 'Unknown';
}
function providerBadgeClass(source) {
  if (source === 'realdebrid') return 'rd';
  if (source === 'alldebrid') return 'ad';
  if (source === 'premiumize') return 'pm';
  if (source === 'usenet') return 'usenet';
  return 'torrent';
}

// Parse title from filename
function parseTitle(name) {
  let cleanName = name;
  let year = null;

  const yearMatch = name.match(/[\.\s\-\[\(](\d{4})[\.\s\-\[\)]/);
  if (yearMatch) {
    const y = parseInt(yearMatch[1]);
    if (y >= 1900 && y <= 2099) year = yearMatch[1];
  }

  cleanName = name
    .replace(/\.[^.]+$/, '')
    .replace(/_/g, ' ')
    .replace(/\./g, ' ')
    .replace(/\-/g, ' ')
    .replace(/\b(1080p|720p|2160p|4K|WEB-?DL|BluRay|WEBRip|x264|x265|HEVC|AVC|AAC|DDP?5\.1|Atmos|REMUX|PROPER|INTERNAL|EXTENDED|UNRATED|DIRECTORS\.?CUT|DUAL|PT-?BR|MULTI|VOSTFR|VFF|VFQ|FRE|GER|SPa|H264|H265|10bit|HDR|HDR10|DV|DoVi)\b/gi, '')
    .replace(/\b(S\d{1,2}E\d{1,2}|S\d{1,2})\b/gi, '')
    .replace(/\b(Season|Episode)\s*\d*\b/gi, '')
    .replace(/\bComplete\b/gi, '')
    .replace(/\b(-\s*[A-Za-z0-9]+)$/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-\.]+|[\s\-\.]+$/g, '')
    .trim();

  if (cleanName.length < 2) cleanName = name;

  return { cleanName, year };
}

// Parse season + episode from filename
function parseEpisodeInfo(name) {
  // S01E05, S01E05E06, S01E05E07
  const seMatch = name.match(/S(\d{1,2})E(\d{1,3})/i);
  if (seMatch) {
    return { season: parseInt(seMatch[1]), episode: parseInt(seMatch[2]) };
  }
  // Just season: Season 1, S01
  const seasonMatch = name.match(/Season\s*(\d{1,2})/i) || name.match(/\bS(\d{1,2})\b/);
  if (seasonMatch) {
    return { season: parseInt(seasonMatch[1]), episode: null };
  }
  return { season: null, episode: null };
}

// Build a grouping key for duplicate detection
// Movies: normalized title + year (or just title if no year)
// Series: normalized title + season + episode
function getDuplicateKey(item) {
  const name = item.name || item.filename || '';
  const parsed = parseTitle(name);
  const epInfo = parseEpisodeInfo(name);
  const title = parsed.cleanName.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

  if (isSeries(name)) {
    if (epInfo.season && epInfo.episode) {
      return `series|${title}|s${epInfo.season}e${epInfo.episode}`;
    }
    if (epInfo.season) {
      return `series|${title}|s${epInfo.season}`;
    }
    // Series with no parseable episode info — use raw name as key
    return `series|${title}|${name.toLowerCase()}`;
  }

  // Movie
  return `movie|${title}|${parsed.year || ''}`;
}

// Time ago helper
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return '';
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  return new Date(dateStr).toLocaleDateString();
}

// ── Web Crypto encryption ──────────────────────────────────
async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(data, password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
  return { salt: Array.from(salt), iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) };
}

async function decryptData(encObj, password) {
  const salt = new Uint8Array(encObj.salt);
  const iv = new Uint8Array(encObj.iv);
  const data = new Uint8Array(encObj.data);
  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

// ── Watchlist (localStorage) ────────────────────────────────
function getWatchlist() {
  try { return JSON.parse(localStorage.getItem('lelibrary_watchlist') || '[]'); }
  catch { return []; }
}

function saveWatchlist(list) {
  localStorage.setItem('lelibrary_watchlist', JSON.stringify(list));
}

function addToWatchlist(item) {
  const list = getWatchlist();
  if (list.some(w => w.tmdbId === item.tmdbId && w.type === item.type)) return false;
  list.unshift({ ...item, addedAt: Date.now() });
  saveWatchlist(list);
  return true;
}

function removeFromWatchlist(tmdbId, type) {
  const list = getWatchlist().filter(w => !(w.tmdbId === tmdbId && w.type === type));
  saveWatchlist(list);
}

function isInWatchlist(tmdbId, type) {
  return getWatchlist().some(w => w.tmdbId === tmdbId && w.type === type);
}

// ── Watched tracking (localStorage) ──────────────────────────
function getWatchedMap() {
  try { return JSON.parse(localStorage.getItem('lelibrary_watched') || '{}'); }
  catch { return {}; }
}

function saveWatchedMap(map) {
  localStorage.setItem('lelibrary_watched', JSON.stringify(map));
}

// Watched key: provider|id → true. Uses item source + id so it survives renames.
function watchedKey(item) {
  return (item.source || 'tb') + '|' + item.id;
}

function isWatched(item) {
  return !!getWatchedMap()[watchedKey(item)];
}

function markWatched(item) {
  const map = getWatchedMap();
  map[watchedKey(item)] = Date.now();
  saveWatchedMap(map);
}

function unmarkWatched(item) {
  const map = getWatchedMap();
  delete map[watchedKey(item)];
  saveWatchedMap(map);
}

function toggleWatched(item) {
  if (isWatched(item)) unmarkWatched(item);
  else markWatched(item);
  return isWatched(item);
}

function markManyWatched(items) {
  const map = getWatchedMap();
  for (const item of items) map[watchedKey(item)] = Date.now();
  saveWatchedMap(map);
}

// ── Settings (localStorage) ────────────────────────────────
function getSettings() {
  try { return JSON.parse(localStorage.getItem('lelibrary_settings') || '{}'); }
  catch { return {}; }
}

function saveSetting(key, value) {
  const s = getSettings();
  s[key] = value;
  localStorage.setItem('lelibrary_settings', JSON.stringify(s));
}

function getSetting(key, fallback) {
  const s = getSettings();
  return s[key] !== undefined ? s[key] : fallback;
}

// ── Library cache (IndexedDB) ──────────────────────────────
const DB_NAME = 'lelibrary';
const DB_VERSION = 1;
const STORE_NAME = 'library';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheLibrary(items) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(items, 'allItems');
    tx.objectStore(STORE_NAME).put(Date.now(), 'lastUpdated');
  } catch (e) { /* IndexedDB not available */ }
}

async function getCachedLibrary() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const items = await new Promise((resolve, reject) => {
      const req = tx.objectStore(STORE_NAME).get('allItems');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const lastUpdated = await new Promise((resolve, reject) => {
      const req = tx.objectStore(STORE_NAME).get('lastUpdated');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return { items: items || [], lastUpdated: lastUpdated || 0 };
  } catch (e) {
    return { items: [], lastUpdated: 0 };
  }
}

// Nuke the IndexedDB library cache so a different account can't see the
// previous account's cached items. Resolves when the deletion settles.
function clearLibraryCache() {
  return new Promise(resolve => {
    try {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch (e) { resolve(); }
  });
}
