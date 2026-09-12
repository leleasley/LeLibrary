// ── One-click source packs ────────────────────────────────────
// Packs are intentionally expressed in terms of catalog source ids, never
// URLs or provider parameters. The registry validates every member at load.

const { getSourceDefinition } = require('./catalog-source-registry');

const QUICK_PICKS = Object.freeze([
  { id: 'movie-night', icon: '🎬', name: 'Movie Night', description: 'Fresh releases, what is in theatres, and all-time favourites.', sources: ['now_playing_movies', 'trending_movies', 'trending_imdb_top100_movies', 'tmdb_popular_movies'] },
  { id: 'tv-tonight', icon: '📺', name: 'TV Tonight', description: 'A fast TV setup with live, trending, and popular series.', sources: ['airing_today_series', 'on_the_air_series', 'trending_series', 'tmdb_popular_series'] },
  { id: 'streaming-now', icon: '✨', name: 'Streaming Now', description: 'Popular picks from the major streaming services.', sources: ['streaming_netflix_movies', 'streaming_netflix_series', 'streaming_disney_movies', 'streaming_prime_movies'] },
  { id: 'trakt-public', icon: '🔗', name: 'Trakt Public', description: 'Public Trakt Trending, Popular, and Anticipated rows. No sign-in required.', sources: ['trakt_trending_movies', 'trakt_trending_series', 'trakt_popular_movies', 'trakt_popular_series', 'trakt_anticipated_movies', 'trakt_anticipated_series'] },
  { id: 'genre-essentials', icon: '🍿', name: 'Genre Essentials', description: 'Action, comedy, horror, and science-fiction staples.', sources: ['genre_action_movies', 'genre_comedy_movies', 'genre_horror_movies', 'genre_scifi_movies'] },
  { id: 'just-added', icon: '🆕', name: 'Just Added', description: 'Current cinema releases and the newest TV episodes.', sources: ['now_playing_movies', 'airing_today_series', 'on_the_air_series'] },
  { id: 'family-night', icon: '👨‍👩‍👧‍👦', name: 'Family Night', description: 'Recent and popular family films and series.', sources: ['genre_family_latest_movies', 'genre_family_movies', 'genre_family_latest_series', 'genre_family_series'] },
  { id: 'hidden-gems', icon: '💎', name: 'Hidden Gems', description: 'Less obvious movie and television discoveries worth finding.', sources: ['themed_hidden_gems_tmdb_movies', 'themed_hidden_gems_tmdb_series'] },
  { id: 'documentaries', icon: '🎞️', name: 'Documentaries', description: 'Documentary films, factual series, and feature documentaries.', sources: ['genre_documentary_movies', 'genre_documentary_series', 'themed_feature_docs'] },
  { id: 'marvel-and-more', icon: '🦸', name: 'Marvel & More', description: 'A franchise-led home with Marvel and superhero picks.', sources: ['collection_marvel_universe_mdb', 'collection_mcu', 'themed_superhero'] },
  { id: 'directors', icon: '🎬', name: 'Directors', description: 'Filmography rows for well-known directors.', sources: ['director_nolan_movies', 'director_spielberg_movies', 'director_tarantino_movies', 'director_scorsese_movies', 'director_villeneuve_movies', 'director_fincher_movies'] },
  { id: 'by-decade', icon: '📅', name: 'By Decade', description: 'The most popular films and shows by decade.', sources: ['decade_2020s_movies', 'decade_2010s_movies', 'decade_2000s_movies', 'decade_1990s_movies', 'decade_1980s_movies'] },
  { id: 'world-cinema', icon: '🌍', name: 'World Cinema', description: 'Popular films by original language.', sources: ['language_japanese_movies', 'language_korean_movies', 'language_spanish_movies', 'language_french_movies', 'language_hindi_movies'] },
  { id: 'lelibrary-special', icon: '🌟', name: 'LeLibrary Special', description: 'A balanced sampler of trending, streaming, genre, and franchise picks.', sources: ['trending_movies', 'trending_series', 'streaming_netflix_movies', 'streaming_netflix_series', 'genre_action_movies', 'collection_star_wars'] },
]);

function listQuickPicks() {
  return QUICK_PICKS.map((pick) => {
    const sources = pick.sources.map(getSourceDefinition).filter((source) => source?.available);
    return {
      id: pick.id,
      icon: pick.icon,
      name: pick.name,
      description: pick.description,
      sources: sources.map((source) => ({
        sourceId: source.id,
        catalogId: `lib-${source.id}`,
        title: source.name,
        type: source.type,
      })),
    };
  }).filter((pick) => pick.sources.length > 0);
}

function validateQuickPicks() {
  const errors = [];
  for (const pick of QUICK_PICKS) {
    if (!/^[a-z0-9-]+$/.test(pick.id)) errors.push(`${pick.id}: invalid pack id`);
    if (!pick.name || !pick.sources?.length) errors.push(`${pick.id}: missing name or sources`);
    for (const sourceId of pick.sources) {
      const source = getSourceDefinition(sourceId);
      if (!source?.available) errors.push(`${pick.id}: unavailable source ${sourceId}`);
    }
  }
  return { ok: errors.length === 0, errors, total: QUICK_PICKS.length };
}

module.exports = { listQuickPicks, validateQuickPicks };
