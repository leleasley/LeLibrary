const crypto = require('crypto');
const cache = require('../cache');
const { getTorBoxDownloads, getTorBoxFiles, getTorBoxStreamLink } = require('../torbox');
const { getRealDebridDownloads, getRealDebridFiles, getRealDebridStreamLink } = require('../realdebrid');
const alldebrid = require('./alldebrid');
const premiumize = require('./premiumize');

// Single source of truth for provider UI + manifests + cache keys.
// `cat` = catalog id prefix (torbox-movies, rd-movies, ...).
// `key` = the config field holding the API key.
const PROVIDER_META = {
  torbox:     { id: 'torbox',     label: 'TorBox',      short: 'TB', logo: '/provider-logos/torbox.png',     cat: 'torbox', key: 'torboxApiKey', badge: 'tb' },
  realdebrid: { id: 'realdebrid', label: 'Real-Debrid', short: 'RD', logo: '/provider-logos/realdebrid.svg', cat: 'rd',     key: 'rdApiKey',      badge: 'rd' },
  alldebrid:  { id: 'alldebrid',  label: 'AllDebrid',   short: 'AD', logo: '/provider-logos/alldebrid.png',  cat: 'ad',     key: 'adApiKey',      badge: 'ad' },
  premiumize: { id: 'premiumize', label: 'Premiumize',  short: 'PM', logo: '/provider-logos/premiumize.svg', cat: 'pm',     key: 'pmApiKey',      badge: 'pm' },
};
const PROVIDER_ORDER = ['torbox', 'realdebrid', 'alldebrid', 'premiumize'];

// item.source → provider id (torrents/usenet both live on TorBox)
const SOURCE_TO_PROVIDER = {
  torrent: 'torbox',
  usenet: 'torbox',
  realdebrid: 'realdebrid',
  alldebrid: 'alldebrid',
  premiumize: 'premiumize',
};

function providerBySource(source) {
  return SOURCE_TO_PROVIDER[source] || null;
}

function providerByCat(prefix) {
  for (const id of PROVIDER_ORDER) if (PROVIDER_META[id].cat === prefix) return id;
  return null;
}

// Resolve the active provider ids for a config. Handles the legacy single
// values ('torbox', 'realdebrid', 'both') and the new comma-separated set.
// Only providers that actually have a key configured count as active.
function activeProviders(config = {}) {
  const raw = (config.provider || '').trim();
  let ids;
  if (!raw) ids = [];
  else if (raw === 'both') ids = ['torbox', 'realdebrid'];
  else ids = raw.split(',').map(s => s.trim()).filter(Boolean);
  return PROVIDER_ORDER.filter(id => ids.includes(id) && config[PROVIDER_META[id].key]);
}

// Stable per-user key from the sorted id:key pairs — a full hash, never a
// plain key fragment (replaces the old slice(-6) namespace).
function getUserKey(config = {}) {
  const pairs = activeProviders(config)
    .map(id => `${id}:${config[PROVIDER_META[id].key]}`)
    .sort()
    .join('|');
  if (!pairs) return '';
  return crypto.createHash('sha256').update(pairs).digest('hex').slice(0, 12);
}

// Fetch downloads for a provider id (array of items with `.source` set).
async function downloadsForProvider(config, id) {
  switch (id) {
    case 'torbox':     return getTorBoxDownloads(config.torboxApiKey);
    case 'realdebrid': return getRealDebridDownloads(config.rdApiKey);
    case 'alldebrid':  return alldebrid.getAlldebridDownloads(config.adApiKey);
    case 'premiumize': return premiumize.getPremiumizeDownloads(config.pmApiKey);
    default:           return [];
  }
}

// Downloads cache key, scoped to the user so one user's library never leaks.
// The in-memory index (tmdbindex) already caches per-user matches; this caches
// the RAW provider downloads so the discovery owned-bridge can answer "does the
// user own this?" without re-hitting TorBox/Real-Debrid on every tt: request.
const DOWNLOADS_TTL = 10 * 60; // 10 minutes

function downloadsCacheKey(config = {}) {
  const userKey = getUserKey(config);
  return userKey ? cache.makeKey('dlcache', userKey) : null;
}

async function getCachedDownloads(config = {}) {
  const key = downloadsCacheKey(config);
  if (!key) return null;
  return cache.get(key);
}

async function setCachedDownloads(config = {}, downloads) {
  const key = downloadsCacheKey(config);
  if (!key) return;
  await cache.set(key, downloads, DOWNLOADS_TTL);
}

// Fetch downloads from all active providers (or only the listed subset).
// One provider failing must not empty the others.
// When `useCache` is true (default) and a fresh-enough copy exists in Redis,
// it returns that instead of hitting the providers — the discovery owned-bridge
// uses this so every tt: stream request doesn't re-fetch 500+ TorBox downloads.
async function fetchDownloads(config = {}, { only = null, useCache = true } = {}) {
  if (useCache) {
    try {
      const cached = await getCachedDownloads(config);
      if (Array.isArray(cached)) return cached;
    } catch { /* cache miss — fall through to live fetch */ }
  }
  const list = only && only.length ? only : activeProviders(config);
  const results = [];
  await Promise.all(list.map(async id => {
    try {
      results.push(...await downloadsForProvider(config, id));
    } catch (err) {
      console.error(`[Providers] ${id} downloads failed (continuing): ${err.message}`);
    }
  }));
  if (useCache) {
    try { await setCachedDownloads(config, results); } catch { /* non-fatal */ }
  }
  return results;
}

// Keep only downloads that belong to one provider.
function downloadsFor(downloads, providerId) {
  return downloads.filter(d => providerBySource(d.source) === providerId);
}

async function getFiles(config, item) {
  const id = providerBySource(item.source);
  try {
    if (id === 'torbox')     return getTorBoxFiles(config.torboxApiKey, item.source, item.id);
    if (id === 'realdebrid') return getRealDebridFiles(config.rdApiKey, item.id);
    if (id === 'alldebrid')  return alldebrid.getAlldebridFiles(config.adApiKey, item.id);
    if (id === 'premiumize') return premiumize.getPremiumizeFiles(config.pmApiKey, item.id);
  } catch (e) { /* ignore */ }
  return [];
}

async function getStreamLink(config, item, fileId) {
  const id = providerBySource(item.source);
  try {
    if (id === 'torbox')     return getTorBoxStreamLink(config.torboxApiKey, item.source, item.id, fileId);
    if (id === 'realdebrid') return getRealDebridStreamLink(config.rdApiKey, item.id, fileId);
    if (id === 'alldebrid')  return alldebrid.getAlldebridStreamLink(config.adApiKey, item.id, fileId);
    if (id === 'premiumize') return premiumize.getPremiumizeStreamLink(config.pmApiKey, item.id, fileId);
  } catch (e) { /* ignore */ }
  return null;
}

module.exports = {
  PROVIDER_META,
  PROVIDER_ORDER,
  providerBySource,
  providerByCat,
  activeProviders,
  getUserKey,
  fetchDownloads,
  getCachedDownloads,
  setCachedDownloads,
  downloadsFor,
  getFiles,
  getStreamLink,
};
