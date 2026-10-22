// Postgres access for the hosted Releases feature. Reuses the library engine's
// pool from DATABASE_URL (one pool per process) and runs its own additive,
// idempotent migrations so the release_ tables are created alongside lib_.
const libraryDb = require('../library/db.ts');

export interface ReleasesDbApi {
  enabled: () => boolean;
  getPool: () => any;
  ensureSchema: () => Promise<boolean>;
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS release_movies (
     tmdb_id            integer NOT NULL,
     region             text    NOT NULL,
     title              text    NOT NULL,
     overview           text,
     poster_path        text,
     popularity         real,
     vote_average       real,
     release_date       date,
     digital_date       date,
     theatrical_date    date,
     physical_date      date,
     fetched_at         timestamptz NOT NULL DEFAULT now(),
     detail_fetched_at  timestamptz,
     PRIMARY KEY (tmdb_id, region)
   )`,
  `CREATE INDEX IF NOT EXISTS release_movies_browse_idx ON release_movies (region, digital_date)`,
  `CREATE INDEX IF NOT EXISTS release_movies_fetched_idx ON release_movies (fetched_at)`,
  `ALTER TABLE release_movies ADD COLUMN IF NOT EXISTS backdrop_path text`,
  `ALTER TABLE release_movies ADD COLUMN IF NOT EXISTS genres jsonb NOT NULL DEFAULT '[]'`,

  `CREATE TABLE IF NOT EXISTS release_shows (
     tmdb_id                integer PRIMARY KEY,
     name                   text NOT NULL,
     overview               text,
     poster_path            text,
     first_air_date         date,
     popularity             real,
     vote_average           real,
     status                 text,
     number_of_seasons      integer,
     next_episode_air_date  date,
     next_episode_season    integer,
     next_episode_number    integer,
     fetched_at             timestamptz NOT NULL DEFAULT now(),
     detail_fetched_at      timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS release_shows_fetched_idx ON release_shows (fetched_at)`,
  `ALTER TABLE release_shows ADD COLUMN IF NOT EXISTS backdrop_path text`,
  `ALTER TABLE release_shows ADD COLUMN IF NOT EXISTS genres jsonb NOT NULL DEFAULT '[]'`,
  `ALTER TABLE release_shows ADD COLUMN IF NOT EXISTS networks jsonb NOT NULL DEFAULT '[]'`,
  `ALTER TABLE release_shows ADD COLUMN IF NOT EXISTS show_type text`,
  `ALTER TABLE release_shows ADD COLUMN IF NOT EXISTS original_language text`,
  `ALTER TABLE release_shows ADD COLUMN IF NOT EXISTS origin_country jsonb NOT NULL DEFAULT '[]'`,
  `ALTER TABLE release_shows ADD COLUMN IF NOT EXISTS episode_run_time integer`,
  `ALTER TABLE release_shows ADD COLUMN IF NOT EXISTS last_episode_air_date date`,
  `ALTER TABLE release_shows ADD COLUMN IF NOT EXISTS last_episode_season integer`,
  `ALTER TABLE release_shows ADD COLUMN IF NOT EXISTS last_episode_number integer`,

  // Every season TMDB lists, including specials (season 0) and undated ones.
  // Episodes are stored separately and fetched lazily per season.
  `CREATE TABLE IF NOT EXISTS release_seasons (
     show_tmdb_id   integer NOT NULL,
     season_number  integer NOT NULL,
     name           text,
     air_date       date,
     episode_count  integer,
     poster_path    text,
     overview       text,
     is_specials    boolean NOT NULL DEFAULT false,
     fetched_at     timestamptz NOT NULL DEFAULT now(),
     episodes_fetched_at timestamptz,
     PRIMARY KEY (show_tmdb_id, season_number)
   )`,
  // These tables are refreshed in batches. Keep statistics and dead tuples
  // under control on the larger, frequently updated release tables.
  `ALTER TABLE release_seasons SET (
     autovacuum_vacuum_scale_factor = 0.05,
     autovacuum_analyze_scale_factor = 0.05
   )`,
  // The primary key covers the same (show_tmdb_id, season_number) lookups.
  `DROP INDEX IF EXISTS release_seasons_show_idx`,
  `ALTER TABLE release_seasons ADD COLUMN IF NOT EXISTS episodes_fetched_at timestamptz`,

  `CREATE TABLE IF NOT EXISTS release_episodes (
     tmdb_id             integer NOT NULL,
     show_tmdb_id        integer NOT NULL,
     season              integer NOT NULL,
     episode             integer NOT NULL,
     name                text,
     air_date            date,
     is_series_premiere  boolean NOT NULL DEFAULT false,
     is_season_premiere  boolean NOT NULL DEFAULT false,
     is_finale           boolean NOT NULL DEFAULT false,
     runtime             integer,
     fetched_at          timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tmdb_id, season, episode)
   )`,
  `CREATE INDEX IF NOT EXISTS release_episodes_air_idx ON release_episodes (air_date, show_tmdb_id)`,
  `ALTER TABLE release_episodes SET (
     autovacuum_vacuum_scale_factor = 0.05,
     autovacuum_analyze_scale_factor = 0.05
   )`,
  `ALTER TABLE release_episodes ADD COLUMN IF NOT EXISTS runtime integer`,
];

let schemaReady = false;
let schemaPromise: Promise<boolean> | null = null;

function enabled(): boolean {
  return !!process.env.DATABASE_URL;
}

function getPool(): any {
  return libraryDb.getPool();
}

async function migrate(): Promise<boolean> {
  const ok = await libraryDb.ensureSchema();
  if (!ok) return false;
  const pool = getPool();
  if (!pool) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const statement of MIGRATIONS) await client.query(statement);
    await client.query('COMMIT');
    schemaReady = true;
    return true;
  } catch (err: any) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

function ensureSchema(): Promise<boolean> {
  if (schemaReady) return Promise.resolve(true);
  if (!enabled()) return Promise.resolve(false);
  if (!schemaPromise) {
    schemaPromise = migrate().catch((err: Error) => {
      schemaPromise = null;
      console.error('[ReleasesDB] migration failed:', err.message);
      return false;
    });
  }
  return schemaPromise;
}

module.exports = { enabled, getPool, ensureSchema } satisfies ReleasesDbApi;
