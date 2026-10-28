// @ts-nocheck
// ── Catalogue corrections (hand-maintained) ──────────────────
//
// The generated table (catalogdefs.ts) came from an Xperience export and
// carries a number of wrong TMDB ids, exact duplicates and series rows that use
// movie-only genre ids. This overlay fixes what each catalogue POINTS AT while
// keeping every catalogue id, name, type and group unchanged: saved setups and
// folders already pushed to Nuvio reference the id, and the Nuvio folder label
// (curatedFolderLabel) is derived from the name + type, so changing either
// would orphan pushed folders.
//
// Every id below was verified on 2026-10-28 against TMDB's public website
// (themoviedb.org/company|network|keyword/<id>, the genre filters on /movie
// and /tv, and the watch-provider filter on /movie and /tv per region) or the
// public MDBList list page. No API key was used. The evidence table lives in
// Docs/research/catalogue-fixes-2026-10-28.md.
//
// Kept separate from the generated file so a regeneration cannot silently
// bring the wrong ids back (catalogdefs.ts applies this overlay last).

// ── Verified TMDB ids ────────────────────────────────────────
const COMPANY = {
  A24: 41077,                       // was 293354 ("a24", 2 movies)
  TWENTIETH_FILMS: '25|127928',     // 20th Century Fox | 20th Century Studios (was 270488, 0 movies)
  TWENTIETH_TV: '1556|21659',       // 20th Century Fox Television | 20th Television
  LEGENDARY_PICTURES: 923,          // was 220583 ("John Legendary")
  LEGENDARY_TV: 54629,              // Legendary Television
  LUCASFILM: 1,                     // was 11928 ("Luna-Film")
  WARNER_PICTURES: 174,             // was 17 (Warner Bros. Entertainment umbrella, 86 movies)
  WARNER_TV: 1957,                  // Warner Bros. Television
  DREAMWORKS_ANIMATION: 521,        // was 15258 (DreamWorks Television)
  DREAMWORKS_TV: '42141|15258',     // DreamWorks Animation Television | DreamWorks Television
  SONY_TV: 11073,                   // Sony Pictures Television (company 34 has 0 shows)
  HBO_FILMS: '3268|7429',           // HBO | HBO Films
  DC: 429,
  MARVEL: 420,
};

const NETWORK = {
  AMC: 174,   // was 280 ("Forcezen")
  FX: 88,     // was 433 ("FamilyNet")
  STARZ: 318, // was 101 ("TV 2 Zulu")
  HBO: 49,
};

const KEYWORD = {
  ZOMBIE: 12377,           // was 360877 (page no longer exists)
  HORROR: 315058,          // "horror", 536 shows (TV has no horror genre)
  ROMANCE: 9840,           // "romance", 7,441 shows
  THRILLER: 316362,        // "thriller", 759 shows
  HISTORY: '282633|192772', // "history" | "historical drama"
  MUSIC: 283297,           // "music", 773 shows
  SPORTS: 6075,            // "sports", 4,128 movies (9805 is not a TMDB genre)
};

// TMDB genre ids, as listed by the genre filters on themoviedb.org/movie and /tv.
const MOVIE_GENRES = [28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 10770, 53, 10752, 37];
const TV_GENRES = [10759, 16, 35, 80, 99, 18, 10751, 10762, 9648, 10763, 10764, 10765, 10766, 10767, 10768, 37];

// Watch providers. A pipe is an OR in TMDB discover, so one row keeps working
// in every region even where TMDB lists the service under another id.
const PROVIDER = {
  SHUDDER: 99,              // was 300 (that is Pluto TV)
  CRUNCHYROLL: 283,         // was 127441 (not a provider id)
  DISCOVERY_PLUS: '520|524', // was 3672 (not a provider id); 520 US/CA, 524 GB/DE/IT
  MGM_PLUS: 34,             // was 2313 (not a provider id)
  PRIME_VIDEO: '9|119',     // was 9 only; 119 in BR/CA/ES/FR/IT
  PARAMOUNT_PLUS: '531|2303|2616', // was 531 only; the US lists Premium 2303 / Essential 2616
  PEACOCK: '386|387',       // was 386 only; adds Peacock Premium Plus
};

// Floors that keep "latest" and "top rated" rows free of unreleased or
// single-vote titles.
const LATEST_FLOOR = 10;
const TOP_FLOOR_MOVIE = 300;
const TOP_FLOOR_SERIES = 100;

function discover(apiType, tmdb) {
  return { handler: 'tmdb_discover', params: { apiType, tmdb } };
}

function latestTv(filters) {
  return discover('tv', { ...filters, sort_by: 'first_air_date.desc', 'vote_count.gte': LATEST_FLOOR });
}

function topTv(filters) {
  return discover('tv', { ...filters, sort_by: 'vote_average.desc', 'vote_count.gte': TOP_FLOOR_SERIES });
}

// id -> replacement { handler, params } (name/type/group/icon are kept).
const FIXES = {
  // Found by fetching every catalogue's first page with a real TMDB key
  // (2026-10-28): wrong collection ids, a TV keyword with no shows, and
  // public MDBList lists that no longer exist (404).
  collection_lord_of_the_rings: { handler: 'tmdb_collection', params: { collectionId: 119 } },   // was 1173608 ("The Making of...")
  collection_planet_of_apes: { handler: 'tmdb_collection', params: { collectionId: '1709|173710' } }, // original + reboot (1719317 was a 404)
  genre_bollywood_series: discover('tv', { with_original_language: 'hi', sort_by: 'popularity.desc' }),
  genre_bollywood_latest_series: latestTv({ with_original_language: 'hi' }),
  genre_bollywood_toprated_series: topTv({ with_original_language: 'hi' }),
  themed_hidden_gems_tmdb_movies: discover('movie', { sort_by: 'vote_average.desc', 'vote_average.gte': 7.3, 'vote_count.gte': 200, 'vote_count.lte': 2500 }),
  themed_hidden_gems_tmdb_series: discover('tv', { sort_by: 'vote_average.desc', 'vote_average.gte': 7.5, 'vote_count.gte': 100, 'vote_count.lte': 1500 }),
  themed_feature_docs: discover('movie', { with_genres: '99', 'with_runtime.gte': 70, sort_by: 'popularity.desc', 'vote_count.gte': 20 }),
  themed_nostalgic_80s_90s: discover('movie', { 'primary_release_date.gte': '1980-01-01', 'primary_release_date.lte': '1999-12-31', sort_by: 'popularity.desc', 'vote_count.gte': 1500 }),
  // Studios (companies)
  studio_a24_movies: { handler: 'tmdb_company', params: { companyId: COMPANY.A24, sort: 'popularity.desc' } },
  studio_a24_series: { handler: 'tmdb_company', params: { companyId: COMPANY.A24, sort: 'popularity.desc' } },
  studio_20th_century_movies: { handler: 'tmdb_company', params: { companyId: COMPANY.TWENTIETH_FILMS, sort: 'popularity.desc' } },
  studio_20th_century_latest_movies: { handler: 'tmdb_company', params: { companyId: COMPANY.TWENTIETH_FILMS, sort: 'release_date.desc' } },
  studio_20th_century_toprated_movies: { handler: 'tmdb_company', params: { companyId: COMPANY.TWENTIETH_FILMS, sort: 'vote_average.desc' } },
  studio_20th_century_series: { handler: 'tmdb_company', params: { companyId: COMPANY.TWENTIETH_TV, sort: 'popularity.desc' } },
  studio_legendary_movies: { handler: 'tmdb_company', params: { companyId: COMPANY.LEGENDARY_PICTURES, sort: 'popularity.desc' } },
  studio_legendary_latest_movies: { handler: 'tmdb_company', params: { companyId: COMPANY.LEGENDARY_PICTURES, sort: 'release_date.desc' } },
  studio_legendary_toprated_movies: { handler: 'tmdb_company', params: { companyId: COMPANY.LEGENDARY_PICTURES, sort: 'vote_average.desc' } },
  studio_legendary_series: { handler: 'tmdb_company', params: { companyId: COMPANY.LEGENDARY_TV, sort: 'popularity.desc' } },
  studio_lucasfilm_movies: { handler: 'tmdb_company', params: { companyId: COMPANY.LUCASFILM, sort: 'popularity.desc' } },
  studio_lucasfilm_latest_movies: { handler: 'tmdb_company', params: { companyId: COMPANY.LUCASFILM, sort: 'release_date.desc' } },
  studio_lucasfilm_toprated_movies: { handler: 'tmdb_company', params: { companyId: COMPANY.LUCASFILM, sort: 'vote_average.desc' } },
  studio_lucasfilm_series: { handler: 'tmdb_company', params: { companyId: COMPANY.LUCASFILM, sort: 'popularity.desc' } },
  studio_warner_movies: { handler: 'tmdb_company', params: { companyId: COMPANY.WARNER_PICTURES, sort: 'popularity.desc' } },
  studio_warner_latest_movies: { handler: 'tmdb_company', params: { companyId: COMPANY.WARNER_PICTURES, sort: 'release_date.desc' } },
  studio_warner_toprated_movies: { handler: 'tmdb_company', params: { companyId: COMPANY.WARNER_PICTURES, sort: 'vote_average.desc' } },
  studio_warner_series: { handler: 'tmdb_company', params: { companyId: COMPANY.WARNER_TV, sort: 'popularity.desc' } },
  studio_dreamworks_movies: { handler: 'tmdb_company', params: { companyId: COMPANY.DREAMWORKS_ANIMATION, sort: 'popularity.desc' } },
  studio_dreamworks_series: { handler: 'tmdb_company', params: { companyId: COMPANY.DREAMWORKS_TV, sort: 'popularity.desc' } },
  studio_sony_series: { handler: 'tmdb_company', params: { companyId: COMPANY.SONY_TV, sort: 'popularity.desc' } },
  // DC / Marvel animation were the whole studio under another label; make them animation.
  studio_dc_animation_movies: discover('movie', { with_companies: COMPANY.DC, with_genres: 16, sort_by: 'popularity.desc' }),
  studio_dc_animation_series: discover('tv', { with_companies: COMPANY.DC, with_genres: 16, sort_by: 'popularity.desc' }),
  studio_marvel_animation_movies: discover('movie', { with_companies: COMPANY.MARVEL, with_genres: 16, sort_by: 'popularity.desc' }),
  studio_marvel_animation_series: discover('tv', { with_companies: COMPANY.MARVEL, with_genres: 16, sort_by: 'popularity.desc' }),

  // HBO "movies" used the TV-only network handler and returned series.
  label_hbo_movies: { handler: 'tmdb_company', params: { companyId: COMPANY.HBO_FILMS, sort: 'popularity.desc' } },

  // Networks. The latest/top-rated variants had no sort and were the base row.
  label_amc_series: { handler: 'tmdb_network', params: { networkId: NETWORK.AMC } },
  label_amc_latest_series: latestTv({ with_networks: NETWORK.AMC }),
  label_amc_toprated_series: topTv({ with_networks: NETWORK.AMC }),
  label_fx_series: { handler: 'tmdb_network', params: { networkId: NETWORK.FX } },
  label_fx_latest_series: latestTv({ with_networks: NETWORK.FX }),
  label_fx_toprated_series: topTv({ with_networks: NETWORK.FX }),
  label_starz_series: { handler: 'tmdb_network', params: { networkId: NETWORK.STARZ } },
  label_starz_latest_series: latestTv({ with_networks: NETWORK.STARZ }),
  label_starz_toprated_series: topTv({ with_networks: NETWORK.STARZ }),
  label_hbo_latest_series: latestTv({ with_networks: NETWORK.HBO }),
  label_hbo_toprated_series: topTv({ with_networks: NETWORK.HBO }),

  // Watch providers
  streaming_shudder_movies: { handler: 'tmdb_provider', params: { providerId: PROVIDER.SHUDDER } },
  streaming_shudder_series: { handler: 'tmdb_provider', params: { providerId: PROVIDER.SHUDDER } },
  streaming_crunchyroll_movies: { handler: 'tmdb_provider', params: { providerId: PROVIDER.CRUNCHYROLL } },
  streaming_crunchyroll_series: { handler: 'tmdb_provider', params: { providerId: PROVIDER.CRUNCHYROLL } },
  streaming_discovery_movies: { handler: 'tmdb_provider', params: { providerId: PROVIDER.DISCOVERY_PLUS } },
  streaming_discovery_series: { handler: 'tmdb_provider', params: { providerId: PROVIDER.DISCOVERY_PLUS } },
  streaming_mgm_movies: { handler: 'tmdb_provider', params: { providerId: PROVIDER.MGM_PLUS } },
  streaming_prime_movies: { handler: 'tmdb_provider', params: { providerId: PROVIDER.PRIME_VIDEO } },
  streaming_prime_series: { handler: 'tmdb_provider', params: { providerId: PROVIDER.PRIME_VIDEO } },
  streaming_paramount_movies: { handler: 'tmdb_provider', params: { providerId: PROVIDER.PARAMOUNT_PLUS } },
  streaming_paramount_series: { handler: 'tmdb_provider', params: { providerId: PROVIDER.PARAMOUNT_PLUS } },
  streaming_peacock_movies: { handler: 'tmdb_provider', params: { providerId: PROVIDER.PEACOCK } },
  streaming_peacock_series: { handler: 'tmdb_provider', params: { providerId: PROVIDER.PEACOCK } },

  // Themes
  // TMDB's old "epic" keyword (6917) is gone and its replacement (377433)
  // tags 16 films, so Epics is long, well-known adventure/fantasy/history/war.
  themed_epics: discover('movie', { with_genres: '12|14|36|10752', 'with_runtime.gte': 150, 'vote_count.gte': 1000, sort_by: 'popularity.desc' }),
  themed_zombies: { handler: 'tmdb_keyword', params: { keywordId: KEYWORD.ZOMBIE } },
  // Both used keyword 342626 ("b-horror"). Now real horror, split by era.
  themed_horror_classics_movies: discover('movie', { with_genres: 27, 'primary_release_date.lte': '1989-12-31', 'vote_count.gte': 300, sort_by: 'popularity.desc' }),
  themed_modern_horror_movies: discover('movie', { with_genres: 27, 'primary_release_date.gte': '2010-01-01', 'vote_count.gte': 200, sort_by: 'popularity.desc' }),

  // "Best of" decades: all four pointed at the 2000s list.
  themed_rt_best_80s: { handler: 'mdb_list', params: { user: 'hdlists', slug: 'rottentomatoes-com-s-best-of-the-80s' } },
  themed_rt_best_90s: { handler: 'mdb_list', params: { user: 'hdlists', slug: 'rottentomatoes-com-s-best-of-the-90s' } },
  themed_rt_best_00s: { handler: 'mdb_list', params: { user: 'hdlists', slug: 'best-of-the-00s' } },
  themed_rt_best_10s: { handler: 'mdb_list', params: { user: 'hdlists', slug: 'best-of-the-2010s' } },

  // Romantic comedy: keyword 380334 no longer has a page. Romance AND Comedy.
  genre_romantic_comedy_movies: discover('movie', { with_genres: '10749,35', sort_by: 'popularity.desc' }),
  genre_romantic_comedy_latest_movies: discover('movie', { with_genres: '10749,35', sort_by: 'primary_release_date.desc', 'vote_count.gte': LATEST_FLOOR }),
  genre_romantic_comedy_toprated_movies: discover('movie', { with_genres: '10749,35', sort_by: 'vote_average.desc', 'vote_count.gte': TOP_FLOOR_MOVIE }),
  genre_romantic_comedy_series: discover('tv', { with_genres: 35, with_keywords: KEYWORD.ROMANCE, sort_by: 'popularity.desc' }),

  // Series rows that used movie-only genre ids.
  genre_adventure_series: { handler: 'tmdb_genre', params: { genreId: 10759 } },     // Action & Adventure
  genre_war_series: { handler: 'tmdb_genre', params: { genreId: 10768 } },           // War & Politics
  genre_horror_series: { handler: 'tmdb_keyword', params: { keywordId: KEYWORD.HORROR, sort: 'popularity.desc' } },
  genre_horror_latest_series: latestTv({ with_keywords: KEYWORD.HORROR }),
  genre_romance_series: { handler: 'tmdb_keyword', params: { keywordId: KEYWORD.ROMANCE } },
  genre_romance_latest_series: latestTv({ with_keywords: KEYWORD.ROMANCE }),
  genre_romance_toprated_series: topTv({ with_keywords: KEYWORD.ROMANCE }),
  genre_thriller_series: { handler: 'tmdb_keyword', params: { keywordId: KEYWORD.THRILLER, sort: 'popularity.desc' } },
  genre_thriller_latest_series: latestTv({ with_keywords: KEYWORD.THRILLER }),
  genre_history_series: { handler: 'tmdb_keyword', params: { keywordId: KEYWORD.HISTORY } },
  genre_music_series: { handler: 'tmdb_keyword', params: { keywordId: KEYWORD.MUSIC } },
  // Not a genre at all on TMDB.
  genre_sports_movies: { handler: 'tmdb_keyword', params: { keywordId: KEYWORD.SPORTS, sort: 'popularity.desc' } },
};

// Exact duplicates (same handler, type and params) kept as working ids that
// resolve to one canonical definition. Packs list only one of them.
const ALIASES = {
  // The public "latest Hulu" MDBList lists are gone; Hulu is region-locked anyway.
  streaming_latest_hulu_movies: 'streaming_hulu_movies',
  streaming_latest_hulu_series: 'streaming_hulu_series',
  collection_universe_star_wars: 'collection_star_wars',
  collection_universe_dune: 'collection_dune',
  collection_universe_jurassic: 'collection_jurassic_park',
  collection_universe_indiana_jones: 'collection_indiana_jones',
  collection_universe_xmen: 'collection_xmen',
  streaming_top100_movies: 'trakt_trending_movies',
  streaming_top100_series: 'trakt_trending_series',
  kb_peacock_top50_series: 'trakt_anticipated_series',
  trending_most_popular_top20_movies: 'tmdb_popular_movies',
  new_latest_digital_movies: 'new_latest_releases_movies',
  // TMDB has one combined TV genre, Sci-Fi & Fantasy (10765).
  genre_fantasy_series: 'genre_scifi_series',
  genre_fantasy_latest_series: 'genre_scifi_latest_series',
  genre_fantasy_toprated_series: 'genre_scifi_toprated_series',
  // Sub-studio rows that were the whole studio under another label.
  studio_dc_batman_movies: 'studio_dc_movies',
  studio_dc_superman_movies: 'studio_dc_movies',
  studio_dc_dceu_movies: 'studio_dc_movies',
  studio_dcu_movies: 'studio_dc_movies',
  studio_dcu_series: 'studio_dc_series',
  studio_marvel_avengers_movies: 'studio_marvel_movies',
  studio_marvel_legacy_movies: 'studio_marvel_movies',
  studio_marvel_spiderman_movies: 'studio_marvel_movies',
  studio_marvel_xmen_movies: 'studio_marvel_movies',
};

function copyParams(params) {
  return JSON.parse(JSON.stringify(params || {}));
}

function applyCatalogFixes(catalogs) {
  const out = { ...catalogs };
  for (const [id, fix] of Object.entries(FIXES)) {
    const base = out[id];
    if (!base) throw new Error(`catalogue fix targets unknown id ${id}`);
    // listName is the picker/folder label of MDBList rows: keep it.
    const listName = base.params?.listName;
    out[id] = { ...base, handler: fix.handler, params: { ...copyParams(fix.params), ...(listName ? { listName } : {}) } };
  }
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    const base = out[alias];
    const target = out[canonical];
    if (!base || !target) throw new Error(`catalogue alias ${alias} -> ${canonical} is not resolvable`);
    if (target.aliasOf) throw new Error(`catalogue alias ${alias} points at another alias`);
    if (base.type !== target.type) throw new Error(`catalogue alias ${alias} changes media type`);
    const listName = base.params?.listName;
    out[alias] = {
      ...base,
      handler: target.handler,
      params: { ...copyParams(target.params), ...(listName ? { listName } : {}) },
      aliasOf: canonical,
    };
  }
  return out;
}

export interface CatalogdefsFixesApi {
  applyCatalogFixes: any;
  FIXES: any;
  ALIASES: any;
  MOVIE_GENRES: number[];
  TV_GENRES: number[];
}

module.exports = { applyCatalogFixes, FIXES, ALIASES, MOVIE_GENRES, TV_GENRES } satisfies CatalogdefsFixesApi;
