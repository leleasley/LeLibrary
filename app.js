const express = require('express');
const path    = require('path');
const cache   = require('./src/cache');
const { getTorBoxDownloads } = require('./src/torbox');
const { getRealDebridDownloads } = require('./src/realdebrid');
const { buildCatalog, buildMeta, buildStreams } = require('./src/builder');
const createWebRoutes = require('./website');

const ROOT_DIR = path.resolve(__dirname);

const IS_SERVERLESS = !!process.env.VERCEL;

const TTL_CATALOG = parseInt(process.env.CACHE_TTL_CATALOG) || 60;    // default 1min
const TTL_STREAM  = parseInt(process.env.CACHE_TTL_STREAM)  || 600;  // default 10min

const knownConfigs = IS_SERVERLESS ? null : new Map();

const app = express();

app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

// ── Website routes (landing, configure, library, discover, proxies) ──
app.use(createWebRoutes(decodeConfig));

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

function parseExtra(str) {
  const extra = {};
  if (!str || typeof str !== 'string' || str.length > 512) return extra;
  str.split('&').forEach(pair => {
    const eq = pair.indexOf('=');
    if (eq > 0) {
      const key = decodeURIComponent(pair.slice(0, eq));
      const val = decodeURIComponent(pair.slice(eq + 1));
      if (key.length < 50 && val.length < 200) extra[key] = val;
    }
  });
  return extra;
}

const TYPES   = ['movie', 'series', 'anime'];
const REFRESH = 2 * 60 * 1000;

function hashDownloads(downloads) {
  return downloads.map(d => d.id).sort().join(',');
}

async function buildAndCacheForConfig(token, config) {
  const { torboxApiKey, rdApiKey, tmdbApiKey, sortBy = 'data_adicao', lang = 'pt-BR', rdCatalog = 'merge', provider = 'both', erdbToken, rpdbKey } = config;
  if (!tmdbApiKey) return;

  console.log(`[Cache] Refresh for ...${token.slice(-8)} (${lang})`);
  try {
    const [tbDownloads, rdDownloads] = await Promise.all([
      torboxApiKey ? getTorBoxDownloads(torboxApiKey) : Promise.resolve([]),
      rdApiKey     ? getRealDebridDownloads(rdApiKey) : Promise.resolve([]),
    ]);

    const tbHash  = hashDownloads(tbDownloads);
    const rdHash  = hashDownloads(rdDownloads);
    const newHash = tbHash + '|' + rdHash;
    const hashKey = cache.makeKey('dlhash', (torboxApiKey || rdApiKey).slice(-6));
    const oldHash = await cache.get(hashKey);

    if (oldHash === newHash) {
      console.log(`[Cache] Downloads unchanged, skip rebuild`);
      return;
    }
    await cache.set(hashKey, newHash, 7200);

    const merged   = [...tbDownloads, ...rdDownloads];
    const sources  = rdCatalog === 'separate'
      ? [{ key: 'tb', downloads: tbDownloads }, { key: 'rd', downloads: rdDownloads }]
      : [{ key: 'merged', downloads: merged }];

    await Promise.all(sources.flatMap(({ key, downloads }) =>
      TYPES.map(async type => {
        const metas    = await buildCatalog(downloads, tmdbApiKey, type, sortBy, { skip: 0, search: '' }, lang, { erdbToken, rpdbKey });
        const cacheKey = cache.makeKey('cat', key, type, sortBy, '', '0', (torboxApiKey || rdApiKey).slice(-6), lang);
        await cache.set(cacheKey, { metas }, TTL_CATALOG);
        console.log(`[Cache] ${key}:${type} → ${metas.length} items`);
      })
    ));

    // Invalidate stale meta cache so new series get fresh episode data
    await cache.delPattern('meta:*');
    console.log('[Cache] Meta cache invalidated after catalog rebuild');
  } catch (err) {
    console.error('[Cache] Error:', err.message);
  }
}

if (!IS_SERVERLESS) {
  setInterval(async () => {
    for (const [token, config] of knownConfigs.entries()) {
      await buildAndCacheForConfig(token, config).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
    }
  }, REFRESH);
}

function getLogoUrl(baseUrl) {
  return `${baseUrl}/LeLibrary.png`;
}

function getBaseManifest(baseUrl) {
  return {
    id: 'community.torbox.catalog',
    version: '2.1.1',
    name: 'LeLibrary',
    description: 'Your personal TorBox catalog with TMDB metadata.',
    logo: getLogoUrl(baseUrl),
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series', 'anime'],
    idPrefixes: ['torbox:', 'tt', 'kitsu:'],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: true },
    configureUrl: `${baseUrl}/configure`,
  };
}

function getConfiguredManifest(baseUrl, config = {}) {
  const { rdApiKey, rdCatalog = 'merge', provider = 'both' } = config;
  const hasRD = !!rdApiKey && (provider === 'both' || provider === 'realdebrid');
  const hasTB = provider === 'both' || provider === 'torbox';

  const catalogs = [];

  if (provider === 'realdebrid') {
    catalogs.push(
      { id: 'rd-movies',     type: 'movie',  name: '🔴 My Movies', extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'rd-series',     type: 'series', name: '🔴 My Series',  extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'rd-anime',      type: 'series', name: '🔴 LeLibrary Anime',  extra: [{ name: 'skip' }, { name: 'search' }] },
    );
  } else if (provider === 'torbox') {
    catalogs.push(
      { id: 'torbox-movies', type: 'movie',  name: '🎬 My Movies', extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'torbox-series', type: 'series', name: '📺 My Series',  extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'torbox-anime',  type: 'series', name: '🍥 LeLibrary Anime',  extra: [{ name: 'skip' }, { name: 'search' }] },
    );
  } else if (!hasRD || rdCatalog === 'merge') {
    catalogs.push(
      { id: 'torbox-movies', type: 'movie',  name: '🎬 My Movies', extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'torbox-series', type: 'series', name: '📺 My Series',  extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'torbox-anime',  type: 'series', name: '🍥 LeLibrary Anime',  extra: [{ name: 'skip' }, { name: 'search' }] },
    );
  } else {
    // separate
    catalogs.push(
      { id: 'torbox-movies', type: 'movie',  name: '🎬 TorBox Films', extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'torbox-series', type: 'series', name: '📺 TorBox Series',  extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'torbox-anime',  type: 'series', name: '🍥 TorBox Animes',  extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'rd-movies',     type: 'movie',  name: '🔴 Real-Debrid Films', extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'rd-series',     type: 'series', name: '🔴 Real-Debrid Series',  extra: [{ name: 'skip' }, { name: 'search' }] },
      { id: 'rd-anime',      type: 'series', name: '🔴 Real-Debrid Animes',  extra: [{ name: 'skip' }, { name: 'search' }] },
    );
  }

  return {
    id: 'community.torbox.catalog',
    version: '2.1.1',
    name: 'LeLibrary',
    description: 'Your personal library with TMDB metadata.',
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
    environment: IS_SERVERLESS ? 'serverless' : 'self-hosted',
    version: '2.1.1',
  });
});

app.post('/cache/clear', async (req, res) => {
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
    const { torboxApiKey, rdApiKey } = config;
    const userKey = (torboxApiKey || rdApiKey || '').slice(-6);
    if (!userKey) return res.status(400).json({ error: 'No key configured' });
    
    const pattern = `*${userKey}*`;
    const deleted = await cache.delPattern(pattern);
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

  const { torboxApiKey, rdApiKey, tmdbApiKey, sortBy = 'data_adicao', lang = 'pt-BR', rdCatalog = 'merge', provider = 'both', erdbToken, rpdbKey } = config;
  if (!tmdbApiKey || (!torboxApiKey && !rdApiKey)) return res.json({ metas: [] });

  const catalogId = req.params.catalogId;
  const isRDCatalog = catalogId.startsWith('rd-');

  let type;
  if (catalogId.endsWith('-anime'))   type = 'anime';
  else if (catalogId.endsWith('-movies')) type = 'movie';
  else type = 'series';

  const extra  = parseExtra(req.params.extra || '');
  const skip   = parseInt(extra.skip) || 0;
  const search = extra.search || '';

  console.log(`[Catalog] catalog=${catalogId} type=${type} skip=${skip} lang=${lang}`);

  const token = req.params.token;
  if (!IS_SERVERLESS && !knownConfigs.has(token)) {
    knownConfigs.set(token, config);
    buildAndCacheForConfig(token, config).catch(() => {});
  }

  const userKey  = (torboxApiKey || rdApiKey).slice(-6);
  const catKey   = rdCatalog === 'separate' ? (isRDCatalog ? 'rd' : 'tb') : 'merged';
  const cacheKey = cache.makeKey('cat', catKey, type, sortBy, search, skip.toString(), userKey, lang);
  const cached   = await cache.get(cacheKey);

  if (cached) {
    console.log(`[Catalog] Cache hit → ${cached.metas.length} items`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(cached);
  }

  try {
    const [tbDownloads, rdDownloads] = await Promise.all([
      torboxApiKey && (!isRDCatalog || rdCatalog === 'merge') ? getTorBoxDownloads(torboxApiKey) : Promise.resolve([]),
      rdApiKey     && (isRDCatalog  || rdCatalog === 'merge') ? getRealDebridDownloads(rdApiKey)  : Promise.resolve([]),
    ]);

    const downloads = [...tbDownloads, ...rdDownloads];

    const newHash = hashDownloads(downloads);
    const hashKey = cache.makeKey('dlhash', userKey);
    const oldHash = await cache.get(hashKey);
    if (oldHash !== newHash) {
      await cache.set(hashKey, newHash, 7200);
      await cache.delPattern(`cat:*${userKey}*`);
    }

    const metas  = await buildCatalog(downloads, tmdbApiKey, type, sortBy, { skip, search }, lang, { erdbToken, rpdbKey });
    console.log(`[Catalog] Built → ${metas.length} metas`);

    const result = { metas };
    await cache.set(cacheKey, result, TTL_CATALOG);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.json(result);
  } catch (err) {
    console.error('[Catalog] Error:', err.message);
    res.json({ metas: [] });
  }
}

app.get('/:token/catalog/:type/:catalogId.json', handleCatalog);
app.get('/:token/catalog/:type/:catalogId/:extra.json', handleCatalog);

// ─── META ─────────────────────────────────────────────────────────────────────
app.get('/:token/meta/:type/:id.json', async (req, res) => {
  const config = decodeConfig(req.params.token);
  if (!config) return res.json({ meta: null });

  const { torboxApiKey, rdApiKey, tmdbApiKey, lang = 'pt-BR', provider = 'both', erdbToken, rpdbKey, omdbKey, fanartKey, enhanceBackground, enhanceLogo, customStreams } = config;
  const { type, id } = req.params;
  if (!tmdbApiKey) return res.json({ meta: null });

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

  const cacheKey = cache.makeKey('meta', 'v2', `torbox:${type}:${tmdbId}`, lang);
  const cached   = await cache.get(cacheKey);

  if (cached) {
    console.log(`[Meta] Cache hit: ${id} → ${cached.meta?.videos?.length || 0} eps`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(cached);
  }

  console.log(`[Meta] Building: ${id} (tmdbId=${tmdbId})`);
  try {
    const userKey = (torboxApiKey || rdApiKey || '').slice(-6);

    // For movies: prefetch stream in parallel with buildMeta
    const streamCacheKey = cache.makeKey('stream', type, tmdbId, '', '', userKey);
    const streamPrefetch = type === 'movie'
      ? cache.get(streamCacheKey).then(hit => {
          if (!hit) buildStreams(torboxApiKey, tmdbApiKey, type, tmdbId, undefined, undefined, lang, rdApiKey, customStreams)
            .then(streams => cache.set(streamCacheKey, { streams }, TTL_STREAM))
            .catch(() => {});
        })
      : Promise.resolve();

    const meta   = await buildMeta(tmdbId, type, tmdbApiKey, lang, torboxApiKey, rdApiKey, { erdbToken, rpdbKey, omdbKey, fanartKey, enhanceBackground, enhanceLogo });
    const result = { meta };

    await Promise.all([
      cache.set(cacheKey, result, 86400),
      streamPrefetch,
    ]);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.json(result);

    // For series: prefetch first episode streams in background after responding
    if (type === 'series' && meta?.videos?.length > 0) {
      const firstEp = meta.videos[0];
      const epKey   = cache.makeKey('stream', type, tmdbId, String(firstEp.season), String(firstEp.episode), userKey);
      cache.get(epKey).then(hit => {
        if (!hit) buildStreams(torboxApiKey, tmdbApiKey, type, tmdbId, String(firstEp.season), String(firstEp.episode), lang, rdApiKey, customStreams)
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

  const { torboxApiKey, rdApiKey, tmdbApiKey, lang = 'pt-BR', provider = 'both', customStreams } = config;
  if (!tmdbApiKey || (!torboxApiKey && !rdApiKey)) return res.json({ streams: [] });

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

    const userKey        = (torboxApiKey || rdApiKey).slice(-6);
    const streamCacheKey = cache.makeKey('stream', type, tmdbId, season || '', episode || '', userKey);
    const cachedStreams  = await cache.get(streamCacheKey);
    if (cachedStreams) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      return res.json(cachedStreams);
    }

    const streams = await buildStreams(torboxApiKey, tmdbApiKey, type, tmdbId, season, episode, lang, rdApiKey, customStreams);
    const result  = { streams };
    await cache.set(streamCacheKey, result, TTL_STREAM);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.json(result);
  } catch (err) {
    console.error('[Stream] Error:', err.message);
    res.json({ streams: [] });
  }
});

module.exports = app;
