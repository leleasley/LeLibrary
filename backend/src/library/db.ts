// @ts-nocheck
// Index-first library engine: persistent local representation of a user's
// Debrid library.
//
// This module owns its own Postgres pool (built from DATABASE_URL) so it works
// identically on the hosted instance and on a self-hosted stack that adds a
// Postgres service. It does NOT depend on src/accounts (which is private and
// absent on self-hosted installs). Without DATABASE_URL the engine stays
// disabled and the addon keeps using the legacy request-time path.
const { Pool } = require('pg');

let pool = null;
let schemaReady = false;
let schemaPromise = null;
let lastSchemaError = null;

function enabled() {
  return !!process.env.DATABASE_URL;
}

function getPool() {
  if (!enabled()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: parseInt(process.env.LIBRARY_DB_POOL_MAX, 10) || 12,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: parseInt(process.env.LIBRARY_DB_STATEMENT_TIMEOUT, 10) || 30000,
      query_timeout: parseInt(process.env.LIBRARY_DB_STATEMENT_TIMEOUT, 10) || 30000,
    });
    pool.on('error', (err) => {
      console.error('[LibraryDB] idle client error:', err.message);
    });
  }
  return pool;
}

function poolStats() {
  const p = getPool();
  if (!p) return { enabled: false, total: 0, idle: 0, waiting: 0, max: 0 };
  return { enabled: true, total: p.totalCount, idle: p.idleCount, waiting: p.waitingCount, max: p.options.max };
}

// Additive, idempotent migrations. The library tables are deliberately separate
// from the accounts schema so the engine can run on a plain self-hosted
// Postgres. Every statement must be safe to replay on every startup.
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS lib_scopes (
     scope_id       text PRIMARY KEY,
     provider       text,
     config_token   text,
     last_seen_at   timestamptz NOT NULL DEFAULT now(),
     last_sync_at   timestamptz,
     last_sync_ms   integer,
     last_status    text NOT NULL DEFAULT 'pending',
     last_error     text,
     item_count     integer NOT NULL DEFAULT 0,
     matched_count  integer NOT NULL DEFAULT 0,
     pending_count  integer NOT NULL DEFAULT 0,
     removed_count  integer NOT NULL DEFAULT 0,
     last_added     integer NOT NULL DEFAULT 0,
     last_changed   integer NOT NULL DEFAULT 0,
     last_removed   integer NOT NULL DEFAULT 0,
     last_unchanged integer NOT NULL DEFAULT 0,
     last_success_at timestamptz,
     last_error_at   timestamptz,
     consecutive_errors integer NOT NULL DEFAULT 0,
     failed_count    integer NOT NULL DEFAULT 0,
     retryable_count integer NOT NULL DEFAULT 0,
     oldest_pending_at timestamptz,
     oldest_retry_at timestamptz,
     created_at     timestamptz NOT NULL DEFAULT now()
   )`,
  `ALTER TABLE lib_scopes ADD COLUMN IF NOT EXISTS last_success_at timestamptz`,
  `ALTER TABLE lib_scopes ADD COLUMN IF NOT EXISTS last_error_at timestamptz`,
  `ALTER TABLE lib_scopes ADD COLUMN IF NOT EXISTS consecutive_errors integer NOT NULL DEFAULT 0`,
  `ALTER TABLE lib_scopes ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0`,
  `ALTER TABLE lib_scopes ADD COLUMN IF NOT EXISTS retryable_count integer NOT NULL DEFAULT 0`,
  `ALTER TABLE lib_scopes ADD COLUMN IF NOT EXISTS oldest_pending_at timestamptz`,
  `ALTER TABLE lib_scopes ADD COLUMN IF NOT EXISTS oldest_retry_at timestamptz`,

  `CREATE TABLE IF NOT EXISTS lib_items (
     id                bigserial PRIMARY KEY,
     scope_id          text NOT NULL,
     provider          text NOT NULL,
     source_id         text NOT NULL,
     source_kind       text,
     name              text NOT NULL,
     norm_title        text,
     search_text       text,
     media_type        text,
     is_series         boolean NOT NULL DEFAULT false,
     is_anime          boolean NOT NULL DEFAULT false,
     year              integer,
     season            integer,
     episode           integer,
     season_start      integer,
     season_end        integer,
     episode_end       integer,
     size              bigint,
     source_updated_at timestamptz,
     source_created_at timestamptz,
     state             text,
     raw               jsonb NOT NULL,
     content_hash      text NOT NULL,
     match_status      text NOT NULL DEFAULT 'pending',
     match_attempts    integer NOT NULL DEFAULT 0,
     match_error       text,
     tmdb_id           integer,
     imdb_id           text,
     kitsu_id          text,
     match_meta        jsonb,
     first_seen_at     timestamptz NOT NULL DEFAULT now(),
     last_seen_at      timestamptz NOT NULL DEFAULT now(),
     synced_at         timestamptz,
     removed_at        timestamptz,
     UNIQUE (scope_id, provider, source_id)
   )`,

  `CREATE INDEX IF NOT EXISTS lib_items_scope_type_idx
     ON lib_items (scope_id, media_type, removed_at)`,
  `CREATE INDEX IF NOT EXISTS lib_items_match_idx
     ON lib_items (scope_id, match_status, removed_at)`,
  `CREATE INDEX IF NOT EXISTS lib_items_tmdb_idx
     ON lib_items (scope_id, tmdb_id)`,
  `CREATE INDEX IF NOT EXISTS lib_items_seen_idx
     ON lib_items (scope_id, last_seen_at)`,
  `CREATE INDEX IF NOT EXISTS lib_items_search_idx
     ON lib_items USING gin (to_tsvector('simple', coalesce(search_text, '')))`,
  `CREATE INDEX IF NOT EXISTS lib_items_catalog_fast_idx
     ON lib_items (scope_id, media_type, first_seen_at ASC)
     WHERE removed_at IS NULL AND match_status = 'matched'`,
  `CREATE INDEX IF NOT EXISTS lib_scopes_sync_idx
     ON lib_scopes (last_sync_at)`,

  // ── Identity / multi-source metadata layer ──────────────────────────────
  // entity_key links every library file of the same title to one canonical
  // identity row, so ids/metadata/episodes are never duplicated per download.
  `ALTER TABLE lib_items ADD COLUMN IF NOT EXISTS entity_key text`,
  `ALTER TABLE lib_items ADD COLUMN IF NOT EXISTS identity_status text NOT NULL DEFAULT 'pending'`,
  `ALTER TABLE lib_items ADD COLUMN IF NOT EXISTS identity_error text`,
  `ALTER TABLE lib_items ADD COLUMN IF NOT EXISTS search_alt text`,
  // Failed matches retry with backoff instead of freezing forever. The drain
  // claims failed rows whose retry time has come; saveMatch schedules it.
  `ALTER TABLE lib_items ADD COLUMN IF NOT EXISTS match_next_retry_at timestamptz`,
  // Resolver/table version that produced the match. A core or table change
  // re-queues stale rows once (see claimMatchJobs) so fixes heal without
  // manual resets; NULL means pre-versioning and always re-queues once.
  `ALTER TABLE lib_items ADD COLUMN IF NOT EXISTS match_version text`,
  `ALTER TABLE lib_scopes ADD COLUMN IF NOT EXISTS identity_version integer NOT NULL DEFAULT 0`,
  `UPDATE lib_scopes SET last_success_at = last_sync_at
     WHERE last_success_at IS NULL AND last_status = 'ok' AND last_sync_at IS NOT NULL`,
  `UPDATE lib_scopes SET last_error_at = last_sync_at
     WHERE last_error_at IS NULL AND last_status = 'error' AND last_sync_at IS NOT NULL`,
  `WITH queue AS (
     SELECT scope_id,
       count(*) FILTER (WHERE removed_at IS NULL)::int AS item_count,
       count(*) FILTER (WHERE removed_at IS NULL AND match_status = 'matched')::int AS matched_count,
       count(*) FILTER (WHERE removed_at IS NULL AND match_status IN ('pending','matching'))::int AS pending_count,
       count(*) FILTER (WHERE removed_at IS NOT NULL)::int AS removed_count,
       count(*) FILTER (WHERE removed_at IS NULL AND match_status = 'failed')::int AS failed_count,
       count(*) FILTER (WHERE removed_at IS NULL AND match_status = 'failed'
         AND (match_next_retry_at IS NULL OR match_next_retry_at <= now()))::int AS retryable_count,
       min(first_seen_at) FILTER (WHERE removed_at IS NULL AND match_status IN ('pending','matching')) AS oldest_pending_at,
       min(match_next_retry_at) FILTER (WHERE removed_at IS NULL AND match_status = 'failed'
         AND match_next_retry_at <= now()) AS oldest_retry_at
     FROM lib_items GROUP BY scope_id
   )
   UPDATE lib_scopes s SET item_count=q.item_count, matched_count=q.matched_count,
     pending_count=q.pending_count, removed_count=q.removed_count, failed_count=q.failed_count,
     retryable_count=q.retryable_count, oldest_pending_at=q.oldest_pending_at, oldest_retry_at=q.oldest_retry_at
   FROM queue q WHERE q.scope_id=s.scope_id`,
  // TorBox usenet/webdl rows are keyed "usenet:123" / "webdl:123" so they can
  // never collide with a torrent of the same id (see sourceIdOf). Rename rows
  // stored before that rule in place, keeping their matches. Idempotent.
  `UPDATE lib_items SET source_id = source_kind || ':' || source_id
     WHERE provider = 'torbox' AND source_kind IN ('usenet', 'webdl') AND position(':' in source_id) = 0`,
  `CREATE INDEX IF NOT EXISTS lib_items_identity_idx
     ON lib_items (scope_id, identity_status, removed_at)`,

  `CREATE TABLE IF NOT EXISTS lib_identities (
     entity_key         text PRIMARY KEY,
     media_type         text,
     tmdb_id            integer,
     imdb_id            text,
     tvdb_id            integer,
     kitsu_id           integer,
     anilist_id         integer,
     mal_id             integer,
     anidb_id           integer,
     title              text,
     canonical_title    text,
     alt_titles         jsonb NOT NULL DEFAULT '[]',
     year               integer,
     poster             text,
     background         text,
     logo               text,
     genres             jsonb NOT NULL DEFAULT '[]',
     status             text,
     episode_count      integer,
     metadata           jsonb NOT NULL DEFAULT '{}',
     metadata_provider  text,
     metadata_status    text,
     metadata_confidence integer,
     metadata_updated_at timestamptz,
     metadata_error     text,
     created_at         timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS lib_identities_tmdb_idx    ON lib_identities (tmdb_id)`,
  `CREATE INDEX IF NOT EXISTS lib_identities_imdb_idx    ON lib_identities (imdb_id)`,
  `CREATE INDEX IF NOT EXISTS lib_identities_tvdb_idx    ON lib_identities (tvdb_id)`,
  `CREATE INDEX IF NOT EXISTS lib_identities_kitsu_idx   ON lib_identities (kitsu_id)`,
  `CREATE INDEX IF NOT EXISTS lib_identities_anilist_idx ON lib_identities (anilist_id)`,
  `CREATE INDEX IF NOT EXISTS lib_identities_mal_idx     ON lib_identities (mal_id)`,

  `CREATE TABLE IF NOT EXISTS lib_episodes (
     entity_key  text NOT NULL,
     season      integer NOT NULL DEFAULT 0,
     episode     integer NOT NULL DEFAULT 0,
     absolute    integer,
     title       text,
     air_date    date,
     runtime     integer,
     overview    text,
     ids         jsonb NOT NULL DEFAULT '{}',
     provider    text,
     updated_at  timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (entity_key, season, episode)
   )`,
  // Vacuum/analyze frequently updated library rows before dead tuples and
  // stale planner stats accumulate. Defaults wait for ~20% table churn.
  `ALTER TABLE lib_items SET (
     autovacuum_vacuum_scale_factor = 0.05,
     autovacuum_analyze_scale_factor = 0.05
   )`,
  // The primary key already provides this exact lookup index.
  `DROP INDEX IF EXISTS lib_episodes_entity_idx`,
];

async function migrate() {
  const p = getPool();
  if (!p) return false;
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    for (const statement of MIGRATIONS) {
      await client.query(statement);
    }
    await client.query('COMMIT');
    schemaReady = true;
    lastSchemaError = null;
    return true;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    lastSchemaError = err.message;
    throw err;
  } finally {
    client.release();
  }
}

// Lazy, memoised schema setup. Never blocks startup: callers await it only when
// they are about to use the index.
function ensureSchema() {
  if (schemaReady) return Promise.resolve(true);
  if (!enabled()) return Promise.resolve(false);
  if (!schemaPromise) {
    schemaPromise = migrate().catch((err) => {
      schemaPromise = null; // allow a later retry (DB may come up after the app)
      console.error('[LibraryDB] migration failed:', err.message);
      return false;
    });
  }
  return schemaPromise;
}

async function isReady() {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

async function close() {
  if (pool) {
    const p = pool;
    pool = null;
    schemaReady = false;
    schemaPromise = null;
    try { await p.end(); } catch { /* ignore */ }
  }
}

export interface DbApi {
  enabled: any;
  getPool: any;
  ensureSchema: any;
  isReady: any;
  close: any;
}

module.exports = {
  enabled,
  getPool,
  poolStats,
  ensureSchema,
  isReady,
  close,
  getLastSchemaError: () => lastSchemaError,
} satisfies DbApi;
