// Manifest surface: the base manifest, the configured manifest, the client
// integration facade's manifest path, and the Configure URL each install points
// at. Everything here is served for a token, so resolution and caching rules
// match the other addon routes.
import type { Express, Request, Response } from 'express';

const {
  TTL_CATALOG, TTL_STREAM, OWNED_CATALOG_CLIENT_TTL,
  knownConfigs, KNOWN_CONFIGS_MAX, knownConfigFailures, catalogBuildInFlight,
  providerRefreshSnapshots, providerRefreshInFlight,
  rememberConfig, registerBackgroundRefresh, restoreAccountRefreshRegistry,
  refreshDownloadsForUser, hashDownloads, buildAndCacheForConfigInner, buildAndCacheForConfig,
} = require('../runtime/refresh.ts');
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
const { compileCollectionPlan } = require('../catalog/collection-plan.ts');
const { buildLibraryCollection, collectionCatalogMetas } = require('../catalog/nuvio-library-collections.ts');
const { searchCatalog } = require('../media/search.ts');
const { decodeConfig } = require('../config/token.ts');
const { validateCustomStreamsConfig, hasCustomStreams, hasMappedCustomStreams, customStreamsFingerprint, customStreamCatalogEntries } = require('../media/custom-streams.ts');
const { getClientIntegration, listClientIntegrations } = require('../client-integrations/index.ts');
const libraryEngine = require('../library/engine.ts');
const { version: APP_VERSION } = require('../../../package.json');
export interface Registry {
  addonId?: string;
  name?: string;
  description?: string;
  stremioAddonsConfig?: unknown;
}

// Config and manifest payloads are still loosely typed: the config shape comes
// from decoded tokens and is typed properly in a later tranche. `LooseConfig`
// keeps this module honest about the fact that anything can be in there.
type LooseConfig = Record<string, any>;
type LooseOptions = Record<string, any>;

export interface BaseManifest {
  id: string;
  version: string;
  name: string;
  description: string;
  logo: string;
  resources: string[];
  types: string[];
  idPrefixes: string[];
  catalogs: unknown[];
  behaviorHints: { configurable: boolean; configurationRequired: boolean };
  configureUrl: string;
  stremioAddonsConfig?: unknown;
}

// Private addon identity (gitignored). When absent, self-hosted builds serve a
// generic manifest so self-hosters never expose the official id or the signed
// Stremio registry config.
// v5.5 removed the hosted account extension; guarded paths degrade to self-host.
const HOSTED: any = null;

let REGISTRY: Registry | null = null;
try { REGISTRY = require('../registry.ts') as Registry; } catch { /* self-hosted build */ }
function getLogoUrl(baseUrl: string): string {
  return `${baseUrl}/LeLibrary.png?v=2`;
}

function getBaseManifest(baseUrl: any) {
  const manifest: BaseManifest = {
    id: (REGISTRY && REGISTRY.addonId) || 'community.lelibrary.selfhosted',
    version: APP_VERSION,
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

function getConfiguredManifest(baseUrl: string, config: LooseConfig = {}, { watchlist = [], collectionRefs = [], homeRows = [], importedTypes = [], token = '', integration = 'nuvio', omitAnime = false }: LooseOptions = {}) {
  const { rdCatalog = 'merge', catNameMovies, catNameSeries, catNameAnime, hideAnime } = config;
  const active  = providers.activeProviders(config);
  const separate = rdCatalog === 'separate';
  const selectedHomeCatalogs = new Set((Array.isArray(homeRows) ? homeRows : []).filter(row => row?.enabled !== false).map(row => row?.source?.id || row?.source?.catalogId).filter(Boolean));
  // Setups that choose their own Home rows: account-era wizard setups and the
  // v5.5 Settle In / Move In tiers. Anything they did not pick stays off Home
  // (on Nuvio Mobile/Desktop too, see keepOffNuvioMobileHome). Quick Look has
  // no Home picker, so its library rows are its Home rows and stay visible.
  const scopeTier = (config as LooseConfig).__configScope?.type === 'config' ? (config as LooseConfig).__configScope?.tier : null;
  const homeManaged = config.wizard === true || scopeTier === 'partial' || scopeTier === 'full';

  function catName(def: any, custom: any) { return custom || def; }
  // Per-catalogue names (Edit Catalogues), with the legacy single trendingName /
  // popularName still honoured so old configs keep working.
  const DISCOVERY = {
    trendingMovies:  catName('🔥 Trending Movies',  config.trendingMoviesName || config.trendingName),
    trendingSeries:  catName('🔥 Trending Series',  config.trendingSeriesName || config.trendingName),
    popularMovies:   catName('⭐ Popular Movies',   config.popularMoviesName  || config.popularName),
    popularSeries:   catName('⭐ Popular Series',   config.popularSeriesName  || config.popularName),
  };
  // Only the dedicated search catalogs advertise the `search` extra: Nuvio and
  // Stremio fire a search request at every catalog that declares it, so a
  // global search would otherwise fan out to every row (trending, library,
  // watchlists, collections). The handlers still accept `search=` in the URL
  // for backward compatibility with older clients.
  const CAT_EXTRA = [{ name: 'skip' }];

  const catalogs = [];
  const EMOJI = { torbox: '🎬', realdebrid: '🔴', alldebrid: '💠', premiumize: '🧲', webdav: '🗄️' };

  // ── Library rows (My Movies / My Series / My Anime) ──
  // buildLibrary('movies') adds just that catalogue type so each row can be
  // reordered or hidden independently in the Edit Catalogues tab.
  function buildLibrary(type: any) {
    const selected = type === 'movies'
      ? active.some((provider: any) => selectedHomeCatalogs.has(`${providers.PROVIDER_META[provider].cat}-movies`))
      : type === 'series'
        ? active.some((provider: any) => selectedHomeCatalogs.has(`${providers.PROVIDER_META[provider].cat}-series`))
        : active.some((provider: any) => selectedHomeCatalogs.has(`${providers.PROVIDER_META[provider].cat}-anime`));
    if (type === 'movies' && config.catalogMovies === false && !selected) return;
    if (type === 'series' && config.catalogSeries === false && !selected) return;
    if (type === 'anime' && config.catalogAnime === false && !selected) return;
    // Auto-omit: the manifest handler proved via the local index that this
    // library holds no anime, so don't advertise the row at all — Stremio
    // fetches every advertised catalog, and an anime fetch for an anime-free
    // library is pure waste (slow cold, empty warm). An explicitly enabled
    // anime row is always kept, so this never overrides a deliberate choice.
    if (type === 'anime' && omitAnime && config.catalogAnime !== true && !selected) return;
    const pushLib = (prefix: any, id: any, name: any) => {
      const catalogId = `${prefix}-${id}`;
      const row = { id: catalogId, type: id === 'movies' ? 'movie' : 'series', name, extra: CAT_EXTRA };
      // Nuvio mobile also renders every manifest catalogue unless this is
      // explicit. The TV client honours pushed Home settings, which is why
      // the leak only appeared on mobile. A library row remains available to
      // native collection folders even when it is hidden from Home.
      // Wizard-managed tokens pick explicit Home rows, so anything unpicked
      // stays off Home. Legacy/self-host installs have no Home picker at
      // all: every enabled row IS a Home row, so never hide them.
      if (integration === 'nuvio' && homeManaged && !selectedHomeCatalogs.has(catalogId)) (row as LooseConfig).showInHome = false;
      catalogs.push(row);
    };
    const groups = [];
    if (active.length === 1) {
      groups.push(providers.PROVIDER_META[active[0]].cat);
    } else if (active.length > 1 && !separate) {
      groups.push(active.includes('torbox') ? 'torbox' : providers.PROVIDER_META[active[0]].cat);
    } else if (active.length > 1) {
      groups.push(...active.map((id: any) => providers.PROVIDER_META[id].cat));
    }
    for (const prefix of groups) {
      // In separate mode each provider gets its own row; tag the name so the
      // rows are distinguishable (e.g. "My Movies [TB]" vs "My Movies [AD]").
      const tag = separate && groups.length > 1 ? ` [${providers.PROVIDER_META[providers.providerByCat(prefix)].short}]` : '';
      if (type === 'movies') pushLib(prefix, 'movies', catName('🎬 My Movies', catNameMovies) + tag);
      else if (type === 'series') pushLib(prefix, 'series', catName('📺 My Series', catNameSeries) + tag);
      else if (type === 'anime' && !hideAnime) pushLib(prefix, 'anime', catName('🍥 LeLibrary Anime', catNameAnime) + tag);
    }
  }

  // ── "LeLibrary Collections" movie catalogs ──
  // Nuvio reads ONE compact catalog (`torbox-collections`) through its native
  // folders (genre = franchise). Stremio has no folders, so when the owned
  // franchises are built it gets one movie catalog PER franchise instead:
  // each reads like a folder that opens its films (served by the
  // `torbox-collection-{key}` handler, which stays for old links regardless).
  // This deliberately re-expands the manifest on Stremio only — Nuvio keeps
  // the single compact row its folders point at. Cold (nothing built yet):
  // fall back to the single row so the section exists while the background
  // build runs. Hidden from Nuvio Home via `showInHome: false`; Stremio
  // ignores that field so rows still appear in Discover.
  function buildCollectionsRow() {
    if (active.length === 0) return;
    if (config.catalogFranchises === false && !selectedHomeCatalogs.has('torbox-collections')) return;
    const userKey = providers.getUserKey(config);
    const collLang = config.lang || 'en-US';
    const colls = getCollections(userKey, collLang);
    if (integration === 'stremio' && colls.length > 0) {
      for (const c of colls) {
        const key = String((c as LooseConfig).id || '').split(':')[2];
        if (!key) continue;
        catalogs.push({
          id: `torbox-collection-${key}`,
          type: 'movie',
          name: franchiseRowName((c as LooseConfig).name) || (c as LooseConfig).name,
          // Nuvio honors this (stays off its Home even if a Nuvio client ever
          // receives a stremio-mode manifest); Stremio ignores it and lists
          // the row. This is what makes misdetection harmless.
          showInHome: false,
          extra: CAT_EXTRA,
        });
      }
      return;
    }
    const genres = colls.map((c: any) => franchiseRowName(c.name)).filter(Boolean);
    // One declared catalogue backs every native Nuvio franchise folder. The
    // folder's genre is a stable `collection-<tmdbId>` filter, so this remains
    // debrid-owned-only without exposing one manifest catalogue per franchise.
    // A required search extra is Nuvio's supported way to keep a backing row
    // out of normal Home catalogue listings; folder requests still include the
    // genre filter and the handler does not require a search query.
    //
    // Any Nuvio install that has native folders reads this row through them, so
    // it stays off Home: a v5.5 setup (a config-scoped row) and an account-era
    // wizard setup both own folders, and leaving the row visible listed every
    // owned franchise film as one flat "straight movies" row on Home instead of
    // the franchise builder. Only legacy/self-host installs, which have no
    // folder surface, keep it as an ordinary visible row.
    const managedNuvio = integration === 'nuvio'
      && (config.wizard === true || config.__configScope?.type === 'config');
    catalogs.push({
      id: 'torbox-collections',
      type: 'movie',
      name: config.collectionsName || 'LeLibrary Collections',
      ...(managedNuvio ? { showInHome: false } : {}),
      extra: managedNuvio
        ? [{ name: 'genre', isRequired: false, options: genres }, { name: 'search', isRequired: true }, { name: 'skip' }]
        : [{ name: 'genre', isRequired: false, options: genres }, { name: 'skip' }],
    });
  }

  function buildSearchRows() {
    const scope = ['combined', 'library', 'tmdb'].includes(config.searchScope) ? config.searchScope : 'combined';
    // Search groups stay separate. Public rows always return canonical IMDb
    // results; owned rows keep their normal library identity and cache path.
    if (scope !== 'library') {
      catalogs.push({ id: 'lelibrary-search-movies', type: 'movie', name: 'LeLibrary · Movies', showInHome: false, extra: [{ name: 'search', isRequired: true }] });
      catalogs.push({ id: 'lelibrary-search-series', type: 'series', name: 'LeLibrary · Series', showInHome: false, extra: [{ name: 'search', isRequired: true }] });
    }
    if (scope !== 'tmdb' && active.length) {
      // These are separate Search sections, so their labels must mirror the
      // labels the person chose for the matching Home rows, emojis included.
      if (config.catalogMovies !== false) catalogs.push({ id: 'lelibrary-search-my-movies', type: 'movie', name: catName('🎬 My Movies', catNameMovies), showInHome: false, extra: [{ name: 'search', isRequired: true }] });
      if (config.catalogSeries !== false) catalogs.push({ id: 'lelibrary-search-my-series', type: 'series', name: catName('📺 My Series', catNameSeries), showInHome: false, extra: [{ name: 'search', isRequired: true }] });
      if (config.catalogFranchises !== false) catalogs.push({ id: 'lelibrary-search-collections', type: 'movie', name: config.collectionsName || 'LeLibrary Collections', showInHome: false, extra: [{ name: 'search', isRequired: true }] });
    }
  }

  function buildCustomStreamRows() {
    if (!config.tmdbApiKey) return;
    for (const type of ['movie', 'series']) {
      if (customStreamCatalogEntries(config.customStreams, type).length === 0) continue;
      const catalogId = `custom-stream-${type === 'movie' ? 'movies' : 'series'}`;
      const selected = selectedHomeCatalogs.has(catalogId);
      if (config.wizard === true && integration === 'stremio' && !selected) continue;
      const row: LooseConfig = {
        id: catalogId,
        type,
        name: `Custom Streams — ${type === 'movie' ? 'Movies' : 'Series'}`,
        extra: CAT_EXTRA,
      } as LooseConfig;
      if (homeManaged && integration === 'nuvio' && !selected) row.showInHome = false;
      catalogs.push(row);
    }
  }

  // Imported collection folders can point at this small pair of catalogues
  // with their source encoded in the genre extra (for example
  // "tmdb-collection:10"). This avoids adding hundreds of rows to a manifest.
  function buildImportedSourceRows() {
    const hasImportedNativeSource = (Array.isArray(config.importedRows) ? config.importedRows : [])
      .some((source: any) => (source.collections || []).some((collection: any) => (collection.folders || []).some((folder: any) =>
        (folder.catalogSources || []).some((ref: any) => String(ref.addonId || '') === '__lelibrary__'))));
    const types = new Set(Array.isArray(importedTypes) ? importedTypes : []);
    if (hasImportedNativeSource) types.add('movie').add('series');
    if (types.has('movie')) catalogs.push({ id: 'lelibrary-import-movie', type: 'movie', name: 'LeLibrary', showInHome: false, extra: [{ name: 'genre', isRequired: false }, { name: 'skip' }] });
    if (types.has('series')) catalogs.push({ id: 'lelibrary-import-series', type: 'series', name: 'LeLibrary', showInHome: false, extra: [{ name: 'genre', isRequired: false }, { name: 'skip' }] });
  }

  // ── Watchlist rows (Simkl / MDBList / Trakt): pure tt: ids ──
  // Added when the user has a watchlist connection (Simkl/Trakt OAuth stored
  // against their account) or a saved MDBList key. Rows carry tt: ids so
  // external stream addons answer them and Nuvio enriches them.
  function buildWatchlistRows() {
    const conns = Array.isArray(watchlist) ? watchlist : [];
    const mdblistOn = !!(config.mdblistKey);
    const names = config.watchlistNames && typeof config.watchlistNames === 'object' ? config.watchlistNames : {};
    const hidden = new Set(Array.isArray(config.watchlistHomeHidden) ? config.watchlistHomeHidden : []);
    const pushWatchlist = (id: any, type: any, fallbackName: any) => {
      const row: LooseConfig = { id, type, name: names[id] || fallbackName, extra: CAT_EXTRA };
      if (hidden.has(id)) row.showInHome = false;
      catalogs.push(row);
    };
    for (const c of conns) {
      const type = c.type === 'movie' ? 'movie' : 'series';
      const id = `torbox-watchlist-${c.provider}-${type}`;
      pushWatchlist(id, type, c.name || `Watchlist (${c.provider})`);
    }
    if (mdblistOn) {
      pushWatchlist('torbox-watchlist-mdblist-movie', 'movie', '🎯 MDBList Watchlist');
      pushWatchlist('torbox-watchlist-mdblist-series', 'series', '📺 MDBList Watchlist');
    }
  }

  // ── Catalog library rows ──
  // Only the catalog ids the user enabled (config.libraryCatalogs) are listed -
  // the full 451-row library is far too big for one manifest. Each row serves
  // tt: ids so external stream addons + Nuvio enrichment work. Rows referenced
  // by the user's stored Nuvio collections are also advertised, so a folder
  // whose catalogSources point at `lib-{catalogId}` always resolves. Rows in
  // config.libHomeHidden get showInHome: false (they stay in Discover and in
  // Nuvio collection folders, but don't clutter Nuvio's Home).
  function buildLibraryRows() {
    const enabled = Array.isArray(config.libraryCatalogs) ? config.libraryCatalogs : [];
    const folderRefs = Array.isArray(collectionRefs) ? collectionRefs : [];
    const homeRefs = (Array.isArray(homeRows) ? homeRows : [])
      .filter((row) => row?.enabled !== false)
      .map((row) => row?.source?.catalogId || row?.source?.id)
      .filter((catalogId) => typeof catalogId === 'string' && catalogId.startsWith('lib-'))
      .map((catalogId) => catalogId.slice(4));
    // Stremio has no native collection surface, so its curated packs must be
    // exposed as individual Discover catalogues. Nuvio folders instead use
    // the compact lelibrary-curated-{movie,series} routes below: advertising
    // every underlying source made a pack selection turn into 100+ addon
    // catalogues in Nuvio settings.
    const curatedRefs = require('../catalog/curated-collections.ts').curatedSourceIds(config.nuvioCollectionPacks);
    const curatedRefSet = new Set(curatedRefs);
    const merged = [...enabled];
    for (const r of homeRefs) if (r && !merged.includes(r)) merged.push(r);
    // A Nuvio folder source points at the compact `lelibrary-curated-{type}`
    // route, so any Nuvio setup with folder sources must advertise it. The
    // wizard flag only ever marked account-era setups; a v5.5 setup never sets
    // it, which left every folder pointing at a catalogue the manifest did not
    // declare.
    const useCompactCuratedRoutes = integration === 'nuvio' && (config.wizard === true || folderRefs.length > 0);
    // Only an account-era wizard setup replaces its individual curated rows
    // with the compact routes. Everything else keeps the rows it always had;
    // the compact routes above are additive.
    const compactCuratedRows = integration === 'nuvio' && config.wizard === true;
    if (integration === 'stremio') {
      for (const r of folderRefs) if (r && !merged.includes(r)) merged.push(r);
      for (const r of curatedRefs) if (r && !merged.includes(r)) merged.push(r);
    } else if (useCompactCuratedRoutes) {
      const defs = require('../catalog/catalogdefs.ts').catalogs;
      const compactRefs = [...curatedRefs, ...folderRefs];
      const types = new Set(compactRefs.map((id) => defs[id]?.type === 'movie' ? 'movie' : defs[id] ? 'series' : null).filter(Boolean));
      for (const type of types) {
        catalogs.push({
          id: `lelibrary-curated-${type}`,
          type,
          // Nuvio appends the media type itself. Keep the shared compact
          // source name short so folder labels stay readable.
          name: 'LeLibrary',
          showInHome: false,
          extra: [{ name: 'genre', isRequired: false }, { name: 'skip' }],
        });
      }
    }
    if (integration !== 'stremio' && !compactCuratedRows) {
      // Legacy/self-host Nuvio installs keep their pack sources as ordinary
      // rows, exactly as before: the compact routes above are additive and
      // never remove a row a Home screen already shows.
      for (const r of curatedRefs) if (r && !merged.includes(r)) merged.push(r);
    }
    if (!merged.length) return;
    const hidden = new Set(Array.isArray(config.libHomeHidden) ? config.libHomeHidden : []);
    const defs = require('../catalog/catalogdefs.ts').catalogs;
    for (const cid of merged) {
      // A curated source lives only inside its native Nuvio folder. Older
      // saved configs may still contain the flattened lib-* selections, but
      // they must not revive as Home rows after the collection migration.
      if (compactCuratedRows && curatedRefSet.has(cid)) continue;
      const def = defs[cid];
      if (!def) continue;
      const row: LooseConfig = {
        id: `lib-${cid}`,
        type: def.type === 'movie' ? 'movie' : 'series',
        name: def.name || cid,
        extra: CAT_EXTRA,
      } as LooseConfig;
      // Curated sources stay out of a wizard-managed Nuvio Home by default:
      // they live inside native folders there. Explicit Home Row selections
      // must win over the collection-only default. Legacy/self-host installs
      // have no folders, so pack sources are ordinary visible rows.
      if (hidden.has(cid) || (config.wizard === true && curatedRefSet.has(cid) && !enabled.includes(cid)) ||
        (integration === 'nuvio' && homeManaged && homeRefs.includes(cid) && !selectedHomeCatalogs.has(`lib-${cid}`))) row.showInHome = false;
      catalogs.push(row);
    }
  }

  // ── Assemble in the user's catalogue order ──
  // Search rows are pinned FIRST in the manifest: Nuvio renders search
  // sections in manifest catalogue order, so a global search should lead with
  // the real TMDB-wide search results rather than library rows. They are
  // excluded from Home/Discover (required search extra + showInHome: false),
  // so their position does not affect any other surface.
  if (config.searchEnabled !== false && config.tmdbApiKey) buildSearchRows();
  const DEFAULT_ORDER = ['trendingMovies','trendingSeries','popularMovies','popularSeries','movies','series','anime','customStreams','franchises','watchlist','library','imports'];
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
    if (key === 'trendingMovies' && (config.catalogTrendingMovies || config.catalogTrending || selectedHomeCatalogs.has('torbox-trending-movies'))) {
      catalogs.push({ id: 'torbox-trending-movies', type: 'movie',  name: DISCOVERY.trendingMovies, extra: CAT_EXTRA });
    } else if (key === 'trendingSeries' && (config.catalogTrendingSeries || config.catalogTrending || selectedHomeCatalogs.has('torbox-trending-series'))) {
      catalogs.push({ id: 'torbox-trending-series', type: 'series', name: DISCOVERY.trendingSeries, extra: CAT_EXTRA });
    } else if (key === 'popularMovies' && (config.catalogPopularMovies || config.catalogPopular || selectedHomeCatalogs.has('torbox-popular-movies'))) {
      catalogs.push({ id: 'torbox-popular-movies', type: 'movie',  name: DISCOVERY.popularMovies, extra: CAT_EXTRA });
    } else if (key === 'popularSeries' && (config.catalogPopularSeries || config.catalogPopular || selectedHomeCatalogs.has('torbox-popular-series'))) {
      catalogs.push({ id: 'torbox-popular-series', type: 'series', name: DISCOVERY.popularSeries, extra: CAT_EXTRA });
    } else if (key === 'movies' || key === 'series' || key === 'anime') {
      buildLibrary(key);
    } else if (key === 'customStreams') {
      buildCustomStreamRows();
    } else if (key === 'franchises') {
      buildCollectionsRow();
    } else if (key === 'watchlist') {
      buildWatchlistRows();
    } else if (key === 'library') {
      buildLibraryRows();
    } else if (key === 'imports') {
      buildImportedSourceRows();
    }
  }

  // Home rows may have a user-facing name separate from the source catalogue.
  // Apply only deliberate wizard edits, so existing manifest labels remain
  // untouched until someone chooses to personalise a row.
  const customHomeTitles = new Map((Array.isArray(homeRows) ? homeRows : [])
    .filter(row => row?.enabled !== false && row?.customTitle === true && typeof row?.title === 'string' && row.title.trim())
    .map(row => [row.source?.id || row.source?.catalogId, row.title.trim().slice(0, 80)]));
  for (const catalog of catalogs) {
    const title = customHomeTitles.get(catalog.id);
    if (title) catalog.name = title;
  }
  if (integration === 'nuvio') keepOffNuvioMobileHome(catalogs);

  return {
    id: (REGISTRY && REGISTRY.addonId) || 'community.lelibrary.selfhosted',
    version: APP_VERSION,
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
    // Opaque tokens belong to an Account. Keep their Configure action on the
    // account-scoped route so a browser can sign in and verify ownership before
    // exposing saved setup data. Legacy self-contained tokens remain public.
    // Wizard-built tokens land on the premium wizard; others stay on the classic
    // account configure.
    configureUrl: `${baseUrl}${(() => {
      // A legacy self-contained token is edited on the classic configure page;
      // a v5.5 setup is edited at its own UUID.
      if (decodeConfig(token)) return `/${token}/configure`;
      if (config && config.__configScope?.type === 'config') return `/${config.__configScope.uuid}`;
      return `/${token}/configure`;
    })()}`,
    behaviorHints: { configurable: true },
  };
}
// Nuvio TV honours `showInHome: false`, but Nuvio Mobile and Desktop ignore
// it: their Home takes every catalogue without a required extra, and their
// hero takes the first two of those by default. Hero choices are device-local
// (never in the synced Home settings), so a hidden My Movies / My Series still
// filled the hero and came back as Home rows. A required `genre` extra is the
// one signal both apps share: Home and hero skip the catalogue, while
// collection folders (whose editors accept a required genre) and Discover keep
// loading it. Library rows ignore `genre`, so the "All" value is harmless.
// Verified against NuvioMedia/NuvioMobile + NuvioDesktop (2026-10-21) and
// NuvioTV (2026-10-22): HomeCatalogDefinitions, HomeCatalogSettingsRepository,
// CollectionRepository / CollectionEditorViewModel.
function keepOffNuvioMobileHome(catalogs: LooseConfig[]): LooseConfig[] {
  for (const catalog of catalogs) {
    if (!catalog || catalog.showInHome !== false) continue;
    const extra = (Array.isArray(catalog.extra) ? catalog.extra : []).map((entry: LooseConfig) => ({ ...entry }));
    if (extra.some((entry: LooseConfig) => entry?.isRequired === true)) continue;
    const genre = extra.find((entry: LooseConfig) => entry?.name === 'genre');
    if (genre) genre.isRequired = true;
    else extra.unshift({ name: 'genre', isRequired: true, options: ['All'] });
    catalog.extra = extra;
  }
  return catalogs;
}

// Which client dialect shapes this manifest. Precedence: explicit facade mode
// (/i/stremio/…), explicit ?integration=, the setup's saved player choice
// (wizardPlatform), then app detection as a last resort, defaulting to nuvio
// (today's behavior) on any doubt. Detection only ever PROMOTES to stremio:
// per-franchise rows carry showInHome:false, which Nuvio honors and Stremio
// ignores, so a misdetected Nuvio stays clean while a real Stremio still gets
// its folder-style rows.
function resolveIntegration(req: Request, config?: LooseConfig): string {
  const facade = (req as any).clientIntegration?.manifestMode;
  if (facade === 'stremio' || facade === 'nuvio') return facade;
  if ((req.query as Record<string, unknown>).integration === 'stremio') return 'stremio';
  if (config && (config as LooseConfig).wizardPlatform === 'stremio') return 'stremio';
  try {
    const ua = String(req.get('user-agent') || req.headers['user-agent'] || '');
    if (/stremio/i.test(ua) && !/nuvio/i.test(ua)) return 'stremio';
  } catch { /* fall through to the default */ }
  return 'nuvio';
}

function franchiseRowName(name: string): string {
  return String(name || '')
    .replace(/\s+(Collection|Cole(ç|c)ão|Colección|Colecion)\s*$/i, '')
    .trim() || name;
}

// ── Nuvio native Collections profile ─────────────────────────────
// One Nuvio collection with one folder per owned TMDB franchise. Each folder
// targets an undeclared, deterministic LeLibrary catalog (collection-{tmdbId})
// which NuvioTV resolves directly. The catalog is owned-only; TMDB is used
// solely to group the existing debrid items.

async function handleConfiguredManifest(req: Request, res: Response, deps: ManifestDeps): Promise<void> {
  const { resolveConfig } = deps;
  const tokenParam = String(req.params.token || '');
  const { timeSpan } = require('../middleware/perf-timing.ts') as {
    timeSpan: <T>(trace: unknown, name: string, fn: () => Promise<T> | T) => Promise<T>;
  };
  const config = await timeSpan((req as any).perfTrace, 'resolve-config', () => resolveConfig(tokenParam, (req as any).perfTrace));
  markClientIntegrationStage(req, 'config');
  if (!config) { res.status(400).json({ error: 'Invalid token' }); return; }
  // Register the scope with the index-first engine (no-op unless enabled) so a
  // manifest request alone starts background indexing.
  libraryEngine.noteConfig(req.params.token, config);
  // Trigger a background build so catalogs are ready for the Nuvio collections
  // profile. The indexed engine starts its own sync from noteConfig instead.
  if (!knownConfigs.has(req.params.token) && !libraryEngine.isIndexed()) {
    rememberConfig(req.params.token, config);
    buildAndCacheForConfig(req.params.token, config).catch(() => {});
  }
  // Cold start: restore the cached collections before building the manifest so
  // the "LeLibrary Collections" row's genre options are populated immediately,
  // even though the background build may still be running.
  try {
    const userKey = providers.getUserKey(config);
    const lang = config.lang || 'en-US';
    if (getCollections(userKey, lang).length === 0) {
      const persistentKey = cache.makeKey('cat', 'collections', 'collections', config.sortBy || 'data_adicao', '', '0', userKey, lang, posterFp(config));
      const persistent = await timeSpan((req as any).perfTrace, 'cache-read:collections', () => cache.get(persistentKey));
      if (Array.isArray(persistent?.metas) && persistent.metas.length > 0) {
        cacheCollections(userKey, lang, persistent.metas);
        console.log(`[Collections] Manifest: restored ${persistent.metas.length} cached collections`);
      }
    }
  } catch (err: any) {
    console.warn(`[Collections] Manifest: cache restore failed: ${err.message}`);
  }
  markClientIntegrationStage(req, 'collection-cache');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  // Resolve which watchlist services this token's owner has connected so the
  // manifest can advertise their catalogs. Legacy tokens have no connections.
  let watchlist = [];
  let collectionRefs = [];
  let homeRows = [];
  let importedTypes = [];
  const requestedIntegration = resolveIntegration(req, config);
  // The collections document this token installs. v5.5 setups keep it in their
  // own config row; the hosted account area kept it beside the token. Either
  // way the SAME plan drives the manifest and the Nuvio push, so a folder can
  // never point at a catalogue this manifest forgot to advertise.
  let collectionDocument: { collections: unknown[]; homeRows: unknown[]; sources: unknown[]; externalSources: unknown[] } = {
    collections: Array.isArray(config.collections) ? config.collections : [],
    homeRows: Array.isArray(config.collectionHomeRows) ? config.collectionHomeRows : [],
    sources: importedSourceDefinitionsFor(config),
    externalSources: Array.isArray(config.externalSources) ? config.externalSources : [],
  };
  try {
    // v5.5 setups keep watchlist connections in the config row itself.
    try {
      const { getSetupStore } = require('../setup/runtime.ts') as {
        getSetupStore: () => Promise<{
          resolveByToken: (token: unknown) => Promise<{ keys?: Record<string, unknown> } | null>;
        } | null>;
      };
      const setupStore = await getSetupStore().catch(() => null);
      if (setupStore) {
        const { setupWatchlistConn } = require('../setup/connections.ts') as {
          setupWatchlistConn: (store: unknown, token: string, provider: string) => Promise<{ access_token?: string } | null>;
        };
        const simklSetup = await setupWatchlistConn(setupStore, String(req.params.token), 'simkl').catch(() => null);
        if (simklSetup) watchlist.push({ provider: 'simkl', type: 'movie', name: '🎬 Simkl Watchlist' }, { provider: 'simkl', type: 'series', name: '📺 Simkl Watchlist' });
        const traktSetup = await setupWatchlistConn(setupStore, String(req.params.token), 'trakt').catch(() => null);
        if (traktSetup) watchlist.push({ provider: 'trakt', type: 'movie', name: '🎬 Trakt Watchlist' }, { provider: 'trakt', type: 'series', name: '📺 Trakt Watchlist' });
      }
    } catch {
      // No setup store, no setup watchlists; legacy path below still applies.
    }
    if (HOSTED) {
      const profileId = typeof req.query.profile_id === 'string' ? req.query.profile_id : 'default';
      const simkl = await HOSTED.tokenWatchlistConn(req.params.token, 'simkl');
      if (simkl) watchlist.push({ provider: 'simkl', type: 'movie', name: '🎬 Simkl Watchlist' }, { provider: 'simkl', type: 'series', name: '📺 Simkl Watchlist' });
      const trakt = await HOSTED.tokenWatchlistConn(req.params.token, 'trakt');
      if (trakt) watchlist.push({ provider: 'trakt', type: 'movie', name: '🎬 Trakt Watchlist' }, { provider: 'trakt', type: 'series', name: '📺 Trakt Watchlist' });
      // A collection context belongs to one manifest token.  Without this guard
      // an ordinary account token inherited the Collections Wizard document for
      // the same account, then advertised its folders alongside its own rows.
      // Nuvio received a mixed setup (and could fetch hundreds of unintended
      // catalogues), rather than the setup the person actually pushed.
      const stored = await HOSTED.tokenCollectionConfig(req.params.token, { integration: requestedIntegration, profile_id: profileId });
      const ownsStoredContext = stored && String(stored.manifest_token_id || '') === String(req.params.token);
      if (ownsStoredContext) collectionDocument = {
        collections: Array.isArray(stored.collections) ? stored.collections : [],
        homeRows: Array.isArray(stored.home_rows) ? stored.home_rows : [],
        sources: Array.isArray(stored.sources) ? stored.sources : [],
        externalSources: Array.isArray(stored.external_sources) ? stored.external_sources : [],
      };
    }
    const plan = compileCollectionPlan({
      collections: collectionDocument.collections,
      homeRows: collectionDocument.homeRows,
      sources: collectionDocument.sources,
      externalSources: collectionDocument.externalSources,
      manifestId: (REGISTRY && REGISTRY.addonId) || 'community.lelibrary.selfhosted',
      integration: requestedIntegration,
      hideAnime: config.hideAnime === true,
    });
    homeRows = plan.homeRows;
    collectionRefs = plan.folderLibraryIds;
    importedTypes = plan.importedTypes;
  } catch (err: any) {
    console.warn('[watchlist] manifest resolve failed:', err.message);
  }
  // Anime auto-omit: ask the local index whether this scope holds any anime
  // at all (ingest-level counts, so pending matches count too). Only when the
  // scope provably synced with zero anime do we drop the row; on any doubt
  // (no database, never synced, query failure) the row stays, preserving
  // current behavior. An explicitly enabled row is kept by the builder below.
  let omitAnime = false;
  try {
    if (libraryEngine.isIndexed() && config.catalogAnime !== true && !config.hideAnime) {
      const store = require('../library/store.ts');
      const scopeId = providers.getUserKey(config);
      const scopeRow = await store.getScope(scopeId).catch(() => null);
      if (scopeRow && scopeRow.last_sync_at) {
        const mediaTypes = await store.mediaTypeCounts(scopeId).catch(() => null);
        if (mediaTypes && (Number(mediaTypes.anime) || 0) === 0) omitAnime = true;
      }
    }
  } catch { /* keep the row on any doubt */ }
  markClientIntegrationStage(req, 'account-context');
  const manifest = getConfiguredManifest(req.protocol + '://' + req.get('host'), config, { watchlist, collectionRefs, homeRows, importedTypes, token: req.params.token, integration: requestedIntegration, omitAnime });
  markClientIntegrationStage(req, 'projection');
  res.json((req as any).clientIntegration ? (req as any).clientIntegration.manifest({ manifest, context: { token: req.params.token } }) : manifest);
}

const { posterFp, markClientIntegrationStage } = require('./shared.ts') as {
  posterFp: (config: Record<string, any>) => string;
  markClientIntegrationStage: (req: any, name: string) => void;
};

// Private imported source definitions a setup carries. The hosted account area
// kept them beside the token; a v5.5 config can only carry them inside its own
// imported rows, so collect whatever is present. Community imports that embed
// their definitions are resolved from here by the collection plan.
function importedSourceDefinitionsFor(config: LooseConfig): unknown[] {
  const out: unknown[] = [];
  const rows = Array.isArray((config as Record<string, unknown>)['importedRows'])
    ? (config as Record<string, unknown>)['importedRows'] as Record<string, unknown>[]
    : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (Array.isArray(row['sources'])) out.push(...row['sources'] as unknown[]);
    if (row['definition']) out.push(row['definition']);
  }
  const direct = (config as Record<string, unknown>)['importedSourceDefinitions'];
  if (Array.isArray(direct)) out.push(...direct);
  return out;
}

export interface ManifestDeps {
  resolveConfig: (token: string, trace?: unknown) => Promise<Record<string, unknown> | null>;
}

export interface ManifestApi {
  mountManifestRoutes: (app: Express, deps: ManifestDeps) => void;
  handleConfiguredManifest: (req: Request, res: Response, deps: ManifestDeps) => Promise<void>;
  franchiseRowName: (name: string) => string;
  resolveIntegration: (req: Request, config?: LooseConfig) => string;
  getConfiguredManifest: (baseUrl: string, config?: LooseConfig, options?: LooseOptions) => LooseConfig;
}

function mountManifestRoutes(app: Express, deps: ManifestDeps): void {
  app.get('/manifest.json', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json(getBaseManifest(req.protocol + '://' + req.get('host')));
  });

  app.get('/api/client-integrations', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ clients: listClientIntegrations() });
  });

  app.get('/:token/manifest.json', (req, res) => handleConfiguredManifest(req, res, deps));

  // Strip the "Collection" suffix for the per-franchise movie row names
  // ("James Bond Collection" → "James Bond"). Also strips the common localized
  // forms ("Coleção", "Colección", "Coleção Completa") so any pt-BR-cached
  // names render cleanly too.
}

module.exports = { mountManifestRoutes, getConfiguredManifest, handleConfiguredManifest, franchiseRowName, resolveIntegration } satisfies ManifestApi;
