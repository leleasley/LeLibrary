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
export const HUB_4K_FOLDER_ID = 'folder-lelibrary-hub-4k';
export const HUB_HDR_FOLDER_ID = 'folder-lelibrary-hub-hdr';
export const HUB_4K_COVER = '/collection-assets/collections/covers/lelibrary-hub-4k-v3.jpg';
export const HUB_HDR_COVER = '/collection-assets/collections/covers/lelibrary-hub-hdr-v3.jpg';
export const HUB_GENRES_FOLDER_ID = 'folder-lelibrary-hub-genres';
export const HUB_GENRES_COVER = '/collection-assets/collections/covers/lelibrary-hub-genres-v3.jpg';

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

// The LeLibrary Hub: My Movies, My Shows, and the same library narrowed to
// 4K and to HDR & Dolby Vision (each of those holds movies and shows).
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
      // Genres: saved as two genre-less sources; each push fills in one tab
      // per genre the library owns enough of (server: expandHubGenres).
      ...([[HUB_4K_FOLDER_ID, '4K', '4k', HUB_4K_COVER], [HUB_HDR_FOLDER_ID, 'HDR & Dolby Vision', 'hdr', HUB_HDR_COVER], [HUB_GENRES_FOLDER_ID, 'Genres', 'genres', HUB_GENRES_COVER]] as const).map(([id, title, variant, cover]) => ({
        id,
        title,
        tileShape: 'LANDSCAPE' as const,
        hideTitle: false,
        coverImageUrl: abs(cover),
        focusGifEnabled: false,
        focusGifUrl: '',
        heroBackdropUrl: abs(cover),
        catalogSources: [
          { addonId: '', addonUrl: '', catalogId: `${prefix}-movies-${variant}`, type: 'movie' as const, genre: '' },
          { addonId: '', addonUrl: '', catalogId: `${prefix}-series-${variant}`, type: 'series' as const, genre: '' },
        ],
      })),
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

// "Your genres" rows: My Movies / My Shows narrowed to one genre, theme
// (TMDB keyword) or world cinema (original language). Mirrors GENRES in
// backend/src/library/genres.ts (slugs are part of saved catalogue ids; a
// test keeps the two lists equal). `movie` / `tv` say which kinds have it.
export const LIBRARY_GENRES: { slug: string; name: string; group: 'genre' | 'theme' | 'world'; movie: boolean; tv: boolean; tvName?: string }[] = [
  { slug: 'action', name: 'Action', group: 'genre', movie: true, tv: true, tvName: 'Action & Adventure' },
  { slug: 'adventure', name: 'Adventure', group: 'genre', movie: true, tv: false },
  { slug: 'animation', name: 'Animation', group: 'genre', movie: true, tv: true },
  { slug: 'comedy', name: 'Comedy', group: 'genre', movie: true, tv: true },
  { slug: 'crime', name: 'Crime', group: 'genre', movie: true, tv: true },
  { slug: 'documentary', name: 'Documentary', group: 'genre', movie: true, tv: true },
  { slug: 'drama', name: 'Drama', group: 'genre', movie: true, tv: true },
  { slug: 'family', name: 'Family', group: 'genre', movie: true, tv: true },
  { slug: 'fantasy', name: 'Fantasy', group: 'genre', movie: true, tv: false },
  { slug: 'history', name: 'History', group: 'genre', movie: true, tv: false },
  { slug: 'horror', name: 'Horror', group: 'genre', movie: true, tv: false },
  { slug: 'kids', name: 'Kids', group: 'genre', movie: false, tv: true },
  { slug: 'music', name: 'Music', group: 'genre', movie: true, tv: false },
  { slug: 'mystery', name: 'Mystery', group: 'genre', movie: true, tv: true },
  { slug: 'news', name: 'News', group: 'genre', movie: false, tv: true },
  { slug: 'reality', name: 'Reality', group: 'genre', movie: false, tv: true },
  { slug: 'romance', name: 'Romance', group: 'genre', movie: true, tv: false },
  { slug: 'scifi', name: 'Sci-Fi', group: 'genre', movie: true, tv: true, tvName: 'Sci-Fi & Fantasy' },
  { slug: 'soap', name: 'Soap', group: 'genre', movie: false, tv: true },
  { slug: 'talk', name: 'Talk', group: 'genre', movie: false, tv: true },
  { slug: 'thriller', name: 'Thriller', group: 'genre', movie: true, tv: false },
  { slug: 'tvmovie', name: 'TV Movie', group: 'genre', movie: true, tv: false },
  { slug: 'war', name: 'War', group: 'genre', movie: true, tv: true, tvName: 'War & Politics' },
  { slug: 'western', name: 'Western', group: 'genre', movie: true, tv: true },
  { slug: 'superhero', name: 'Superheroes', group: 'theme', movie: true, tv: true },
  { slug: 'comicbook', name: 'Comic Book Adaptations', group: 'theme', movie: true, tv: true },
  { slug: 'zombie', name: 'Zombies', group: 'theme', movie: true, tv: true },
  { slug: 'vampire', name: 'Vampires', group: 'theme', movie: true, tv: true },
  { slug: 'werewolf', name: 'Werewolves', group: 'theme', movie: true, tv: true },
  { slug: 'slasher', name: 'Slashers', group: 'theme', movie: true, tv: false },
  { slug: 'foundfootage', name: 'Found Footage', group: 'theme', movie: true, tv: false },
  { slug: 'monster', name: 'Monsters & Kaiju', group: 'theme', movie: true, tv: true },
  { slug: 'ghost', name: 'Ghosts & Hauntings', group: 'theme', movie: true, tv: true },
  { slug: 'possession', name: 'Possession & Exorcism', group: 'theme', movie: true, tv: false },
  { slug: 'witch', name: 'Witches', group: 'theme', movie: true, tv: true },
  { slug: 'supernatural', name: 'Supernatural', group: 'theme', movie: true, tv: true },
  { slug: 'psychhorror', name: 'Psychological Horror', group: 'theme', movie: true, tv: false },
  { slug: 'bodyhorror', name: 'Body Horror', group: 'theme', movie: true, tv: false },
  { slug: 'folkhorror', name: 'Folk Horror', group: 'theme', movie: true, tv: false },
  { slug: 'gothic', name: 'Gothic', group: 'theme', movie: true, tv: false },
  { slug: 'heist', name: 'Heists', group: 'theme', movie: true, tv: true },
  { slug: 'spy', name: 'Spies', group: 'theme', movie: true, tv: true },
  { slug: 'martialarts', name: 'Martial Arts', group: 'theme', movie: true, tv: true },
  { slug: 'samurai', name: 'Samurai', group: 'theme', movie: true, tv: true },
  { slug: 'gangster', name: 'Gangsters & Mafia', group: 'theme', movie: true, tv: true },
  { slug: 'serialkiller', name: 'Serial Killers', group: 'theme', movie: true, tv: true },
  { slug: 'police', name: 'Cops & Police', group: 'theme', movie: true, tv: true },
  { slug: 'detective', name: 'Detectives', group: 'theme', movie: true, tv: true },
  { slug: 'legal', name: 'Courtroom & Legal', group: 'theme', movie: true, tv: true },
  { slug: 'prison', name: 'Prison', group: 'theme', movie: true, tv: true },
  { slug: 'hitman', name: 'Hitmen', group: 'theme', movie: true, tv: false },
  { slug: 'revenge', name: 'Revenge', group: 'theme', movie: true, tv: true },
  { slug: 'kidnapping', name: 'Kidnapping', group: 'theme', movie: true, tv: false },
  { slug: 'conspiracy', name: 'Conspiracy', group: 'theme', movie: true, tv: true },
  { slug: 'politics', name: 'Politics', group: 'theme', movie: true, tv: true },
  { slug: 'psychthriller', name: 'Psychological Thrillers', group: 'theme', movie: true, tv: true },
  { slug: 'noir', name: 'Noir', group: 'theme', movie: true, tv: true },
  { slug: 'timetravel', name: 'Time Travel', group: 'theme', movie: true, tv: true },
  { slug: 'space', name: 'Space', group: 'theme', movie: true, tv: true },
  { slug: 'aliens', name: 'Aliens', group: 'theme', movie: true, tv: true },
  { slug: 'dystopia', name: 'Dystopia', group: 'theme', movie: true, tv: true },
  { slug: 'postapoc', name: 'Post-Apocalyptic', group: 'theme', movie: true, tv: true },
  { slug: 'cyberpunk', name: 'Cyberpunk', group: 'theme', movie: true, tv: true },
  { slug: 'ai', name: 'AI & Robots', group: 'theme', movie: true, tv: true },
  { slug: 'parallel', name: 'Parallel Worlds', group: 'theme', movie: true, tv: true },
  { slug: 'dinosaur', name: 'Dinosaurs', group: 'theme', movie: true, tv: true },
  { slug: 'mecha', name: 'Mecha', group: 'theme', movie: true, tv: true },
  { slug: 'isekai', name: 'Isekai', group: 'theme', movie: true, tv: true },
  { slug: 'steampunk', name: 'Steampunk', group: 'theme', movie: true, tv: false },
  { slug: 'magic', name: 'Magic', group: 'theme', movie: true, tv: true },
  { slug: 'dragon', name: 'Dragons', group: 'theme', movie: true, tv: true },
  { slug: 'fairytale', name: 'Fairy Tales', group: 'theme', movie: true, tv: true },
  { slug: 'mythology', name: 'Mythology', group: 'theme', movie: true, tv: true },
  { slug: 'medieval', name: 'Medieval & Knights', group: 'theme', movie: true, tv: true },
  { slug: 'pirate', name: 'Pirates & Swashbucklers', group: 'theme', movie: true, tv: true },
  { slug: 'romcom', name: 'Rom-Coms', group: 'theme', movie: true, tv: true },
  { slug: 'comingofage', name: 'Coming of Age', group: 'theme', movie: true, tv: true },
  { slug: 'teen', name: 'High School & Teens', group: 'theme', movie: true, tv: true },
  { slug: 'parody', name: 'Parody & Spoof', group: 'theme', movie: true, tv: true },
  { slug: 'satire', name: 'Satire', group: 'theme', movie: true, tv: true },
  { slug: 'darkcomedy', name: 'Dark Comedy', group: 'theme', movie: true, tv: true },
  { slug: 'mockumentary', name: 'Mockumentary', group: 'theme', movie: true, tv: true },
  { slug: 'standup', name: 'Stand-Up Comedy', group: 'theme', movie: true, tv: true },
  { slug: 'buddy', name: 'Buddy Comedy', group: 'theme', movie: true, tv: false },
  { slug: 'roadtrip', name: 'Road Trips', group: 'theme', movie: true, tv: false },
  { slug: 'sitcom', name: 'Sitcoms', group: 'theme', movie: false, tv: true },
  { slug: 'musical', name: 'Musicals', group: 'theme', movie: true, tv: true },
  { slug: 'concert', name: 'Concerts', group: 'theme', movie: true, tv: false },
  { slug: 'sports', name: 'Sports', group: 'theme', movie: true, tv: true },
  { slug: 'boxing', name: 'Boxing', group: 'theme', movie: true, tv: false },
  { slug: 'football', name: 'Football', group: 'theme', movie: true, tv: true },
  { slug: 'racing', name: 'Motor Racing', group: 'theme', movie: true, tv: false },
  { slug: 'biopic', name: 'Biopics', group: 'theme', movie: true, tv: true },
  { slug: 'truestory', name: 'Based on a True Story', group: 'theme', movie: true, tv: true },
  { slug: 'book', name: 'Book Adaptations', group: 'theme', movie: true, tv: true },
  { slug: 'videogame', name: 'Video Game Adaptations', group: 'theme', movie: true, tv: true },
  { slug: 'ww2', name: 'World War II', group: 'theme', movie: true, tv: true },
  { slug: 'coldwar', name: 'Cold War', group: 'theme', movie: true, tv: true },
  { slug: 'vietnam', name: 'Vietnam War', group: 'theme', movie: true, tv: false },
  { slug: 'period', name: 'Period Drama', group: 'theme', movie: true, tv: true },
  { slug: 'disaster', name: 'Disaster', group: 'theme', movie: true, tv: true },
  { slug: 'survival', name: 'Survival', group: 'theme', movie: true, tv: true },
  { slug: 'outbreak', name: 'Pandemics & Outbreaks', group: 'theme', movie: true, tv: true },
  { slug: 'shark', name: 'Sharks', group: 'theme', movie: true, tv: false },
  { slug: 'christmas', name: 'Christmas', group: 'theme', movie: true, tv: true },
  { slug: 'halloween', name: 'Halloween', group: 'theme', movie: true, tv: true },
  { slug: 'anthology', name: 'Anthologies', group: 'theme', movie: true, tv: true },
  { slug: 'cooking', name: 'Food & Cooking', group: 'theme', movie: true, tv: true },
  { slug: 'lgbtq', name: 'LGBTQ+', group: 'theme', movie: true, tv: true },
  { slug: 'anime', name: 'Anime', group: 'world', movie: true, tv: true },
  { slug: 'kdrama', name: 'Korean', group: 'world', movie: true, tv: true, tvName: 'K-Drama' },
  { slug: 'japanese', name: 'Japanese', group: 'world', movie: true, tv: true },
  { slug: 'chinese', name: 'Chinese & Hong Kong', group: 'world', movie: true, tv: true },
  { slug: 'indian', name: 'Indian', group: 'world', movie: true, tv: true },
  { slug: 'french', name: 'French', group: 'world', movie: true, tv: true },
  { slug: 'spanish', name: 'Spanish-Language', group: 'world', movie: true, tv: true },
  { slug: 'italian', name: 'Italian', group: 'world', movie: true, tv: true },
  { slug: 'german', name: 'German', group: 'world', movie: true, tv: true },
  { slug: 'nordic', name: 'Nordic', group: 'world', movie: true, tv: true },
  { slug: 'turkish', name: 'Turkish', group: 'world', movie: true, tv: true },
  { slug: 'thai', name: 'Thai', group: 'world', movie: true, tv: true },
];
export const YOUR_GENRES_GROUP = 'Your genres';
export const YOUR_THEMES_GROUP = 'Your themes';
export const YOUR_WORLD_GROUP = 'Your world cinema';
const GENRE_GROUP_NAMES = { genre: YOUR_GENRES_GROUP, theme: YOUR_THEMES_GROUP, world: YOUR_WORLD_GROUP } as const;

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
    // The same library narrowed to one release quality (server:
    // library/quality-filter.ts). Never on Home unless picked.
    { id: 'native-4k-movies', catalogId: `${resolved}-movies-4k`, name: '4K Movies', type: 'movie', category: 'LeLibrary', addonId: '', nativeLibrary: true, defaultHome: false },
    { id: 'native-4k-shows', catalogId: `${resolved}-series-4k`, name: '4K Shows', type: 'series', category: 'LeLibrary', addonId: '', nativeLibrary: true, defaultHome: false },
    { id: 'native-hdr-movies', catalogId: `${resolved}-movies-hdr`, name: 'HDR & Dolby Vision Movies', type: 'movie', category: 'LeLibrary', addonId: '', nativeLibrary: true, defaultHome: false },
    { id: 'native-hdr-shows', catalogId: `${resolved}-series-hdr`, name: 'HDR & Dolby Vision Shows', type: 'series', category: 'LeLibrary', addonId: '', nativeLibrary: true, defaultHome: false },
  ];
  // Your genres: only what you own, one genre at a time. Never on Home
  // unless picked; a folder can use them too.
  for (const genre of LIBRARY_GENRES) {
    const category = GENRE_GROUP_NAMES[genre.group];
    if (genre.movie) rows.push({ id: `native-genre-movies-${genre.slug}`, catalogId: `${resolved}-movies-g-${genre.slug}`, name: `Your ${genre.name} Movies`, type: 'movie', category, addonId: '', nativeLibrary: true, defaultHome: false });
    if (genre.tv) rows.push({ id: `native-genre-shows-${genre.slug}`, catalogId: `${resolved}-series-g-${genre.slug}`, name: `Your ${genre.tvName ?? genre.name} Shows`, type: 'series', category, addonId: '', nativeLibrary: true, defaultHome: false });
  }
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
  if (name === 'your genres') return -9;
  if (name === 'your themes') return -8;
  if (name === 'your world cinema') return -7;
  if (/trending/.test(name)) return 0;
  if (/popular/.test(name)) return 1;
  if (name === 'watchlists') return 2;
  return 5;
}
