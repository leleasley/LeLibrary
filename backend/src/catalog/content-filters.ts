'use strict';
// Content filters (Settle In / Move In): the catalogue-level knobs that decide
// what may appear at all. Four inputs, saved on the setup config:
//
//   hideAnime          boolean  (existing, 5.x)
//   hideAdultContent   boolean
//   excludeCategories  string[] (the eleven category slugs below)
//
// "Hide anime" and the Anime exclude category mean the same thing to every
// surface, so `hideAnime(config)` is the ONE place that answers it. Category
// rules are the same shape the library genre rows use (`GenreRule`), so the
// indexed library can filter with one SQL query (library/genres.ts) while
// discovery/search metas filter on plain TMDB genre ids. Unknown facts never
// hide a title: a library row with no genre fill yet stays visible.
//
// The frontend mirror is `frontend/src/features/setup/shared/content-filters.ts`;
// `test/content-filters.test.ts` keeps the two in agreement.

interface GenreRule {
  genres?: number[];
  keywords?: number[];
  langs?: string[];
  needGenres?: number[];
  notGenres?: number[];
}

interface GenreFacts {
  genre_ids: number[];
  keyword_ids: number[] | null;
  orig_lang: string | null;
}

export interface ContentCategory {
  // Saved in configs: never rename a slug.
  id: string;
  label: string;
  movie?: GenreRule;
  tv?: GenreRule;
  // Plain TMDB genre ids, for rows/metas that only carry genre_ids (discovery,
  // search, imported catalogues). Keyword- and language-only rules cannot be
  // applied there; the library path still applies the full rule.
  movieGenres?: number[];
  tvGenres?: number[];
  // The Anime category is the same switch as "Hide anime".
  anime?: boolean;
}

// Order is the UI order (operator's screenshot, 2026-11-05).
const CONTENT_CATEGORIES: readonly ContentCategory[] = [
  { id: 'anime', label: 'Anime', anime: true, movieGenres: [16], tvGenres: [16],
    movie: { genres: [16], keywords: [210024], langs: ['ja'] }, tv: { genres: [16], keywords: [210024], langs: ['ja'] } },
  { id: 'animation', label: 'Animation', movieGenres: [16], tvGenres: [16],
    movie: { genres: [16] }, tv: { genres: [16] } },
  { id: 'reality', label: 'Reality TV', tvGenres: [10764], tv: { genres: [10764] } },
  { id: 'talk', label: 'Talk Shows', tvGenres: [10767], tv: { genres: [10767] } },
  { id: 'kids', label: 'Kids', tvGenres: [10762], tv: { genres: [10762] } },
  { id: 'family', label: 'Family', movieGenres: [10751], tvGenres: [10751],
    movie: { genres: [10751] }, tv: { genres: [10751] } },
  // TMDB has no "Musical" genre; editors tag musicals with the keyword, and
  // films also carry the Music genre. Both match the library rule.
  { id: 'musical', label: 'Musical', movieGenres: [10402],
    movie: { genres: [10402], keywords: [4344] }, tv: { keywords: [4344] } },
  { id: 'documentary', label: 'Documentary', movieGenres: [99], tvGenres: [99],
    movie: { genres: [99] }, tv: { genres: [99] } },
  { id: 'news', label: 'News', tvGenres: [10763], tv: { genres: [10763] } },
  { id: 'soap', label: 'Soap Operas', tvGenres: [10766], tv: { genres: [10766] } },
  // TV has no Horror genre: TMDB editors tag shows with the horror keyword.
  { id: 'horror', label: 'Horror', movieGenres: [27], tv: { keywords: [315058] }, movie: { genres: [27] } },
];

const BY_ID = new Map(CONTENT_CATEGORIES.map((category) => [category.id, category]));

const EXCLUDE_CATEGORY_IDS: readonly string[] = CONTENT_CATEGORIES.map((category) => category.id);

// Certifications that mark adult content on TMDB. Films: NC-17 and the legacy
// X; shows: TV-MA (operator's choice, 2026-11-05). library/genres.ts imports
// this list so one table decides both filtering paths.
const ADULT_CERTIFICATIONS: Readonly<Record<'movie' | 'tv', readonly string[]>> = {
  movie: ['NC-17', 'X'],
  tv: ['TV-MA'],
};

export interface ContentFilterState {
  hideAnime: boolean;
  hideAdult: boolean;
  excludeCategories: string[];
}

// Config -> state. Unknown or non-string entries drop out.
function normalizeContentFilters(config: unknown): ContentFilterState {
  const value = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  const raw = Array.isArray(value['excludeCategories']) ? value['excludeCategories'] : [];
  const picked = EXCLUDE_CATEGORY_IDS.filter((id) => raw.includes(id));
  return {
    hideAnime: value['hideAnime'] === true || picked.includes('anime'),
    hideAdult: value['hideAdultContent'] === true,
    excludeCategories: picked,
  };
}

// "Hide anime" for every surface that already reads it: the switch or the
// Anime exclude category. Use this instead of reading config.hideAnime.
function hideAnime(config: unknown): boolean {
  return normalizeContentFilters(config).hideAnime;
}

// Stored value for excludeCategories: only known ids, empty when none.
function excludeCategoriesForConfig(value: unknown): string[] {
  return normalizeContentFilters({ excludeCategories: value }).excludeCategories;
}

// The categories picked, minus Anime (already answered by hideAnime).
function categoryFilters(state: ContentFilterState): ContentCategory[] {
  return state.excludeCategories
    .filter((id) => id !== 'anime')
    .map((id) => BY_ID.get(id))
    .filter((category): category is ContentCategory => !!category);
}

// Library rules for one kind ('movies' | 'series'), as the genre SQL wants.
function libraryRules(state: ContentFilterState, kind: 'movies' | 'series'): GenreRule[] {
  return categoryFilters(state)
    .map((category) => (kind === 'movies' ? category.movie : category.tv))
    .filter((rule): rule is GenreRule => !!rule);
}

// TMDB genre ids for metas that only carry genre ids (discovery, search,
// imported catalogues). A keyword-only category contributes what it can.
function metaGenreIds(state: ContentFilterState, mediaType: 'movie' | 'tv'): number[] {
  const out = new Set<number>();
  for (const category of categoryFilters(state)) {
    for (const id of (mediaType === 'movie' ? category.movieGenres : category.tvGenres) || []) out.add(id);
  }
  if (state.hideAnime) out.add(16);
  return [...out];
}

export interface FilterableMeta {
  _anime?: boolean;
  _adult?: boolean;
  _cert?: string | null;
  _genres?: number[];
  type?: string;
}

// True when a meta or library row must not reach the client. `mediaType` is
// 'movie' or 'tv'. Facts that are missing never hide anything.
function metaExcluded(meta: FilterableMeta, state: ContentFilterState, mediaType: 'movie' | 'tv'): boolean {
  if (!meta) return false;
  if (state.hideAnime && meta._anime === true) return true;
  if (state.hideAdult) {
    if (meta._adult === true) return true;
    const cert = String(meta._cert || '').toUpperCase();
    if (cert && (ADULT_CERTIFICATIONS[mediaType] || []).includes(cert)) return true;
  }
  const excluded = metaGenreIds(state, mediaType);
  if (excluded.length) {
    const genres = Array.isArray(meta._genres) ? meta._genres.map(Number) : [];
    if (genres.some((id) => excluded.includes(id))) return true;
  }
  return false;
}

// Library facts (lib_tmdb_genres) -> excluded? Same answers as above, with
// keywords and original language available. Loaded lazily so this module stays
// light (pushOptionsFromConfig requires it on every push).
function factsExcluded(facts: { genre_ids?: number[]; keyword_ids?: number[] | null; orig_lang?: string | null }, state: ContentFilterState, kind: 'movies' | 'series'): boolean {
  if (!facts) return false;
  const { matchesRule } = require('../library/genres.ts') as {
    matchesRule: (rule: GenreRule, facts: GenreFacts) => boolean;
  };
  const normalized = {
    genre_ids: Array.isArray(facts.genre_ids) ? facts.genre_ids : [],
    keyword_ids: Array.isArray(facts.keyword_ids) ? facts.keyword_ids : [],
    orig_lang: facts.orig_lang ?? null,
  };
  const rules = libraryRules(state, kind);
  // The Anime category is answered by hideAnime: apply the same rule here so a
  // caller with genre facts gets the same answer as one with a tagged meta.
  if (state.hideAnime) {
    const anime = BY_ID.get('anime');
    const rule = kind === 'movies' ? anime?.movie : anime?.tv;
    if (rule) rules.push(rule);
  }
  return rules.some((rule) => matchesRule(rule, normalized));
}

export interface ContentFiltersApi {
  CONTENT_CATEGORIES: readonly ContentCategory[];
  EXCLUDE_CATEGORY_IDS: readonly string[];
  ADULT_CERTIFICATIONS: Readonly<Record<'movie' | 'tv', readonly string[]>>;
  normalizeContentFilters: typeof normalizeContentFilters;
  hideAnime: typeof hideAnime;
  excludeCategoriesForConfig: typeof excludeCategoriesForConfig;
  libraryRules: typeof libraryRules;
  metaGenreIds: typeof metaGenreIds;
  metaExcluded: typeof metaExcluded;
  factsExcluded: typeof factsExcluded;
}

module.exports = {
  CONTENT_CATEGORIES,
  EXCLUDE_CATEGORY_IDS,
  ADULT_CERTIFICATIONS,
  normalizeContentFilters,
  hideAnime,
  excludeCategoriesForConfig,
  libraryRules,
  metaGenreIds,
  metaExcluded,
  factsExcluded,
} satisfies ContentFiltersApi;
