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
     created_at     timestamptz NOT NULL DEFAULT now()
   )`,

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
  `CREATE INDEX IF NOT EXISTS lib_scopes_sync_idx
     ON lib_scopes (last_sync_at)`,

  // ── Identity / multi-source metadata layer ──────────────────────────────
  // entity_key links every library file of the same title to one canonical
  // identity row, so ids/metadata/episodes are never duplicated per download.
  `ALTER TABLE lib_items ADD COLUMN IF NOT EXISTS entity_key text`,
  `ALTER TABLE lib_items ADD COLUMN IF NOT EXISTS identity_status text NOT NULL DEFAULT 'pending'`,
  `ALTER TABLE lib_items ADD COLUMN IF NOT EXISTS identity_error text`,
  `ALTER TABLE lib_items ADD COLUMN IF NOT EXISTS search_alt text`,
  `ALTER TABLE lib_scopes ADD COLUMN IF NOT EXISTS identity_version integer NOT NULL DEFAULT 0`,
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
  `CREATE INDEX IF NOT EXISTS lib_episodes_entity_idx ON lib_episodes (entity_key, season, episode)`,
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

module.exports = {
  enabled,
  getPool,
  ensureSchema,
  isReady,
  close,
  getLastSchemaError: () => lastSchemaError,
};
