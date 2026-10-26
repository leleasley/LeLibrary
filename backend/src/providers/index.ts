const crypto = require('crypto');
const cache = require('../runtime/cache.ts');
const { getTorBoxDownloads, getTorBoxFiles, getTorBoxStreamLink, getTorBoxPlaybackStatus } = require('./torbox.ts');
const { getRealDebridDownloads, getRealDebridFiles, getRealDebridStreamLink } = require('./realdebrid.ts');
const alldebrid = require('./alldebrid.ts');
const premiumize = require('./premiumize.ts');
const webdav = require('./webdav.ts');

// Single source of truth for provider UI + manifests + cache keys.
// `cat` = catalog id prefix (torbox-movies, rd-movies, ...).
// `key` = the config field holding the API key.
export interface ProviderMetaRow {
  id: string; label: string; short: string; logo: string; cat: string; key: string; badge: string;
}
const PROVIDER_META: Record<string, ProviderMetaRow> = {
  torbox:     { id: 'torbox',     label: 'TorBox',      short: 'TB', logo: '/provider-logos/torbox.png',     cat: 'torbox', key: 'torboxApiKey', badge: 'tb' },
  realdebrid: { id: 'realdebrid', label: 'Real-Debrid', short: 'RD', logo: '/provider-logos/realdebrid.svg', cat: 'rd',     key: 'rdApiKey',      badge: 'rd' },
  alldebrid:  { id: 'alldebrid',  label: 'AllDebrid',   short: 'AD', logo: '/provider-logos/alldebrid.png',  cat: 'ad',     key: 'adApiKey',      badge: 'ad' },
  premiumize: { id: 'premiumize', label: 'Premiumize',  short: 'PM', logo: '/provider-logos/premiumize.svg', cat: 'pm',     key: 'pmApiKey',      badge: 'pm' },
  // Self-host only (WEBDAV_SOURCE=on): the user's own WebDAV server. Its
  // secret is three fields (address, user, password); `key` is the address.
  webdav:     { id: 'webdav',     label: 'WebDAV',      short: 'DAV', logo: '/provider-logos/webdav.svg',   cat: 'dav',    key: 'webdavUrl',     badge: 'dav' },
};
const PROVIDER_ORDER = ['torbox', 'realdebrid', 'alldebrid', 'premiumize', 'webdav'];

// item.source → provider id (torrents/usenet/webdl all live on TorBox)
const SOURCE_TO_PROVIDER: Record<string, string | null> = {
  torrent: 'torbox',
  usenet: 'torbox',
  webdl: 'torbox',
  realdebrid: 'realdebrid',
  alldebrid: 'alldebrid',
  premiumize: 'premiumize',
  webdav: 'webdav',
};

// Is this provider usable for a config? WebDAV also needs the self-host
// switch and a valid address; every other provider just needs its key.
function hasProviderKey(config: any, id: string) {
  if (id === 'webdav') return webdav.webdavEnabled() && webdav.davConnection(config) !== null;
  return Boolean(config[PROVIDER_META[id].key]);
}

// The value that identifies a provider's library in the scope id. WebDAV uses
// address + user (not the password), so a new password keeps the library.
function scopeValue(config: any, id: string) {
  if (id === 'webdav') return webdav.davConnection(config).scopeSeed;
  return config[PROVIDER_META[id].key];
}

// TorBox lists three kinds of download. `torboxSources` on the config limits
// the library to some of them (issue #16: usenet only). Absent, empty or
// unrecognised means all three, so existing setups are unchanged.
const TORBOX_SOURCES = ['torrent', 'usenet', 'webdl'];

function torboxSources(config: any = {}) {
  const raw = config.torboxSources;
  const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',') : []);
  const picked = TORBOX_SOURCES.filter(source => list.some((v: any) => typeof v === 'string' && v.trim() === source));
  return picked.length ? picked : TORBOX_SOURCES.slice();
}

// Stable short id of a non-default selection ('' when every source is on),
// for cache keys and change detection.
function torboxSourcesKey(config: any = {}) {
  const picked = torboxSources(config);
  return picked.length === TORBOX_SOURCES.length ? '' : picked.join(',');
}

// Drop TorBox downloads whose source the config leaves out. Other providers'
// items pass through. Keeps the non-enumerable `failedProviders` marker.
function filterTorboxSources(config: any, downloads: any) {
  if (!Array.isArray(downloads) || !torboxSourcesKey(config)) return downloads;
  const allowed = new Set(torboxSources(config));
  const out = downloads.filter((d: any) => !TORBOX_SOURCES.includes(d?.source) || allowed.has(d.source));
  const failed = (downloads as any).failedProviders;
  if (failed) Object.defineProperty(out, 'failedProviders', { value: failed, enumerable: false });
  return out;
}

function providerBySource(source: any) {
  return SOURCE_TO_PROVIDER[source] || null;
}

function providerByCat(prefix: any) {
  for (const id of PROVIDER_ORDER) if (PROVIDER_META[id].cat === prefix) return id;
  return null;
}

// Resolve the active provider ids for a config. Handles the legacy single
// values ('torbox', 'realdebrid', 'both') and the new comma-separated set.
// Only providers that actually have a key configured count as active.
function activeProviders(config: any = {}) {
  // Coerce defensively: config tokens are arbitrary user-supplied JSON, and a
  // crafted non-string `provider` used to throw on `.trim()` and take the
  // whole process down via an unhandled async rejection. Even String() can
  // throw on objects with a poisoned toString, so only strings/numbers pass.
  const p = config.provider;
  const raw = typeof p === 'string' ? p.trim() : (typeof p === 'number' ? String(p) : '');
  let ids: string[];
  if (!raw) {
    // v5.5 setups keep provider keys in a sealed store and may not carry the
    // legacy `provider` selection: infer it from key presence so a saved key
    // is usable. Legacy tokens always carry `provider`, so they never reach
    // this branch and behave exactly as before.
    ids = PROVIDER_ORDER.filter(id => hasProviderKey(config, id));
  }
  else if (raw === 'both') ids = ['torbox', 'realdebrid'];
  else ids = raw.split(',').map(s => s.trim()).filter(Boolean);
  return PROVIDER_ORDER.filter(id => ids.includes(id) && hasProviderKey(config, id));
}

// Stable per-user key from the sorted id:key pairs: a full hash, never a
// plain key fragment (replaces the old slice(-6) namespace).
function getUserKey(config: any = {}) {
  const pairs = activeProviders(config)
    .map(id => `${id}:${scopeValue(config, id)}`)
    .sort()
    .join('|');
  if (!pairs) return '';
  return crypto.createHash('sha256').update(pairs).digest('hex').slice(0, 12);
}

// Fetch downloads for a provider id (array of items with `.source` set).
async function downloadsForProvider(config: any, id: any, options: any = {}) {
  switch (id) {
    case 'torbox':     return getTorBoxDownloads(config.torboxApiKey, options);
    case 'realdebrid': return getRealDebridDownloads(config.rdApiKey);
    case 'alldebrid':  return alldebrid.getAlldebridDownloads(config.adApiKey);
    case 'premiumize': return premiumize.getPremiumizeDownloads(config.pmApiKey);
    case 'webdav':     return webdav.listWebdavLibrary(config, { fresh: Boolean(options.requireFresh) });
    default:           return [];
  }
}

// Downloads cache key, scoped to the user so one user's library never leaks.
// The in-memory index (tmdbindex) already caches per-user matches; this caches
// the RAW provider downloads so the discovery owned-bridge can answer "does the
// user own this?" without re-hitting TorBox/Real-Debrid on every tt: request.
const DOWNLOADS_TTL = 10 * 60; // 10 minutes
// One slow provider refresh must be shared by all requests for the same
// account. Nuvio commonly asks for the same title more than once while a
// detail page opens; without this guard each request could start a separate
// multi-page TorBox download scan.
const downloadsInFlight = new Map();

function downloadsCacheKey(config: any = {}) {
  const userKey = getUserKey(config);
  if (!userKey) return null;
  // A limited TorBox selection gets its own snapshot: a library sync seeds
  // the cache with its already-filtered list.
  return cache.makeKey('dlcache', userKey, torboxSourcesKey(config));
}

async function getCachedDownloads(config: any = {}) {
  const key = downloadsCacheKey(config);
  if (!key) return null;
  const cached = await cache.get(key);
  // Empty snapshots from older provider failures must never keep a library
  // blank. Successful non-empty snapshots remain the normal fast path.
  return Array.isArray(cached) && cached.length === 0 ? null : cached;
}

async function setCachedDownloads(config: any = {}, downloads: any) {
  const key = downloadsCacheKey(config);
  if (!key) return;
  // Do not persist an empty snapshot. It may be a real empty account, but
  // preserving a previous library is safer than treating a transient outage
  // as destructive state.
  if (!Array.isArray(downloads) || downloads.length === 0) return;
  await cache.set(key, downloads, DOWNLOADS_TTL);
}

// Fetch downloads from all active providers (or only the listed subset).
// One provider failing must not empty the others.
// When `useCache` is true (default) and a fresh-enough copy exists in Redis,
// it returns that instead of hitting the providers: the discovery owned-bridge
// uses this so every tt: stream request doesn't re-fetch 500+ TorBox downloads.
// TorBox source limits (`torboxSources`) apply to the result, cached or live.
async function fetchDownloads(config: any = {}, options: { only?: string[] | null; useCache?: boolean; requireFresh?: boolean } = {}) {
  return filterTorboxSources(config, await fetchAllDownloads(config, options));
}

async function fetchAllDownloads(config: any = {}, { only = null, useCache = true, requireFresh = false }: { only?: string[] | null; useCache?: boolean; requireFresh?: boolean } = {}) {
  if (useCache) {
    try {
      const cached = await getCachedDownloads(config);
      if (Array.isArray(cached)) return cached;
    } catch { /* cache miss: fall through to live fetch */ }
  }
  const userKey = getUserKey(config);
  const requestKey = `${userKey}:${only?.slice().sort().join(',') || '*'}:${requireFresh ? 'fresh' : 'stale-ok'}`;
  const existing = downloadsInFlight.get(requestKey);
  if (existing) return existing;

  const pending = (async () => {
    const list = only && only.length ? only : activeProviders(config);
    const results: any[] = [];
    const failures: any[] = [];
    await Promise.all(list.map(async id => {
      try {
        results.push(...await downloadsForProvider(config, id, { requireFresh }));
      } catch (err: any) {
        console.error(`[Providers] ${id} downloads failed (continuing): ${err.message}`);
        failures.push({ id, err });
      }
    }));
    // An empty account is valid, but an empty result caused by every active
    // provider failing is not. Propagate it so callers retain their last good
    // catalogue instead of caching an empty library during a TorBox backoff.
    if (list.length > 0 && failures.length === list.length) {
      throw failures[0].err;
    }
    if (useCache) {
      try { await setCachedDownloads(config, results); } catch { /* non-fatal */ }
    }
    // Which providers failed this time, so a library sync keeps their rows
    // instead of removing them (a NAS asleep next to a working TorBox).
    Object.defineProperty(results, 'failedProviders', { value: failures.map((failure) => failure.id), enumerable: false });
    return results;
  })();
  downloadsInFlight.set(requestKey, pending);
  try { return await pending; } finally { downloadsInFlight.delete(requestKey); }
}

// Keep only downloads that belong to one provider.
function downloadsFor(downloads: any, providerId: any) {
  return downloads.filter((d: any) => providerBySource(d.source) === providerId);
}

async function getFiles(config: any, item: any) {
  const id = providerBySource(item.source);
  try {
    if (id === 'torbox')     return getTorBoxFiles(config.torboxApiKey, item.source, item.id);
    if (id === 'realdebrid') return getRealDebridFiles(config.rdApiKey, item.id);
    if (id === 'alldebrid')  return alldebrid.getAlldebridFiles(config.adApiKey, item.id);
    if (id === 'premiumize') return premiumize.getPremiumizeFiles(config.pmApiKey, item.id);
    if (id === 'webdav')     return webdav.getWebdavFiles(config, item);
  } catch (e) { /* ignore */ }
  return [];
}

async function getStreamLink(config: any, item: any, fileId: any) {
  const id = providerBySource(item.source);
  try {
    if (id === 'torbox')     return getTorBoxStreamLink(config.torboxApiKey, item.source, item.id, fileId);
    if (id === 'realdebrid') return getRealDebridStreamLink(config.rdApiKey, item.id, fileId);
    if (id === 'alldebrid')  return alldebrid.getAlldebridStreamLink(config.adApiKey, item.id, fileId);
    if (id === 'premiumize') return premiumize.getPremiumizeStreamLink(config.pmApiKey, item.id, fileId);
    // WebDAV has no provider link: playback streams through LeLibrary
    // (routes/stream.ts handleOwnedPlay -> webdav.proxyWebdavFile).
  } catch (e) { /* ignore */ }
  return null;
}

// Return privacy-safe, user-facing playback state only for providers that were
// actually attempted. Provider adapters keep credentials and anonymous cache
// identities private; callers receive only a label and rounded retry time.
async function getPlaybackRateLimits(config: any = {}, providerIds: string[] = []) {
  const attempted = new Set(providerIds);
  const notices: any[] = [];
  if (attempted.has('torbox') && config.torboxApiKey) {
    const status = await getTorBoxPlaybackStatus(config.torboxApiKey);
    if (status?.rateLimited) notices.push({ ...(status as Record<string, unknown>), label: (PROVIDER_META as Record<string, ProviderMetaRow>).torbox.label });
  }
  return notices;
}

export interface IndexApi {
  // implemented below as providersApi;
  PROVIDER_META: any;
  PROVIDER_ORDER: any;
  providerBySource: any;
  providerByCat: any;
  activeProviders: any;
  getUserKey: any;
  fetchDownloads: any;
  getCachedDownloads: any;
  setCachedDownloads: any;
  torboxSources: any;
  torboxSourcesKey: any;
  filterTorboxSources: any;
  downloadsFor: any;
  getFiles: any;
  getStreamLink: any;
  getPlaybackRateLimits: any;
}

const providersApi = {
  PROVIDER_META,
  PROVIDER_ORDER,
  providerBySource,
  providerByCat,
  activeProviders,
  getUserKey,
  fetchDownloads,
  getCachedDownloads,
  setCachedDownloads,
  torboxSources,
  torboxSourcesKey,
  filterTorboxSources,
  downloadsFor,
  getFiles,
  getStreamLink,
  getPlaybackRateLimits,
};

module.exports = providersApi satisfies IndexApi;
