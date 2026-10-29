// Frontend → resolver contract for v5.5 setups.
import type { CollectionDoc, HomeRowDoc } from './collection-doc';
import type { NuvioPlaybackConfig } from './nuvio-playback';
import { DEFAULT_CAT_NAMES, DEFAULT_CAT_ORDER } from './home-model';
//
// Everything a tier page collects lands in one of two buckets:
// - keys: provider secrets, sealed server-side, never readable again.
// - config: plain preferences the addon resolver turns into behaviour.
//
// The resolver (backend, still to come) must honour the key names and shapes
// here. A tier page may only emit fields declared in this file.

export type StreamPresetId =
  | 'lelibrary'
  | 'cinema'
  | 'remux'
  | 'compact'
  | 'technical'
  | 'torrentio'
  | 'torbox'
  | 'gdrive'
  | 'lightgdrive'
  | 'minimalisticgdrive'
  | 'prism'
  | 'tamtaro'
  | 'custom';

export interface StreamPresetOption {
  id: StreamPresetId;
  name: string;
}

// Preset ids match formatter.js `presets` (ported from AIOStreams); the
// backend resolves them, the frontend never embeds templates.
// Every preset the formatter engine ships, in the same order the legacy
// Configure page used, plus `custom` for hand-written templates.
export const STREAM_PRESETS: StreamPresetOption[] = [
  { id: 'lelibrary', name: 'LeLibrary' },
  { id: 'cinema', name: 'Cinema cards' },
  { id: 'remux', name: 'Premium REMUX' },
  { id: 'compact', name: 'Clean compact' },
  { id: 'technical', name: 'Technical detail' },
  { id: 'torrentio', name: 'Torrentio' },
  { id: 'torbox', name: 'Torbox' },
  { id: 'gdrive', name: 'Google Drive' },
  { id: 'lightgdrive', name: 'Light GDrive' },
  { id: 'minimalisticgdrive', name: 'Minimalistic GDrive' },
  { id: 'prism', name: 'Prism' },
  { id: 'tamtaro', name: 'Tamtaro' },
  { id: 'custom', name: 'Custom templates' },
];

// Realistic filenames the preview formats against, rotating one per view.
export interface FormatSample {
  filename: string;
  source: string;
  size: number;
}

export const FORMAT_SAMPLES: FormatSample[] = [
  // The default preview sample, kept first so every preview starts the same.
  { filename: 'Toy.Story.2.1999.2160p.BluRay.HEVC.TrueHD.7.1.Atmos-FRDS.mkv', source: 'torbox', size: 2_630_000_000 },
  { filename: 'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.HEVC.DV.TrueHD.Atmos.7.1-FGT.mkv', source: 'torbox', size: 66_800_000_000 },
  { filename: 'The.Bear.S03E08.1080p.WEB-DL.DDP5.1.H.264-NTb.mkv', source: 'realdebrid', size: 3_100_000_000 },
];

// Poster preview samples: mainstream, so a live key always resolves them.
// The preview shows a film and a series together, matching how Nuvio presents
// a mixed library, and cycles whole pairs rather than single posters.
export interface PosterSample {
  id: number;
  imdb: string;
  title: string;
  type: 'movie' | 'series';
  // Public TMDB poster path for the sample, so the default provider can show a
  // real preview without an API key.
  posterPath: string;
}

export interface PosterPair {
  movie: PosterSample;
  series: PosterSample;
}

export const POSTER_PAIRS: PosterPair[] = [
  {
    movie: { id: 27205, imdb: 'tt1375666', title: 'Inception', type: 'movie', posterPath: '/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg' },
    series: { id: 66732, imdb: 'tt4574334', title: 'Stranger Things', type: 'series', posterPath: '/49WJfeN0moxb9IPfGn8AIqMGskD.jpg' },
  },
  {
    movie: { id: 550, imdb: 'tt0137523', title: 'Fight Club', type: 'movie', posterPath: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg' },
    series: { id: 1396, imdb: 'tt0903747', title: 'Breaking Bad', type: 'series', posterPath: '/ggFHVNu6YYI5L9pCfOacjizRGt.jpg' },
  },
  {
    movie: { id: 155, imdb: 'tt0468569', title: 'The Dark Knight', type: 'movie', posterPath: '/qJ2tW6WMUDux911r6m7haRef0WH.jpg' },
    series: { id: 1399, imdb: 'tt0944947', title: 'Game of Thrones', type: 'series', posterPath: '/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg' },
  },
];

export const POSTER_SAMPLES: PosterSample[] = POSTER_PAIRS.flatMap((pair) => [pair.movie, pair.series]);

export const DEFAULT_STREAM_PRESET: StreamPresetId = 'lelibrary';

export interface HomeRowPack {
  id: string;
  name: string;
}

// Pack ids match backend QUICK_PICKS (catalog-quick-picks.ts), which the
// server validates at load. Labels here are display-only.
export const HOME_ROW_PACKS: HomeRowPack[] = [
  { id: 'movie-night', name: 'Movie Night' },
  { id: 'tv-tonight', name: 'TV Tonight' },
  { id: 'streaming-now', name: 'Streaming Now' },
  { id: 'trakt-public', name: 'Trakt Public' },
  { id: 'genre-essentials', name: 'Genre Essentials' },
  { id: 'just-added', name: 'Just Added' },
  { id: 'family-night', name: 'Family Night' },
  { id: 'hidden-gems', name: 'Hidden Gems' },
  { id: 'documentaries', name: 'Documentaries' },
  { id: 'marvel-and-more', name: 'Marvel and more' },
  { id: 'directors', name: 'Directors' },
  { id: 'by-decade', name: 'By Decade' },
  { id: 'world-cinema', name: 'World Cinema' },
  { id: 'lelibrary-special', name: 'LeLibrary Special' },
];

export interface StreamFilterDraft {
  hideUncached: boolean;
  minResolution: '' | '480p' | '720p' | '1080p' | '2160p';
  maxSizeGb: string;
}

// One hand-mapped stream row. The frozen editor normalizes rows before they
// reach React state; the server revalidates on read.
export interface CustomStreamRow {
  name?: string;
  url?: string;
  type?: string;
  ids?: string[];
  tmdbId?: number;
  expiresAt?: number;
  description?: string;
  filename?: string;
  bingeGroup?: string;
  [key: string]: unknown;
}

export interface SetupConfigDraft {
  provider?: string;
  // Which player this setup installs into. Saved so push/review know the
  // target without asking again. The field name is kept for older saved configs.
  wizardPlatform?: string;
  // 'merge' (default, omitted) or 'separate', honoured by the backend
  // catalog builder.
  rdCatalog?: string;
  // Move In collections document (Step 7 studio). Saved so the manifest
  // compiler and push adapter can render the same folders Nuvio receives.
  collections?: CollectionDoc[];
  // Move In home rows (Step 6 builder). Rich rows, saved so the manifest
  // can advertise them in the user's order.
  collectionHomeRows?: HomeRowDoc[];
  // Set by Settle In / Move In saves: watchlist rows reach Nuvio Home only
  // when picked as Home rows. Older setups without it keep them on Home.
  watchlistHomeManaged?: boolean;
  // Selected Quick Pack ids. The server compiles them; the studio also
  // materializes editable copies so every folder stays customizable.
  nuvioCollectionPacks?: string[];
  streamPreset?: StreamPresetId;
  streamNameTemplate?: string;
  streamDescTemplate?: string;
  nuvioBadgePack?: string;
  nuvioBadgeUrl?: string;
  // Opt-in Nuvio playback controls. Absent means the setup does not touch the
  // user's Nuvio player settings at all.
  nuvioPlayback?: NuvioPlaybackConfig;
  // Explicit hide/show choice for Nuvio's Home and search. Absent leaves the
  // user's own Nuvio setting untouched.
  nuvioHideUnreleased?: boolean;
  homeRows?: string[];
  streamFilters?: StreamFilterDraft;
  // Full metadata + stream model. Names match what the backend builders read.
  lang?: string;
  sortBy?: string;
  libraryIdMode?: string;
  hideAnime?: boolean;
  // TorBox download kinds kept in the library. Absent means all three.
  torboxSources?: string[];
  searchScope?: string;
  streamNotices?: string;
  streamNoticeTypes?: string[];
  filterResolutions?: string[];
  filterResOrder?: string[];
  filterCodecs?: string[];
  filterHdr?: string[];
  filterAudio?: string[];
  filterQualities?: string[];
  filterSources?: string[];
  filterMinSize?: number;
  filterMaxSize?: number;
  filterCachedOnly?: boolean;
  streamAddons?: string[];
  customStreams?: CustomStreamRow[];
  // Settle In home model (7-step Content Builder): the library browser
  // selection plus the eight legacy toggle rows. All backend-live except
  // libraryNames, which is editor display state.
  libraryCatalogs?: string[];
  libHomeHidden?: string[];
  libraryNames?: Record<string, string>;
  catalogOrder?: string[];
  catalogTrendingMovies?: boolean;
  catalogTrendingSeries?: boolean;
  catalogPopularMovies?: boolean;
  catalogPopularSeries?: boolean;
  catalogMovies?: boolean;
  catalogSeries?: boolean;
  catalogAnime?: boolean;
  catalogFranchises?: boolean;
  catNameMovies?: string;
  catNameSeries?: string;
  catNameAnime?: string;
  trendingMoviesName?: string;
  trendingSeriesName?: string;
  popularMoviesName?: string;
  popularSeriesName?: string;
  collectionsName?: string;
  posterProvider?: string;
  pictoriumUrl?: string;
  pictoriumOptions?: Record<string, unknown>;
  customPosterTemplate?: string;
  // Display names for the user's own stream addons (links live in keys).
  customAddons?: { id: string; name: string }[];
}

// Key field names match the legacy token fields so the resolver can reuse
// the provider adapters unchanged.
export interface SetupKeysDraft {
  torboxApiKey?: string;
  rdApiKey?: string;
  adApiKey?: string;
  pmApiKey?: string;
  mdblistKey?: string;
  tmdbApiKey?: string;
  tvdbApiKey?: string;
  erdbToken?: string;
  rpdbKey?: string;
  omdbKey?: string;
  fanartKey?: string;
  // The Posters+ link from its configurator ("Copy config"): carries the
  // style and the instance's access key, so it is sealed like a key.
  postersPlusUrl?: string;
  // Links to the user's own stream addons (sealed, never revealed).
  customAddon1?: string;
  customAddon2?: string;
  customAddon3?: string;
  // Self-host only: the user's own WebDAV server (sealed, never revealed).
  webdavUrl?: string;
  webdavUser?: string;
  webdavPassword?: string;
}

export interface KeyField {
  field: keyof SetupKeysDraft;
  label: string;
  hint: string;
  logo?: string;
  required?: boolean;
  placeholder?: string;
  docsUrl?: string;
}

// No debrid provider is individually required: a setup needs at least one of
// them (or Custom Streams), never a specific one.
export const PROVIDER_KEY_FIELDS: KeyField[] = [
  { field: 'torboxApiKey', label: 'TorBox API key', hint: 'From your TorBox settings page.', placeholder: 'tb-xxxxxxxxxxxxxxxxxxxxxxxx', docsUrl: 'https://torbox.app/settings' },
  { field: 'rdApiKey', label: 'Real-Debrid API key', hint: 'From your Real-Debrid account page.', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', docsUrl: 'https://real-debrid.com/apitoken' },
  { field: 'adApiKey', label: 'AllDebrid API key', hint: 'From your AllDebrid account.', placeholder: 'Your AllDebrid API key', docsUrl: 'https://alldebrid.com/apikeys' },
  { field: 'pmApiKey', label: 'Premiumize API key', hint: 'From your Premiumize account.', placeholder: 'Your Premiumize API key', docsUrl: 'https://www.premiumize.me/account' },
];

export const METADATA_KEY_FIELDS: KeyField[] = [
  { field: 'tmdbApiKey', label: 'TMDB API key', hint: 'Required for title search, metadata, posters and exact episode choices. Copy the 32-character v3 API key from your TMDB account settings.', logo: '/logos/TMDB.svg', required: true, placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', docsUrl: 'https://www.themoviedb.org/settings/api' },
  { field: 'tvdbApiKey', label: 'TVDB API key', hint: 'Optional. Free from your TVDB account. Improves series matching.', logo: '/tvdb.png', placeholder: 'Optional - TVDB sharpens series matching', docsUrl: 'https://thetvdb.com/dashboard/account/apikey' },
  { field: 'omdbKey', label: 'OMDb key', hint: 'Optional. Extra metadata from the Open Movie Database.', placeholder: 'Optional - extra ratings metadata', docsUrl: 'https://www.omdbapi.com/apikey.aspx' },
];

export const ARTWORK_KEY_FIELDS: KeyField[] = [
  { field: 'erdbToken', label: 'ERDB token', hint: 'Ratings on posters from EasyRatingsDB.', docsUrl: 'https://easyratingsdb.com/configurator' },
  { field: 'rpdbKey', label: 'RPDB key', hint: 'Rating posters from Rating Poster DB.', docsUrl: 'https://ratingposterdb.com/' },
  { field: 'fanartKey', label: 'Fanart.tv key', hint: 'High-resolution alternative art.', docsUrl: 'https://www.fanart.tv/' },
  { field: 'postersPlusUrl', label: 'Posters+ link', hint: 'Open Posters+, pick a style, press Copy config and paste the link here.', docsUrl: 'https://postersplus.elfhosted.com/' },
];

// Key field -> POST /api/verify/* endpoint. The server checks the key live;
// the response is { valid, username?, error? }.
export const VERIFY_ENDPOINTS: Partial<Record<keyof SetupKeysDraft, string>> = {
  torboxApiKey: '/api/verify/torbox',
  rdApiKey: '/api/verify/realdebrid',
  adApiKey: '/api/verify/alldebrid',
  pmApiKey: '/api/verify/premiumize',
  mdblistKey: '/api/verify/mdblist',
  tmdbApiKey: '/api/verify/tmdb',
  tvdbApiKey: '/api/verify/tvdb',
  erdbToken: '/api/verify/erdb',
  rpdbKey: '/api/verify/rpdb',
  omdbKey: '/api/verify/omdb',
  fanartKey: '/api/verify/fanart',
};

// Poster providers match the legacy configure values the backend honours.
export const POSTER_PROVIDERS: { id: string; name: string; blurb: string }[] = [
  { id: '', name: 'TMDB default', blurb: 'Plain TMDB posters, no key needed.' },
  { id: 'erdb', name: 'ERDB ratings', blurb: 'Ratings baked onto posters. Needs an ERDB token below.' },
  { id: 'rpdb', name: 'RPDB ratings', blurb: 'Rating posters. Needs an RPDB key below.' },
  { id: 'betterposter', name: 'BetterPosters', blurb: 'Community artwork from btttr.cc.' },
  { id: 'pictorium', name: 'Pictorium', blurb: 'Build your own posters: badges, ratings, backdrops. Free.' },
  { id: 'postersplus', name: 'Posters+', blurb: 'Styled posters from Posters+ by ElfHosted. Paste your Posters+ link below.' },
  { id: 'fanart', name: 'Fanart.tv', blurb: 'High-resolution alternative art. Needs a Fanart.tv key below.' },
  { id: 'custom', name: 'Custom template', blurb: 'Your own poster URL template with {tmdbId} or {imdbId}.' },
];


export function cleanKeys(draft: SetupKeysDraft): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, value] of Object.entries(draft)) {
    const trimmed = (value ?? '').trim();
    if (trimmed) out[field] = trimmed;
  }
  return out;
}

// Non-secret provider selection derived from filled debrid key fields. Saved
// into config (not keys) so the addon engine knows which providers are active
// without ever reading a secret. Mirrors backend PROVIDER_ORDER.
const DEBRID_FIELD_TO_PROVIDER: Array<[keyof SetupKeysDraft, string]> = [
  ['torboxApiKey', 'torbox'],
  ['rdApiKey', 'realdebrid'],
  ['adApiKey', 'alldebrid'],
  ['pmApiKey', 'premiumize'],
  ['webdavUrl', 'webdav'],
];

export function providerSelection(draft: SetupKeysDraft): string {
  return DEBRID_FIELD_TO_PROVIDER
    .filter(([field]) => (draft[field] ?? '').trim())
    .map(([, id]) => id)
    .join(',');
}

// Typed keys plus keys the server already holds (an edit page never sees a
// WebDAV address: it is never revealed), in provider order.
export function providerSelectionWithSaved(draft: SetupKeysDraft, savedServices: readonly string[] = []): string {
  const present = new Set(savedServices);
  return DEBRID_FIELD_TO_PROVIDER
    .filter(([field]) => present.has(field) || (draft[field] ?? '').trim())
    .map(([, id]) => id)
    .join(',');
}

export function providerSelectionFromServices(services: readonly string[]): string {
  const present = new Set(services);
  return DEBRID_FIELD_TO_PROVIDER
    .filter(([field]) => present.has(field))
    .map(([, id]) => id)
    .join(',');
}

// Drops untouched defaults so stored configs stay small and readable.
// TorBox download kinds, in the order the backend reads them
// (`torboxSources`, providers/index.ts).
export const TORBOX_SOURCE_IDS = ['torrent', 'usenet', 'webdl'];

// A saved or restored selection, cleaned: unknown ids drop out and nothing
// left means every source (the backend reads it the same way).
export function cleanTorboxSources(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  const picked = TORBOX_SOURCE_IDS.filter((id) => list.includes(id));
  return picked.length > 0 ? picked : [...TORBOX_SOURCE_IDS];
}

// The config value for a selection: empty when every source is on, so
// existing setups and tokens stay unchanged.
export function torboxSourcesForConfig(value: unknown): string[] {
  const picked = cleanTorboxSources(value);
  return picked.length === TORBOX_SOURCE_IDS.length ? [] : picked;
}

export function pruneConfig(draft: SetupConfigDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (draft.provider && draft.provider.trim()) {
    out.provider = draft.provider.trim();
  }
  if (draft.wizardPlatform && draft.wizardPlatform.trim()) {
    out.wizardPlatform = draft.wizardPlatform.trim();
  }
  if (draft.rdCatalog && draft.rdCatalog !== 'merge') {
    out.rdCatalog = draft.rdCatalog;
  }
  if (draft.collections && draft.collections.length > 0) {
    out.collections = draft.collections;
  }
  if (draft.collectionHomeRows && draft.collectionHomeRows.length > 0) {
    out.collectionHomeRows = draft.collectionHomeRows;
  }
  if (draft.watchlistHomeManaged === true) out.watchlistHomeManaged = true;
  if (draft.nuvioCollectionPacks && draft.nuvioCollectionPacks.length > 0) {
    out.nuvioCollectionPacks = [...draft.nuvioCollectionPacks];
  }
  if (draft.streamPreset && draft.streamPreset !== DEFAULT_STREAM_PRESET) {
    out.streamPreset = draft.streamPreset;
  }
  // Templates matter only for the custom preset; presets resolve server-side.
  if (draft.streamPreset === 'custom') {
    if (draft.streamNameTemplate !== undefined) out.streamNameTemplate = draft.streamNameTemplate;
    if (draft.streamDescTemplate !== undefined) out.streamDescTemplate = draft.streamDescTemplate;
  }
  // Badge packs: keep the default pack out of the token unless a custom URL
  // was supplied, exactly like the legacy save did.
  if (draft.nuvioBadgePack && draft.nuvioBadgePack !== 'lelibrary-premium') {
    out.nuvioBadgePack = draft.nuvioBadgePack;
  }
  if (draft.nuvioBadgePack === 'custom' && draft.nuvioBadgeUrl) {
    out.nuvioBadgePack = 'custom';
    out.nuvioBadgeUrl = draft.nuvioBadgeUrl;
  }
  if (draft.nuvioPlayback) {
    out.nuvioPlayback = {
      mode: draft.nuvioPlayback.mode,
      regex: draft.nuvioPlayback.regex,
      nextEpisode: draft.nuvioPlayback.nextEpisode,
      onlyLeLibrary: draft.nuvioPlayback.onlyLeLibrary === true,
    };
  }
  if (typeof draft.nuvioHideUnreleased === 'boolean') {
    out.nuvioHideUnreleased = draft.nuvioHideUnreleased;
  }
  if (draft.homeRows && draft.homeRows.length > 0) out.homeRows = [...draft.homeRows];
  if (draft.customAddons && draft.customAddons.length > 0) out.customAddons = draft.customAddons.map((row) => ({ ...row }));
  if (draft.posterProvider) out.posterProvider = draft.posterProvider;
  if (draft.pictoriumUrl && draft.pictoriumUrl.trim()) out.pictoriumUrl = draft.pictoriumUrl.trim();
  if (draft.pictoriumOptions && Object.keys(draft.pictoriumOptions).length > 0) {
    out.pictoriumOptions = { ...draft.pictoriumOptions };
  }
  if (draft.customPosterTemplate && draft.customPosterTemplate.trim()) {
    out.customPosterTemplate = draft.customPosterTemplate.trim();
  }
  if (draft.streamFilters) {
    // The simple tier filter boxes translate into the same backend fields the
    // full model writes, so every tier's filters actually apply server-side.
    const filters: Record<string, unknown> = {};
    if (draft.streamFilters.hideUncached) {
      filters.hideUncached = true;
      out.filterCachedOnly = true;
    }
    if (draft.streamFilters.minResolution) {
      const included = MIN_RESOLUTION_INCLUDED[draft.streamFilters.minResolution];
      if (included) out.filterResolutions = [...included];
    }
    const maxSize = Number(draft.streamFilters.maxSizeGb);
    if (draft.streamFilters.maxSizeGb.trim() !== '' && Number.isFinite(maxSize) && maxSize > 0) {
      filters.maxSizeGb = maxSize;
      out.filterMaxSize = maxSize;
    }
    if (Object.keys(filters).length > 0) out.streamFilters = filters;
  }
  if (draft.lang && draft.lang !== 'en-US') out.lang = draft.lang;
  if (draft.sortBy && draft.sortBy !== 'data_adicao') out.sortBy = draft.sortBy;
  if (draft.libraryIdMode && draft.libraryIdMode !== 'torbox') out.libraryIdMode = draft.libraryIdMode;
  if (draft.hideAnime === true) out.hideAnime = true;
  const torboxSources = torboxSourcesForConfig(draft.torboxSources);
  if (torboxSources.length > 0) out.torboxSources = torboxSources;
  if (draft.searchScope && draft.searchScope !== 'combined') out.searchScope = draft.searchScope;
  if (draft.streamNotices === 'off') out.streamNotices = 'off';
  if (draft.streamNoticeTypes && !sameNoticeTypes(draft.streamNoticeTypes)) {
    out.streamNoticeTypes = [...draft.streamNoticeTypes];
  }
  if (draft.filterResolutions && draft.filterResolutions.length > 0) {
    out.filterResolutions = [...draft.filterResolutions];
  }
  if (draft.filterResOrder && draft.filterResOrder.length > 0) {
    out.filterResOrder = [...draft.filterResOrder];
  }
  if (draft.filterQualities && draft.filterQualities.length > 0) {
    out.filterQualities = [...draft.filterQualities];
  }
  if (draft.filterSources && draft.filterSources.length > 0) {
    out.filterSources = [...draft.filterSources];
  }
  if (draft.filterCodecs && draft.filterCodecs.length > 0) {
    out.filterCodecs = [...draft.filterCodecs];
  }
  if (draft.filterHdr && draft.filterHdr.length > 0) {
    out.filterHdr = [...draft.filterHdr];
  }
  if (draft.filterAudio && draft.filterAudio.length > 0) {
    out.filterAudio = [...draft.filterAudio];
  }
  if (typeof draft.filterMinSize === 'number' && draft.filterMinSize > 0) {
    out.filterMinSize = draft.filterMinSize;
  }
  if (typeof draft.filterMaxSize === 'number' && draft.filterMaxSize > 0) {
    out.filterMaxSize = draft.filterMaxSize;
  }
  if (draft.filterCachedOnly === true) out.filterCachedOnly = true;
  if (draft.streamAddons && draft.streamAddons.length > 0) out.streamAddons = [...draft.streamAddons];
  if (draft.customStreams && draft.customStreams.length > 0) {
    out.customStreams = draft.customStreams.map((row) => ({ ...row }));
  }
  if (draft.libraryCatalogs && draft.libraryCatalogs.length > 0) {
    out.libraryCatalogs = [...draft.libraryCatalogs];
  }
  if (draft.libHomeHidden && draft.libHomeHidden.length > 0) {
    out.libHomeHidden = [...draft.libHomeHidden];
  }
  if (draft.libraryNames && Object.keys(draft.libraryNames).length > 0) {
    out.libraryNames = { ...draft.libraryNames };
  }
  if (draft.catalogOrder && draft.catalogOrder.length > 0 &&
    JSON.stringify(draft.catalogOrder) !== JSON.stringify(DEFAULT_CAT_ORDER)) {
    out.catalogOrder = [...draft.catalogOrder];
  }
  if (draft.catalogTrendingMovies === true) out.catalogTrendingMovies = true;
  if (draft.catalogTrendingSeries === true) out.catalogTrendingSeries = true;
  if (draft.catalogPopularMovies === true) out.catalogPopularMovies = true;
  if (draft.catalogPopularSeries === true) out.catalogPopularSeries = true;
  if (draft.catalogMovies === false) out.catalogMovies = false;
  if (draft.catalogSeries === false) out.catalogSeries = false;
  if (draft.catalogAnime === false) out.catalogAnime = false;
  if (draft.catalogFranchises === false) out.catalogFranchises = false;
  const nameFields = [
    ['catNameMovies', 'movies'],
    ['catNameSeries', 'series'],
    ['catNameAnime', 'anime'],
    ['trendingMoviesName', 'trendingMovies'],
    ['trendingSeriesName', 'trendingSeries'],
    ['popularMoviesName', 'popularMovies'],
    ['popularSeriesName', 'popularSeries'],
    ['collectionsName', 'franchises'],
  ] as const;
  for (const [field, key] of nameFields) {
    const value = draft[field];
    if (typeof value === 'string' && value !== '' && value !== DEFAULT_CAT_NAMES[key]) {
      out[field] = value;
    }
  }
  return out;
}

// Minimum-resolution shorthand mapped onto the backend's include-list,
// ordered high to low.
const MIN_RESOLUTION_INCLUDED: Record<string, string[]> = {
  '2160p': ['4K'],
  '1080p': ['4K', '2K', '1080p'],
  '720p': ['4K', '2K', '1080p', '720p'],
  '480p': ['4K', '2K', '1080p', '720p', '480p', '360p', '240p'],
};

const DEFAULT_NOTICE_TYPES = ['none', 'rateLimit', 'digitalRelease'];

function sameNoticeTypes(types: string[]): boolean {
  if (types.length !== DEFAULT_NOTICE_TYPES.length) return false;
  return DEFAULT_NOTICE_TYPES.every((kind) => types.includes(kind));
}
