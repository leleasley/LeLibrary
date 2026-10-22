// TMDB's canonical genre ids mapped to names. Discover/search payloads carry
// only genre ids, so mapping here avoids an extra per-title API call. These are
// fixed TMDB constants, not invented data.
export interface GenresApi {
  movieGenreNames: (ids: unknown) => string[];
  tvGenreNames: (ids: unknown) => string[];
}

const MOVIE_GENRES: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance',
  878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War',
  37: 'Western',
};

const TV_GENRES: Record<number, string> = {
  10759: 'Action & Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 10762: 'Kids', 9648: 'Mystery',
  10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap',
  10767: 'Talk', 10768: 'War & Politics', 37: 'Western',
};

function mapNames(ids: unknown, table: Record<number, string>): string[] {
  if (!Array.isArray(ids)) return [];
  const names: string[] = [];
  for (const id of ids) {
    const name = table[Number(id)];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function movieGenreNames(ids: unknown): string[] {
  return mapNames(ids, MOVIE_GENRES);
}

function tvGenreNames(ids: unknown): string[] {
  return mapNames(ids, TV_GENRES);
}

module.exports = { movieGenreNames, tvGenreNames } satisfies GenresApi;
