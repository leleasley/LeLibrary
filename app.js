const express = require('express');
const fs      = require('fs');
const path    = require('path');
const cache   = require('./src/cache');
const providers = require('./src/providers');
const { buildCatalog, buildMeta, buildStreams, populateTmdbIndexFromMetas } = require('./src/builder');
const { buildDiscoveryCatalog, buildDiscoveryMeta, buildDiscoveryStreams } = require('./src/discovery');
const { buildCollectionsCatalog, cacheCollections, getCollectionMeta, getCollections, getCollectionForMovie } = require('./src/collections');

let createWebRoutes = null;
try {
  const webEntry = fs.existsSync(path.join(__dirname, 'website', 'index.js'))
    ? path.join(__dirname, 'website', 'index.js')
    : path.join(__dirname, 'website', 'index.example.js');
  createWebRoutes = require(webEntry);
} catch (err) {
  console.warn(`[website] Web routes unavailable (${err.message}) — addon routes only`);
}

const ROOT_DIR = path.resolve(__dirname);

// Private addon identity (gitignored). When absent — self-hosted builds — the
// addon serves a generic manifest so self-hosters never expose the official
// id or the signed Stremio registry config.
let REGISTRY = null;
try { REGISTRY = require('./src/registry'); } catch (e) { /* self-hosted build */ }

const http  = require('http');
const https = require('https');

// Simple per-IP rate limiter for the config-store routes. (This is a tiny copy
// of the one in website/index.js so the addon core doesn't depend on the
// private website file to guard these endpoints.)
const rateLimitBuckets = new Map();
function rateLimit({ windowMs = 60000, max = 30 } = {}) {
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    let bucket = rateLimitBuckets.get(ip);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      rateLimitBuckets.set(ip, bucket);
    }
    bucket.count++;
    if (bucket.count > max) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
    }
    next();
  };
}
setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [ip, b] of rateLimitBuckets) { if (b.start < cutoff) rateLimitBuckets.delete(ip); }
}, 300000);

// Reuse TCP/TLS connections to provider APIs (TorBox, Real-Debrid, TMDB).
// axios opens a brand-new connection per request by default and each TLS
// handshake can cost 100ms–1s depending on the provider — keep-alive makes the
// repeated calls (key verify, catalog/meta/stream builds, TMDB proxy) faster.
http.globalAgent.keepAlive  = true;
https.globalAgent.keepAlive = true;

const TTL_CATALOG = parseInt(process.env.CACHE_TTL_CATALOG) || 3600;  // default 1h
const TTL_STREAM  = parseInt(process.env.CACHE_TTL_STREAM)  || 600;  // default 10min

const knownConfigs = new Map();

// Add Stremio protocol cache hints (seconds) so clients reuse data while revalidating
function withCacheHints(obj, { cacheMaxAge = 60, staleRevalidate = 60, staleError = 1800 } = {}) {
  return { ...obj, cacheMaxAge, staleRevalidate, staleError };
}

function hashShort(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Fingerprint of poster/rating config so caches are keyed per config, not shared
function posterFp(config) {
  const { erdbToken = '', rpdbKey = '', fanartKey = '', omdbKey = '', posterProvider = '', enhanceBackground = false, enhanceLogo = false } = config;
  return hashShort([posterProvider, erdbToken, rpdbKey, fanartKey, omdbKey, enhanceBackground ? 1 : 0, enhanceLogo ? 1 : 0].join('|'));
}

const app = express();

app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Never log query strings (they used to carry API keys) or base64 config
// tokens (which contain the keys) — redact long base64url-looking segments.
function maskSensitivePath(p) {
  return p.split('/').map(seg => /^[A-Za-z0-9_-]{16,}$/.test(seg) ? '[token]' : seg).join('/');
}

app.use((req, res, next) => {
  const url = req.originalUrl || req.url;
  const isAsset = /\.(css|js|png|jpg|jpeg|svg|webp|ico|webmanifest|woff2?|ttf|map)(\?|$)/i.test(url) || url.startsWith('/img/');
  if (!isAsset) console.log(`[REQ] ${req.method} ${maskSensitivePath(req.path)}`);
  next();
});

// ── Website routes (landing, configure, library, discover, proxies) ──
if (createWebRoutes) app.use(createWebRoutes(decodeConfig));

// ── Server-side config store (stream settings) ──
// Lives HERE (git-tracked, auto-deployed) rather than in the private
// website/index.js so the addon never depends on a manually-synced file for
// the custom formatter / stream addon settings to work. The configure page
// saves the heavy stream settings keyed by the user's stable hash; the addon
// merges them back on every stream/meta request.
app.post('/api/save-config', rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
  try {
    const config = req.body && req.body.config;
    if (!config || typeof config !== 'object') return res.status(400).json({ error: 'Missing config' });
    const userKey = await require('./src/configstore').saveStreamSettings(config);
    if (!userKey) return res.status(400).json({ error: 'Config has no usable API keys' });
    res.json({ ok: true, userKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Return the server-side stream settings for a token's user so the configure
// form can pre-fill them even when the token itself is missing them.
app.get('/api/config/:token', async (req, res) => {
  const config = decodeConfig(req.params.token);
  if (!config) return res.status(400).json({ error: 'Invalid token' });
  try {
    const userKey = providers.getUserKey(config);
    const stored = userKey ? await require('./src/configstore').loadStreamSettings(userKey) : null;
    res.json(stored || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Addon core routes ───────────────────────────────────────────────

// Proxy TMDB images to avoid CORS blocking
const axiosImg = require('axios');
app.get('/img/tmdb/*', async (req, res) => {
  try {
    const tmdbPath = req.params[0];
    const url = `https://image.tmdb.org/t/p/${tmdbPath}`;
    const resp = await axiosImg.get(url, {
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'LeLibrary/2.0' },
      timeout: 10000,
    });
    res.setHeader('Content-Type', resp.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.send(Buffer.from(resp.data));
  } catch (err) {
    console.error('[IMG PROXY]', err.message);
    res.status(502).end();
  }
});

function decodeConfig(str) {
  if (!str || typeof str !== 'string' || str.length > 2048) return null;
  try {
    const padded   = str + '=='.slice(0, (4 - (str.length % 4)) % 4);
    const standard = padded.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(Buffer.from(standard, 'base64').toString('utf8'));
    if (!decoded || typeof decoded !== 'object') return null;
    return decoded;
  } catch { return null; }
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function parseExtra(str) {
  const extra = {};
  if (!str || typeof str !== 'string' || str.length > 512) return extra;
  try {
    str.split('&').forEach(pair => {
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const key = safeDecode(pair.slice(0, eq));
        const val = safeDecode(pair.slice(eq + 1));
        if (key.length < 50 && val.length < 200) extra[key] = val;
      }
    });
  } catch { /* malformed input — ignore and return what we parsed */ }
  return extra;
}

const TYPES   = ['movie', 'series', 'anime'];
const REFRESH = 2 * 60 * 1000;

// Fingerprint of a user's library. Includes updated_at AND the name so in-place
// edits (renames, file changes) also trigger a rebuild, not just add/remove —
// Real-Debrid items have no updated_at, so name is what catches renames there.
function hashDownloads(downloads) {
  return downloads
    .map(d => `${d.id}:${d.name || d.filename || ''}:${d.updated_at || d.created_at || ''}`)
    .sort()
    .join(',');
}

async function buildAndCacheForConfig(token, config) {
  // Merge server-side settings (incl. the libraryIdMode toggle) so the
  // background rebuild matches what the on-demand route would serve.
  config = await require('./src/configstore').mergeStoredConfig(config);
  const { tmdbApiKey, sortBy = 'data_adicao', lang = 'pt-BR', rdCatalog = 'merge', erdbToken, rpdbKey, fanartKey, hideAnime, libraryIdMode } = config;
  if (!tmdbApiKey) return;

  const active = providers.activeProviders(config);
  const userKey = providers.getUserKey(config);
  if (!active.length) return;

  console.log(`[Cache] Refresh for ...${token.slice(-8)} (${lang}) providers=${active.join(',')}`);
  try {
    // Always fetch FRESH for the background rebuild (it must detect library
    // changes) but seed the Redis downloads cache so the discovery stream path
    // can answer the owned-bridge without re-hitting TorBox.
    const downloads = await providers.fetchDownloads(config, { useCache: false });
    await providers.setCachedDownloads(config, downloads);
    const newHash   = hashDownloads(downloads);
    const hashKey   = cache.makeKey('dlhash', userKey);
    const oldHash   = await cache.get(hashKey);

    if (oldHash === newHash) {
      console.log(`[Cache] Downloads unchanged, skip rebuild`);
      // Keep long-TTL catalog cache warm so it doesn't expire and force a slow rebuild
      await cache.touchPattern(`cat:*${userKey}*`, TTL_CATALOG);
      await cache.expire(hashKey, 7200);
      return;
    }

    // Resilience: if the provider suddenly returns nothing but we previously had
    // content, don't wipe the cached catalogs. A transient provider blip (or a
    // silently-failing key) shouldn't blank someone's library for hours.
    if (downloads.length === 0 && oldHash) {
      console.log('[Cache] Downloads empty but we had content — keeping existing catalog');
      await cache.touchPattern(`cat:*${userKey}*`, TTL_CATALOG);
      await cache.expire(hashKey, 7200);
      return;
    }

    const sources = rdCatalog === 'separate'
      ? active.map(id => ({ key: providers.PROVIDER_META[id].cat, downloads: providers.downloadsFor(downloads, id) }))
      : [{ key: 'merged', downloads }];

    await Promise.all(sources.flatMap(({ key, downloads: dl }) =>
      TYPES.map(async type => {
        const metas    = await buildCatalog(dl, tmdbApiKey, type, sortBy, { skip: 0, search: '' }, lang, { erdbToken, rpdbKey }, { userKey, hideAnime, libraryIdMode });
        const cacheKey = cache.makeKey('cat', key, type, sortBy, '', '0', userKey, lang, posterFp(config), libraryIdMode);
        await cache.set(cacheKey, { metas }, TTL_CATALOG);
        console.log(`[Cache] ${key}:${type} → ${metas.length} items`);
      })
    ));

    // Collections catalog — merged across all providers, additive.
    const collMetas = await buildCollectionsCatalog(downloads, tmdbApiKey, lang, { erdbToken, rpdbKey });
    cacheCollections(userKey, lang, collMetas);
    const collKey = cache.makeKey('cat', 'collections', 'collections', sortBy, '', '0', userKey, lang, posterFp(config));
    await cache.set(collKey, { metas: collMetas }, TTL_CATALOG);
    console.log(`[Cache] collections → ${collMetas.length} items`);

    // Pre-warm Trending / Popular so their first on-screen load is instant
    // (each row needs per-title IMDb lookups, which is slow on a cold build).
    // Uses buildDiscoveryCatalog so the cached rows carry this user's poster
    // providers and are keyed by the poster fingerprint.
    const { buildDiscoveryCatalog } = require('./src/discovery');
    const discEnhance = { erdbToken, rpdbKey, fanartKey, posterProvider: config.posterProvider };
    const discFp = posterFp(config);
    if (config.catalogTrending) {
      await Promise.allSettled([
        buildDiscoveryCatalog({ tmdbApiKey, kind: 'trending', apiType: 'movie', lang, userKey, enhance: discEnhance, posterFp: discFp }),
        buildDiscoveryCatalog({ tmdbApiKey, kind: 'trending', apiType: 'tv', lang, userKey, enhance: discEnhance, posterFp: discFp }),
      ]);
      console.log('[Cache] trending pre-warmed');
    }
    if (config.catalogPopular) {
      await Promise.allSettled([
        buildDiscoveryCatalog({ tmdbApiKey, kind: 'popular', apiType: 'movie', lang, userKey, enhance: discEnhance, posterFp: discFp }),
        buildDiscoveryCatalog({ tmdbApiKey, kind: 'popular', apiType: 'tv', lang, userKey, enhance: discEnhance, posterFp: discFp }),
      ]);
      console.log('[Cache] popular pre-warmed');
    }

    // Only update hash and invalidate caches after ALL catalogs built successfully
    await cache.set(hashKey, newHash, 7200);
    // Scope invalidation to THIS user's caches. Meta and stream keys embed the
    // user key hash, so a bare 'meta:*' / 'stream:*' wipe would evict every
    // other user's cached metas and streams on every library change.
    await cache.delPattern(`meta:*${userKey}*`);
    await cache.delPattern(`stream:*${userKey}*`);
    console.log('[Cache] Meta + stream caches invalidated after catalog rebuild');
  } catch (err) {
    console.error('[Cache] Error:', err.message);
  }
}

setInterval(async () => {
    for (const [token, config] of knownConfigs.entries()) {
      await buildAndCacheForConfig(token, config).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
    }
  }, REFRESH);

function getLogoUrl(baseUrl) {
  return `${baseUrl}/LeLibrary.png?v=2`;
}

function getBaseManifest(baseUrl) {
  const manifest = {
    id: (REGISTRY && REGISTRY.addonId) || 'community.lelibrary.selfhosted',
    version: '4.8.0',
    name: (REGISTRY && REGISTRY.name) || 'LeLibrary (Self-Hosted)',
    description: (REGISTRY && REGISTRY.description) || 'Your movies, series & anime from every debrid provider, beautifully organized with TMDB artwork and ratings.',
    logo: getLogoUrl(baseUrl),
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series', 'anime'],
    idPrefixes: ['torbox:', 'tt', 'kitsu:'],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: true },
    configureUrl: `${baseUrl}/configure`,
  };
  if (REGISTRY && REGISTRY.stremioAddonsConfig) {
    manifest.stremioAddonsConfig = REGISTRY.stremioAddonsConfig;
  }
  return manifest;
}

function getConfiguredManifest(baseUrl, config = {}) {
  const { rdCatalog = 'merge', catNameMovies, catNameSeries, catNameAnime, hideAnime } = config;
  const active  = providers.activeProviders(config);
  const separate = rdCatalog === 'separate';

  function catName(def, custom) { return custom || def; }
  // Per-catalogue names (Edit Catalogues), with the legacy single trendingName /
  // popularName still honoured so old configs keep working.
  const DISCOVERY = {
    trendingMovies:  catName('🔥 Trending Movies',  config.trendingMoviesName || config.trendingName),
    trendingSeries:  catName('🔥 Trending Series',  config.trendingSeriesName || config.trendingName),
    popularMovies:   catName('⭐ Popular Movies',   config.popularMoviesName  || config.popularName),
    popularSeries:   catName('⭐ Popular Series',   config.popularSeriesName  || config.popularName),
  };
  const CAT_EXTRA = [{ name: 'skip' }, { name: 'search' }];

  const catalogs = [];
  const EMOJI = { torbox: '🎬', realdebrid: '🔴', alldebrid: '💠', premiumize: '🧲' };

  // ── Library rows (My Movies / My Series / My Anime) ──
  // buildLibrary('movies') adds just that catalogue type so each row can be
  // reordered or hidden independently in the Edit Catalogues tab.
  function buildLibrary(type) {
    if (type === 'movies' && config.catalogMovies === false) return;
    if (type === 'series' && config.catalogSeries === false) return;
    if (type === 'anime' && config.catalogAnime === false) return;
    const pushLib = (prefix, id, name) => {
      catalogs.push({ id: `${prefix}-${id}`, type: id === 'movies' ? 'movie' : 'series', name, extra: CAT_EXTRA });
    };
    const groups = [];
    if (active.length === 1) {
      groups.push(providers.PROVIDER_META[active[0]].cat);
    } else if (active.length > 1 && !separate) {
      groups.push(active.includes('torbox') ? 'torbox' : providers.PROVIDER_META[active[0]].cat);
    } else if (active.length > 1) {
      groups.push(...active.map(id => providers.PROVIDER_META[id].cat));
    }
    for (const prefix of groups) {
      if (type === 'movies') pushLib(prefix, 'movies', catName('🎬 My Movies', catNameMovies));
      else if (type === 'series') pushLib(prefix, 'series', catName('📺 My Series', catNameSeries));
      else if (type === 'anime' && !hideAnime) pushLib(prefix, 'anime', catName('🍥 LeLibrary Anime', catNameAnime));
    }
  }

  // ── "LeLibrary Collections" movie catalog (torbox-collections) ──
  // ONE catalog listing every owned franchise film as a plain movie. Both
  // platforms filter it through the `genre` extra (a franchise name): Nuvio
  // collection folders send genre in the catalog URL, and Stremio's Discover
  // shows a genre dropdown for catalogs that declare `options`. This replaces
  // the old one-catalog-per-franchise rows, which bloated the manifest to
  // ~38 catalogue entries. Hidden from Nuvio Home via `showInHome: false`;
  // Stremio ignores that field so the row still appears in Discover.
  function buildCollectionsRow() {
    if (config.catalogFranchises === false) return;
    const userKey = providers.getUserKey(config);
    const collLang = config.lang || 'pt-BR';
    const colls = getCollections(userKey, collLang);
    const genres = colls.map(c => franchiseRowName(c.name)).filter(Boolean);
    catalogs.push({
      id: 'torbox-collections',
      type: 'movie',
      name: config.collectionsName || 'LeLibrary Collections',
      showInHome: false,
      extra: [
        { name: 'genre', isRequired: false, options: genres },
        { name: 'skip' },
        { name: 'search' },
      ],
    });
  }

  // ── Assemble in the user's catalogue order ──
  const DEFAULT_ORDER = ['trendingMovies','trendingSeries','popularMovies','popularSeries','movies','series','anime','franchises'];
  const orderRaw = Array.isArray(config.catalogOrder) && config.catalogOrder.length
    ? config.catalogOrder.slice()
    : DEFAULT_ORDER.slice();
  const order = [...orderRaw];
  for (const k of DEFAULT_ORDER) {
    if (!order.includes(k)) order.push(k);
  }
  const seen = new Set();

  for (const key of order) {
    if (seen.has(key)) continue;
    seen.add(key);
    // Discovery rows tick individually (legacy catalogTrending/catalogPopular
    // enable both of that kind for older tokens).
    if (key === 'trendingMovies' && (config.catalogTrendingMovies || config.catalogTrending)) {
      catalogs.push({ id: 'torbox-trending-movies', type: 'movie',  name: DISCOVERY.trendingMovies, extra: CAT_EXTRA });
    } else if (key === 'trendingSeries' && (config.catalogTrendingSeries || config.catalogTrending)) {
      catalogs.push({ id: 'torbox-trending-series', type: 'series', name: DISCOVERY.trendingSeries, extra: CAT_EXTRA });
    } else if (key === 'popularMovies' && (config.catalogPopularMovies || config.catalogPopular)) {
      catalogs.push({ id: 'torbox-popular-movies', type: 'movie',  name: DISCOVERY.popularMovies, extra: CAT_EXTRA });
    } else if (key === 'popularSeries' && (config.catalogPopularSeries || config.catalogPopular)) {
      catalogs.push({ id: 'torbox-popular-series', type: 'series', name: DISCOVERY.popularSeries, extra: CAT_EXTRA });
    } else if (key === 'movies' || key === 'series' || key === 'anime') {
      buildLibrary(key);
    } else if (key === 'franchises') {
      buildCollectionsRow();
    }
  }

  return {
    id: (REGISTRY && REGISTRY.addonId) || 'community.lelibrary.selfhosted',
    version: '4.8.0',
    name: (REGISTRY && REGISTRY.name) || 'LeLibrary (Self-Hosted)',
    description: (REGISTRY && REGISTRY.description) || 'Your movies, series & anime from every debrid provider, beautifully organized with TMDB artwork and ratings.',
    logo: getLogoUrl(baseUrl),
    resources: [
      'catalog',
      'meta',
      { name: 'stream', types: ['movie', 'series', 'anime'], idPrefixes: ['torbox:', 'tt', 'kitsu:'] },
    ],
    types: ['movie', 'series', 'anime'],
    idPrefixes: ['torbox:', 'tt', 'kitsu:'],
    catalogs,
    behaviorHints: { configurable: true },
  };
}


app.get('/health', async (req, res) => {
  const stats = await cache.getStats();
  res.json({
    status: 'ok',
    cache: stats,
    version: '4.8.0',
  });
});

app.post('/cache/clear', async (req, res) => {
  // Admin-only: requires CACHE_CLEAR_SECRET to be set. Disabled otherwise,
  // so no anonymous visitor can wipe the whole cache (a DoS primitive).
  const secret = process.env.CACHE_CLEAR_SECRET;
  if (!secret) return res.status(403).json({ success: false, error: 'Global cache clear is disabled. Set CACHE_CLEAR_SECRET to enable.' });
  if (req.headers['x-cache-secret'] !== secret) return res.status(403).json({ success: false, error: 'Invalid cache secret' });
  try {
    const deleted = await cache.delPattern('*');
    res.json({ success: true, deleted, message: 'Cache cleared successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/:token/cache/clear', async (req, res) => {
  const config = decodeConfig(req.params.token);
  if (!config) return res.status(400).json({ error: 'Invalid token' });
  
  try {
    const userKey = providers.getUserKey(config);
    if (!userKey) return res.status(400).json({ error: 'No key configured' });
    
    const pattern = `*${userKey}*`;
    const deleted = await cache.delPattern(pattern);
    require('./src/tmdb').clearCaches();
    res.json({ success: true, deleted, message: 'User cache cleared' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/manifest.json', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json(getBaseManifest(req.protocol + '://' + req.get('host')));
});

app.get('/:token/manifest.json', async (req, res) => {
  const config = decodeConfig(req.params.token);
  if (!config) return res.status(400).json({ error: 'Invalid token' });
  // Trigger a background build so catalogs are ready for the Nuvio collections
  // profile.
  if (!knownConfigs.has(req.params.token)) {
    knownConfigs.set(req.params.token, config);
    buildAndCacheForConfig(req.params.token, config).catch(() => {});
  }
  // Cold start: restore the cached collections before building the manifest so
  // the "LeLibrary Collections" row's genre options are populated immediately,
  // even though the background build may still be running.
  try {
    const userKey = providers.getUserKey(config);
    const lang = config.lang || 'pt-BR';
    if (getCollections(userKey, lang).length === 0) {
      const persistentKey = cache.makeKey('cat', 'collections', 'collections', config.sortBy || 'data_adicao', '', '0', userKey, lang, posterFp(config));
      const persistent = await cache.get(persistentKey);
      if (Array.isArray(persistent?.metas) && persistent.metas.length > 0) {
        cacheCollections(userKey, lang, persistent.metas);
        console.log(`[Collections] Manifest: restored ${persistent.metas.length} cached collections (${req.params.token})`);
      }
    }
  } catch (err) {
    console.warn(`[Collections] Manifest: cache restore failed: ${err.message}`);
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json(getConfiguredManifest(req.protocol + '://' + req.get('host'), config));
});

// Strip the "Collection" suffix for the per-franchise movie row names
// ("James Bond Collection" → "James Bond").
function franchiseRowName(name) {
  return String(name || '').replace(/\s+Collection$/i, '').trim() || name;
}

// ── Nuvio native Collections profile ─────────────────────────────
// One "LeLibrary Collections" collection with one folder per franchise, each
// folder pointing at that franchise's MOVIE catalog (torbox-collection-{key}).
// Nuvio resolves a folder's catalogSources against the addon's manifest and
// fetches the catalog live, so a folder always shows the franchise's current
// films as plain movies. Every folder points at the single "LeLibrary
// Collections" movie catalog (torbox-collections) with its franchise name as
// the genre extra; the catalog handler filters on genre. New films appear
// automatically; a brand-new franchise needs one re-push so its folder is added.
async function handleNuvioProfile(req, res) {
  const config = decodeConfig(req.params.token);
  if (!config) return res.status(400).json({ error: 'Invalid token' });
  const { tmdbApiKey, lang = 'pt-BR' } = config;
  const active = providers.activeProviders(config);
  if (!tmdbApiKey || active.length === 0) return res.json([]);
  if (config.catalogFranchises === false) return res.json([]); // franchises disabled

  const userKey = providers.getUserKey(config);
  if (!knownConfigs.has(req.params.token)) {
    knownConfigs.set(req.params.token, config);
    buildAndCacheForConfig(req.params.token, config).catch(() => {});
  }
  let metas = getCollections(userKey, lang);
  if (metas.length === 0) {
    try {
      const all = await providers.fetchDownloads(config);
      metas = await buildCollectionsCatalog(all, tmdbApiKey, lang, { erdbToken: config.erdbToken, rpdbKey: config.rpdbKey });
      cacheCollections(userKey, lang, metas);
    } catch (err) {
      console.error('[Nuvio] Collections build error:', err.message);
      return res.json([]);
    }
  }

  const addonId = (REGISTRY && REGISTRY.addonId) || 'community.lelibrary.selfhosted';

  const folders = metas.map((m, i) => {
    const key = m.id.split(':')[2];
    const franchiseName = franchiseRowName(m.name);
    return {
      id: `folder-franchise-${i}`,
      title: franchiseName,
      tileShape: 'PORTRAIT',
      hideTitle: false,
      focusGifEnabled: false,
      coverImageUrl: m.poster || '',
      focusGifUrl: '',
      catalogSources: [{
        addonId,
        catalogId: 'torbox-collections',
        type: 'movie',
        genre: franchiseName,
      }],
    };
  });

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.json([{
    focusGlowEnabled: true,
    id: 'collection-lelibrary-franchises',
    title: config.collectionsName || 'LeLibrary Collections',
    pinToTop: config.pinCollections === true,
    showAllTab: true,
    viewMode: 'TABBED_GRID',
    folders,
  }]);
}

app.get('/:token/collections.json', handleNuvioProfile);
app.get('/:token/nuvio-collections/manifest.json', handleNuvioProfile);
app.get('/:token/nuvio-collections.json', handleNuvioProfile);

async function handleCatalog(req, res) {
  const config = await require('./src/configstore').mergeStoredConfig(decodeConfig(req.params.token));
  if (!config) return res.json({ metas: [] });

  const { tmdbApiKey, sortBy = 'data_adicao', lang = 'pt-BR', rdCatalog = 'merge', erdbToken, rpdbKey, fanartKey, posterProvider, hideAnime, libraryIdMode } = config;
  const active = providers.activeProviders(config);
  if (!tmdbApiKey || active.length === 0) return res.json({ metas: [] });

  const catalogId = req.params.catalogId;

  // ── Legacy per-franchise MOVIE catalog (torbox-collection-{key}) ──
  // Kept for backward compat with folders/saga links pushed before the
  // single-catalog refactor; no longer advertised in the manifest. Lists one
  // franchise's owned films as plain movies. Clicking a film reuses the normal
  // torbox:movie meta + stream path.
  if (catalogId.startsWith('torbox-collection-')) {
    const key = catalogId.slice('torbox-collection-'.length);
    const extra  = parseExtra(req.params.extra || '');
    const skip   = parseInt(extra.skip) || 0;
    const search = extra.search || '';

    const token = req.params.token;
    if (!knownConfigs.has(token)) {
      knownConfigs.set(token, config);
      buildAndCacheForConfig(token, config).catch(() => {});
    }
    const userKey = providers.getUserKey(config);
    let metas = getCollections(userKey, lang);
    if (metas.length === 0) {
      try {
        // Prefer the persistent collections cache before rebuilding. A temporary
        // empty provider response must not erase a previously working franchise
        // folder and turn it into "No Items Found".
        const persistentKey = cache.makeKey('cat', 'collections', 'collections', sortBy, '', '0', userKey, lang, posterFp(config));
        const persistent = await cache.get(persistentKey);
        if (Array.isArray(persistent?.metas) && persistent.metas.length > 0) {
          metas = persistent.metas;
          cacheCollections(userKey, lang, metas);
        }
        if (metas.length > 0) {
          console.log(`[Collections] Film catalog: restored ${metas.length} cached collections (${key})`);
        } else {
          const all = await providers.fetchDownloads(config);
          // Do not replace an existing in-memory collection map with an empty
          // rebuild. The normal path already retains stale data on empty scans.
          if (!Array.isArray(all) || all.length === 0) {
            console.warn(`[Collections] Film catalog: provider returned no downloads (${key})`);
            return res.json({ metas: [] });
          }
          metas = await buildCollectionsCatalog(all, tmdbApiKey, lang, { erdbToken, rpdbKey });
          if (metas.length > 0) cacheCollections(userKey, lang, metas);
          console.log(`[Collections] Film catalog: rebuilt → ${metas.length} collections (${key})`);
        }
      } catch (err) {
        console.error('[Collections] Film catalog error:', err.message);
        return res.json({ metas: [] });
      }
    }
    const coll = metas.find(m => m.id.split(':')[2] === key);
    if (!coll) {
      console.warn(`[Collections] Film catalog: key "${key}" not found among ${metas.length} collections`);
      return res.json({ metas: [] });
    }

    const filmMetas = (coll.videos || [])
      .map(v => ({
        id: libraryIdMode === 'tt' && v.imdbId ? v.imdbId : `torbox:movie:${v.id.split(':').pop()}`,
        type: 'movie',
        name: v.title,
        poster: v.thumbnail ? v.thumbnail.replace('/w300', '/w500') : null,
        releaseInfo: (v.released || '').slice(0, 4) || undefined,
        released: v.released || undefined,
      }))
      .filter(f => f.poster)
      .filter(f => !search || (f.name || '').toLowerCase().includes(search.toLowerCase()));

    const paginated = filmMetas.slice(skip, skip + 50);
    console.log(`[Collections] Film catalog "${key}" → ${paginated.length} films`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints({ metas: paginated }, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
  }

  // ── Trending / Popular discovery catalogs ──
  // torbox-trending-{movies,series} / torbox-popular-{movies,series}. These
  // rows carry plain tt: (IMDb) meta ids so other stream addons contribute
  // streams. Handled BEFORE the generic path (which keys off -movies/-series
  // suffixes and would treat them as library catalogs).
  const discMatch = catalogId.match(/^torbox-(trending|popular)-(movies|series)$/);
  if (discMatch) {
    const kind     = discMatch[1];   // trending | popular
    const apiType  = discMatch[2] === 'movies' ? 'movie' : 'tv'; // TMDB's own names
    const extra    = parseExtra(req.params.extra || '');
    const skip     = parseInt(extra.skip) || 0;
    const search   = extra.search || '';
    const userKey  = providers.getUserKey(config);
    let paginated;
    try {
      paginated = await buildDiscoveryCatalog({ tmdbApiKey, kind, apiType, lang, userKey, skip, search, enhance: { erdbToken, rpdbKey, fanartKey, posterProvider }, posterFp: posterFp(config) });
    } catch (err) {
      console.error(`[Discovery] ${kind} ${apiType} error:`, err.message);
      return res.json({ metas: [] });
    }
    console.log(`[Discovery] ${kind} ${apiType} → ${paginated.length} metas (skip=${skip})`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints({ metas: paginated }, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
  }

  // ── "LeLibrary Collections" movie catalog (torbox-collections) ──
  // One catalog listing every owned franchise film as a plain movie. Filtered
  // by the `genre` extra (a franchise name), which Nuvio collection folders and
  // Stremio's Discover genre dropdown both send; `search` and `skip` work too.
  // Handled before the separate-mode provider check so it works for every user
  // regardless of provider mode.
  if (catalogId === 'torbox-collections' && req.params.type === 'movie') {
    const extra  = parseExtra(req.params.extra || '');
    const skip   = parseInt(extra.skip) || 0;
    const search = extra.search || '';
    const genre  = extra.genre || '';

    const token = req.params.token;
    if (!knownConfigs.has(token)) {
      knownConfigs.set(token, config);
      buildAndCacheForConfig(token, config).catch(() => {});
    }
    const userKey = providers.getUserKey(config);
    let metas = getCollections(userKey, lang);
    if (metas.length === 0) {
      try {
        // Prefer the persistent collections cache before rebuilding. A temporary
        // empty provider response must not erase a previously working row.
        const persistentKey = cache.makeKey('cat', 'collections', 'collections', sortBy, '', '0', userKey, lang, posterFp(config));
        const persistent = await cache.get(persistentKey);
        if (Array.isArray(persistent?.metas) && persistent.metas.length > 0) {
          metas = persistent.metas;
          cacheCollections(userKey, lang, metas);
        }
        if (metas.length === 0) {
          const all = await providers.fetchDownloads(config);
          if (!Array.isArray(all) || all.length === 0) {
            console.warn('[Collections] Movie catalog: provider returned no downloads');
            return res.json({ metas: [] });
          }
          metas = await buildCollectionsCatalog(all, tmdbApiKey, lang, { erdbToken, rpdbKey });
          if (metas.length > 0) cacheCollections(userKey, lang, metas);
        }
      } catch (err) {
        console.error('[Collections] Movie catalog error:', err.message);
        return res.json({ metas: [] });
      }
    }

    const filmMetas = [];
    for (const c of metas) {
      const fname = franchiseRowName(c.name);
      if (genre && fname !== genre) continue;
      for (const v of (c.videos || [])) {
        filmMetas.push({
          id: libraryIdMode === 'tt' && v.imdbId ? v.imdbId : `torbox:movie:${v.id.split(':').pop()}`,
          type: 'movie',
          name: v.title,
          poster: v.thumbnail ? v.thumbnail.replace('/w300', '/w500') : null,
          releaseInfo: (v.released || '').slice(0, 4) || undefined,
          released: v.released || undefined,
        });
      }
    }
    const filtered = filmMetas
      .filter(f => f.poster)
      .filter(f => !search || (f.name || '').toLowerCase().includes(search.toLowerCase()));
    const paginated = filtered.slice(skip, skip + 50);
    console.log(`[Collections] Movie catalog "${genre || 'all'}" → ${paginated.length} films`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints({ metas: paginated }, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
  }

  // ── Legacy Collections series catalog (dead code, kept for backward compat) ──
  // Spans ALL providers, isolated to torbox:collection:* metas.
  if (catalogId.endsWith('-collections')) {
    const extra  = parseExtra(req.params.extra || '');
    const skip   = parseInt(extra.skip) || 0;
    const search = extra.search || '';

    const token = req.params.token;
    if (!knownConfigs.has(token)) {
      knownConfigs.set(token, config);
      buildAndCacheForConfig(token, config).catch(() => {});
    }
    const userKey = providers.getUserKey(config);
    const collKey = cache.makeKey('cat', 'collections', 'collections', sortBy, '', '0', userKey, lang, posterFp(config));
    let metas = null;
    const cached = await cache.get(collKey);
    if (cached) {
      metas = cached.metas;
      console.log(`[Collections] Cache hit → ${metas.length} items`);
    } else {
      try {
        const all = await providers.fetchDownloads(config);
        metas = await buildCollectionsCatalog(all, tmdbApiKey, lang, { erdbToken, rpdbKey });
        cacheCollections(userKey, lang, metas);
        await cache.set(collKey, { metas }, TTL_CATALOG);
        console.log(`[Collections] Built → ${metas.length} items`);
      } catch (err) {
        console.error('[Collections] Error:', err.message);
        return res.json({ metas: [] });
      }
    }
    if (search) metas = metas.filter(m => (m.name || '').toLowerCase().includes(search.toLowerCase()));
    const paginated = metas.slice(skip, skip + 50);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints({ metas: paginated }, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
  }

  const prefix    = catalogId.split('-')[0];
  const separate  = rdCatalog === 'separate';

  // Which provider(s) feed this catalog? In merge mode all active providers;
  // in separate mode only the provider owning the catalog id prefix.
  let catalogProviderId = null;
  if (separate) {
    catalogProviderId = providers.providerByCat(prefix);
    if (!catalogProviderId || !active.includes(catalogProviderId)) return res.json({ metas: [] });
  }

  let type;
  if (catalogId.endsWith('-anime'))   type = 'anime';
  else if (catalogId.endsWith('-movies')) type = 'movie';
  else type = 'series';

  const extra  = parseExtra(req.params.extra || '');
  const skip   = parseInt(extra.skip) || 0;
  const search = extra.search || '';

  console.log(`[Catalog] catalog=${catalogId} type=${type} skip=${skip} lang=${lang}`);

  const token = req.params.token;
  if (!knownConfigs.has(token)) {
    knownConfigs.set(token, config);
    buildAndCacheForConfig(token, config).catch(() => {});
  }

  const userKey  = providers.getUserKey(config);
  const catKey   = separate ? providers.PROVIDER_META[catalogProviderId].cat : 'merged';
  const cacheKey = cache.makeKey('cat', catKey, type, sortBy, search, skip.toString(), userKey, lang, posterFp(config), libraryIdMode);
  const cached   = await cache.get(cacheKey);

  if (cached) {
    console.log(`[Catalog] Cache hit → ${cached.metas.length} items`);
    populateTmdbIndexFromMetas(cached.metas, userKey);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints(cached, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
  }

  try {
    // In separate mode fetch only this provider's downloads; in merge mode all.
    const all   = await providers.fetchDownloads(config, { only: separate ? [catalogProviderId] : null });
    const downloads = separate ? providers.downloadsFor(all, catalogProviderId) : all;

    // Compute hash the same way as background refresh (buildAndCacheForConfig)
    const newHash = hashDownloads(downloads);
    const hashKey = cache.makeKey('dlhash', userKey);
    const oldHash = await cache.get(hashKey);
    const hashChanged = oldHash !== newHash;

    // Resilience: a suddenly-empty provider response must not blank the cached
    // catalog. If we had content before and now get nothing, serve the existing
    // cache instead of rebuilding it empty.
    if (hashChanged && downloads.length === 0 && oldHash) {
      const stale = await cache.get(cacheKey).catch(() => null);
      if (stale) {
        console.log('[Catalog] Empty provider response — serving cached catalog instead of blanking');
        await cache.touchPattern(`cat:*${userKey}*`, TTL_CATALOG);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
        return res.json(withCacheHints(stale, { cacheMaxAge: 60, staleRevalidate: 60, staleError: 1800 }));
      }
    }

    // Progressive: return already-known items immediately, complete the rest in the background
    const built = await buildCatalog(downloads, tmdbApiKey, type, sortBy, { skip, search }, lang, { erdbToken, rpdbKey }, { progressive: true, userKey, hideAnime, libraryIdMode });
    const isPartial = !!built.completion;
    const metas     = built.metas || built;

    if (isPartial) {
      console.log(`[Catalog] Fast-returning ${metas.length} metas, completing ${built._fresh || 0} in background`);
      // Serve partial immediately (short cache so the client re-fetches once complete)
      await cache.set(cacheKey, { metas }, 10);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      res.json(withCacheHints({ metas }, { cacheMaxAge: 10, staleRevalidate: 10, staleError: 1800 }));
      // Finish matching + rebuild full catalog in the background
      built.completion.then(async () => {
        try {
          const full = await buildCatalog(downloads, tmdbApiKey, type, sortBy, { skip, search }, lang, { erdbToken, rpdbKey }, { userKey, hideAnime, libraryIdMode });
          const result = { metas: full };
          if (hashChanged) {
            await cache.set(hashKey, newHash, 7200);
            await cache.delPattern(`cat:*${userKey}*`);
          }
          await cache.set(cacheKey, result, TTL_CATALOG);
          console.log(`[Catalog] Progressive completion → ${full.length} metas cached`);
        } catch (err) {
          console.error('[Catalog] Progressive completion error:', err.message);
        }
      }).catch(() => {});
      return;
    }

    console.log(`[Catalog] Built → ${metas.length} metas`);

    if (hashChanged) {
      await cache.set(hashKey, newHash, 7200);
      await cache.delPattern(`cat:*${userKey}*`);
    }

    const result = { metas };
    await cache.set(cacheKey, result, TTL_CATALOG);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.json(withCacheHints(result, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
  } catch (err) {
    console.error('[Catalog] Error:', err.message);
    // If we had a cached result, serve it as fallback instead of empty
    const stale = await cache.get(cacheKey).catch(() => null);
    if (stale) {
      console.log('[Catalog] Serving stale cache as fallback');
      // Re-set with a longer TTL so it survives extended outages
      await cache.set(cacheKey, stale, 1800).catch(() => {});
      return res.json(withCacheHints(stale, { cacheMaxAge: 60, staleRevalidate: 60, staleError: 1800 }));
    }
    res.json({ metas: [] });
  }
}

app.get('/:token/catalog/:type/:catalogId.json', handleCatalog);
app.get('/:token/catalog/:type/:catalogId/:extra.json', handleCatalog);

// ─── META ─────────────────────────────────────────────────────────────────────
app.get('/:token/meta/:type/:id.json', async (req, res) => {
  const baseConfig = decodeConfig(req.params.token);
  if (!baseConfig) return res.json({ meta: null });
  const config = await require('./src/configstore').mergeStoredConfig(baseConfig);

  const { tmdbApiKey, lang = 'pt-BR', erdbToken, rpdbKey, omdbKey, fanartKey, enhanceBackground, enhanceLogo, customStreams } = config;
  const active = providers.activeProviders(config);
  const { type, id } = req.params;
  if (!tmdbApiKey || active.length === 0) return res.json({ meta: null });

  console.log(`[Meta] Request: type=${type} id=${id}`);

  // Discovery rows (Trending/Popular) carry plain tt: (IMDb) ids so Nuvio and
  // Stremio route streams to every installed addon that claims the 'tt' prefix
  // (Torrentio, Comet, Meteor, MediaFusion). The meta itself is built from TMDB
  // and cached under the torbox: namespace, so for a tt: request we serve it
  // back with the plain tt: id in the response only. This keeps the detail page
  // requesting streams by the IMDb id; the cached copy keeps its torbox: id for
  // library/franchise rows, where only LeLibrary should answer.
  const ttId = id.startsWith('tt') ? id.split(':')[0] : null;

  // ── Collections meta (torbox:collection:* — additive, isolated) ──
  if (id.startsWith('torbox:collection:')) {
    const userKey = providers.getUserKey(config);
    const cacheKey = cache.makeKey('meta', 'coll', id, lang, userKey, posterFp(config));
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log(`[Collections] Meta cache hit: ${id}`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      return res.json(withCacheHints(cached, { cacheMaxAge: 86400, staleRevalidate: 86400, staleError: 604800 }));
    }
    if (!knownConfigs.has(req.params.token)) {
      knownConfigs.set(req.params.token, config);
      buildAndCacheForConfig(req.params.token, config).catch(() => {});
    }
    let meta = getCollectionMeta(userKey, lang, id.split(':')[2]);
    if (!meta) {
      console.log(`[Collections] Meta not in memory cache (${id}) — building`);
      try {
        const all = await providers.fetchDownloads(config);
        const metas = await buildCollectionsCatalog(all, tmdbApiKey, lang, { erdbToken, rpdbKey });
        cacheCollections(userKey, lang, metas);
        meta = getCollectionMeta(userKey, lang, id.split(':')[2]);
        console.log(`[Collections] Meta rebuilt → ${meta ? 'found' : 'STILL NULL'} (${id})`);
      } catch (err) {
        console.error(`[Collections] Meta build error (${id}):`, err.message);
        return res.json({ meta: null });
      }
    }
    if (!meta) {
      console.warn(`[Collections] Meta null for ${id} — client will not find this collection`);
      return res.json({ meta: null });
    }
    const result = { meta };
    await cache.set(cacheKey, result, 86400);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints(result, { cacheMaxAge: 86400, staleRevalidate: 86400, staleError: 604800 }));
  }

  let tmdbId;
  if (id.startsWith('torbox:')) {
    tmdbId = id.split(':')[2];
  } else if (id.startsWith('tt')) {
    const { imdbToTmdb } = require('./src/tmdb');
    const mapped = await imdbToTmdb(tmdbApiKey, id.split(':')[0]);
    if (!mapped) return res.json({ meta: null });
    tmdbId = String(mapped.tmdbId);
  } else {
    return res.json({ meta: null });
  }

  const userKey = providers.getUserKey(config);
  // Discovery (tt:) metas are proxied from the TMDB metadata addon (the rich
  // source Xperience/AIOStreams use) with the response id rewritten to tt:,
  // so they must not collide with the owned-filtered library/franchise metas.
  const discovery = !!ttId;
  const cacheKey = cache.makeKey('meta', 'v3', `torbox:${type}:${tmdbId}`, discovery ? 'tt' : '', lang, userKey, posterFp(config));
  const cached   = await cache.get(cacheKey);

  if (cached) {
    console.log(`[Meta] Cache hit: ${id} → ${cached.meta?.videos?.length || 0} eps`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints(discovery ? { meta: { ...cached.meta, id: ttId } } : cached, { cacheMaxAge: 86400, staleRevalidate: 86400, staleError: 604800 }));
  }

  console.log(`[Meta] Building: ${id} (tmdbId=${tmdbId})`);
  try {
    // For movies: prefetch stream in parallel with buildMeta
    const fmtFp = ':' + hashShort([config.streamPreset || '', config.streamNameTemplate || '', config.streamDescTemplate || ''].join('|'));
    const streamCacheKey = cache.makeKey('stream', type, tmdbId, '', '', userKey + fmtFp);
    const streamPrefetch = type === 'movie'
      ? cache.get(streamCacheKey).then(hit => {
          if (!hit) buildStreams(config, tmdbApiKey, type, tmdbId, undefined, undefined, lang, customStreams, userKey)
            .then(streams => cache.set(streamCacheKey, { streams }, streams.length > 0 ? TTL_STREAM : 60))
            .catch(() => {});
        })
      : Promise.resolve();

    const enhance = { erdbToken, rpdbKey, omdbKey, fanartKey, posterProvider: config.posterProvider, enhanceBackground, enhanceLogo };
    const meta   = discovery
      ? await buildDiscoveryMeta({ tmdbApiKey, tmdbId, type, lang, enhance, imdbId: ttId })
      : await buildMeta(tmdbId, type, tmdbApiKey, lang, config, enhance, userKey, !discovery);
    const result = { meta };

    // "More from this saga" — for movies that belong to a built collection, add
    // a Stremio detail link that opens the franchise's movie catalog (plain
    // movies, never a series/season view), plus the raw TMDB collection id
    // (NuvioWeb reads it for its native Collection tab). Purely additive;
    // skipped when the saga isn't in the collections cache.
    if (meta && type === 'movie') {
      const saga = getCollectionForMovie(userKey, lang, tmdbId);
      if (saga) {
        const manifestUrl = `${req.protocol}://${req.get('host')}/${req.params.token}/manifest.json`;
        meta.links = [
          ...(meta.links || []).filter(l => l && l.category !== 'saga'),
          { name: `More from the ${saga.name} saga`, category: 'saga', url: `stremio:///discover/${encodeURIComponent(manifestUrl)}/movie/torbox-collections?genre=${encodeURIComponent(franchiseRowName(saga.name))}` },
        ];
        meta.collectionId = saga.collectionId;
        meta.belongs_to_collection = { id: saga.collectionId, name: saga.name };
      }
    }

    // Resilience: don't cache hollow results for 24h. A series with zero
    // episodes (provider down/empty) or a meta that failed to build (TMDB
    // blip) gets a 5-minute TTL so it rebuilds once the source is reachable
    // again — otherwise a temporary outage empties detail pages for a day.
    const metaTtl = (!meta || (type !== 'movie' && (!meta.videos || meta.videos.length === 0))) ? 300 : 86400;

    await Promise.all([
      cache.set(cacheKey, result, metaTtl),
      streamPrefetch,
    ]);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.json(withCacheHints(discovery ? { meta: { ...result.meta, id: ttId } } : result, { cacheMaxAge: metaTtl, staleRevalidate: metaTtl, staleError: 604800 }));

    // For series: prefetch first episode streams in background after responding
    if (type === 'series' && meta?.videos?.length > 0) {
      const firstEp = meta.videos[0];
      const epKey   = cache.makeKey('stream', type, tmdbId, String(firstEp.season), String(firstEp.episode), userKey + fmtFp);
      cache.get(epKey).then(hit => {
        if (!hit) buildStreams(config, tmdbApiKey, type, tmdbId, String(firstEp.season), String(firstEp.episode), lang, customStreams, userKey)
          .then(streams => cache.set(epKey, { streams }, streams.length > 0 ? TTL_STREAM : 60))
          .catch(() => {});
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[Meta] Error:', err.message);
    res.json({ meta: null });
  }
});

app.get('/:token/stream/:type/:id.json', async (req, res) => {
  const baseConfig = decodeConfig(req.params.token);
  if (!baseConfig) return res.json({ streams: [] });
  // Merge server-side stream settings (addons + format) stored in Redis by the
  // configure page — the token stays small and these survive reloads/device
  // switches. Falls back to the token's own fields when nothing is stored.
  const config = await require('./src/configstore').mergeStoredConfig(baseConfig);

  const { tmdbApiKey, lang = 'pt-BR', customStreams } = config;
  const active = providers.activeProviders(config);
  if (!tmdbApiKey || active.length === 0) return res.json({ streams: [] });

  const { type, id } = req.params;
  if (!id.startsWith('torbox:') && !id.startsWith('tt') && !id.startsWith('kitsu:')) {
    return res.json({ streams: [] });
  }

  // ── Trending / Popular discovery streams (tt: ids) ──
  // These rows carry plain IMDb ids and are backed by external stream addons
  // (Torrentio, Comet, Meteor, MediaFusion). When the user OWNS the title, the
  // "owned bridge" lists their library copy first, then the external addon
  // streams. Handled by src/discovery.js (buildDiscoveryStreams).
  const externalAddons = Array.isArray(config.streamAddons) ? config.streamAddons : [];
  const userKey        = providers.getUserKey(config);
  // Include the stream-format fingerprint so changing the preset/templates
  // invalidates cached streams instead of serving stale names for the TTL.
  const fmtFp = ':' + hashShort([config.streamPreset || '', config.streamNameTemplate || '', config.streamDescTemplate || ''].join('|'));

  let tmdbId, season, episode;
  let buildType = type;

  try {
    if (id.startsWith('torbox:collection:')) {
      // torbox:collection:{collId}:{movieId} — a movie inside a collection.
      // Resolve the owned movie's stream directly (the movie catalogs/index
      // already populate tmdbindex; buildStreams falls back if not).
      const parts = id.split(':');
      const movieId = parts[3];
      if (!movieId) return res.json({ streams: [] });
      buildType = 'movie';
      tmdbId  = movieId;
      season  = undefined;
      episode = undefined;
    } else if (id.startsWith('torbox:')) {
      const parts = id.split(':');
      tmdbId  = parts[2];
      season  = parts[3];
      episode = parts[4];
    } else if (id.startsWith('kitsu:')) {
      const parts = id.split(':');
      const kitsuId = parts[1];
      episode = parts[2];
      const axios = require('axios');
      const kitsuRes = await axios.get(`https://kitsu.io/api/edge/anime/${kitsuId}`, { timeout: 5000 });
      const title = kitsuRes.data?.data?.attributes?.canonicalTitle;
      if (!title) return res.json({ streams: [] });
      const { searchMetadata } = require('./src/tmdb');
      const search = await searchMetadata(tmdbApiKey, title, 'tv', undefined, lang);
      if (!search) return res.json({ streams: [] });
      tmdbId = search.id;
    }

    // ── tt: id + stream addons → owned copy first, then external addons ──
    if (id.startsWith('tt')) {
      const addonFp = ':' + hashShort(externalAddons.slice().sort().join(','));
      // Include the format fingerprint so changing the stream preset/templates
      // invalidates cached discovery streams instead of serving the old format.
      const discKey = cache.makeKey('stream', type, id, '', '', userKey + addonFp + fmtFp);
      const cached  = await cache.get(discKey);
      if (cached) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
        return res.json(withCacheHints(cached, { cacheMaxAge: TTL_STREAM, staleRevalidate: TTL_STREAM, staleError: 604800 }));
      }
      const { streams, ownedCount, externalCount } = await buildDiscoveryStreams({
        config, tmdbApiKey, type, id, lang, customStreams, userKey, externalAddons,
      });
      const result   = { streams };
      const streamTtl = streams.length > 0 ? TTL_STREAM : 60;
      await cache.set(discKey, result, streamTtl);
      console.log(`[Stream] ${id} → ${streams.length} streams (${ownedCount} owned, ${externalCount} external)`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      return res.json(withCacheHints(result, { cacheMaxAge: TTL_STREAM, staleRevalidate: TTL_STREAM, staleError: 604800 }));
    }

    // Include the stream-format fingerprint so changing the preset/templates
    // invalidates cached streams instead of serving stale names for the TTL.
    const streamCacheKey = cache.makeKey('stream', buildType, tmdbId, season || '', episode || '', userKey + fmtFp);
    const cachedStreams  = await cache.get(streamCacheKey);
    if (cachedStreams) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      return res.json(withCacheHints(cachedStreams, { cacheMaxAge: TTL_STREAM, staleRevalidate: TTL_STREAM, staleError: 604800 }));
    }

    const streams = await buildStreams(config, tmdbApiKey, buildType, tmdbId, season, episode, lang, customStreams, userKey);

    const result  = { streams };
    // Don't cache hollow results for the full TTL — a provider blip (e.g. TorBox
    // rate-limiting requestdl) would otherwise blank streams for 10 minutes.
    const streamTtl = streams.length > 0 ? TTL_STREAM : 60;
    await cache.set(streamCacheKey, result, streamTtl);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.json(withCacheHints(result, { cacheMaxAge: TTL_STREAM, staleRevalidate: TTL_STREAM, staleError: 604800 }));
  } catch (err) {
    console.error('[Stream] Error:', err.message);
    res.json({ streams: [] });
  }
});

module.exports = app;
