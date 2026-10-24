// Nuvio Collections profile document: the manifest side of a pushed collection
// set, plus the profile-scoped collections.json the client reads.
import type { Express, Request, Response } from 'express';

const { errorHandler } = require('../middleware/error-handler.ts');
const {
  TTL_CATALOG, TTL_STREAM, OWNED_CATALOG_CLIENT_TTL,
  knownConfigs, KNOWN_CONFIGS_MAX, knownConfigFailures, catalogBuildInFlight,
  providerRefreshSnapshots, providerRefreshInFlight,
  rememberConfig, registerBackgroundRefresh, restoreAccountRefreshRegistry,
  refreshDownloadsForUser, hashDownloads, buildAndCacheForConfigInner, buildAndCacheForConfig,
  settleWithin, waitFor,
} = require('../runtime/refresh.ts');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const cache   = require('../runtime/cache.ts');
const pictoriumWarm = require('../runtime/pictorium-warm.ts');
const providers = require('../providers/index.ts');
const { buildCatalog, buildMeta, buildStreams, populateTmdbIndexFromMetas, applyStreamNotices, libraryStreamFmtFp } = require('../catalog/builder.ts');
const { buildDiscoveryCatalog, buildDiscoveryMeta, buildDiscoveryStreams, discoveryStreamKeyParts } = require('../catalog/discovery.ts');
const { buildCollectionsCatalog, cacheCollections, getCollectionMeta, getCollections, collectionsBuilt, getCollectionForMovie } = require('../catalog/franchise-collections.ts');
const { normaliseNuvioArtwork, absoluteLocalArtwork } = require('../catalog/collection-artwork.ts');
const { compileCollectionPlan } = require('../catalog/collection-plan.ts');
const { posterFp } = require('./shared.ts') as { posterFp: (config: Record<string, any>) => string };

const { buildLibraryCollection, collectionCatalogMetas } = require('../catalog/nuvio-library-collections.ts') as {
  buildLibraryCollection: (...args: any[]) => any;
  collectionCatalogMetas: (...args: any[]) => any;
};

const HOSTED: any = null;

// How long an owned-only request (a Nuvio push) may wait for a cold library
// build before publishing what is ready. Bounded so the push always answers
// well inside the browser and edge request limits; the build continues in the
// background and the next push picks up the franchise folders.
const OWNED_BUILD_BUDGET_MS = 15000;
// Nuvio fetches this profile document frequently, but its folder definitions
// can change on the next push. Keep reuse short and allow conditional ETag
// revalidation; even stale fallback remains bounded to six minutes.
const NUVIO_COLLECTIONS_CACHE_CONTROL = 'private, max-age=60, stale-while-revalidate=60, stale-if-error=300';

function cacheNuvioCollections(res: any): void {
  res.setHeader('Cache-Control', NUVIO_COLLECTIONS_CACHE_CONTROL);
}

// Private addon identity (gitignored), used for the owned-library catalogue id.
let REGISTRY: { addonId?: string; name?: string } | null = null;
try { REGISTRY = require('../registry.ts') as { addonId?: string; name?: string }; } catch { /* self-hosted build */ }

export interface CollectionsDeps {
  resolveConfig: (token: string) => Promise<Record<string, any> | null>;
}

export interface CollectionsApi {
  mountCollectionsRoutes: (app: Express, deps: CollectionsDeps) => void;
}

function mountCollectionsRoutes(app: Express, deps: CollectionsDeps): void {
  const { resolveConfig } = deps;
  async function handleNuvioProfile(req: any, res: any) {
    const config = await resolveConfig(req.params.token);
    if (!config) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(400).json({ error: 'Invalid token' });
    }
    const { tmdbApiKey, lang = 'en-US' } = config;
    const active = providers.activeProviders(config);
    if (!tmdbApiKey || active.length === 0) {
      res.setHeader('Cache-Control', 'no-store');
      return res.json([]);
    }
    // Collection-wizard tokens can return their saved document below without
    // ever touching My Movies/My Shows. They still need to join the exact same
    // 2-minute provider refresh loop as a normal Configure install.
    registerBackgroundRefresh(req.params.token, config);

    const addonId = (REGISTRY && REGISTRY.addonId) || 'community.lelibrary.selfhosted';
    const artworkOrigin = `${req.protocol}://${req.get('host')}`;

    // Nuvio collection exports can contain first-class public TMDB and Trakt
    // sources. They are not addon catalogues: Nuvio resolves them itself. Keep
    // the exact source payload when pushing an imported collection so list IDs,
    // filters and sort order behave exactly like the original community pack.
    function nativeNuvioSources(folder: any) {
      if (!Array.isArray(folder?.sources)) return [];
      return folder.sources.filter((source: any) => {
        const provider = String(source?.provider || '').toLowerCase();
        if (provider === 'trakt') return Number.isFinite(Number(source.traktListId)) && Number(source.traktListId) > 0;
        if (provider !== 'tmdb') return false;
        const kind = String(source.tmdbSourceType || '').toUpperCase();
        return !!kind && (Number.isFinite(Number(source.tmdbId)) || kind === 'DISCOVER');
      }).map((source: any) => ({ ...source }));
    }

    function addonNuvioSources(folder: any) {
      if (!Array.isArray(folder?.sources)) return [];
      return folder.sources.filter((source: any) => (
        String(source?.provider || '').toLowerCase() === 'addon' &&
        source.addonId && source.type && source.catalogId
      )).map((source: any) => ({ ...source }));
    }

    const curatedModule = require('../catalog/curated-collections.ts');
    const curatedSourceIds = curatedModule.curatedSourceIds(config.nuvioCollectionPacks);
    const curatedCatalogIds = new Set(curatedSourceIds.map((id: any) => `lib-${id}`));
    // Nuvio's addon-source schema has no `title` field. It displays `genre`
    // beneath the generic catalogue name, so send a readable label there while
    // resolving it back to the source id in the catalogue handler below.
    const curatedSourceLabels = new Map(curatedSourceIds.map((id: any) => [
      `lib-${id}`,
      // The canonical folder label: readable on the folder tab AND resolvable
      // back to this exact source by the catalogue handler.
      curatedModule.curatedFolderLabel(`lib-${id}`, require('../catalog/catalogdefs.ts').catalogs[id]?.type)
        || curatedModule.curatedSourceDisplayName(`lib-${id}`, require('../catalog/catalogdefs.ts').catalogs[id]?.type),
    ]));

    function renderCollections(collections: any) {
      // Curated folder sources are multiplexed through one hidden catalogue per
      // media type on Nuvio. The original lib-* id travels in `genre`, so the
      // catalogue handler can still use the exact same source definition. This
      // keeps native folders working without bloating Nuvio's addon settings.
      const renderCatalogSource = (source: any) => {
        const type = source.type === 'movie' ? 'movie' : 'series';
        const catalogId = String(source.catalogId || '');
        // A folder source may arrive as an internal routing id from an older
        // export; recover the real catalogue before rendering it.
        const recovered = /^lib-/.test(catalogId) ? catalogId : require('../catalog/collection-plan.ts').upgradeCuratedSourceId(catalogId, source.genre, type);
        if (recovered && curatedCatalogIds.has(recovered)) {
          return { addonId, catalogId: `lelibrary-curated-${type}`, type, genre: curatedSourceLabels.get(recovered) || recovered };
        }
        return { addonId: source.addonId === '__lelibrary__' ? addonId : (source.addonId || addonId), catalogId: recovered || catalogId, type, genre: source.genre || '' };
      };
      return collections
        .filter((c: any) => c && typeof c === 'object' && Array.isArray(c.folders))
        .map((c: any) => ({
          focusGlowEnabled: c.focusGlowEnabled !== false,
          id: c.id || `collection-${Math.random().toString(36).slice(2, 8)}`,
          title: c.title || 'LeLibrary Collections',
          // Explicit false matters: Nuvio persists this independently from Home
          // order, so omitting it can leave an old true value in place.
          pinToTop: c.pinToTop === true,
          showAllTab: c.showAllTab !== false,
          viewMode: c.viewMode || 'TABBED_GRID',
          folders: c.folders.map((f: any, i: any) => {
            const sources = [...nativeNuvioSources(f), ...addonNuvioSources(f)];
            const folder = {
              id: f.id || `folder-${i}`,
              title: f.title || 'Collection',
              tileShape: require('../catalog/collection-artwork.ts').nuvioTileShape(f.tileShape),
              hideTitle: !!f.hideTitle,
              heroBackdropUrl: absoluteLocalArtwork(f.heroBackdropUrl, artworkOrigin),
              heroVideoUrl: absoluteLocalArtwork(f.heroVideoUrl, artworkOrigin),
              titleLogoUrl: absoluteLocalArtwork(f.titleLogoUrl, artworkOrigin),
              ...normaliseNuvioArtwork(f, artworkOrigin),
            };
            // `sources` is the current Nuvio model. `catalogSources` is emitted
            // only for legacy folder documents that do not already have sources.
            if (sources.length) folder.sources = sources;
            else folder.catalogSources = Array.isArray(f.catalogSources) && f.catalogSources.length
              ? f.catalogSources.map(renderCatalogSource)
              : [{ addonId, catalogId: 'torbox-collections', type: 'movie', genre: '' }];
            return folder;
          }),
        }));
    }

    // Configure packs are token-backed and work for self-hosters too. A pack is
    // opt-in, so it never changes an existing account collection document.
    const curated = require('../catalog/curated-collections.ts').buildCuratedCollections(
      config.nuvioCollectionPacks,
      config.nuvioCollectionOverrides || {},
      { hideAnime: config.hideAnime === true }
    );
    // Imported Nuvio folders are token-backed just like curated packs. Native
    // TMDB/Trakt sources stay native; addon catalog sources stay as references.
    const importedSources = Array.isArray(config.importedRows) ? config.importedRows : [];
    const imported = importedSources
      .flatMap((source) => (Array.isArray(source?.collections) ? source.collections.map((collection: any) => ({ ...collection, _importSourceId: source.id })) : []))
      .map((collection) => ({
        ...collection,
        id: String(collection.id || '').startsWith('collection-imported-')
          ? collection.id : `collection-imported-${String(collection.id || 'source').replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)}`,
        enabled: collection.enabled !== false,
        folders: (collection.folders || []).filter((folder: any) => {
          if (!folder || folder.enabled === false) return false;
          return nativeNuvioSources(folder).length > 0 ||
            (Array.isArray(folder.catalogSources) && folder.catalogSources.every((source: any) => source && source.addonId));
        }),
      }))
      .filter(collection => collection.enabled && collection.folders.length > 0);
    const configuredOrder = Array.isArray(config.catalogOrder) ? config.catalogOrder : [];
    const importedOrder = new Map(configuredOrder.map((key, index) => [String(key), index]));
    imported.sort((a, b) => {
      const aKey = `importedCollection:${a._importSourceId}:${a.id.replace(/^collection-imported-/, '')}`;
      const bKey = `importedCollection:${b._importSourceId}:${b.id.replace(/^collection-imported-/, '')}`;
      return (importedOrder.get(aKey) ?? Number.MAX_SAFE_INTEGER) - (importedOrder.get(bKey) ?? Number.MAX_SAFE_INTEGER);
    });
    imported.forEach(collection => { delete collection._importSourceId; delete collection.enabled; });
    // If the token owner has a saved Collections config, render THAT structure
    // instead of the franchise default. Folders point at `lib-{catalogId}` rows
    // (or torbox-collections with a genre) and Nuvio resolves them against the
    // manifest. The catalog handler ignores the genre extra for lib- rows.
    let storedCollections = [];
    if (HOSTED && typeof HOSTED.tokenCollectionConfig === 'function') {
      try {
        const stored = await HOSTED.tokenCollectionConfig(req.params.token, {
          integration: req.query.integration === 'stremio' ? 'stremio' : 'nuvio',
          profile_id: typeof req.query.profile_id === 'string' ? req.query.profile_id : 'default',
        });
        // Do not leak a Collections Wizard document into a different account
        // token's legacy /collections.json export. The token being installed is
        // the authority for this response; mixing the two was the source of the
        // duplicate native collections and mobile Nuvio crashes.
        if (stored && String(stored.manifest_token_id || '') === String(req.params.token) && Array.isArray(stored.collections)) {
          storedCollections = compileCollectionPlan({
            collections: stored.collections,
            homeRows: stored.home_rows,
            sources: stored.sources,
            externalSources: stored.external_sources,
            manifestId: addonId,
            integration: req.query.integration === 'stremio' ? 'stremio' : 'nuvio',
            hideAnime: config.hideAnime === true,
          }).collections;
        }
      } catch (err: any) {
        console.warn('[Nuvio] stored collections render failed, falling back:', err.message);
      }
    }

    // The Collections Wizard already persists its complete native-collection
    // document. Its token must export that document verbatim: adding legacy
    // packs or the provider-franchise fallback here creates a second, competing
    // collection tree for the very same Nuvio profile.
    if (config.collection_setup === true && storedCollections.length && req.query.owned_only !== '1') {
      cacheNuvioCollections(res);
      return res.json(renderCollections(storedCollections));
    }

    if (config.catalogFranchises === false && req.query.owned_only !== '1') {
      cacheNuvioCollections(res);
      return res.json(renderCollections([...curated, ...imported, ...storedCollections]));
    }

    // A saved account collection document may contain additional custom
    // collections, but it must not silently remove the live library-franchise
    // collection. Respect an explicitly saved replacement with the same id.
    if (storedCollections.some((collection: any) => collection?.id === 'collection-lelibrary-franchises')) {
      cacheNuvioCollections(res);
      return res.json(renderCollections([...curated, ...imported, ...storedCollections]));
    }

    const userKey = providers.getUserKey(config);
    const ownedOnly = req.query.owned_only === '1';
    if (!knownConfigs.has(req.params.token)) {
      rememberConfig(req.params.token, config);
      // A normal client request can populate a cold cache in the background.
      // The account push path must not: it needs the finished folder projection
      // before it writes Nuvio's static collection document.
      if (!ownedOnly) buildAndCacheForConfig(req.params.token, config).catch(() => {});
    }
    let metas = getCollections(userKey, lang);
    if (metas.length === 0) {
      // Do not make an install or a Nuvio sync wait while every owned title is
      // rematched into franchise folders after a restart. The normal catalog
      // build persists this exact payload in Redis, so restore it first just as
      // the manifest route does.
      try {
        const persistentKey = cache.makeKey('cat', 'collections', 'collections', config.sortBy || 'data_adicao', '', '0', userKey, lang, posterFp(config));
        const persistent = await cache.get(persistentKey);
        if (Array.isArray(persistent?.metas) && persistent.metas.length > 0) {
          metas = persistent.metas;
          cacheCollections(userKey, lang, metas);
        }
      } catch (err: any) {
        console.warn('[Nuvio] Collections cache restore failed:', err.message);
      }
    }
    // Built and empty (the library owns no franchise films): nothing to wait for.
    const builtEmpty = () => metas.length === 0 && collectionsBuilt(userKey, lang);
    if (metas.length === 0 && ownedOnly && !builtEmpty()) {
      try {
        // A cold library is provider pagination plus TMDB matching: minutes on a
        // big account. The push that asks for owned franchise folders must not
        // wait for all of it. Waiting unboundedly made the browser give up
        // ("Push failed") while the build carried on and the retry succeeded,
        // which is exactly the first-push-times-out-then-works report. Wait a
        // bounded slice, publish whatever is ready, and let the build finish in
        // the background: the next push then includes the franchise folders.
        const indexed = (() => { try { return require('../library/engine.ts').isIndexed(); } catch { return false; } })();
        if (indexed) {
          // The index worker owns the library. Register the scope (a first
          // sighting starts its sync) and wait for the projection the folders
          // are built from. Deliberately NOT the legacy rebuild below: that
          // duplicates the whole provider scan + TMDB match the worker is
          // already running.
          try { require('../library/engine.ts').noteConfig(req.params.token, config); } catch { /* engine absent */ }
          await waitFor(() => getCollections(userKey, lang).length > 0 || collectionsBuilt(userKey, lang), OWNED_BUILD_BUDGET_MS);
          metas = getCollections(userKey, lang);
        } else {
          const settled = await settleWithin(
            buildAndCacheForConfig(req.params.token, config),
            OWNED_BUILD_BUDGET_MS,
          );
          metas = getCollections(userKey, lang);
          if (!settled) {
            console.log('[Nuvio] Owned library still building; publishing what is ready');
          }
        }
        if (metas.length === 0) {
          console.log('[Nuvio] Owned library still building; publishing what is ready');
        }
      } catch (err: any) {
        console.warn('[Nuvio] Owned collection build failed:', err.message);
      }
    }
    if (metas.length === 0 && ownedOnly && builtEmpty()) {
      // The owned collection exists with no folders, so a push is complete
      // (not "still building") and simply has no franchise folders to add.
      return res.json(renderCollections([buildLibraryCollection([], addonId, config)]));
    }
    if (metas.length === 0) {
      // A cold cache builds in the background. Returning the rest of the native
      // setup immediately keeps Nuvio responsive; the next push will include
      // the freshly built franchise folders.
      if (!knownConfigs.has(req.params.token)) rememberConfig(req.params.token, config);
      // The indexed worker is the only owner of provider snapshots while the
      // engine is enabled. Starting the legacy builder here would repeat the
      // full TorBox scan and TMDB matching concurrently with its sync.
      const indexed = (() => { try { return require('../library/engine.ts').isIndexed(); } catch { return false; } })();
      if (indexed) {
        try { require('../library/engine.ts').noteConfig(req.params.token, config); } catch { /* engine absent */ }
      } else {
        buildAndCacheForConfig(req.params.token, config).catch((err: any) => {
          console.warn('[Nuvio] Background collection build failed:', err.message);
        });
      }
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      return res.json(renderCollections([...curated, ...imported]));
    }
    cacheNuvioCollections(res);
    const ownedLibraryCollection = buildLibraryCollection(metas, addonId, config);
    if (req.query.owned_only === '1') return res.json(renderCollections([ownedLibraryCollection]));
    res.json(renderCollections([...curated, ...imported, ...storedCollections, ownedLibraryCollection]));
  }

  app.get('/:token/collections.json', handleNuvioProfile);
  app.get('/:token/nuvio-collections/manifest.json', handleNuvioProfile);
  app.get('/:token/nuvio-collections.json', handleNuvioProfile);
}

module.exports = { mountCollectionsRoutes } satisfies CollectionsApi;
