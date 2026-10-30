// Collection document model for Move In Step 7 (Collections studio).
//
// The Nuvio push adapter and compileCollectionPlan already speak this
// document, and saved setups store it, so the shapes here must not drift.
// `genre` stays on every source and `externalSourceId` stays optional - the
// plan compiler reads both.

export type TileShape = 'LANDSCAPE' | 'PORTRAIT';

export function isPortraitShape(value: unknown): boolean {
  const shape = String(value ?? '').trim().toLowerCase();
  return shape === 'portrait' || shape === 'poster';
}
export type CollectionViewMode = 'TABBED_GRID' | 'FOLLOW_LAYOUT';

export interface CatalogSourceRef {
  addonId: string;
  addonUrl: string;
  catalogId: string;
  type: 'movie' | 'series';
  genre: string;
  externalSourceId?: string;
  // Display-only. The transport label is derived server-side from the
  // catalogue id, so a stale title can never change which catalogue a folder
  // resolves to.
  title?: string;
}

export interface FolderDoc {
  id: string;
  title: string;
  tileShape: TileShape;
  hideTitle: boolean;
  coverImageUrl: string;
  focusGifEnabled: boolean;
  focusGifUrl: string;
  heroBackdropUrl: string;
  catalogSources: CatalogSourceRef[];
}

export interface CollectionDoc {
  id: string;
  title: string;
  tileShape: TileShape;
  pinToTop: boolean;
  focusGlowEnabled: boolean;
  showAllTab: boolean;
  viewMode: CollectionViewMode;
  backdropUrl: string;
  hideTitle: boolean;
  folders: FolderDoc[];
}

// System ids. Pushes replace collections by these ids: never change them.
export const HUB_COLLECTION_ID = 'collection-lelibrary-hub';
export const HUB_MOVIES_FOLDER_ID = 'folder-lelibrary-hub-movies';
export const HUB_SHOWS_FOLDER_ID = 'folder-lelibrary-hub-shows';

// Bundled Hub artwork (served from public/collection-assets).
// Stored absolute (see absoluteUrl): Nuvio clients fetch artwork directly.
// The Hub's own art is the current Movies cover (v3); the old hub-focus
// image is retired and redirects there for collections already pushed.
export const HUB_COVER = '/collection-assets/collections/covers/lelibrary-hub-movies-v3.jpg';
export const HUB_MOVIES_COVER = '/collection-assets/collections/covers/lelibrary-hub-movies-v3.jpg';
export const HUB_MOVIES_FOCUS = '/collection-assets/collections/gifs/lelibrary-hub-movies-focus-v3.gif';
export const HUB_SHOWS_COVER = '/collection-assets/collections/covers/lelibrary-hub-shows-v3.jpg';
export const HUB_SHOWS_FOCUS = '/collection-assets/collections/gifs/lelibrary-hub-shows-focus-v3.gif';

export const FALLBACK_ART = '/LeLibrary.png?v=3';

// Old folderDefault() pointed at the genre starter catalogue.
export const STARTER_SOURCE: CatalogSourceRef = {
  addonId: '',
  addonUrl: '',
  catalogId: 'lib-genre_action_movies',
  type: 'movie',
  genre: '',
};

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeTileShape(value: unknown): TileShape {
  // Nuvio itself says POSTER (TV) or poster (mobile); LeLibrary's editor says
  // PORTRAIT. Treat all three as portrait so imported poster folders stay posters.
  return isPortraitShape(value) ? 'PORTRAIT' : 'LANDSCAPE';
}

export function normalizeViewMode(value: unknown): CollectionViewMode {
  return value === 'FOLLOW_LAYOUT' ? 'FOLLOW_LAYOUT' : 'TABBED_GRID';
}

export function collectionDefault(title = 'My Collection'): CollectionDoc {
  return {
    id: uniqueId('coll'),
    title,
    tileShape: 'LANDSCAPE',
    pinToTop: false,
    focusGlowEnabled: true,
    showAllTab: true,
    viewMode: 'TABBED_GRID',
    backdropUrl: '',
    hideTitle: false,
    folders: [],
  };
}

export function folderDefault(): FolderDoc {
  return {
    id: uniqueId('folder'),
    title: 'New folder',
    tileShape: 'LANDSCAPE',
    hideTitle: false,
    coverImageUrl: '',
    focusGifEnabled: false,
    focusGifUrl: '',
    heroBackdropUrl: '',
    catalogSources: [{ ...STARTER_SOURCE }],
  };
}

// Human title for a catalogue id when no registry entry is at hand.
// Mirrors the old importedSourceTitle() fallback branch.
export function friendlyCatalogName(catalogId: string): string {
  const raw = String(catalogId || '');
  if (/^imp_[a-f0-9]{64}$/.test(raw)) return 'Private imported source';
  const name = raw.replace(/^lib-/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  return name || 'Catalogue';
}

// Older saved documents, imported community collections and pushes made before
// the compact route was fixed carry an internal routing id in the source's
// catalogue id (`lelibrary-curated-movie,lib-trending_movies`, or the same id
// with the real source in `genre`). Recover the catalogue id when the document
// says it, so nothing raw ever reaches the screen or a re-save.
export function normaliseSourceCatalogId(catalogId: string): string {
  const raw = String(catalogId || '').trim();
  const match = raw.match(/^lelibrary-curated-(?:movie|series),(lib-[a-z0-9_]+)$/);
  return match?.[1] ?? raw;
}

// What a folder source is called on screen: a real catalogue name when the
// registry knows it, the folder label Nuvio renders when the document only
// carries the internal id, and a readable fallback otherwise.
export function sourceDisplayName(
  source: Pick<CatalogSourceRef, 'catalogId' | 'genre'> & { title?: string },
  names: Record<string, string> = {},
): string {
  const catalogId = normaliseSourceCatalogId(source.catalogId);
  const title = String(source.title || '').trim();
  if (title) return title;
  if (names[catalogId]) return names[catalogId];
  if (/^lib-/.test(catalogId)) return friendlyCatalogName(catalogId);
  // Internal ids (`lelibrary-curated-*`, `imp_*`) carry their readable label in
  // the genre; a `lib-` genre is only the source id, never the name.
  const genre = String(source.genre || '').trim();
  if (genre && !/^lib-/.test(genre) && !/^imp_/.test(genre)) return genre;
  if (/^lib-/.test(genre)) return names[genre] || friendlyCatalogName(genre);
  return friendlyCatalogName(catalogId);
}

// Identity of a catalogue source, mirroring the old sourceKey().
export function sourceKey(source: Pick<CatalogSourceRef, 'addonId' | 'catalogId' | 'type'>): string {
  return `${String(source.addonId || 'lelibrary')}:${String(source.catalogId || '')}:${String(source.type || 'movie')}`;
}

// The Hub is always last; everything else keeps its order.
export function orderCollections(collections: CollectionDoc[]): CollectionDoc[] {
  const hub = collections.filter((collection) => collection.id === HUB_COLLECTION_ID);
  if (hub.length === 0) return [...collections];
  return [...collections.filter((collection) => collection.id !== HUB_COLLECTION_ID), ...hub];
}

// Provider → native catalogue prefix (matches the manifest's catalogue ids).
// TorBox wins when present.
const PROVIDER_PREFIX: Record<string, string> = {
  torbox: 'torbox',
  realdebrid: 'rd',
  alldebrid: 'ad',
  premiumize: 'pm',
  webdav: 'dav',
};

export function hubPrefix(providerCsv: string): string | null {
  const active = String(providerCsv || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const provider = active.includes('torbox') ? 'torbox' : active[0];
  if (!provider) return null;
  return PROVIDER_PREFIX[provider] ?? 'torbox';
}

// Artwork saved into the document is absolute: Nuvio fetches it directly.
// The small copy of a cover for tiles in the setup pages. LeLibrary's own
// fixed covers have a 480 wide copy under /collection-art/thumbs/ and Live
// covers take ?w=480; anything else is returned unchanged.
export function artThumb(value: string): string {
  const raw = String(value || '').trim();
  const fixed = raw.match(/^(.*\/collection-art\/)([a-z0-9][a-z0-9_-]*-v\d+\.jpg)(\?.*)?$/);
  if (fixed) return `${fixed[1]}thumbs/${fixed[2]}`;
  if (/\/art\/folder\/folder-lelibrary-[a-z0-9_-]+\.jpg$/.test(raw)) return `${raw}?w=480`;
  return raw;
}

export function absoluteUrl(origin: string, value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, origin).href;
  } catch {
    return raw;
  }
}

// The LeLibrary Hub: My Movies + My Shows in two folders.
export function hubCollection(prefix: string, origin: string): CollectionDoc {
  const abs = (path: string) => absoluteUrl(origin, path);
  return {
    id: HUB_COLLECTION_ID,
    title: 'LeLibrary',
    tileShape: 'LANDSCAPE',
    pinToTop: false,
    focusGlowEnabled: true,
    showAllTab: true,
    viewMode: 'TABBED_GRID',
    backdropUrl: abs(HUB_COVER),
    hideTitle: false,
    folders: [
      {
        id: HUB_MOVIES_FOLDER_ID,
        title: 'Movies',
        tileShape: 'LANDSCAPE',
        hideTitle: false,
        coverImageUrl: abs(HUB_MOVIES_COVER),
        focusGifEnabled: false,
        focusGifUrl: '',
        heroBackdropUrl: abs(HUB_MOVIES_COVER),
        catalogSources: [{ addonId: '', addonUrl: '', catalogId: `${prefix}-movies`, type: 'movie', genre: '' }],
      },
      {
        id: HUB_SHOWS_FOLDER_ID,
        title: 'Shows',
        tileShape: 'LANDSCAPE',
        hideTitle: false,
        coverImageUrl: abs(HUB_SHOWS_COVER),
        focusGifEnabled: false,
        focusGifUrl: '',
        heroBackdropUrl: abs(HUB_SHOWS_COVER),
        catalogSources: [{ addonId: '', addonUrl: '', catalogId: `${prefix}-series`, type: 'series', genre: '' }],
      },
    ],
  };
}

// ── Home rows (Move In Step 6) ────────────────────────────────────────────
// Rich row shapes: rows carry their own source so Nuvio and Stremio resolve them
// without another lookup. Quick/Partial keep the pack-id `homeRows` field;
// Full saves these under `collectionHomeRows`.

export interface HomeRowSource {
  kind: 'catalog';
  id: string;
  catalogId: string;
  type: 'movie' | 'series';
  addonId: string;
  addonUrl: string;
}

export interface HomeRowDoc {
  id: string;
  title: string;
  source: HomeRowSource;
  enabled: boolean;
  limit: number;
  order: number;
  customTitle: boolean;
  _nativeFranchiseCollection?: boolean;
}

// One entry in the catalogue browser. Registry rows arrive with the full
// definition; native and imported rows fill the same shape.
export interface BrowserSource {
  id: string;
  catalogId: string;
  name: string;
  type: 'movie' | 'series';
  category: string;
  addonId: string;
  addonUrl?: string;
  nativeLibrary?: boolean;
  nativeCollection?: boolean;
  defaultHome?: boolean;
  // Registry rows only: countries with titles (absent = everywhere), a key
  // the row needs beyond TMDB, and whether it belongs on the Suggested shelf.
  regions?: string[];
  needsMdblistKey?: boolean;
  featured?: boolean;
}

export const OWNED_MARKER_ID = 'native-franchise-collection';

// Owned-franchise marker row: a native
// collection row, fixed at the bottom of Nuvio Collections, never a Home
// row there - keep it for Stremio only in the browser.
export function ownedFranchiseMarker(order: number): HomeRowDoc {
  return {
    id: OWNED_MARKER_ID,
    title: 'LeLibrary Movie Collections',
    source: { kind: 'catalog', id: 'torbox-collections', catalogId: 'torbox-collections', type: 'movie', addonId: '', addonUrl: '' },
    enabled: true,
    limit: 20,
    order,
    customTitle: false,
    _nativeFranchiseCollection: true,
  };
}

// Native library browser rows. Always present so the LeLibrary shelf is
// findable before any key is typed: with no provider connected yet the rows
// use the default torbox prefix, and re-resolve live to the connected
// provider the moment a key is filled in. A stored row whose prefix ends up
// not matching the install's active provider is ignored at manifest time,
// so a guessed prefix can never break an install - it just stays dormant.
export function nativeLibraryRows(prefix: string | null, platform: string): BrowserSource[] {
  const resolved = prefix || 'torbox';
  const rows: BrowserSource[] = [
    { id: 'native-my-movies', catalogId: `${resolved}-movies`, name: 'My Movies', type: 'movie', category: 'LeLibrary', addonId: '', nativeLibrary: true, defaultHome: true },
    { id: 'native-my-shows', catalogId: `${resolved}-series`, name: 'My Shows', type: 'series', category: 'LeLibrary', addonId: '', nativeLibrary: true, defaultHome: true },
    { id: 'native-my-anime', catalogId: `${resolved}-anime`, name: 'My Anime', type: 'series', category: 'LeLibrary', addonId: '', nativeLibrary: true, defaultHome: true },
  ];
  if (platform === 'stremio') {
    rows.push({ id: 'native-lelibrary-collections', catalogId: 'torbox-collections', name: 'LeLibrary Collections', type: 'movie', category: 'LeLibrary', addonId: '', nativeLibrary: true, nativeCollection: true, defaultHome: false });
  }
  return rows;
}

// Discovery browser rows. Catalogue ids must match the manifest's.
export const DISCOVERY_ROWS: BrowserSource[] = [
  { id: 'trending-movies', catalogId: 'torbox-trending-movies', name: 'Trending movies', type: 'movie', category: 'Trending', addonId: '' },
  { id: 'trending-series', catalogId: 'torbox-trending-series', name: 'Trending series', type: 'series', category: 'Trending', addonId: '' },
  { id: 'popular-movies', catalogId: 'torbox-popular-movies', name: 'Popular movies', type: 'movie', category: 'Popular', addonId: '' },
  { id: 'popular-series', catalogId: 'torbox-popular-series', name: 'Popular series', type: 'series', category: 'Popular', addonId: '' },
];

// Watchlist rows, per provider. Ids and titles match the manifest
// (routes/manifest.ts) and setup/watchlist-home.ts. A row only appears in
// the app once that watchlist is connected.
export const WATCHLIST_ROWS: (BrowserSource & { provider: 'simkl' | 'trakt' | 'mdblist' })[] = [
  { id: 'watchlist-simkl-movie', catalogId: 'torbox-watchlist-simkl-movie', name: '🎬 Simkl Watchlist', type: 'movie', category: 'Watchlists', addonId: '', provider: 'simkl' },
  { id: 'watchlist-simkl-series', catalogId: 'torbox-watchlist-simkl-series', name: '📺 Simkl Watchlist', type: 'series', category: 'Watchlists', addonId: '', provider: 'simkl' },
  { id: 'watchlist-trakt-movie', catalogId: 'torbox-watchlist-trakt-movie', name: '🎬 Trakt Watchlist', type: 'movie', category: 'Watchlists', addonId: '', provider: 'trakt' },
  { id: 'watchlist-trakt-series', catalogId: 'torbox-watchlist-trakt-series', name: '📺 Trakt Watchlist', type: 'series', category: 'Watchlists', addonId: '', provider: 'trakt' },
  { id: 'watchlist-mdblist-movie', catalogId: 'torbox-watchlist-mdblist-movie', name: '🎯 MDBList Watchlist', type: 'movie', category: 'Watchlists', addonId: '', provider: 'mdblist' },
  { id: 'watchlist-mdblist-series', catalogId: 'torbox-watchlist-mdblist-series', name: '📺 MDBList Watchlist', type: 'series', category: 'Watchlists', addonId: '', provider: 'mdblist' },
];

// Watchlist rows this server can serve: Simkl and Trakt only when it can
// connect them, MDBList always (it uses the setup's own key).
export function watchlistBrowserRows(available: { simkl: boolean; trakt: boolean }): BrowserSource[] {
  return WATCHLIST_ROWS
    .filter((row) => row.provider === 'mdblist' || available[row.provider])
    .map(({ provider: _provider, ...row }) => row);
}

export function homeRowFromSource(source: BrowserSource, order: number): HomeRowDoc {
  return {
    id: `row-${source.id}`,
    title: String(source.name || source.catalogId).slice(0, 80),
    source: {
      kind: 'catalog',
      id: source.catalogId,
      catalogId: source.catalogId,
      type: source.type,
      addonId: source.addonId || '',
      addonUrl: source.addonUrl || '',
    },
    enabled: true,
    limit: 20,
    order,
    customTitle: false,
  };
}

// Nuvio renders the franchise as a native collection at the bottom, never a
// Home row - strip it there (the marker excepted). Stremio keeps it.
export function normalizeHomeOrder(rows: HomeRowDoc[], platform: string): HomeRowDoc[] {
  const kept = platform === 'nuvio'
    ? rows.filter((row) => row._nativeFranchiseCollection === true || String(row.source?.catalogId || '') !== 'torbox-collections')
    : rows.slice();
  return kept.map((row, index) => ({ ...row, order: index }));
}

// Browser group rank: LeLibrary first, then Trending, Popular, then the rest.
export function homeCategoryRank(category: string): number {
  const name = String(category || '').toLowerCase();
  if (name === 'lelibrary') return -10;
  if (/trending/.test(name)) return 0;
  if (/popular/.test(name)) return 1;
  if (name === 'watchlists') return 2;
  return 5;
}
