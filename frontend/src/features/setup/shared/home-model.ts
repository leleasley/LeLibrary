// Settle In's Home-row model.
// Move In uses the 8-step document instead (collection-doc.ts); Settle In
// uses this lighter model: 8 legacy toggle rows + the library catalogue
// browser. The ids are stored in saved configs: never rename them.

export interface CatalogueMeta {
  desc: string;
  enable?: string;
}

export const CATALOGUE_META: Record<string, CatalogueMeta> = {
  trendingMovies: { desc: 'Trending movies from TMDB, backed by other stream addons.', enable: 'trendingMovies' },
  trendingSeries: { desc: 'Trending series from TMDB, backed by other stream addons.', enable: 'trendingSeries' },
  popularMovies: { desc: 'Popular movies from TMDB, backed by other stream addons.', enable: 'popularMovies' },
  popularSeries: { desc: 'Popular series from TMDB, backed by other stream addons.', enable: 'popularSeries' },
  movies: { desc: 'Your owned movies.', enable: 'movies' },
  series: { desc: 'Your owned series.', enable: 'series' },
  anime: { desc: 'Your owned anime.', enable: 'anime' },
  franchises: { desc: 'One collections row: every franchise you own, as folders in Nuvio and a genre filter in Stremio.', enable: 'franchises' },
};

export interface CatSelection {
  franchises: boolean;
  trendingMovies: boolean;
  trendingSeries: boolean;
  popularMovies: boolean;
  popularSeries: boolean;
  movies: boolean;
  series: boolean;
  anime: boolean;
}

export const DEFAULT_CAT_SELECTION: CatSelection = {
  franchises: true,
  trendingMovies: false,
  trendingSeries: false,
  popularMovies: false,
  popularSeries: false,
  movies: true,
  series: true,
  anime: true,
};

export const DEFAULT_CAT_NAMES: Record<string, string> = {
  trendingMovies: '🔥 Trending Movies',
  trendingSeries: '🔥 Trending Series',
  popularMovies: '⭐ Popular Movies',
  popularSeries: '⭐ Popular Series',
  movies: '🎬 My Movies',
  series: '📺 My Series',
  anime: '🍥 LeLibrary Anime',
  franchises: 'LeLibrary Collections',
};

// Default order: new/latest at top, then trending, then library. Streaming
// and genre rows (libraryCatalogs) are ordered separately below.
export const DEFAULT_CAT_ORDER = [
  'trendingMovies', 'trendingSeries', 'popularMovies', 'popularSeries',
  'movies', 'series', 'franchises', 'anime',
];

export function isDefaultCatOrder(order: string[]): boolean {
  return JSON.stringify(order) === JSON.stringify(DEFAULT_CAT_ORDER);
}

export const CATALOGUE_PREVIEW_MAP: Record<string, [string, string]> = {
  trendingMovies: ['movie', 'torbox-trending-movies'],
  trendingSeries: ['series', 'torbox-trending-series'],
  popularMovies: ['movie', 'torbox-popular-movies'],
  popularSeries: ['series', 'torbox-popular-series'],
  movies: ['movie', 'torbox-movies'],
  series: ['series', 'torbox-series'],
  anime: ['series', 'torbox-anime'],
  franchises: ['movie', 'torbox-collections'],
};

// LeLibrary Special quick-add. The label says 20 rows; the list carries 24.
// Ported exactly, quirk included.
export const SPECIAL_HOME_IDS = [
  'trending_movies', 'trending_series', 'tmdb_popular_movies', 'tmdb_popular_series',
  'upcoming_movies', 'trending_imdb_top100_movies', 'streaming_netflix_movies',
  'streaming_disney_movies', 'streaming_prime_movies', 'streaming_hbo_movies',
  'streaming_crave_movies', 'streaming_hayu_movies', 'streaming_magellan_movies',
  'streaming_starz_movies', 'genre_action_movies', 'genre_comedy_movies',
  'genre_horror_movies', 'genre_scifi_movies', 'genre_documentary_movies',
  'genre_mystery_movies', 'collection_marvel_universe_mdb', 'collection_star_wars',
  'collection_harry_potter', 'collection_lord_of_the_rings',
];

export interface LibraryDef {
  id: string;
  name?: string;
  type?: string;
  group?: string;
  icon?: string;
  description?: string;
  available?: boolean;
}

export function catalogDisplayName(def: LibraryDef, libraryNames: Record<string, string> = {}): string {
  const custom = libraryNames[def.id];
  if (custom) return custom;
  const type = def.type === 'series' ? 'Series' : def.type === 'movie' ? 'Movies' : def.type || '';
  const id = String(def.id || '').toLowerCase();
  const variant = id.includes('top10') ? 'Top 10' : id.includes('top50') ? 'Top 50' : id.includes('latest') ? 'Latest' : '';
  return [def.name, type, variant].filter(Boolean).join(' · ');
}

export function groupIcon(group: string): string {
  const icons: Record<string, string> = {
    Streaming: '📺', Genres: '🎭', Anime: '🍥', Themes: '🎨',
    Studios: '🏰', Decades: '📅', Runtime: '🕒', World: '🌍',
  };
  return icons[group] || '📁';
}

export function groupPriority(group: string): number {
  const name = String(group || '').toLowerCase();
  if (name.includes('trending') || name.includes('popular') || name.includes('latest') || name.includes('new')) return 0;
  if (name.includes('streaming')) return 1;
  if (name.includes('genre')) return 2;
  if (name.includes('collection')) return 3;
  if (name.includes('studio') || name.includes('network') || name.includes('company')) return 4;
  if (name.includes('anime')) return 5;
  return 6;
}
