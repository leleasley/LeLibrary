// Stream surface: the owned-copy-first bridge plus the external addon fan-out,
// projected by the client-integration facade.
import type { Express } from 'express';

const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const cache   = require('../runtime/cache.ts');
const { matchVersion } = require('../matching/resolve.ts');
const pictoriumWarm = require('../runtime/pictorium-warm.ts');
const providers = require('../providers/index.ts');
const { buildCatalog, buildMeta, buildStreams, populateTmdbIndexFromMetas, applyStreamNotices, libraryStreamFmtFp } = require('../catalog/builder.ts');
const { buildDiscoveryCatalog, buildDiscoveryMeta, buildDiscoveryStreams, discoveryStreamKeyParts } = require('../catalog/discovery.ts');
const { buildCollectionsCatalog, cacheCollections, getCollectionMeta, getCollections, getCollectionForMovie } = require('../catalog/franchise-collections.ts');
const { normaliseNuvioArtwork, absoluteLocalArtwork } = require('../catalog/collection-artwork.ts');
const { compileCollectionPlan } = require('../catalog/collection-plan.ts');
const { buildLibraryCollection, collectionCatalogMetas } = require('../catalog/nuvio-library-collections.ts');
const { searchCatalog } = require('../media/search.ts');
const { decodeConfig } = require('../config/token.ts');
const { validateCustomStreamsConfig, hasCustomStreams, hasMappedCustomStreams, customStreamsFingerprint, customStreamCatalogEntries } = require('../media/custom-streams.ts');
const { getClientIntegration, listClientIntegrations } = require('../client-integrations/index.ts');
const libraryEngine = require('../library/engine.ts');
const {
  withCacheHints, streamResponseTtl, setPrivateResponseCache, hashShort, markClientIntegrationStage, materializePlayUrls,
} = require('./shared.ts') as {
  withCacheHints: (...args: any[]) => any;
  streamResponseTtl: (result: any) => number;
  setPrivateResponseCache: (res: any, maxAge: number, staleRevalidate?: number, staleError?: number) => void;
  hashShort: (value: unknown) => string;
  markClientIntegrationStage: (req: any, name: string) => void;
  materializePlayUrls: <T>(payload: T, req: any) => T;
};
// Phase 0 timing: per-dependency spans, no behaviour change.
const { timeSpan, spanName } = require('../middleware/perf-timing.ts') as {
  timeSpan: <T>(trace: unknown, name: string, fn: () => Promise<T> | T) => Promise<T>;
  spanName: (base: string, details?: Record<string, unknown>) => string;
};

// Coalesce cold public-ID stream requests in this process. Stremio/Nuvio can
// issue duplicate requests while opening a detail page; without this, each one
// fans out to every selected upstream before Redis has the first result.
const publicStreamInFlight = new Map();


function publicStreamCacheKey({ config, type, id, userKey, externalAddons, customStreams, aioFp, token }: any) {
  const addonFp = ':' + hashShort([
    ...(externalAddons || []).slice().sort(),
    customStreamsFingerprint(customStreams),
    aioFp || '', token ? crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 20) : '',
    // Changing a "your own addon" link must not serve its old results. Only a
    // one-way fingerprint of each link enters the key, never the link.
    ...[1, 2, 3].map((slot) => (typeof config?.[`customAddon${slot}`] === 'string' && config[`customAddon${slot}`]
      ? require('../streams/aiostreams.ts').connectorFingerprint(config[`customAddon${slot}`]) : '')),
  ].join('|'));
  return cache.makeKey('stream', type, id, '', '', userKey + addonFp + discoveryStreamKeyParts(config).fmtFp, matchVersion());
}

async function getPublicStreams({ config, tmdbApiKey, type, id, lang, customStreams, userKey, externalAddons, requestPolicy, aioStreams, trace, token, origin }: any) {
  const discKey = publicStreamCacheKey({ config, type, id, userKey, externalAddons, customStreams, aioFp: aioStreams && aioStreams.fingerprint, token });
  const cached = await cache.get(discKey);
  if (cached) return { result: cached, cacheHit: true };

  let pending = publicStreamInFlight.get(discKey);
  if (!pending) {
    pending = (async () => {
      const { streams, ownedCount, externalCount } = await buildDiscoveryStreams({
        config, tmdbApiKey, type, id, lang, customStreams, userKey, externalAddons, requestPolicy,
        runtime: { aioStreams, trace, token, origin },
      });
      const result = { streams };
      await cache.set(discKey, result, streamResponseTtl(result));
      console.log(`[Stream] ${id} → ${streams.length} streams (${ownedCount} owned, ${externalCount} external)`);
      return result;
    })();
    publicStreamInFlight.set(discKey, pending);
    pending.finally(() => publicStreamInFlight.delete(discKey)).catch(() => {});
  }
  return { result: await pending, cacheHit: false };
}

// Fingerprint of poster/rating config so caches are keyed per config, not shared



// ── Route surface ───────────────────────────────────────────────────────────
// Two mount points, because ordering matters: `mountCoreRoutes` must be
// registered BEFORE the website router (whose trailing 404 would otherwise
// swallow /health, /img/tmdb and the library status endpoints), and
// `mountAddonRoutes` AFTER it (the router whitelists the addon protocol paths
// and defers them to these handlers).

export interface StreamDeps {
  resolveConfig: (token: string, trace?: unknown) => Promise<Record<string, any> | null>;
}

export interface StreamApi {
  mountStreamRoutes: (app: Express, deps: StreamDeps) => void;
  handleStream: (req: any, res: any, deps: StreamDeps) => Promise<void>;
}

async function handleStream(req: any, res: any, deps: StreamDeps): Promise<void> {
  const { resolveConfig } = deps;
  const baseConfig = await timeSpan(req.perfTrace, 'resolve-config', () => resolveConfig(req.params.token, req.perfTrace));
  if (!baseConfig) return res.json({ streams: [] });
  // Merge server-side stream settings (addons + format) stored in Redis by the
  // configure page: the token stays small and these survive reloads/device
  // switches. Falls back to the token's own fields when nothing is stored.
  const config = await timeSpan(req.perfTrace, 'configstore-merge', () => require('../runtime/configstore.ts').mergeStoredConfig(baseConfig));
  markClientIntegrationStage(req, 'config');
  libraryEngine.noteConfig(req.params.token, config);

  const { tmdbApiKey, lang = 'en-US', customStreams } = config;
  const active = providers.activeProviders(config);
  const customEnabled = hasCustomStreams(customStreams);
  if ((!tmdbApiKey || active.length === 0) && !customEnabled) return res.json({ streams: [] });

  const { type, id } = req.params;
  if (!id.startsWith('torbox:') && !id.startsWith('tt') && !id.startsWith('kitsu:')) {
    return res.json({ streams: [] });
  }

  // ── Public IMDb streams (tt: ids) ──
  // Every public `tt:` row uses the shared discovery bridge: Trending/Popular,
  // imported and created public rows, plus library/collections in Main Meta
  // mode. When the user OWNS the title, their library copy is listed first,
  // then selected external addon streams.
  const externalAddons = Array.isArray(config.streamAddons) ? config.streamAddons : [];
  const userKey        = providers.getUserKey(config);
  // Include the stream-format fingerprint so changing the preset/templates
  // invalidates cached streams instead of serving stale names for the TTL.
  // The stream-notices toggle joins both fingerprints so flipping it takes
  // effect immediately instead of serving stale notice rows.
  const fmtFp = libraryStreamFmtFp(config);
  let tmdbId: any, season: any, episode: any, mappingImdbId: any;
  let buildType = type;

  try {
    if (id.startsWith('torbox:collection:')) {
      // torbox:collection:{collId}:{movieId}: a movie inside a collection.
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
      if (!tmdbApiKey) {
        tmdbId = `kitsu-${kitsuId}`;
      } else {
        // Cached Kitsu -> TMDB mapping: the Kitsu title lookup + TMDB search
        // run at most once per anime id ever (30d TTL, versioned with the
        // match core so table/resolver changes re-resolve). Every later
        // request for the same anime is a local cache hit with zero live
        // calls. Misses are never cached, so a transient upstream failure
        // retries on the next request instead of poisoning the mapping.
        const kitsuKey = cache.makeKey('kitsu2tmdb', String(kitsuId), matchVersion());
        let mappedId = await cache.get(kitsuKey).catch(() => null);
        if (!mappedId) {
          const axios = require('axios');
          const kitsuRes = await timeSpan(req.perfTrace, spanName('kitsu', { op: 'map' }), () => axios.get(`https://kitsu.io/api/edge/anime/${kitsuId}`, { timeout: 5000 }));
          const title = kitsuRes.data?.data?.attributes?.canonicalTitle;
          if (!title) return res.json({ streams: [] });
          const { searchMetadata } = require('../media/tmdb.ts');
          const search = await timeSpan(req.perfTrace, spanName('tmdb', { op: 'search' }), () => searchMetadata(tmdbApiKey, title, 'tv', undefined, lang));
          if (!search) return res.json({ streams: [] });
          mappedId = search.id;
          await cache.set(kitsuKey, mappedId, 30 * 86400).catch(() => {});
        }
        tmdbId = mappedId;
      }
    }

    // ── tt: id + stream addons → owned copy first, then external addons ──
    if (id.startsWith('tt')) {
      markClientIntegrationStage(req, 'identity');
      // Resolve the personal AIOStreams connector server-side (account vault or
      // sealed self-host reference). It must never enter the config, token,
      // response, logs or cache key; only its fingerprint joins the cache key.
      let aioStreams = null;
      if (externalAddons.includes('aiostreams')) {
        try {
          const aioUrl = await require('../streams/aiostreams-store.ts').resolveAioStreamsUrl(config, req.params.token);
          if (aioUrl) aioStreams = { url: aioUrl, userKeyHash: userKey, fingerprint: require('../streams/aiostreams.ts').connectorFingerprint(aioUrl) };
        } catch { /* connector unavailable: continue without it */ }
      }
      const { result, cacheHit } = await timeSpan(req.perfTrace, 'stream-bridge', () => getPublicStreams({
        config, tmdbApiKey, type, id, lang, customStreams, userKey, externalAddons,
        requestPolicy: req.clientIntegration?.requestPolicy,
        aioStreams, trace: req.perfTrace, token: req.params.token,
        origin: `${req.protocol}://${req.get('host')}`,
      }));
      markClientIntegrationStage(req, cacheHit ? 'cache' : 'stream-bridge');
      const responseTtl = streamResponseTtl(result);
      setPrivateResponseCache(res, responseTtl, responseTtl, 604800);
      return res.json(withCacheHints(materializePlayUrls(result, req), { cacheMaxAge: responseTtl, staleRevalidate: responseTtl, staleError: 604800 }));
    }

    // Owned library ids stay in the torbox namespace. Resolve only the mapping
    // lookup key back to IMDb so the same explicit row also answers a library
    // card; never rewrite the public catalog/meta id.
    if (hasMappedCustomStreams(customStreams) && tmdbApiKey && tmdbId && !String(tmdbId).startsWith('kitsu-')) {
      const { getImdbId } = require('../media/tmdb.ts');
      const apiType = buildType === 'movie' ? 'movie' : 'tv';
      mappingImdbId = await timeSpan(req.perfTrace, spanName('tmdb', { op: 'imdb-map' }), () => getImdbId(tmdbApiKey, apiType, tmdbId).catch(() => null));
    }
    markClientIntegrationStage(req, 'identity');

    // Include the stream-format fingerprint so changing the preset/templates
    // invalidates cached streams instead of serving stale names for the TTL.
    // Match version likewise orphans streams built from older decisions.
    const streamCacheKey = cache.makeKey('stream', buildType, tmdbId, season || '', episode || '', userKey + fmtFp, matchVersion());
    const cachedStreams  = await cache.get(streamCacheKey);
    markClientIntegrationStage(req, 'cache');
    if (cachedStreams) {
      const responseTtl = streamResponseTtl(cachedStreams);
      setPrivateResponseCache(res, responseTtl, responseTtl, 604800);
      return res.json(withCacheHints(materializePlayUrls(cachedStreams, req), { cacheMaxAge: responseTtl, staleRevalidate: responseTtl, staleError: 604800 }));
    }

    // Index-first: seed the owned-episode index from persisted rows before the
    // stream build, so an owned title never triggers a provider scan here.
    if (libraryEngine.isIndexed() && tmdbId && !String(tmdbId).startsWith('kitsu-')) {
      try { await timeSpan(req.perfTrace, 'pg:owned-hydrate', () => libraryEngine.hydrateOwnedIndex({ userKey, tmdbId })); } catch { /* best effort */ }
    }

    const streams = await timeSpan(req.perfTrace, 'owned-streams', () => buildStreams(config, tmdbApiKey, buildType, tmdbId, season, episode, lang, customStreams, userKey, { imdbId: mappingImdbId, trace: req.perfTrace, lazyLinks: true }));
    markClientIntegrationStage(req, 'owned-streams');
    // A providerless Custom Streams install is a sparse stream-only mapping:
    // unknown IDs must remain empty so LeLibrary does not add a notice row to
    // every title in the client.
    const noticeConfig = active.length > 0 ? config : { ...config, streamNotices: 'off' };
    const noticed  = await applyStreamNotices(streams, { config: noticeConfig, tmdbApiKey, tmdbId, type: buildType });
    markClientIntegrationStage(req, 'notices');

    const result  = { streams: noticed };
    // Don't cache hollow results for the full TTL: a provider blip (e.g. TorBox
    // rate-limiting requestdl) would otherwise blank streams for 10 minutes.
    // Notice-only results count as hollow (the fallback row isn't a stream).
    const streamTtl = streamResponseTtl(result);
    await cache.set(streamCacheKey, result, streamTtl);
    markClientIntegrationStage(req, 'cache-write');

    setPrivateResponseCache(res, streamTtl, streamTtl, 604800);
    res.json(withCacheHints(materializePlayUrls(result, req), { cacheMaxAge: streamTtl, staleRevalidate: streamTtl, staleError: 604800 }));
  } catch (err: any) {
    console.error('[Stream] Error:', err.message);
    res.json({ streams: [] });
  }
}

async function handleKnabenPlayback(req: any, res: any, deps: StreamDeps) {
  const { provider, hash } = req.params;
  if (!['torbox', 'realdebrid', 'alldebrid', 'premiumize'].includes(provider) || !/^[a-f0-9]{40}$/i.test(String(hash || ''))) return res.sendStatus(404);
  const baseConfig = await deps.resolveConfig(req.params.token);
  if (!baseConfig) return res.sendStatus(404);
  const config = await require('../runtime/configstore.ts').mergeStoredConfig(baseConfig);
  if (!Array.isArray(config.streamAddons) || !config.streamAddons.includes('knaben') || !providers.activeProviders(config).includes(provider)) return res.sendStatus(404);
  const name = String(req.query.name || '').slice(0, 300);
  const season = /^\d{1,2}$/.test(String(req.query.season || '')) ? Number(req.query.season) : undefined;
  const episode = /^\d{1,2}$/.test(String(req.query.episode || '')) ? Number(req.query.episode) : undefined;
  try {
    const magnet = await cache.get(cache.makeKey('knabenmagnet', String(hash).toLowerCase()));
    const url = await require('../streams/knabenPlayback.ts').resolveKnabenPlayback({ config, provider, hash: String(hash).toLowerCase(), name, season, episode, magnet });
    if (!url || !/^https:\/\//i.test(url)) return res.status(503).type('text/plain').send('This result is not ready through your debrid provider. Try another result.');
    res.set('Cache-Control', 'private, no-store');
    return res.redirect(302, url);
  } catch {
    return res.status(502).type('text/plain').send('Your debrid provider could not resolve this result. Try another result.');
  }
}


// Owned "links on demand": resolve one file's provider link when it is played
// and redirect the player straight to the provider. Video never passes through
// LeLibrary. Only this setup's own key is used, so ids from another library do
// nothing; the provider adapters cache links per file (TorBox: tbdl), so seeks
// and retries do not request a new link. Links and file names are never logged.
const PLAY_SOURCES = new Set(['torrent', 'usenet', 'webdl', 'realdebrid', 'alldebrid', 'premiumize', 'webdav']);
async function handleOwnedPlay(req: any, res: any, deps: StreamDeps) {
  res.set('Cache-Control', 'private, no-store');
  const source = String(req.params.source || '');
  const itemId = String(req.params.itemId || '');
  const fileId = String(req.params.fileId || '');
  // Ids are opaque provider values (TorBox numbers, Real-Debrid/Premiumize
  // strings): allow a safe character set only, never a path or a URL.
  const SAFE_ID = /^[A-Za-z0-9_.:=~-]{1,200}$/;
  // WebDAV file ids are base64url paths (webdav.fileRefToPath decodes and
  // checks them), so they can be longer than provider ids.
  const fileOk = source === 'webdav' ? /^[A-Za-z0-9_-]{1,1500}$/.test(fileId) : (SAFE_ID.test(fileId) && !fileId.includes('..'));
  if (!PLAY_SOURCES.has(source) || !SAFE_ID.test(itemId) || !fileOk || itemId.includes('..')) {
    return res.status(404).type('text/plain').send('Not found');
  }
  const baseConfig = await deps.resolveConfig(req.params.token);
  if (!baseConfig) return res.status(404).type('text/plain').send('Not found');
  const config = await require('../runtime/configstore.ts').mergeStoredConfig(baseConfig);
  const provider = providers.providerBySource(source);
  if (!provider || !providers.activeProviders(config).includes(provider)) return res.status(404).type('text/plain').send('Not found');
  // WebDAV has no link to send the player to (it needs the password), so the
  // file streams through LeLibrary instead. Self-host only.
  if (provider === 'webdav') return require('../providers/webdav.ts').proxyWebdavFile(req, res, config, fileId);
  let url: string | null = null;
  try {
    url = await providers.getStreamLink(config, { source, id: itemId }, /^\d+$/.test(fileId) ? Number(fileId) : fileId);
  } catch { url = null; }
  if (!url || !/^https:\/\//i.test(url)) {
    return res.status(503).type('text/plain').send('Your debrid provider could not give a link for this file right now. Try again in a moment.');
  }
  return res.redirect(302, url);
}

function mountStreamRoutes(app: Express, deps: StreamDeps): void {
  const { rateLimit } = require('../middleware/rate-limit.ts') as {
    rateLimit: (options?: { windowMs?: number; max?: number }) => (req: any, res: any, next: () => void) => void;
  };
  const playLimit = rateLimit({ windowMs: 60_000, max: 120 });
  app.get('/:token/play/:source/:itemId/:fileId', playLimit, (req, res) => handleOwnedPlay(req, res, deps));
  app.get('/:token/play/:source/:itemId/:fileId/:name', playLimit, (req, res) => handleOwnedPlay(req, res, deps));
  app.get('/:token/knaben/play/:provider/:hash.json', (req, res) => handleKnabenPlayback(req, res, deps));
  app.get('/:token/stream/:type/:id.json', (req, res) => handleStream(req, res, deps));
}

module.exports = { mountStreamRoutes, handleStream } satisfies StreamApi;
