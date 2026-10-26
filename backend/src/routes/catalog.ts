// Catalog surface: the owned/discovery/search builders, the catalogue routes and
// the Configure preview endpoints. Largest group in the addon router.
import type { Express, Request, Response } from 'express';

const { applyAsyncWrap } = require('../middleware/async-wrap.ts');
const { errorHandler } = require('../middleware/error-handler.ts');
const {
  TTL_CATALOG, TTL_STREAM, OWNED_CATALOG_CLIENT_TTL, LIBRARY_PROJECTION_VERSION,
  knownConfigs, KNOWN_CONFIGS_MAX, knownConfigFailures, catalogBuildInFlight,
  providerRefreshSnapshots, providerRefreshInFlight,
  rememberConfig, registerBackgroundRefresh, restoreAccountRefreshRegistry,
  refreshDownloadsForUser, hashDownloads, buildAndCacheForConfigInner, buildAndCacheForConfig,
} = require('../runtime/refresh.ts');
const express = require('express');
const libraryEngine = require('../library/engine.ts');
const { buildLibraryCollection, collectionCatalogMetas } = require('../catalog/nuvio-library-collections.ts');
const { rateLimit } = require('../middleware/rate-limit.ts');
const { searchCatalog } = require('../media/search.ts');
const { validateCustomStreamsConfig, hasCustomStreams, hasMappedCustomStreams, customStreamsFingerprint, customStreamCatalogEntries } = require('../media/custom-streams.ts');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const cache   = require('../runtime/cache.ts');
const pictoriumWarm = require('../runtime/pictorium-warm.ts');
const providers = require('../providers/index.ts');
const { buildCatalog, buildMeta, buildStreams, populateTmdbIndexFromMetas, applyStreamNotices, libraryStreamFmtFp } = require('../catalog/builder.ts');
const { buildDiscoveryCatalog, buildDiscoveryMeta, buildDiscoveryStreams, discoveryStreamKeyParts } = require('../catalog/discovery.ts');
const { buildCollectionsCatalog, cacheCollections, getCollectionMeta, getCollections, getCollectionForMovie } = require('../catalog/franchise-collections.ts');
const { normaliseNuvioArtwork, absoluteLocalArtwork } = require('../catalog/collection-artwork.ts');
// Private addon identity (gitignored).
let REGISTRY: { addonId?: string; name?: string } | null = null;
try { REGISTRY = require('../registry.ts') as { addonId?: string; name?: string }; } catch { /* self-hosted build */ }

const HOSTED: any = null;

const { withCacheHints, streamResponseTtl, setPrivateResponseCache, posterFp, posterEnhance, hashShort, parseExtra, markClientIntegrationStage } = require('./shared.ts') as {
  withCacheHints: (...args: any[]) => any;
  streamResponseTtl: (result: any) => number;
  setPrivateResponseCache: (res: any, maxAge: number, staleRevalidate?: number, staleError?: number) => void;
  posterFp: (config: Record<string, any>) => string;
  posterEnhance: (config?: Record<string, any>) => Record<string, unknown>;
  hashShort: (value: unknown) => string;
  parseExtra: (str: unknown) => Record<string, string>;
  markClientIntegrationStage: (req: any, name: string) => void;
};
const { franchiseRowName } = require('./manifest.ts') as { franchiseRowName: (name: string) => string };
// Phase 0 timing: per-dependency spans, no behaviour change. timeSpan passes
// straight through when req.perfTrace is absent (flag off).
const { timeSpan, spanName } = require('../middleware/perf-timing.ts') as {
  timeSpan: <T>(trace: unknown, name: string, fn: () => Promise<T> | T) => Promise<T>;
  spanName: (base: string, details?: Record<string, unknown>) => string;
};

export interface CatalogDeps {
  resolveConfig: (token: string, trace?: unknown) => Promise<Record<string, any> | null>;
}

export interface CatalogApi {
  mountCatalogRoutes: (app: Express, deps: CatalogDeps) => void;
  // Used by the client-integration facade, which projects these handlers.
  handleCatalog: (req: any, res: any, deps: CatalogDeps) => Promise<void>;
}

async function searchOwnedLibrary({ config, tmdbApiKey, type, query, sortBy, lang, enhance, userKey }: any) {
    const words = String(query || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter(word => word.length > 1);
    if (!words.length) return [];
    try {
      const downloads = await providers.fetchDownloads(config);
      const candidates = downloads.filter((item: any) => {
        const name = String(item?.name || item?.filename || '')
          .toLowerCase()
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '');
        return words.every(word => name.includes(word));
      });
      if (!candidates.length) return [];
      return buildCatalog(candidates, tmdbApiKey, type, sortBy, { search: query }, lang,
        enhance,
        { userKey, hideAnime: config.hideAnime === true, libraryIdMode: config.libraryIdMode || 'torbox', config });
    } catch (err: any) {
      console.warn('[Search] owned-library search failed:', err.message);
      return [];
    }
  }

  // Poster precedence mirrors enhanceMeta/discovery: custom > pictorium >
  // erdb > rpdb > betterposter > fanart. Async (fanart fetches); the caller
  // awaits it like every other catalog branch.
  async function searchCollectionFilms({ userKey, lang, query, libraryIdMode, config = {} }: any) {
    const words = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 1);
    if (!words.length) return [];
    const enhance = posterEnhance(config);
    const { erdbToken, rpdbKey, fanartKey, posterProvider, customPosterTemplate } = enhance as Record<string, any>;
    const pictoriumOn = !!((enhance as Record<string, any>).pictorium && (enhance as Record<string, any>).pictorium.enabled);
    const builder = require('../catalog/builder.ts');
    const rows = [];
    for (const collection of getCollections(userKey, lang)) {
      for (const video of (collection.videos || [])) {
        const title = String(video.title || '').toLowerCase();
        if (!words.every(word => title.includes(word))) continue;
        const tmdbId = video.tmdbId || Number(String(video.id || '').split(':').pop());
        const row = {
          id: libraryIdMode === 'tt' && video.imdbId ? video.imdbId : `torbox:movie:${tmdbId}`,
          type: 'movie', name: video.title, tmdbId,
          imdbId: video.imdbId || undefined,
          poster: video.thumbnail ? video.thumbnail.replace('/w300', '/w500') : null,
          releaseInfo: String(video.released || '').slice(0, 4) || undefined,
          released: video.released || undefined,
        };
        rows.push(row);
      }
    }
    const filtered = rows.filter(row => row.poster).slice(0, 50);
    if (!filtered.length) return filtered;
    if (posterProvider === 'custom') {
      const posterTemplate = require('../media/poster-template.ts');
      return filtered.map((row: any) => posterTemplate.apply(row, customPosterTemplate));
    }
    if (pictoriumOn || erdbToken || rpdbKey || fanartKey || posterProvider === 'betterposter') {
      await Promise.all(filtered.map(async (row: any) => {
        if (pictoriumOn && row.tmdbId) {
          const url = builder.buildPictoriumPosterUrl(enhance, {
            type: 'movie', id: row.tmdbId, title: row.name,
            releaseDate: row.released, imdbId: row.imdbId, fallback: row.poster,
          });
          if (url) { row.poster = url; row.posterShape = 'poster'; }
        } else if (erdbToken && row.imdbId) {
          row.poster = builder.erdbProxyUrl(enhance, 'poster', row.imdbId, row.poster) || row.poster;
        } else if (rpdbKey && row.imdbId) {
          row.poster = builder.buildRpdbUrl(rpdbKey, 'imdb', 'poster-default', row.imdbId);
        } else if (posterProvider === 'betterposter' && row.imdbId) {
          row.poster = builder.buildBetterPosterUrl(row.imdbId, 'movie');
          row.posterShape = 'poster';
        } else if (fanartKey && row.tmdbId) {
          const art = await builder.getFanartArt(fanartKey, row.tmdbId, 'movie').catch(() => null);
          if (art && art.poster) row.poster = art.poster;
        }
      }));
    }
    return filtered;
  }

  async function handleCatalog(req: any, res: any, deps: CatalogDeps): Promise<void> {
  const { resolveConfig } = deps;
    const baseConfig = await timeSpan(req.perfTrace, 'resolve-config', () => resolveConfig(req.params.token, req.perfTrace));
    const config = await timeSpan(req.perfTrace, 'configstore-merge', () => require('../runtime/configstore.ts').mergeStoredConfig(baseConfig));
    markClientIntegrationStage(req, 'config');
    if (!config) {
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ metas: [] });
    }

    const { tmdbApiKey, sortBy = 'data_adicao', lang = 'en-US', rdCatalog = 'merge', erdbToken, rpdbKey, omdbKey, fanartKey, posterProvider, hideAnime, libraryIdMode } = config;
    const active = providers.activeProviders(config);
    if (!tmdbApiKey || active.length === 0) {
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ metas: [] });
    }

    // Compact `lelibrary-curated-*` and imported folder routes return early
    // below. Register before dispatch so account Collection Wizard installs keep
    // rebuilding My Movies/My Shows when the provider library changes.
    if (active.length) registerBackgroundRefresh(req.params.token, config);

    const catalogId = req.params.catalogId;

    const customCatalogMatch = catalogId.match(/^custom-stream-(movies|series)$/);
    if (customCatalogMatch) {
      const type = customCatalogMatch[1] === 'movies' ? 'movie' : 'series';
      const extra = parseExtra(req.params.extra || '');
      const skip = Math.max(0, parseInt(extra.skip) || 0);
      const search = String(extra.search || '').trim().toLowerCase();
      const entries = customStreamCatalogEntries(config.customStreams, type)
        .filter((entry: any) => !search || entry.name.toLowerCase().includes(search))
        .slice(skip, skip + 50);
      const metas = [];
      for (let offset = 0; offset < entries.length; offset += 6) {
        const batch = await Promise.all(entries.slice(offset, offset + 6).map(async (entry: any) => {
          const item = await require('../media/tmdb.ts').findByImdbId(tmdbApiKey, entry.id);
          if (!item) return null;
          const date = item.release_date || item.first_air_date || '';
          const meta = {
            id: entry.id,
            imdbId: entry.id,
            tmdbId: item.id,
            type,
            name: item.title || item.name || entry.name,
            poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined,
            background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : undefined,
            posterShape: 'poster',
            releaseInfo: date.slice(0, 4) || undefined,
            released: date ? new Date(date).toISOString() : undefined,
            description: item.overview || undefined,
          };
          return require('../catalog/builder.ts').enhanceMeta(meta, posterEnhance(config));
        }));
        metas.push(...batch.filter(Boolean));
      }
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      return res.json({ metas });
    }

    const searchMatch = catalogId.match(/^lelibrary-search-(movies|series)$/);
    const ownedSearchMatch = catalogId.match(/^lelibrary-search-my-(movies|series)$/);
    if (searchMatch) {
      const extra = parseExtra(req.params.extra || '');
      const query = extra.search || '';
      const type = searchMatch[1] === 'movies' ? 'movie' : 'series';
      const enhance = posterEnhance(config);
      const metas = await timeSpan(req.perfTrace, 'search-catalog', () => searchCatalog({
        apiKey: tmdbApiKey, query, type, lang,
        enhance,
        enhanceFingerprint: posterFp(config),
      }));
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=1800');
      return res.json(withCacheHints({ metas }, { cacheMaxAge: 300, staleRevalidate: 1800, staleError: 1800 }));
    }
    if (ownedSearchMatch) {
      const extra = parseExtra(req.params.extra || '');
      const type = ownedSearchMatch[1] === 'movies' ? 'movie' : 'series';
      let metas;
      if (libraryEngine.isIndexed()) {
        // Index-first: search the persisted local index (Postgres), never the
        // provider library or a fresh TMDB round trip.
        metas = await timeSpan(req.perfTrace, 'pg:index-search', () => libraryEngine.search({
          token: req.params.token, config, type, query: extra.search || '',
          libraryIdMode, lang, enhance: posterEnhance(config),
        }));
      } else {
        metas = await searchOwnedLibrary({
          config, tmdbApiKey, type, query: extra.search || '', sortBy, lang,
          enhance: posterEnhance(config), userKey: providers.getUserKey(config),
        });
      }
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=1800');
      return res.json(withCacheHints({ metas }, { cacheMaxAge: 300, staleRevalidate: 1800, staleError: 1800 }));
    }
    if (catalogId === 'lelibrary-search-collections' && req.params.type === 'movie') {
      const extra = parseExtra(req.params.extra || '');
      const metas = await searchCollectionFilms({ userKey: providers.getUserKey(config), lang, query: extra.search || '', libraryIdMode, config });
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=1800');
      return res.json(withCacheHints({ metas }, { cacheMaxAge: 300, staleRevalidate: 1800, staleError: 1800 }));
    }

    const importedMatch = catalogId.match(/^lelibrary-import-(movie|series)(?:,(imp_[a-f0-9]{64}))?$/);
    if (importedMatch) {
      const extra = parseExtra(req.params.extra || '');
      const type = importedMatch[1] === 'movie' ? 'movie' : 'series';
      const skip = parseInt(extra.skip) || 0;
      const search = extra.search || '';
      let metas = [];
      const importedSourceId = importedMatch[2] || (/^imp_[a-f0-9]{64}$/.test(String(extra.genre || '')) ? String(extra.genre) : '');
      const importedLabel = !importedSourceId ? String(extra.genre || '').trim().slice(0, 160) : '';
      if (importedSourceId || importedLabel) {
        // Only an opaque account token can resolve a private definition. The
        // genre carries the human label Nuvio displays on the folder tab
        // ("<catalog name> · <genre>"); hashes remain accepted for old pushes.
        if (config.__configScope?.type !== 'account' || (!HOSTED?.resolveImportedSource && !HOSTED?.resolveImportedSourceByLabel)) return res.json({ metas: [] });
        const definition = importedSourceId
          ? await HOSTED.resolveImportedSource(req.params.token, importedSourceId, type)
          : await HOSTED.resolveImportedSourceByLabel(req.params.token, importedLabel, type);
        try {
          if (definition) {
            metas = await require('../catalog/libcatalog.ts').buildNormalizedImportedCatalog({
              definition, tmdbApiKey, lang, skip, search,
              enhance: posterEnhance(config), posterFp: posterFp(config), mdblistKey: config.mdblistKey || '',
              hideAnime: config.hideAnime === true,
            });
          } else if (!importedSourceId && HOSTED?.resolveExternalSourceByLabel) {
            const external = await HOSTED.resolveExternalSourceByLabel(req.params.token, importedLabel, type);
            if (!external) return res.json({ metas: [] });
            metas = await require('../accounts/external-catalog').fetchExternalCatalog(external, {
              skip,
              search,
              genre: external.genre || '',
            });
          } else {
            return res.json({ metas: [] });
          }
        } catch (error: any) {
          console.warn(`[Imported catalog] ${error.code || 'upstream_error'}`);
          const messages: Record<string, string> = {
            source_not_found: 'This public list or collection was deleted, made private, or is unavailable.',
            source_unavailable: 'This public source is no longer accessible.',
            provider_not_configured: 'This source provider is not configured on LeLibrary.',
            rate_limited: 'The source provider is temporarily rate limiting requests.',
            temporary_upstream_error: 'The source provider is temporarily unavailable.',
            blocked_external_host: 'This external catalogue address is not permitted.',
            external_catalog_missing: 'The configured addon no longer provides this catalogue.',
            external_catalog_empty: 'The external catalogue returned no compatible public titles.',
            external_timeout: 'The external catalogue took too long to respond.',
            unsupported_external_transport: 'This external addon does not expose a compatible catalogue route.',
            invalid_external_response: 'The external addon returned an invalid catalogue response.',
            external_source_unavailable: 'The external catalogue is temporarily unavailable.',
          };
          return res.json({ metas: [], sourceError: { code: error.code || 'upstream_error', message: messages[error.code] || 'This imported source is unavailable.' } });
        }
      } else {
        // Read-only compatibility for existing pre-normalization imports. New
        // imports never create these recipe strings.
        const ref = String(extra.genre || '');
        metas = await require('../catalog/libcatalog.ts').buildImportedCatalog({ tmdbApiKey, ref, type, lang, userKey: providers.getUserKey(config), skip, search, enhance: posterEnhance(config), posterFp: posterFp(config), mdblistKey: config.mdblistKey, hideAnime: config.hideAnime === true });
      }
      setPrivateResponseCache(res, TTL_CATALOG);
      return res.json(withCacheHints({ metas }, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
    }

    // Curated Nuvio folders share one hidden catalogue per media type. The
    // manifest advertises exactly these ids and the original source travels in
    // the genre extra: either the canonical folder label Nuvio renders on the
    // folder tab ("<catalogue name> · <genre>") or, for a source whose label
    // would be ambiguous, the exact `lib-<id>`. Older pushes (and community
    // exports) may still send the source in a comma-suffixed catalogue id.
    const curatedMatch = catalogId.match(/^lelibrary-curated-(movie|series)(?:,(lib-[a-z0-9_]+))?$/);
    if (curatedMatch) {
      const extra = parseExtra(req.params.extra || '');
      const type = curatedMatch[1] === 'movie' ? 'movie' : 'series';
      const { resolveCuratedSourceLabel, curatedSourceIds, curatedSourceDisplayName } = require('../catalog/curated-collections.ts');
      const { catalogs } = require('../catalog/catalogdefs.ts');
      const { getSourceDefinition } = require('../catalog/catalog-source-registry.ts');
      const rawSource = curatedMatch[2] || String(extra.genre || '');
      const resolveLabel = (value: string) => {
        const label = String(value || '').trim();
        if (!label) return '';
        const canonical = resolveCuratedSourceLabel(label, type);
        if (canonical) return canonical;
        // Compatibility: labels written before the shared index existed, and
        // older exports whose title differed from the canonical name.
        const configured = curatedSourceIds(config.nuvioCollectionPacks);
        return configured.find((id: any) => (
          (catalogs[id]?.type === 'movie' ? 'movie' : 'series') === type &&
          curatedSourceDisplayName(`lib-${id}`, catalogs[id]?.type) === label
        )) || '';
      };
      const libId = rawSource.startsWith('lib-')
        ? rawSource.slice(4)
        : resolveLabel(rawSource);
      const definition = getSourceDefinition(libId);
      if (!definition || (definition.type === 'movie' ? 'movie' : 'series') !== type) return res.json({ metas: [] });
      const skip = parseInt(extra.skip) || 0;
      const search = extra.search || '';
      const userKey = providers.getUserKey(config);
      const { buildLibraryCatalog } = require('../catalog/libcatalog.ts');
      let metas = [];
      try {
        metas = await timeSpan(req.perfTrace, spanName('libcatalog', { op: 'curated' }), () => buildLibraryCatalog({ tmdbApiKey, catalogId: libId, lang, userKey, skip, search, enhance: posterEnhance(config), posterFp: posterFp(config), mdblistKey: config.mdblistKey, hideAnime: config.hideAnime === true }));
      } catch (err: any) {
        console.error(`[Curated] ${libId} error:`, err.message);
      }
      setPrivateResponseCache(res, TTL_CATALOG);
      return res.json(withCacheHints({ metas }, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
    }

    // ── NuvioTV dynamic franchise MOVIE catalog (collection-{tmdbId}) ──
    // These IDs are deliberately not advertised in the manifest: NuvioTV can
    // resolve addon sources used only inside native folders. Keeping them hidden
    // prevents a large debrid library from becoming hundreds of Home rows.
    const dynamicCollectionMatch = catalogId.match(/^collection-(\d+)$/);
    if (dynamicCollectionMatch && req.params.type === 'movie') {
      const collectionId = dynamicCollectionMatch[1];
      const extra = parseExtra(req.params.extra || '');
      const skip = parseInt(extra.skip) || 0;
      const search = extra.search || '';
      const token = req.params.token;
      const indexedEngine = libraryEngine.isIndexed();
      if (indexedEngine) {
        libraryEngine.noteConfig(token, config);
      } else if (!knownConfigs.has(token)) {
        rememberConfig(token, config);
        buildAndCacheForConfig(token, config).catch(() => {});
      }
      const userKey = providers.getUserKey(config);
      let metas = getCollections(userKey, lang);
      if (metas.length === 0) {
        try {
          const persistentKey = cache.makeKey('cat', 'collections', 'collections', sortBy, '', '0', userKey, lang, posterFp(config));
          const persistent = await cache.get(persistentKey);
          if (Array.isArray(persistent?.metas) && persistent.metas.length > 0) {
            metas = persistent.metas;
            cacheCollections(userKey, lang, metas);
          }
          // In indexed mode the background engine owns provider polling and
          // franchise projection refresh. Never make a Nuvio collection open
          // perform a second full TorBox scan plus TMDB build on the request.
          if (metas.length === 0 && !indexedEngine) {
            const all = await timeSpan(req.perfTrace, spanName('provider-fetch', { op: 'collections' }), () => providers.fetchDownloads(config));
            if (!Array.isArray(all) || all.length === 0) return res.json({ metas: [] });
            metas = await buildCollectionsCatalog(all, tmdbApiKey, lang, posterEnhance(config));
            if (metas.length > 0) cacheCollections(userKey, lang, metas);
          }
        } catch (err: any) {
          console.error('[Collections] Dynamic movie catalog error:', err.message);
          return res.json({ metas: [] });
        }
      }
      const filmMetas = collectionCatalogMetas(metas, collectionId, libraryIdMode)
        .filter((film: any) => !search || (film.name || '').toLowerCase().includes(search.toLowerCase()));
      const paginated = filmMetas.slice(skip, skip + 50);
      console.log(`[Collections] Dynamic movie catalog ${collectionId} → ${paginated.length} films`);
      const responseTtl = indexedEngine && metas.length === 0 ? 15 : TTL_CATALOG;
      setPrivateResponseCache(res, responseTtl);
      return res.json(withCacheHints({ metas: paginated }, { cacheMaxAge: responseTtl, staleRevalidate: responseTtl, staleError: 1800 }));
    }

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
        rememberConfig(token, config);
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
            const all = await timeSpan(req.perfTrace, spanName('provider-fetch', { op: 'collections' }), () => providers.fetchDownloads(config));
            // Do not replace an existing in-memory collection map with an empty
            // rebuild. The normal path already retains stale data on empty scans.
            if (!Array.isArray(all) || all.length === 0) {
              console.warn(`[Collections] Film catalog: provider returned no downloads (${key})`);
              return res.json({ metas: [] });
            }
            metas = await buildCollectionsCatalog(all, tmdbApiKey, lang, posterEnhance(config));
            if (metas.length > 0) cacheCollections(userKey, lang, metas);
            console.log(`[Collections] Film catalog: rebuilt → ${metas.length} collections (${key})`);
          }
        } catch (err: any) {
          console.error('[Collections] Film catalog error:', err.message);
          return res.json({ metas: [] });
        }
      }
      const coll = metas.find((m: any) => m.id.split(':')[2] === key);
      if (!coll) {
        console.warn(`[Collections] Film catalog: key "${key}" not found among ${metas.length} collections`);
        return res.json({ metas: [] });
      }

      const filmMetas = (coll.videos || [])
        .map((v: any) => ({
          id: libraryIdMode === 'tt' && v.imdbId ? v.imdbId : `torbox:movie:${v.id.split(':').pop()}`,
          type: 'movie',
          name: v.title,
          poster: v.thumbnail ? v.thumbnail.replace('/w300', '/w500') : null,
          releaseInfo: (v.released || '').slice(0, 4) || undefined,
          released: v.released || undefined,
        }))
        .filter((f: any) => f.poster)
        .filter((f: any) => !search || (f.name || '').toLowerCase().includes(search.toLowerCase()));

      const paginated = filmMetas.slice(skip, skip + 50);
      console.log(`[Collections] Film catalog "${key}" → ${paginated.length} films`);
      setPrivateResponseCache(res, TTL_CATALOG);
      return res.json(withCacheHints({ metas: paginated }, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
    }

    // ── Catalog library rows (lib-{catalogId} from catalogdefs.js) ──
    // Rows carry plain tt: ids; the handler (TMDB discover/keyword/company/etc.)
    // is looked up in catalogdefs. MDBList-backed rows need the user's mdblistKey.
    if (catalogId.startsWith('lib-')) {
      const libId = catalogId.slice(4);
      const extra = parseExtra(req.params.extra || '');
      const skip = parseInt(extra.skip) || 0;
      const search = extra.search || '';
      const userKey = providers.getUserKey(config);
      const { buildLibraryCatalog } = require('../catalog/libcatalog.ts');
      let paginated = [];
      try {
        paginated = await timeSpan(req.perfTrace, spanName('libcatalog', { op: 'lib' }), () => buildLibraryCatalog({ tmdbApiKey, catalogId: libId, lang, userKey, skip, search, enhance: posterEnhance(config), posterFp: posterFp(config), mdblistKey: config.mdblistKey, hideAnime: config.hideAnime === true }));
      } catch (err: any) {
        console.error(`[LibCat] ${libId} error:`, err.message);
      }
      console.log(`[LibCat] ${libId} → ${paginated.length} rows`);
      setPrivateResponseCache(res, TTL_CATALOG);
      return res.json(withCacheHints({ metas: paginated }, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
    }

    // ── Watchlist catalogs (Simkl / MDBList / Trakt) ──
    // torbox-watchlist-{simkl,mdblist,trakt}-{movie,series}. Rows carry pure tt:
    // ids so external stream addons and Nuvio enrichment work. Handled before the
    // generic path (would otherwise look like a library catalog).
    const wlMatch = catalogId.match(/^torbox-watchlist-([a-z]+)-(movie|series)$/);
    if (wlMatch) {
      const wlProvider = wlMatch[1];
      const wlType = wlMatch[2];
      const extra = parseExtra(req.params.extra || '');
      const skip = parseInt(extra.skip) || 0;
      const search = extra.search || '';
      const userKey = providers.getUserKey(config);
      if (!HOSTED) return res.json({ metas: [] });
      let paginated = [];
      try {
        paginated = await HOSTED.buildWatchlistCatalog({ token: req.params.token, config, provider: wlProvider, type: wlType, lang, userKey, skip, search });
      } catch (err: any) {
        console.error(`[Watchlist] ${wlProvider} ${wlType} error:`, err.message);
      }
      console.log(`[Watchlist] ${wlProvider}:${wlType} → ${paginated.length} rows`);
      setPrivateResponseCache(res, 300);
      return res.json(withCacheHints({ metas: paginated }, { cacheMaxAge: 300, staleRevalidate: 300, staleError: 1800 }));
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
        paginated = await timeSpan(req.perfTrace, 'discovery-catalog', () => buildDiscoveryCatalog({ tmdbApiKey, kind, apiType, lang, userKey, skip, search, enhance: posterEnhance(config), posterFp: posterFp(config), hideAnime: config.hideAnime === true }));
      } catch (err: any) {
        console.error(`[Discovery] ${kind} ${apiType} error:`, err.message);
        return res.json({ metas: [] });
      }
      console.log(`[Discovery] ${kind} ${apiType} → ${paginated.length} metas (skip=${skip})`);
      setPrivateResponseCache(res, TTL_CATALOG);
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
      const collectionIdFilter = String(genre).match(/^collection-(\d+)$/)?.[1] || '';

      const token = req.params.token;
      const indexedEngine = libraryEngine.isIndexed();
      if (indexedEngine) {
        libraryEngine.noteConfig(token, config);
      } else if (!knownConfigs.has(token)) {
        rememberConfig(token, config);
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
          // Indexed sync owns provider polling and the franchise projection;
          // do not launch a duplicate scan from a catalogue request.
          if (metas.length === 0 && !indexedEngine) {
            const all = await timeSpan(req.perfTrace, spanName('provider-fetch', { op: 'collections' }), () => providers.fetchDownloads(config));
            if (!Array.isArray(all) || all.length === 0) {
              console.warn('[Collections] Movie catalog: provider returned no downloads');
              // Short TTL: an empty row must be re-fetched soon (background
              // sync rebuilds the projection), never pinned by the client.
              setPrivateResponseCache(res, 60);
              return res.json(withCacheHints({ metas: [] }, { cacheMaxAge: 60, staleRevalidate: 60, staleError: 300 }));
            }
            metas = await buildCollectionsCatalog(all, tmdbApiKey, lang, posterEnhance(config));
            if (metas.length > 0) cacheCollections(userKey, lang, metas);
          }
          if (metas.length === 0) {
            const emptyTtl = indexedEngine ? 15 : 60;
            setPrivateResponseCache(res, emptyTtl);
            return res.json(withCacheHints({ metas: [] }, { cacheMaxAge: emptyTtl, staleRevalidate: emptyTtl, staleError: 300 }));
          }
        } catch (err: any) {
          console.error('[Collections] Movie catalog error:', err.message);
          setPrivateResponseCache(res, 60);
          return res.json(withCacheHints({ metas: [] }, { cacheMaxAge: 60, staleRevalidate: 60, staleError: 300 }));
        }
      }

      const filmMetas = [];
      for (const c of metas) {
        const fname = franchiseRowName(c.name);
        if (collectionIdFilter) {
          if (String(c.collectionId) !== collectionIdFilter) continue;
        } else if (genre && fname !== genre) continue;
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
        .filter((f: any) => f.poster)
        .filter((f: any) => !search || (f.name || '').toLowerCase().includes(search.toLowerCase()));
      const paginated = filtered.slice(skip, skip + 50);
      console.log(`[Collections] Movie catalog "${genre || 'all'}" → ${paginated.length} films`);
      const responseTtl = indexedEngine && metas.length === 0 ? 15 : TTL_CATALOG;
      setPrivateResponseCache(res, responseTtl);
      return res.json(withCacheHints({ metas: paginated }, { cacheMaxAge: responseTtl, staleRevalidate: responseTtl, staleError: 1800 }));
    }

    // ── Legacy Collections series catalog (dead code, kept for backward compat) ──
    // Spans ALL providers, isolated to torbox:collection:* metas.
    if (catalogId.endsWith('-collections')) {
      const extra  = parseExtra(req.params.extra || '');
      const skip   = parseInt(extra.skip) || 0;
      const search = extra.search || '';

      const token = req.params.token;
      if (!knownConfigs.has(token)) {
        rememberConfig(token, config);
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
          metas = await buildCollectionsCatalog(all, tmdbApiKey, lang, posterEnhance(config));
          cacheCollections(userKey, lang, metas);
          await cache.set(collKey, { metas }, TTL_CATALOG);
          console.log(`[Collections] Built → ${metas.length} items`);
        } catch (err: any) {
          console.error('[Collections] Error:', err.message);
          return res.json({ metas: [] });
        }
      }
      if (search) metas = metas.filter((m: any) => (m.name || '').toLowerCase().includes(search.toLowerCase()));
      const paginated = metas.slice(skip, skip + 50);
      setPrivateResponseCache(res, TTL_CATALOG);
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

    const token = req.params.token;
    if (!knownConfigs.has(token) && !libraryEngine.isIndexed()) {
      rememberConfig(token, config);
      buildAndCacheForConfig(token, config).catch(() => {});
    }

    const userKey  = providers.getUserKey(config);

    // ── Index-first library catalogs (LIBRARY_ENGINE=indexed) ──
    // My Movies / My Shows / My Anime (and per-provider rows in separate mode)
    // are served from the persistent local index: one SQL query plus in-memory
    // assembly, with no provider scan and no TMDB search on the request path. A
    // `search` extra falls through to the dedicated owned-search catalogs above,
    // so we only take this branch for plain reads.
    if (libraryEngine.isIndexed() && !search && !req.forceLegacyCatalog) {
      try {
        const out = await timeSpan(req.perfTrace, 'pg:index-catalog', () => libraryEngine.buildCatalog({
          token, config, type, sortBy, skip, libraryIdMode, lang,
          enhance: posterEnhance(config),
          provider: separate ? catalogProviderId : null,
          trace: req.perfTrace,
        }));
        const metas = out.metas || [];
        // Indexed mode never falls back to a request-time provider scan. On a
        // cold scope the worker is already syncing; waiting for the legacy
        // builder here duplicated pagination/matching and could surface as a
        // 503 under load. Return a short-lived empty page until the index lands.
        console.log(`[Catalog:index] ${catalogId} → ${metas.length}${out.syncing ? ' (syncing)' : ''}${out.ready ? '' : ' (warming)'}`);
        const responseTtl = metas.length ? OWNED_CATALOG_CLIENT_TTL : 10;
        setPrivateResponseCache(res, responseTtl, responseTtl, 300);
        return res.json(withCacheHints({ metas }, { cacheMaxAge: responseTtl, staleRevalidate: responseTtl, staleError: 300 }));
      } catch (err: any) {
        console.error(`[Catalog:index] ${catalogId} index read failed:`, err.message);
        // Keep the catalogue route available during a transient DB timeout.
        // Do not turn a failed indexed read into a slow provider scan on the
        // same request; the next client refresh will retry the index.
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(withCacheHints({ metas: [] }, { cacheMaxAge: 0, staleRevalidate: 0, staleError: 0 }));
      }
    }

    console.log(`[Catalog] catalog=${catalogId} type=${type} skip=${skip} lang=${lang}`);
    const catKey   = separate ? providers.PROVIDER_META[catalogProviderId].cat : 'merged';
    // hideAnime is part of the key: installs sharing provider keys but differing
    // in hide-anime used to serve each other's rows for the whole TTL.
    // So is a limited TorBox source selection (torboxSources).
    const sourcesKey = providers.torboxSourcesKey(config);
    const cacheKey = cache.makeKey('cat', catKey, type, sortBy, search, skip.toString(), userKey, lang, posterFp(config), libraryIdMode, hideAnime ? 'noanime' : '', sourcesKey);
    // Long-lived "last good" copy of this catalog page. The serve-stale branches
    // below used to re-read `cacheKey` itself: the exact key that just missed -
    // so the protection never fired. This snapshot is only written on success.
    const catlastKey = cache.makeKey('catlast', catKey, type, sortBy, skip.toString(), userKey, lang, sourcesKey);
    const cached   = await cache.get(cacheKey);

    // A previous upstream throttle used to cache zero rows for a whole hour.
    // Treat empty pages as a recovery opportunity: a successful provider read
    // below replaces them, while a failed read falls back without extending the
    // poisoned cache.
    if (cached && Array.isArray(cached.metas) && cached.metas.length > 0) {
      console.log(`[Catalog] Cache hit → ${cached.metas.length} items`);
      populateTmdbIndexFromMetas(cached.metas, userKey);
      setPrivateResponseCache(res, OWNED_CATALOG_CLIENT_TTL, OWNED_CATALOG_CLIENT_TTL, 300);
      return res.json(withCacheHints(cached, { cacheMaxAge: OWNED_CATALOG_CLIENT_TTL, staleRevalidate: OWNED_CATALOG_CLIENT_TTL, staleError: 300 }));
    }

    try {
      // In separate mode fetch only this provider's downloads; in merge mode all.
      const all   = await timeSpan(req.perfTrace, spanName('provider-fetch', { op: 'downloads' }), () => providers.fetchDownloads(config, { only: separate ? [catalogProviderId] : null }));
      const downloads = separate ? providers.downloadsFor(all, catalogProviderId) : all;

      // Compute the same projection-scoped hash as the background refresh.
      // This keeps a direct Nuvio request from undoing another profile's cache
      // comparison when both use the same provider account.
      const projectionFp = hashShort(JSON.stringify({
        sortBy, lang, rdCatalog, poster: posterFp(config), libraryIdMode: libraryIdMode || 'torbox', hideAnime: !!hideAnime,
        torboxSources: sourcesKey,
      }));
      const newHash = `${LIBRARY_PROJECTION_VERSION}:${hashDownloads(downloads)}:${posterFp(config)}:${libraryIdMode || 'torbox'}`;
      const hashKey = cache.makeKey('dlhash', 'v2', userKey, projectionFp);
      const oldHash = await cache.get(hashKey);
      const hashChanged = oldHash !== newHash;

      // Resilience: a suddenly-empty provider response must not blank the cached
      // catalog. If we had content before and now get nothing, serve the last
      // good snapshot instead of rebuilding it empty.
      if (hashChanged && downloads.length === 0 && oldHash) {
        const stale = await cache.get(catlastKey).catch(() => null);
        if (stale) {
          console.log('[Catalog] Empty provider response: serving cached catalog instead of blanking');
          await cache.touchPattern(`cat:*${userKey}*`, TTL_CATALOG);
          setPrivateResponseCache(res, 60);
          return res.json(withCacheHints(stale, { cacheMaxAge: 60, staleRevalidate: 60, staleError: 1800 }));
        }
      }

      // Progressive: return already-known items immediately, complete the rest in the background
      const built = await buildCatalog(downloads, tmdbApiKey, type, sortBy, { skip, search }, lang, posterEnhance(config), { progressive: true, userKey, hideAnime, libraryIdMode, config });
      const isPartial = !!built.completion;
      const metas     = built.metas || built;

      if (isPartial) {
        console.log(`[Catalog] Fast-returning ${metas.length} metas, completing ${built._fresh || 0} in background`);
        // Serve partial immediately (short cache so the client re-fetches once complete)
        await cache.set(cacheKey, { metas }, 10);
        setPrivateResponseCache(res, 10);
        res.json(withCacheHints({ metas }, { cacheMaxAge: 10, staleRevalidate: 10, staleError: 1800 }));
        // Finish matching + rebuild full catalog in the background
        built.completion.then(async () => {
          try {
            const full = await buildCatalog(downloads, tmdbApiKey, type, sortBy, { skip, search }, lang, posterEnhance(config), { userKey, hideAnime, libraryIdMode, config });
            const result = { metas: full };
            if (hashChanged) {
              await cache.set(hashKey, newHash, 7200);
              await cache.delPattern(`cat:*${userKey}*`);
            }
            await Promise.all([
              cache.set(cacheKey, result, TTL_CATALOG),
              cache.set(catlastKey, result, 7 * 86400), // last-good snapshot for outage fallback
            ]);
            console.log(`[Catalog] Progressive completion → ${full.length} metas cached`);
          } catch (err: any) {
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
      await Promise.all([
        cache.set(cacheKey, result, TTL_CATALOG),
        metas.length > 0 ? cache.set(catlastKey, result, 7 * 86400) : Promise.resolve(),
      ]);

      setPrivateResponseCache(res, OWNED_CATALOG_CLIENT_TTL, OWNED_CATALOG_CLIENT_TTL, 300);
      res.json(withCacheHints(result, { cacheMaxAge: OWNED_CATALOG_CLIENT_TTL, staleRevalidate: OWNED_CATALOG_CLIENT_TTL, staleError: 300 }));
    } catch (err: any) {
      console.error('[Catalog] Error:', err.message);
      // If we had a last-good snapshot, serve it as fallback instead of empty
      const stale = await cache.get(catlastKey).catch(() => null);
      if (stale) {
        console.log('[Catalog] Serving stale cache as fallback');
        return res.json(withCacheHints(stale, { cacheMaxAge: 60, staleRevalidate: 60, staleError: 1800 }));
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ metas: [] });
    }
  }

function mountCatalogRoutes(app: Express, deps: CatalogDeps): void {
  const { resolveConfig } = deps;
  // Owned search uses a small, targeted pass over the provider library without
  // mixing those results into the canonical TMDB search rows.
    app.get('/:token/catalog/:type/:catalogId.json', (req, res) => handleCatalog(req, res, deps));
  app.get('/:token/catalog/:type/:catalogId/:extra.json', (req, res) => handleCatalog(req, res, deps));

  // ── Catalog preview (configure page) ────────────────────────────────────
  // Renders a small poster grid of a user's catalog by running the REAL catalog
  // pipeline (same handler, same cache, same gates) and truncating the result.
  // This keeps the website preview in lockstep with what Stremio/Nuvio actually
  // receive: no parallel TMDB re-implementation that could drift.
  app.get('/:token/preview/:type/:catalogId.json', rateLimit({ windowMs: 60000, max: 40 }), async (req: any, res: any) => {
    // A preview can be partial, configuration-dependent, or backed by mutable
    // setup state. Never let a client or intermediary retain it.
    res.setHeader('Cache-Control', 'no-store');
    try {
      const config = await require('../runtime/configstore.ts').mergeStoredConfig(await resolveConfig(req.params.token));
      if (!config) return res.json({ metas: [], error: 'invalid_token' });
      const { tmdbApiKey } = config;
      const active = providers.activeProviders(config);
      if (!tmdbApiKey || active.length === 0) return res.json({ metas: [], error: 'missing_keys' });

      // Forward any genre/search/skip extras so collections and filters preview honestly.
      const extraStr = Object.entries(req.query || {})
        .filter(([k]) => /^(genre|search|skip|sort)$/.test(String(k)))
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');

      const captured: any = {};
      const fakeRes = { setHeader() {}, json(body: any) { captured.body = body; } };
      const fakeReq = { params: { token: req.params.token, type: req.params.type, catalogId: req.params.catalogId, extra: extraStr }, forceLegacyCatalog: true };
      await handleCatalog(fakeReq, fakeRes, deps);

      const metas = Array.isArray(captured.body && captured.body.metas) ? captured.body.metas : [];
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      res.json({ metas: metas.slice(0, 12), total: metas.length });
    } catch (err: any) {
      console.error('[Preview] error:', err.message);
      res.status(500).json({ error: 'preview_failed' });
    }
  });

  // POST preview: same pipeline but config comes in JSON body to avoid URL-length
  // limits when the user has large imported collections (e.g. Kaptain 22-folder pack).
  app.post('/api/preview', express.json({ limit: '2mb' }), rateLimit({ windowMs: 60000, max: 40 }), async (req: any, res: any) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const body = req.body || {};
      let config = body.config;
      if ((!config || typeof config !== 'object') && body.token) {
        config = await require('../runtime/configstore.ts').mergeStoredConfig(await resolveConfig(body.token));
      }
      if (!config || typeof config !== 'object') return res.status(400).json({ error: 'missing_config' });
      const type = String(body.type || '').trim();
      const catalogId = String(body.catalogId || '').trim();
      if (!type || !catalogId) return res.status(400).json({ error: 'missing_params' });
      const { tmdbApiKey } = config;
      const active = providers.activeProviders(config);
      if (!tmdbApiKey || active.length === 0) return res.json({ metas: [], error: 'missing_keys' });
      const extraStr = typeof body.extra === 'string' ? body.extra
        : Object.entries(body.extra || body.query || {}).filter(([k]) => /^(genre|search|skip|sort)$/.test(String(k))).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
      const tokenMap = require('../config/token-map.ts');
      const token = tokenMap.encodeConfig(config);
      const captured: any = {};
      const fakeRes = { setHeader() {}, json(b: any) { captured.body = b; } };
      const fakeReq = { params: { token, type, catalogId, extra: extraStr }, forceLegacyCatalog: true };
      await handleCatalog(fakeReq, fakeRes, deps);
      const metas = Array.isArray(captured.body && captured.body.metas) ? captured.body.metas : [];
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      res.json({ metas: metas.slice(0, 12), total: metas.length });
    } catch (err: any) {
      console.error('[Preview POST] error:', err.message);
      res.status(500).json({ error: 'preview_failed' });
    }
  });

  // Small, live TMDB picker endpoints used by the Custom Streams editor. These
  // deliberately fetch one selected season at a time; expanding full metadata
  // for every season made long-running series unnecessarily slow and expensive.
  app.get('/:token/custom-streams/series/:id/seasons.json', async (req: any, res: any) => {
    try {
      const base = await resolveConfig(req.params.token);
      if (!base) return res.status(404).json({ seasons: [] });
      const config = await require('../runtime/configstore.ts').mergeStoredConfig(base);
      if (!config.tmdbApiKey || !/^tt\d+$/.test(req.params.id)) return res.status(400).json({ seasons: [] });
      const { imdbToTmdbCached, getSeriesSeasons } = require('../media/tmdb.ts');
      const selectedTmdbId = Number(req.query.tmdbId);
      const mapped = Number.isSafeInteger(selectedTmdbId) && selectedTmdbId > 0
        ? { tmdbId: selectedTmdbId, type: 'series' }
        : await imdbToTmdbCached(config.tmdbApiKey, req.params.id);
      const seasons = mapped?.type === 'series' ? await getSeriesSeasons(config.tmdbApiKey, mapped.tmdbId, config.lang || 'en-US') : [];
      res.setHeader('Cache-Control', 'private, no-cache');
      res.json({ seasons: Array.isArray(seasons) ? seasons : [] });
    } catch { res.status(502).json({ seasons: [] }); }
  });

  app.get('/:token/custom-streams/series/:id/season/:season.json', async (req: any, res: any) => {
    try {
      const base = await resolveConfig(req.params.token);
      if (!base) return res.status(404).json({ episodes: [] });
      const config = await require('../runtime/configstore.ts').mergeStoredConfig(base);
      const season = Number(req.params.season);
      if (!config.tmdbApiKey || !/^tt\d+$/.test(req.params.id) || !Number.isInteger(season) || season < 0) return res.status(400).json({ episodes: [] });
      const { imdbToTmdbCached, getSeasonEpisodes } = require('../media/tmdb.ts');
      const selectedTmdbId = Number(req.query.tmdbId);
      const mapped = Number.isSafeInteger(selectedTmdbId) && selectedTmdbId > 0
        ? { tmdbId: selectedTmdbId, type: 'series' }
        : await imdbToTmdbCached(config.tmdbApiKey, req.params.id);
      const episodes = mapped?.type === 'series' ? await getSeasonEpisodes(config.tmdbApiKey, mapped.tmdbId, season, config.lang || 'en-US') : [];
      res.setHeader('Cache-Control', 'private, no-cache');
      res.json({ episodes });
    } catch { res.status(502).json({ episodes: [] }); }
  });

  // ─── META ─────────────────────────────────────────────────────────────────────

}

module.exports = { mountCatalogRoutes, handleCatalog } satisfies CatalogApi;
