// Metadata surface: the addon meta handler, also projected by the
// client-integration facade with the same response shape clients expect.
import type { Express } from 'express';

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
const { version: APP_VERSION } = require('../../../package.json');
const { withCacheHints, posterFp, posterEnhance, markClientIntegrationStage, setPrivateResponseCache, streamResponseTtl } = require('./shared.ts') as {
  withCacheHints: (...args: any[]) => any;
  setPrivateResponseCache: (res: any, maxAge: number, staleRevalidate?: number, staleError?: number) => void;
  streamResponseTtl: (result: any) => number;
  posterFp: (config: Record<string, any>) => string;
  posterEnhance: (config?: Record<string, any>) => Record<string, unknown>;
  markClientIntegrationStage: (req: any, name: string) => void;
};

const cache   = require('../runtime/cache.ts');
const providers = require('../providers/index.ts');
const { matchVersion } = require('../matching/resolve.ts');
const { buildCatalog, buildMeta, buildStreams, populateTmdbIndexFromMetas, applyStreamNotices, libraryStreamFmtFp } = require('../catalog/builder.ts');

const { knownConfigs, rememberConfig, buildAndCacheForConfig } = require('../runtime/refresh.ts') as {
  knownConfigs: Map<string, any>;
  rememberConfig: (token: string, config: any) => void;
  buildAndCacheForConfig: (token: string, config: any) => any;
};
// Phase 0 timing: per-dependency spans, no behaviour change.
const { timeSpan, spanName } = require('../middleware/perf-timing.ts') as {
  timeSpan: <T>(trace: unknown, name: string, fn: () => Promise<T> | T) => Promise<T>;
  spanName: (base: string, details?: Record<string, unknown>) => string;
};

const { franchiseRowName } = require('./manifest.ts') as { franchiseRowName: (name: string) => string };

export interface MetaDeps {
  resolveConfig: (token: string, trace?: unknown) => Promise<Record<string, any> | null>;
}

export interface MetaApi {
  mountMetaRoutes: (app: Express, deps: MetaDeps) => void;
  handleMeta: (req: any, res: any, deps: MetaDeps) => Promise<void>;
}

async function handleMeta(req: any, res: any, deps: MetaDeps): Promise<void> {
  const { resolveConfig } = deps;
  const baseConfig = await timeSpan(req.perfTrace, 'resolve-config', () => resolveConfig(req.params.token, req.perfTrace));
  if (!baseConfig) return res.json({ meta: null });
  const config = await timeSpan(req.perfTrace, 'configstore-merge', () => require('../runtime/configstore.ts').mergeStoredConfig(baseConfig));
  markClientIntegrationStage(req, 'config');
  libraryEngine.noteConfig(req.params.token, config);

  const { tmdbApiKey, lang = 'en-US', erdbToken, rpdbKey, omdbKey, fanartKey, enhanceBackground, enhanceLogo, customStreams } = config;
  const active = providers.activeProviders(config);
  const { type, id } = req.params;
  if (!tmdbApiKey || (active.length === 0 && !hasCustomStreams(customStreams))) return res.json({ meta: null });

  console.log(`[Meta] Request: type=${type} id=${id}`);

  // Discovery rows (Trending/Popular) carry plain tt: (IMDb) ids so Nuvio and
  // Stremio route streams to every installed addon that claims the 'tt' prefix
  // (Torrentio, Comet, Meteor, MediaFusion). The meta itself is built from TMDB
  // and cached under the torbox: namespace, so for a tt: request we serve it
  // back with the plain tt: id in the response only. This keeps the detail page
  // requesting streams by the IMDb id; the cached copy keeps its torbox: id for
  // library/franchise rows, where only LeLibrary should answer.
  const ttId = id.startsWith('tt') ? id.split(':')[0] : null;

  // ── Collections meta (torbox:collection:*: additive, isolated) ──
  if (id.startsWith('torbox:collection:')) {
    const userKey = providers.getUserKey(config);
    const cacheKey = cache.makeKey('meta', 'coll', id, lang, userKey, posterFp(config));
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log(`[Collections] Meta cache hit: ${id}`);
      setPrivateResponseCache(res, 86400, 86400, 604800);
      return res.json(withCacheHints(cached, { cacheMaxAge: 86400, staleRevalidate: 86400, staleError: 604800 }));
    }
    if (!knownConfigs.has(req.params.token)) {
      rememberConfig(req.params.token, config);
      buildAndCacheForConfig(req.params.token, config).catch(() => {});
    }
    let meta = getCollectionMeta(userKey, lang, id.split(':')[2]);
    if (!meta) {
      console.log(`[Collections] Meta not in memory cache (${id}): building`);
      try {
        const all = await timeSpan(req.perfTrace, spanName('provider-fetch', { op: 'collections' }), () => providers.fetchDownloads(config));
        const metas = await buildCollectionsCatalog(all, tmdbApiKey, lang, posterEnhance(config));
        cacheCollections(userKey, lang, metas);
        meta = getCollectionMeta(userKey, lang, id.split(':')[2]);
        console.log(`[Collections] Meta rebuilt → ${meta ? 'found' : 'STILL NULL'} (${id})`);
      } catch (err: any) {
        console.error(`[Collections] Meta build error (${id}):`, err.message);
        return res.json({ meta: null });
      }
    }
    if (!meta) {
      console.warn(`[Collections] Meta null for ${id}: client will not find this collection`);
      return res.json({ meta: null });
    }
    const result = { meta };
    await cache.set(cacheKey, result, 86400);
    setPrivateResponseCache(res, 86400, 86400, 604800);
    return res.json(withCacheHints(result, { cacheMaxAge: 86400, staleRevalidate: 86400, staleError: 604800 }));
  }

  let tmdbId;
  if (id.startsWith('torbox:')) {
    tmdbId = id.split(':')[2];
  } else if (id.startsWith('tt')) {
    const { imdbToTmdbCached } = require('../media/tmdb.ts');
    const mapped = await timeSpan(req.perfTrace, spanName('tmdb', { op: 'imdb-map' }), () => imdbToTmdbCached(tmdbApiKey, id.split(':')[0]));
    if (!mapped) return res.json({ meta: null });
    tmdbId = String(mapped.tmdbId);
  } else {
    return res.json({ meta: null });
  }
  markClientIntegrationStage(req, 'identity');

  const userKey = providers.getUserKey(config);
  // Discovery (tt:) metas are proxied from the TMDB metadata addon with the
  // response id rewritten to tt:,
  // so they must not collide with the owned-filtered library/franchise metas.
  const discovery = !!ttId;
  // Match-derived rows carry the match version so table/resolver changes
  // orphan stale metas instead of serving them for the TTL.
  const cacheKey = cache.makeKey('meta', 'v3', `torbox:${type}:${tmdbId}`, discovery ? 'tt' : '', lang, userKey, posterFp(config), matchVersion());
  const cached   = await cache.get(cacheKey);
  markClientIntegrationStage(req, 'cache');

  if (cached) {
    console.log(`[Meta] Cache hit: ${id} → ${cached.meta?.videos?.length || 0} eps`);
    setPrivateResponseCache(res, 86400, 86400, 604800);
    return res.json(withCacheHints(discovery ? { meta: { ...cached.meta, id: ttId } } : cached, { cacheMaxAge: 86400, staleRevalidate: 86400, staleError: 604800 }));
  }

  // Index-first: seed the owned-episode index from the persisted local library
  // so buildMeta never has to scan the provider for a title we already
  // indexed. Only runs on a cold meta (cache miss).
  if (libraryEngine.isIndexed() && !discovery && tmdbId) {
    try { await timeSpan(req.perfTrace, 'pg:owned-hydrate', () => libraryEngine.hydrateOwnedIndex({ userKey, tmdbId })); } catch { /* best effort */ }
  }

  console.log(`[Meta] Building: ${id} (tmdbId=${tmdbId})`);
  try {
    const enhance = posterEnhance(config);
    const meta   = discovery
      ? await timeSpan(req.perfTrace, 'discovery-meta', () => buildDiscoveryMeta({ tmdbApiKey, tmdbId, type, lang, enhance, imdbId: ttId }))
      : await timeSpan(req.perfTrace, 'owned-meta', () => buildMeta(tmdbId, type, tmdbApiKey, lang, config, enhance, userKey, !discovery, req.perfTrace));
    const result = { meta };
    markClientIntegrationStage(req, 'metadata');

    // Resilience: don't cache hollow results for 24h. A series with zero
    // episodes (provider down/empty) or a meta that failed to build (TMDB
    // blip) gets a 5-minute TTL so it rebuilds once the source is reachable
    // again: otherwise a temporary outage empties detail pages for a day.
    const metaTtl = (!meta || (type !== 'movie' && (!meta.videos || meta.videos.length === 0))) ? 300 : 86400;

    await cache.set(cacheKey, result, metaTtl);
    markClientIntegrationStage(req, 'cache-write');

    // "More from this saga": for movies that belong to a built collection, add
    // a Stremio detail link that opens the franchise's own movie catalog (one
    // row per franchise on Stremio manifests - folder-style, plain movies,
    // never a series/season view), plus the raw TMDB collection id (NuvioWeb
    // reads it for its native Collection tab). Purely additive; skipped when
    // the saga isn't in the collections cache (then the single
    // genre-filtered row is the fallback target).
    //
    // Applied AFTER caching: the link embeds THIS request's manifest URL, which
    // contains this user's config token. Mutating before cache.set baked one
    // user's token into every other user's cached meta for the full TTL.
    if (meta && type === 'movie') {
      const saga = getCollectionForMovie(userKey, lang, tmdbId);
      if (saga) {
        const integrationPath = req.clientIntegration ? `/i/${req.clientIntegration.id}` : '';
        const manifestUrl = `${req.protocol}://${req.get('host')}/${req.params.token}${integrationPath}/manifest.json`;
        // A found saga always carries its franchise key (same key the Stremio
        // manifest advertises as torbox-collection-{key}), so link straight
        // at the franchise row. Without it, use the single genre-filtered row.
        const sagaTarget = saga.key
          ? `movie/torbox-collection-${saga.key}`
          : `movie/torbox-collections?genre=${encodeURIComponent(franchiseRowName(saga.name))}`;
        meta.links = [
          ...(meta.links || []).filter((l: any) => l && l.category !== 'saga'),
          { name: `More from the ${saga.name} saga`, category: 'saga', url: `stremio:///discover/${encodeURIComponent(manifestUrl)}/${sagaTarget}` },
        ];
        meta.collectionId = saga.collectionId;
        meta.belongs_to_collection = { id: saga.collectionId, name: saga.name };
      }
    }

    setPrivateResponseCache(res, metaTtl, metaTtl, 604800);
    res.json(withCacheHints(discovery ? { meta: { ...result.meta, id: ttId } } : result, { cacheMaxAge: metaTtl, staleRevalidate: metaTtl, staleError: 604800 }));

    // Playback links are deliberately created only by the stream route below.
    // Nuvio opens several metadata pages while browsing, and prefetching each
    // title's TorBox requestdl URL consumed its stricter quota before playback.
    // The tt: owned-copy bridge remains unchanged: its real stream request
    // still lists owned streams before configured external addons.
  } catch (err: any) {
    console.error('[Meta] Error:', err.message);
    res.json({ meta: null });
  }
}

function mountMetaRoutes(app: Express, deps: MetaDeps): void {
  app.get('/:token/meta/:type/:id.json', (req, res) => handleMeta(req, res, deps));
}

module.exports = { mountMetaRoutes, handleMeta } satisfies MetaApi;
