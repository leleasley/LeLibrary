// SQL-only data access for the Releases feature. Browse and day-view request
// paths call these reads; they never call TMDB. All writes are done by the
// background sync engine.
const db = require('./db.ts');

function poolOrNull(): any {
  return db.getPool();
}

async function ensure(): Promise<any> {
  const ok = await db.ensureSchema();
  if (!ok) throw new Error('releases database unavailable');
  return db.getPool();
}

// ── Writes (sync engine only) ──────────────────────────────────────────────

export interface MovieRow {
  tmdbId: number;
  region: string;
  title: string;
  overview: string | null;
  posterPath: string | null;
  backdropPath?: string | null;
  genres?: string[];
  popularity: number | null;
  voteAverage: number | null;
  releaseDate: string | null;
  digital: string | null;
  theatrical: string | null;
  physical: string | null;
}

async function upsertMovie(row: MovieRow): Promise<void> {
  const pool = poolOrNull();
  if (!pool) return;
  await pool.query(
    `INSERT INTO release_movies
       (tmdb_id, region, title, overview, poster_path, backdrop_path, genres, popularity, vote_average,
        release_date, digital_date, theatrical_date, physical_date, fetched_at, detail_fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13, now(),
        CASE WHEN $11::date IS NOT NULL OR $12::date IS NOT NULL OR $13::date IS NOT NULL THEN now() ELSE NULL END)
     ON CONFLICT (tmdb_id, region) DO UPDATE SET
       title = EXCLUDED.title,
       overview = EXCLUDED.overview,
       poster_path = EXCLUDED.poster_path,
       backdrop_path = COALESCE(EXCLUDED.backdrop_path, release_movies.backdrop_path),
       genres = CASE WHEN EXCLUDED.genres = '[]'::jsonb THEN release_movies.genres ELSE EXCLUDED.genres END,
       popularity = EXCLUDED.popularity,
       vote_average = EXCLUDED.vote_average,
       release_date = EXCLUDED.release_date,
       digital_date = COALESCE(EXCLUDED.digital_date, release_movies.digital_date),
       theatrical_date = COALESCE(EXCLUDED.theatrical_date, release_movies.theatrical_date),
       physical_date = COALESCE(EXCLUDED.physical_date, release_movies.physical_date),
       fetched_at = now(),
       detail_fetched_at = COALESCE(release_movies.detail_fetched_at, EXCLUDED.detail_fetched_at)`,
    [row.tmdbId, row.region, row.title, row.overview, row.posterPath, row.backdropPath ?? null,
      JSON.stringify(row.genres ?? []), row.popularity, row.voteAverage,
      row.releaseDate, row.digital, row.theatrical, row.physical],
  );
}

export interface MovieDetailUpdate {
  tmdbId: number;
  region: string;
  digital: string | null;
  theatrical: string | null;
  physical: string | null;
}

async function updateMovieMeta(update: { tmdbId: number; region: string; genres: string[]; backdropPath: string | null }): Promise<void> {
  const pool = poolOrNull();
  if (!pool) return;
  await pool.query(
    `UPDATE release_movies SET
       genres = CASE WHEN $3::jsonb = '[]'::jsonb THEN genres ELSE $3::jsonb END,
       backdrop_path = COALESCE($4, backdrop_path)
     WHERE tmdb_id = $1 AND region = $2`,
    [update.tmdbId, update.region, JSON.stringify(update.genres ?? []), update.backdropPath ?? null],
  );
}

async function updateMovieDetail(update: MovieDetailUpdate): Promise<void> {
  const pool = poolOrNull();
  if (!pool) return;
  await pool.query(
    `UPDATE release_movies SET
       digital_date = COALESCE($3, digital_date),
       theatrical_date = COALESCE($4, theatrical_date),
       physical_date = COALESCE($5, physical_date),
       detail_fetched_at = now()
     WHERE tmdb_id = $1 AND region = $2`,
    [update.tmdbId, update.region, update.digital, update.theatrical, update.physical],
  );
}

export interface ShowRow {
  tmdbId: number;
  name: string;
  overview: string | null;
  posterPath: string | null;
  backdropPath?: string | null;
  genres?: string[];
  originalLanguage?: string | null;
  originCountry?: string[];
  firstAirDate: string | null;
  popularity: number | null;
  voteAverage: number | null;
  episodeRunTime?: number | null;
}

async function upsertShow(row: ShowRow): Promise<void> {
  const pool = poolOrNull();
  if (!pool) return;
  await pool.query(
    `INSERT INTO release_shows
       (tmdb_id, name, overview, poster_path, backdrop_path, genres, original_language, origin_country,
        first_air_date, popularity, vote_average, episode_run_time, fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$12, now())
     ON CONFLICT (tmdb_id) DO UPDATE SET
       name = EXCLUDED.name,
       overview = EXCLUDED.overview,
       poster_path = EXCLUDED.poster_path,
       backdrop_path = COALESCE(EXCLUDED.backdrop_path, release_shows.backdrop_path),
       genres = CASE WHEN EXCLUDED.genres = '[]'::jsonb THEN release_shows.genres ELSE EXCLUDED.genres END,
       original_language = COALESCE(EXCLUDED.original_language, release_shows.original_language),
       origin_country = CASE WHEN EXCLUDED.origin_country = '[]'::jsonb THEN release_shows.origin_country ELSE EXCLUDED.origin_country END,
       first_air_date = EXCLUDED.first_air_date,
       popularity = COALESCE(EXCLUDED.popularity, release_shows.popularity),
       vote_average = EXCLUDED.vote_average,
       episode_run_time = COALESCE(EXCLUDED.episode_run_time, release_shows.episode_run_time),
       fetched_at = now()`,
    [row.tmdbId, row.name, row.overview, row.posterPath, row.backdropPath ?? null,
      JSON.stringify(row.genres ?? []), row.originalLanguage ?? null, JSON.stringify(row.originCountry ?? []),
      row.firstAirDate, row.popularity, row.voteAverage, row.episodeRunTime ?? null],
  );
}

export interface ShowDetailUpdate {
  tmdbId: number;
  status: string | null;
  numberOfSeasons: number | null;
  nextEpisodeAirDate: string | null;
  nextEpisodeSeason: number | null;
  nextEpisodeNumber: number | null;
  lastEpisodeAirDate?: string | null;
  lastEpisodeSeason?: number | null;
  lastEpisodeNumber?: number | null;
  episodeRunTime?: number | null;
  genres?: string[];
  networks?: string[];
  showType?: string | null;
}

async function updateShowDetail(update: ShowDetailUpdate): Promise<void> {
  const pool = poolOrNull();
  if (!pool) return;
  await pool.query(
    `UPDATE release_shows SET
       status = $2,
       number_of_seasons = $3,
       next_episode_air_date = $4,
       next_episode_season = $5,
       next_episode_number = $6,
       last_episode_air_date = $7,
       last_episode_season = $8,
       last_episode_number = $9,
       episode_run_time = COALESCE($10, episode_run_time),
       genres = CASE WHEN $11::jsonb = '[]'::jsonb THEN genres ELSE $11::jsonb END,
       networks = CASE WHEN $12::jsonb = '[]'::jsonb THEN networks ELSE $12::jsonb END,
       show_type = COALESCE($13, show_type),
       detail_fetched_at = now()
     WHERE tmdb_id = $1`,
    [update.tmdbId, update.status, update.numberOfSeasons, update.nextEpisodeAirDate,
      update.nextEpisodeSeason, update.nextEpisodeNumber, update.lastEpisodeAirDate ?? null,
      update.lastEpisodeSeason ?? null, update.lastEpisodeNumber ?? null, update.episodeRunTime ?? null,
      JSON.stringify(update.genres ?? []), JSON.stringify(update.networks ?? []), update.showType ?? null],
  );
}

export interface EpisodeRow {
  tmdbId: number;
  showTmdbId: number;
  season: number;
  episode: number;
  name: string | null;
  airDate: string | null;
  runtime?: number | null;
  seriesPremiere: boolean;
  seasonPremiere: boolean;
  finale: boolean;
}

async function upsertEpisodes(rows: EpisodeRow[]): Promise<void> {
  const pool = poolOrNull();
  if (!pool || rows.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      await client.query(
        `INSERT INTO release_episodes
           (tmdb_id, show_tmdb_id, season, episode, name, air_date, runtime,
            is_series_premiere, is_season_premiere, is_finale, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
         ON CONFLICT (tmdb_id, season, episode) DO UPDATE SET
           show_tmdb_id = EXCLUDED.show_tmdb_id,
           name = EXCLUDED.name,
           air_date = EXCLUDED.air_date,
           runtime = COALESCE(EXCLUDED.runtime, release_episodes.runtime),
           is_series_premiere = EXCLUDED.is_series_premiere,
           is_season_premiere = EXCLUDED.is_season_premiere,
           is_finale = EXCLUDED.is_finale,
           fetched_at = now()`,
        [row.tmdbId, row.showTmdbId, row.season, row.episode, row.name, row.airDate, row.runtime ?? null,
          row.seriesPremiere, row.seasonPremiere, row.finale],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

// ── Seasons ────────────────────────────────────────────────────────────────
export interface SeasonUpsertRow {
  seasonNumber: number;
  name: string | null;
  airDate: string | null;
  episodeCount: number | null;
  posterPath: string | null;
  overview: string | null;
  isSpecials: boolean;
}

async function upsertSeasons(showTmdbId: number, seasons: SeasonUpsertRow[]): Promise<void> {
  const pool = poolOrNull();
  if (!pool || seasons.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const season of seasons) {
      await client.query(
        `INSERT INTO release_seasons
           (show_tmdb_id, season_number, name, air_date, episode_count, poster_path, overview, is_specials, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
         ON CONFLICT (show_tmdb_id, season_number) DO UPDATE SET
           name = EXCLUDED.name,
           air_date = EXCLUDED.air_date,
           episode_count = EXCLUDED.episode_count,
           poster_path = EXCLUDED.poster_path,
           overview = EXCLUDED.overview,
           is_specials = EXCLUDED.is_specials,
           fetched_at = now()`,
        [showTmdbId, season.seasonNumber, season.name, season.airDate, season.episodeCount,
          season.posterPath, season.overview, season.isSpecials],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

// Numbered seasons ascending, then specials (season 0) last.
async function listSeasons(showTmdbId: number): Promise<any[]> {
  const pool = await ensure();
  const { rows } = await pool.query(
    `SELECT season_number, name, air_date::text AS air_date, episode_count, poster_path, overview,
            is_specials, (episodes_fetched_at IS NOT NULL) AS episodes_fetched
       FROM release_seasons WHERE show_tmdb_id = $1
      ORDER BY (season_number = 0) ASC, season_number ASC`,
    [showTmdbId],
  );
  return rows;
}

async function getSeason(showTmdbId: number, seasonNumber: number): Promise<any | null> {
  const pool = await ensure();
  const { rows } = await pool.query(
    `SELECT season_number, name, air_date::text AS air_date, episode_count, poster_path, overview,
            is_specials, (episodes_fetched_at IS NOT NULL) AS episodes_fetched
       FROM release_seasons WHERE show_tmdb_id = $1 AND season_number = $2`,
    [showTmdbId, seasonNumber],
  );
  return rows[0] || null;
}

async function markSeasonEpisodesFetched(showTmdbId: number, seasonNumber: number): Promise<void> {
  const pool = poolOrNull();
  if (!pool) return;
  await pool.query(
    `UPDATE release_seasons SET episodes_fetched_at = now() WHERE show_tmdb_id = $1 AND season_number = $2`,
    [showTmdbId, seasonNumber],
  );
}

async function listSeasonEpisodes(showTmdbId: number, seasonNumber: number): Promise<any[]> {
  const pool = await ensure();
  const { rows } = await pool.query(
    `SELECT tmdb_id, season, episode, name, air_date::text AS air_date, runtime,
            is_series_premiere, is_season_premiere, is_finale
       FROM release_episodes
      WHERE show_tmdb_id = $1 AND season = $2
      ORDER BY episode ASC`,
    [showTmdbId, seasonNumber],
  );
  return rows;
}

async function seasonEpisodesFetchedAt(showTmdbId: number, seasonNumber: number): Promise<string | null> {
  const pool = await ensure();
  const { rows } = await pool.query(
    `SELECT episodes_fetched_at FROM release_seasons WHERE show_tmdb_id = $1 AND season_number = $2`,
    [showTmdbId, seasonNumber],
  );
  return rows[0] ? rows[0].episodes_fetched_at : null;
}

async function cleanupStale(staleDays: number): Promise<number> {
  const pool = poolOrNull();
  if (!pool) return 0;
  const result = await pool.query(
    `DELETE FROM release_movies WHERE fetched_at < now() - ($1::int * interval '1 day')`,
    [staleDays],
  );
  await pool.query(
    `DELETE FROM release_shows WHERE fetched_at < now() - ($1::int * interval '1 day')`,
    [staleDays],
  );
  await pool.query(
    `DELETE FROM release_episodes WHERE fetched_at < now() - ($1::int * interval '1 day')`,
    [staleDays],
  );
  await pool.query(
    `DELETE FROM release_seasons WHERE fetched_at < now() - ($1::int * interval '1 day')`,
    [staleDays],
  );
  return result.rowCount || 0;
}

// ── Reads (request path: SQL only) ─────────────────────────────────────────

export interface MovieListRow {
  tmdb_id: number;
  region: string;
  title: string;
  overview: string | null;
  poster_path: string | null;
  popularity: number | null;
  vote_average: number | null;
  release_date: string | null;
  digital_date: string | null;
  theatrical_date: string | null;
  physical_date: string | null;
}

async function listMovies(opts: { region: string; from: string; to: string; limit: number; offset: number }): Promise<MovieListRow[]> {
  const pool = await ensure();
  const { rows } = await pool.query(
    `SELECT tmdb_id, region, title, overview, poster_path, backdrop_path, genres, popularity, vote_average,
            release_date::text AS release_date, digital_date::text AS digital_date,
            theatrical_date::text AS theatrical_date, physical_date::text AS physical_date
       FROM release_movies
      WHERE region = $1 AND digital_date IS NOT NULL AND digital_date >= $2::date AND digital_date <= $3::date
      ORDER BY digital_date ASC, title ASC
      LIMIT $4 OFFSET $5`,
    [opts.region, opts.from, opts.to, opts.limit, opts.offset],
  );
  return rows;
}

async function countMovies(opts: { region: string; from: string; to: string }): Promise<number> {
  const pool = await ensure();
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total FROM release_movies
      WHERE region = $1 AND digital_date IS NOT NULL AND digital_date >= $2::date AND digital_date <= $3::date`,
    [opts.region, opts.from, opts.to],
  );
  return rows[0] ? rows[0].total : 0;
}

export interface DayEpisodeRow {
  tmdb_id: number;
  show_tmdb_id: number;
  season: number;
  episode: number;
  name: string | null;
  air_date: string;
  is_series_premiere: boolean;
  is_season_premiere: boolean;
  is_finale: boolean;
  show_name: string;
  show_poster: string | null;
  show_status: string | null;
  show_networks: string[] | null;
  show_popularity: number | null;
  show_type: string | null;
  show_language: string | null;
}

async function listDay(opts: { date: string; limit: number; offset: number }): Promise<DayEpisodeRow[]> {
  const pool = await ensure();
  const { rows } = await pool.query(
    `SELECT e.tmdb_id, e.show_tmdb_id, e.season, e.episode, e.name, e.air_date::text AS air_date,
            e.is_series_premiere, e.is_season_premiere, e.is_finale,
            s.name AS show_name, s.poster_path AS show_poster, s.status AS show_status, s.networks AS show_networks,
            s.popularity AS show_popularity, s.show_type AS show_type, s.original_language AS show_language
       FROM release_episodes e
       JOIN release_shows s ON s.tmdb_id = e.show_tmdb_id
      WHERE e.air_date = $1::date
      ORDER BY s.name ASC, e.season ASC, e.episode ASC
      LIMIT $2 OFFSET $3`,
    [opts.date, opts.limit, opts.offset],
  );
  return rows;
}

// Every episode row in a date range, for the week strip. The whole range is
// loaded so the per-day counts use the same grouping and Notable rule as the
// day view instead of a second, SQL-side approximation of them.
async function listRange(opts: { from: string; to: string; limit: number }): Promise<DayEpisodeRow[]> {
  const pool = await ensure();
  const { rows } = await pool.query(
    `SELECT e.tmdb_id, e.show_tmdb_id, e.season, e.episode, e.name, e.air_date::text AS air_date,
            e.is_series_premiere, e.is_season_premiere, e.is_finale,
            s.name AS show_name, s.poster_path AS show_poster, s.status AS show_status, s.networks AS show_networks,
            s.popularity AS show_popularity, s.show_type AS show_type, s.original_language AS show_language
       FROM release_episodes e
       JOIN release_shows s ON s.tmdb_id = e.show_tmdb_id
      WHERE e.air_date >= $1::date AND e.air_date <= $2::date
      ORDER BY e.air_date ASC, s.name ASC, e.season ASC, e.episode ASC
      LIMIT $3`,
    [opts.from, opts.to, opts.limit],
  );
  return rows;
}

async function getMovie(tmdbId: number, region: string): Promise<MovieListRow | null> {
  const pool = await ensure();
  const { rows } = await pool.query(
    `SELECT tmdb_id, region, title, overview, poster_path, backdrop_path, genres, popularity, vote_average,
            release_date::text AS release_date, digital_date::text AS digital_date,
            theatrical_date::text AS theatrical_date, physical_date::text AS physical_date
       FROM release_movies WHERE tmdb_id = $1 AND region = $2`,
    [tmdbId, region],
  );
  return rows[0] || null;
}

async function getMovieAnyRegion(tmdbId: number): Promise<MovieListRow | null> {
  const pool = await ensure();
  const { rows } = await pool.query(
    `SELECT tmdb_id, region, title, overview, poster_path, backdrop_path, genres, popularity, vote_average,
            release_date::text AS release_date, digital_date::text AS digital_date,
            theatrical_date::text AS theatrical_date, physical_date::text AS physical_date
       FROM release_movies WHERE tmdb_id = $1 ORDER BY fetched_at DESC LIMIT 1`,
    [tmdbId],
  );
  return rows[0] || null;
}

export interface ShowDetailRow {
  tmdb_id: number;
  name: string;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: string[] | null;
  networks: string[] | null;
  first_air_date: string | null;
  popularity: number | null;
  vote_average: number | null;
  status: string | null;
  show_type: string | null;
  original_language: string | null;
  origin_country: string[] | null;
  number_of_seasons: number | null;
  episode_run_time: number | null;
  next_episode_air_date: string | null;
  next_episode_season: number | null;
  next_episode_number: number | null;
  last_episode_air_date: string | null;
  last_episode_season: number | null;
  last_episode_number: number | null;
}

async function getShow(tmdbId: number): Promise<ShowDetailRow | null> {
  const pool = await ensure();
  const { rows } = await pool.query(
    `SELECT tmdb_id, name, overview, poster_path, backdrop_path, genres, networks,
            first_air_date::text AS first_air_date, popularity, vote_average,
            status, show_type, original_language, origin_country, number_of_seasons, episode_run_time,
            next_episode_air_date::text AS next_episode_air_date, next_episode_season, next_episode_number,
            last_episode_air_date::text AS last_episode_air_date, last_episode_season, last_episode_number
       FROM release_shows WHERE tmdb_id = $1`,
    [tmdbId],
  );
  return rows[0] || null;
}

async function listShowEpisodes(tmdbId: number): Promise<DayEpisodeRow[]> {
  const pool = await ensure();
  const { rows } = await pool.query(
    `SELECT e.tmdb_id, e.show_tmdb_id, e.season, e.episode, e.name, e.air_date::text AS air_date,
            e.is_series_premiere, e.is_season_premiere, e.is_finale,
            s.name AS show_name, s.poster_path AS show_poster, s.status AS show_status
       FROM release_episodes e
       JOIN release_shows s ON s.tmdb_id = e.show_tmdb_id
      WHERE e.show_tmdb_id = $1
      ORDER BY e.season ASC, e.episode ASC`,
    [tmdbId],
  );
  return rows;
}

export interface LocalSearchRow {
  kind: string;
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  digital_date: string | null;
  theatrical_date: string | null;
  physical_date: string | null;
  release_date: string | null;
  first_air_date: string | null;
  next_episode_air_date: string | null;
  popularity: number | null;
}

async function localSearch(opts: { query: string; limit: number }): Promise<LocalSearchRow[]> {
  const pool = await ensure();
  const like = `%${opts.query}%`;
  const { rows } = await pool.query(
    `SELECT 'movie' AS kind, tmdb_id, title, poster_path, digital_date::text AS digital_date,
            theatrical_date::text AS theatrical_date, physical_date::text AS physical_date, release_date::text AS release_date,
            NULL::text AS first_air_date, NULL::text AS next_episode_air_date, popularity
       FROM release_movies WHERE title ILIKE $1
     UNION ALL
     SELECT 'tv' AS kind, tmdb_id, name AS title, poster_path, NULL::text AS digital_date,
            NULL::text AS theatrical_date, NULL::text AS physical_date, NULL::text AS release_date,
            first_air_date::text AS first_air_date, next_episode_air_date::text AS next_episode_air_date, popularity
       FROM release_shows WHERE name ILIKE $1
     ORDER BY popularity DESC NULLS LAST
     LIMIT $2`,
    [like, opts.limit],
  );
  return rows;
}

// Sync helpers: which rows still need per-title detail.
async function movieRegionsNeedingDetail(opts: { regions: string[]; ttlSeconds: number; limit: number }): Promise<{ tmdb_id: number; region: string }[]> {
  const pool = await ensure();
  const { rows } = await pool.query(
    `SELECT tmdb_id, region FROM release_movies
      WHERE region = ANY($1::text[])
        AND (detail_fetched_at IS NULL OR detail_fetched_at < now() - ($2::int * interval '1 second'))
      ORDER BY fetched_at ASC
      LIMIT $3`,
    [opts.regions, opts.ttlSeconds, opts.limit],
  );
  return rows;
}

async function showsNeedingDetail(opts: { ttlSeconds: number; limit: number }): Promise<number[]> {
  const pool = await ensure();
  const { rows } = await pool.query(
    `SELECT tmdb_id FROM release_shows
      WHERE detail_fetched_at IS NULL OR detail_fetched_at < now() - ($1::int * interval '1 second')
      ORDER BY popularity DESC NULLS LAST
      LIMIT $2`,
    [opts.ttlSeconds, opts.limit],
  );
  return rows.map((row: { tmdb_id: number }) => row.tmdb_id);
}

module.exports = {
  ensure,
  upsertMovie,
  updateMovieDetail,
  updateMovieMeta,
  upsertShow,
  updateShowDetail,
  upsertEpisodes,
  upsertSeasons,
  markSeasonEpisodesFetched,
  cleanupStale,
  listMovies,
  countMovies,
  listDay,
  listRange,
  getMovie,
  getMovieAnyRegion,
  getShow,
  listSeasons,
  getSeason,
  listSeasonEpisodes,
  seasonEpisodesFetchedAt,
  listShowEpisodes,
  localSearch,
  movieRegionsNeedingDetail,
  showsNeedingDetail,
};
