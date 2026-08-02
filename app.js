const express = require('express');
const fs      = require('fs');
const path    = require('path');
const cache   = require('./src/cache');
const providers = require('./src/providers');
const { buildCatalog, buildMeta, buildStreams, populateTmdbIndexFromMetas } = require('./src/builder');

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
  const { tmdbApiKey, sortBy = 'data_adicao', lang = 'pt-BR', rdCatalog = 'merge', erdbToken, rpdbKey, hideAnime } = config;
  if (!tmdbApiKey) return;

  const active = providers.activeProviders(config);
  const userKey = providers.getUserKey(config);
  if (!active.length) return;

  console.log(`[Cache] Refresh for ...${token.slice(-8)} (${lang}) providers=${active.join(',')}`);
  try {
    const downloads = await providers.fetchDownloads(config);
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

    const sources = rdCatalog === 'separate'
      ? active.map(id => ({ key: providers.PROVIDER_META[id].cat, downloads: providers.downloadsFor(downloads, id) }))
      : [{ key: 'merged', downloads }];

    await Promise.all(sources.flatMap(({ key, downloads: dl }) =>
      TYPES.map(async type => {
        const metas    = await buildCatalog(dl, tmdbApiKey, type, sortBy, { skip: 0, search: '' }, lang, { erdbToken, rpdbKey }, { userKey, hideAnime });
        const cacheKey = cache.makeKey('cat', key, type, sortBy, '', '0', userKey, lang, posterFp(config));
        await cache.set(cacheKey, { metas }, TTL_CATALOG);
        console.log(`[Cache] ${key}:${type} → ${metas.length} items`);
      })
    ));

    // Only update hash and invalidate caches after ALL catalogs built successfully
    await cache.set(hashKey, newHash, 7200);
    await cache.delPattern('meta:*');
    await cache.delPattern('stream:*');
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
    version: '4.0.0',
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

  const catalogs = [];
  const addCat = (prefix, nameM, nameS, nameA) => {
    catalogs.push({ id: `${prefix}-movies`, type: 'movie',  name: nameM, extra: [{ name: 'skip' }, { name: 'search' }] });
    catalogs.push({ id: `${prefix}-series`, type: 'series', name: nameS, extra: [{ name: 'skip' }, { name: 'search' }] });
    if (!hideAnime) catalogs.push({ id: `${prefix}-anime`, type: 'series', name: nameA, extra: [{ name: 'skip' }, { name: 'search' }] });
  };

  const EMOJI = { torbox: '🎬', realdebrid: '🔴', alldebrid: '💠', premiumize: '🧲' };

  if (active.length === 1) {
    const meta = providers.PROVIDER_META[active[0]];
    addCat(meta.cat,
      catName('🎬 My Movies', catNameMovies),
      catName('📺 My Series', catNameSeries),
      catName('🍥 LeLibrary Anime', catNameAnime));
  } else if (active.length > 1 && !separate) {
    // merge — keep the legacy torbox-* ids when torbox is active so existing
    // installs don't change; otherwise fall back to the first active provider.
    const prefix = active.includes('torbox') ? 'torbox' : providers.PROVIDER_META[active[0]].cat;
    addCat(prefix,
      catName('🎬 My Movies', catNameMovies),
      catName('📺 My Series', catNameSeries),
      catName('🍥 LeLibrary Anime', catNameAnime));
  } else if (active.length > 1) {
    // separate — one catalog row per provider. When a custom name is set we
    // disambiguate each provider (legacy behavior: TorBox keeps the plain
    // custom name, the others get a "(Provider)" suffix).
    for (const id of active) {
      const meta = providers.PROVIDER_META[id];
      const suffix = id === 'torbox' ? '' : ` (${meta.label})`;
      addCat(meta.cat,
        catName(`${EMOJI[id] || '📦'} ${meta.label} Films`, catNameMovies) + (catNameMovies && suffix ? suffix : ''),
        catName(`${EMOJI[id] || '📦'} ${meta.label} Series`, catNameSeries) + (catNameSeries && suffix ? suffix : ''),
        catName(`${EMOJI[id] || '📦'} ${meta.label} Animes`, catNameAnime) + (catNameAnime && suffix ? suffix : ''));
    }
  }

  return {
    id: (REGISTRY && REGISTRY.addonId) || 'community.lelibrary.selfhosted',
    version: '4.0.0',
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
    version: '4.0.0',
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

app.get('/:token/manifest.json', (req, res) => {
  const config = decodeConfig(req.params.token);
  if (!config) return res.status(400).json({ error: 'Invalid token' });
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json(getConfiguredManifest(req.protocol + '://' + req.get('host'), config));
});

async function handleCatalog(req, res) {
  const config = decodeConfig(req.params.token);
  if (!config) return res.json({ metas: [] });

  const { tmdbApiKey, sortBy = 'data_adicao', lang = 'pt-BR', rdCatalog = 'merge', erdbToken, rpdbKey, hideAnime } = config;
  const active = providers.activeProviders(config);
  if (!tmdbApiKey || active.length === 0) return res.json({ metas: [] });

  const catalogId = req.params.catalogId;
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
  const cacheKey = cache.makeKey('cat', catKey, type, sortBy, search, skip.toString(), userKey, lang, posterFp(config));
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

    // Progressive: return already-known items immediately, complete the rest in the background
    const built = await buildCatalog(downloads, tmdbApiKey, type, sortBy, { skip, search }, lang, { erdbToken, rpdbKey }, { progressive: true, userKey, hideAnime });
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
          const full = await buildCatalog(downloads, tmdbApiKey, type, sortBy, { skip, search }, lang, { erdbToken, rpdbKey }, { userKey, hideAnime });
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
  const config = decodeConfig(req.params.token);
  if (!config) return res.json({ meta: null });

  const { tmdbApiKey, lang = 'pt-BR', erdbToken, rpdbKey, omdbKey, fanartKey, enhanceBackground, enhanceLogo, customStreams } = config;
  const active = providers.activeProviders(config);
  const { type, id } = req.params;
  if (!tmdbApiKey || active.length === 0) return res.json({ meta: null });

  console.log(`[Meta] Request: type=${type} id=${id}`);
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
  const cacheKey = cache.makeKey('meta', 'v2', `torbox:${type}:${tmdbId}`, lang, userKey, posterFp(config));
  const cached   = await cache.get(cacheKey);

  if (cached) {
    console.log(`[Meta] Cache hit: ${id} → ${cached.meta?.videos?.length || 0} eps`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints(cached, { cacheMaxAge: 86400, staleRevalidate: 86400, staleError: 604800 }));
  }

  console.log(`[Meta] Building: ${id} (tmdbId=${tmdbId})`);
  try {
    // For movies: prefetch stream in parallel with buildMeta
    const streamCacheKey = cache.makeKey('stream', type, tmdbId, '', '', userKey);
    const streamPrefetch = type === 'movie'
      ? cache.get(streamCacheKey).then(hit => {
          if (!hit) buildStreams(config, tmdbApiKey, type, tmdbId, undefined, undefined, lang, customStreams, userKey)
            .then(streams => cache.set(streamCacheKey, { streams }, TTL_STREAM))
            .catch(() => {});
        })
      : Promise.resolve();

    const meta   = await buildMeta(tmdbId, type, tmdbApiKey, lang, config, { erdbToken, rpdbKey, omdbKey, fanartKey, enhanceBackground, enhanceLogo }, userKey);
    const result = { meta };

    await Promise.all([
      cache.set(cacheKey, result, 86400),
      streamPrefetch,
    ]);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.json(withCacheHints(result, { cacheMaxAge: 86400, staleRevalidate: 86400, staleError: 604800 }));

    // For series: prefetch first episode streams in background after responding
    if (type === 'series' && meta?.videos?.length > 0) {
      const firstEp = meta.videos[0];
      const epKey   = cache.makeKey('stream', type, tmdbId, String(firstEp.season), String(firstEp.episode), userKey);
      cache.get(epKey).then(hit => {
        if (!hit) buildStreams(config, tmdbApiKey, type, tmdbId, String(firstEp.season), String(firstEp.episode), lang, customStreams, userKey)
          .then(streams => cache.set(epKey, { streams }, TTL_STREAM))
          .catch(() => {});
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[Meta] Error:', err.message);
    res.json({ meta: null });
  }
});

app.get('/:token/stream/:type/:id.json', async (req, res) => {
  const config = decodeConfig(req.params.token);
  if (!config) return res.json({ streams: [] });

  const { tmdbApiKey, lang = 'pt-BR', customStreams } = config;
  const active = providers.activeProviders(config);
  if (!tmdbApiKey || active.length === 0) return res.json({ streams: [] });

  const { type, id } = req.params;
  if (!id.startsWith('torbox:') && !id.startsWith('tt') && !id.startsWith('kitsu:')) {
    return res.json({ streams: [] });
  }

  let tmdbId, season, episode;

  try {
    if (id.startsWith('torbox:')) {
      const parts = id.split(':');
      tmdbId  = parts[2];
      season  = parts[3];
      episode = parts[4];
    } else if (id.startsWith('tt')) {
      const parts = id.split(':');
      const imdbId = parts[0];
      season = parts[1];
      episode = parts[2];
      const { imdbToTmdb } = require('./src/tmdb');
      const mapped = await imdbToTmdb(tmdbApiKey, imdbId);
      if (!mapped) return res.json({ streams: [] });
      tmdbId = mapped.tmdbId;
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

    const userKey        = providers.getUserKey(config);
    const streamCacheKey = cache.makeKey('stream', type, tmdbId, season || '', episode || '', userKey);
    const cachedStreams  = await cache.get(streamCacheKey);
    if (cachedStreams) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      return res.json(withCacheHints(cachedStreams, { cacheMaxAge: TTL_STREAM, staleRevalidate: TTL_STREAM, staleError: 604800 }));
    }

    const streams = await buildStreams(config, tmdbApiKey, type, tmdbId, season, episode, lang, customStreams, userKey);
    const result  = { streams };
    await cache.set(streamCacheKey, result, TTL_STREAM);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.json(withCacheHints(result, { cacheMaxAge: TTL_STREAM, staleRevalidate: TTL_STREAM, staleError: 604800 }));
  } catch (err) {
    console.error('[Stream] Error:', err.message);
    res.json({ streams: [] });
  }
});

module.exports = app;
