// @ts-nocheck
// Postgres store for the index-first library engine. All writes are batched and
// only touch new/changed rows, so an unchanged library costs one read + zero
// per-item writes per sync.
const db = require('./db.ts');
const { recordKey, normalizeTitle, buildRecord } = require('./diff.ts');
const { matchVersion, retryVersion, MAX_MATCH_ATTEMPTS } = require('../matching/resolve.ts');

// Mass-removal guard state: scopeId -> { fp, strikes }. A partial provider
// snapshot (dropped page, flaky endpoint) must never wipe the local index, but
// a genuine user bulk-delete must still take effect once the snapshot agrees
// with itself a few syncs in a row. In-memory only: after a restart the guard
// is conservative again, which is the safe direction.
const massRemovalStrikes = new Map();
// Pure decision step of the mass-removal guard, exported for unit tests.
// Returns { apply, strikes }: apply=false means "refuse this sync, keep rows".
function massRemovalDecision(scopeId, removedCount, liveCount, fp) {
  if (!(removedCount > 10 && liveCount > 0 && removedCount > liveCount * 0.1)) {
    massRemovalStrikes.delete(scopeId);
    return { apply: true, strikes: 0 };
  }
  const prev = massRemovalStrikes.get(scopeId);
  const strikes = prev && prev.fp === fp ? prev.n + 1 : 1;
  if (strikes >= 3) {
    massRemovalStrikes.delete(scopeId);
    return { apply: true, strikes };
  }
  if (massRemovalStrikes.size > 1000) massRemovalStrikes.clear();
  massRemovalStrikes.set(scopeId, { fp, n: strikes });
  return { apply: false, strikes };
}

const WRITE_CHUNK = 250;
const INSERT_COLUMNS = [
  'scope_id', 'provider', 'source_id', 'source_kind', 'name', 'norm_title', 'search_text',
  'media_type', 'is_series', 'is_anime', 'year', 'season', 'episode', 'season_start',
  'season_end', 'episode_end', 'size', 'source_updated_at', 'source_created_at', 'state',
  'raw', 'content_hash',
];
// Used in the upsert to preserve a successful match when old and new provider
// records parse to the same source identity, even if matching previously
// rewrote the display/classification columns to canonical TMDB values.
const PRESERVE_MATCH_SQL = `EXISTS (
  SELECT 1 FROM ll_sync_stage preserve_row
   WHERE preserve_row.provider=EXCLUDED.provider
     AND preserve_row.source_id=EXCLUDED.source_id
     AND preserve_row.preserve_match
)`;

function toTimestamp(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function ensure() {
  const ok = await db.ensureSchema();
  if (!ok) throw new Error('library database unavailable');
  return db.getPool();
}

async function listScopes() {
  const pool = db.getPool();
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT scope_id, provider, config_token, last_sync_at, last_status, last_error,
            item_count, matched_count, pending_count, removed_count, last_sync_ms, identity_version,
            last_success_at, last_error_at, consecutive_errors, failed_count, retryable_count,
            oldest_pending_at, oldest_retry_at
       FROM lib_scopes ORDER BY last_seen_at DESC`
  );
  return rows;
}

async function getScope(scopeId) {
  const pool = db.getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT scope_id, provider, config_token, last_sync_at, last_sync_ms, last_status, last_error,
            item_count, matched_count, pending_count, removed_count,
            last_added, last_changed, last_removed, last_unchanged, identity_version,
            last_success_at, last_error_at, consecutive_errors, failed_count, retryable_count,
            oldest_pending_at, oldest_retry_at
       FROM lib_scopes WHERE scope_id = $1`,
    [scopeId]
  );
  return rows[0] || null;
}

async function touchScope(scopeId, { provider = null, configToken = null } = {}) {
  const pool = await ensure();
  await pool.query(
    `INSERT INTO lib_scopes (scope_id, provider, config_token, last_seen_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (scope_id) DO UPDATE SET
       last_seen_at = now(),
       provider = COALESCE(EXCLUDED.provider, lib_scopes.provider),
       config_token = CASE WHEN EXCLUDED.config_token IS NOT NULL THEN EXCLUDED.config_token
                           ELSE lib_scopes.config_token END`,
    [scopeId, provider, configToken]
  );
}

async function markScopeSyncing(scopeId) {
  const pool = await ensure();
  await pool.query(
    `UPDATE lib_scopes SET last_status = 'syncing' WHERE scope_id = $1`,
    [scopeId]
  );
}

async function markScopeResult(scopeId, { status, error = null, durationMs = 0, counts = {}, totals = {} }) {
  const pool = await ensure();
  await pool.query(
    `UPDATE lib_scopes SET
        last_sync_at = now(),
        last_sync_ms = $2,
        last_status = $3,
        last_error = CASE WHEN $3 = 'error' THEN $4 ELSE NULL END,
        last_error_at = CASE WHEN $3 = 'error' THEN now() ELSE last_error_at END,
        last_success_at = CASE WHEN $3 = 'ok' THEN now() ELSE last_success_at END,
        consecutive_errors = CASE WHEN $3 = 'error' THEN consecutive_errors + 1 ELSE 0 END,
        provider = COALESCE($5, provider),
        item_count = COALESCE($6, item_count),
        matched_count = COALESCE($7, matched_count),
        pending_count = COALESCE($8, pending_count),
        removed_count = COALESCE($9, removed_count),
        last_added = COALESCE($10, last_added),
        last_changed = COALESCE($11, last_changed),
        last_removed = COALESCE($12, last_removed),
        last_unchanged = COALESCE($13, last_unchanged),
        failed_count = COALESCE($14, failed_count),
        retryable_count = COALESCE($15, retryable_count),
        oldest_pending_at = CASE WHEN $3 = 'ok' THEN $16::timestamptz ELSE oldest_pending_at END,
        oldest_retry_at = CASE WHEN $3 = 'ok' THEN $17::timestamptz ELSE oldest_retry_at END
     WHERE scope_id = $1`,
    [
      scopeId, Math.round(durationMs) || 0, status, error, totals.provider || null,
      totals.item_count, totals.matched_count, totals.pending_count, totals.removed_count,
      counts.added, counts.changed, counts.removed, counts.unchanged,
      totals.failed_count, totals.retryable_count, totals.oldest_pending_at, totals.oldest_retry_at,
    ]
  );
}

async function resetStuckMatches() {
  const pool = db.getPool();
  if (!pool) return 0;
  const { rowCount } = await pool.query(
    `UPDATE lib_items SET match_status = 'pending' WHERE match_status = 'matching'`
  );
  return rowCount || 0;
}

// A matcher worker can fail after its claim (for example, a transient
// Postgres timeout while saving the result). Return only those claimed rows to
// the queue so they do not disappear from catalogs until the periodic repair.
async function releaseMatchJobs(scopeId, ids) {
  const pool = db.getPool();
  if (!pool || !Array.isArray(ids) || ids.length === 0) return 0;
  const { rowCount } = await pool.query(
    `UPDATE lib_items
        SET match_status='pending', match_attempts=GREATEST(match_attempts - 1, 0)
      WHERE scope_id=$1 AND id=ANY($2::bigint[]) AND match_status='matching'`,
    [scopeId, ids]
  );
  return rowCount || 0;
}

// One-shot repair for split-season matches stored before canonicalSource
// existed: those rows carry the PRE-split tmdbId with the POST-split season
// (e.g. 11294/S10 instead of 235884/S03), so their episodes filter against
// an entry that never had them. Any matched row whose (tmdb_id, season) the
// table maps elsewhere is re-pended once; the fixed matcher then stores the
// right entry. Future matches are correct at write time, so this converges
// to zero and stays there.
async function requeueSplitMismatches() {
  const pool = db.getPool();
  if (!pool) return 0;
  const { lookupSplitSeason } = require('../matching/tables.ts');
  const { rows } = await pool.query(
    `SELECT id, tmdb_id, season FROM lib_items
      WHERE removed_at IS NULL AND match_status = 'matched'
        AND tmdb_id IS NOT NULL AND season IS NOT NULL`
  );
  const bad = [];
  for (const row of rows) {
    let target = null;
    try { target = lookupSplitSeason(row.tmdb_id, row.season); } catch { target = null; }
    if (target && Number(target.tmdbId) !== Number(row.tmdb_id)) bad.push(row.id);
  }
  for (let offset = 0; offset < bad.length; offset += 500) {
    const chunk = bad.slice(offset, offset + 500);
    await pool.query(
      `UPDATE lib_items SET match_status = 'pending', match_attempts = 0, match_error = NULL
        WHERE id = ANY($1::bigint[])`,
      [chunk]
    );
  }
  return bad.length;
}

// A matched row keeps its stored numbering while its provider record is
// unchanged (see reconcile's preserve_match), so a parser fix that newly reads
// a season range ("S1.S9") would never reach it. Re-queue matched series rows
// whose current source parse finds a range the stored row lacks; the matcher
// re-parses the name and writes the range through the normal match path.
async function requeueReparsedSeasonRanges() {
  const pool = db.getPool();
  if (!pool) return 0;
  const { rows } = await pool.query(
    `SELECT id, source_id, raw FROM lib_items
      WHERE removed_at IS NULL AND match_status = 'matched' AND is_series
        AND season_start IS NULL AND episode IS NULL`
  );
  const stale = [];
  for (const row of rows) {
    let parsed = null;
    try { parsed = buildRecord(row.raw, row.source_id); } catch { parsed = null; }
    if (parsed && parsed.season_start != null && parsed.season_end != null && parsed.season_end > parsed.season_start) stale.push(row.id);
  }
  for (let offset = 0; offset < stale.length; offset += 500) {
    await pool.query(
      `UPDATE lib_items SET match_status = 'pending', match_attempts = 0, match_error = NULL
        WHERE id = ANY($1::bigint[])`,
      [stale.slice(offset, offset + 500)]
    );
  }
  return stale.length;
}

// Move over-budget failures to the existing `skipped` terminal state. Keep
// match_error and match_version intact so diagnostics remain visible and a
// later retry-version change can wake the row. No identity fields are touched.
async function terminalizeExhaustedMatches(scopeId = null) {
  const pool = db.getPool();
  if (!pool) return 0;
  const params = [MAX_MATCH_ATTEMPTS, retryVersion()];
  const scopeFilter = scopeId == null ? '' : `AND scope_id=$3`;
  if (scopeId != null) params.push(scopeId);
  const { rows } = await pool.query(
    `UPDATE lib_items SET match_status='skipped', match_next_retry_at=NULL, match_version=$2
      WHERE removed_at IS NULL AND match_status='failed'
        AND match_error IS NOT NULL AND match_attempts >= $1
        ${scopeFilter}
      RETURNING scope_id`,
    params
  );
  const scopeIds = [...new Set(rows.map((row) => row.scope_id))];
  for (const scopeId of scopeIds) {
    const totals = await counts(scopeId);
    await markQueueStats(scopeId, totals);
  }
  return rows.length;
}

// Explicit operator escape hatch. `itemId` is an internal lib_items key,
// scoped by the caller's resolved config; no provider identifier is accepted.
// Preserve the previous reason until the new attempt records its outcome.
async function requeueFailedMatches(scopeId, itemId = null) {
  const pool = await ensure();
  const params = [scopeId, retryVersion()];
  let itemFilter = '';
  if (itemId != null) {
    params.push(itemId);
    itemFilter = `AND id=$${params.length}`;
  }
  const { rowCount } = await pool.query(
    `UPDATE lib_items SET match_status='pending', match_attempts=0,
        match_next_retry_at=NULL, match_version=$2
      WHERE scope_id=$1 AND removed_at IS NULL
        AND (match_status='failed' OR (match_status='skipped' AND match_error IS NOT NULL))
        ${itemFilter}`,
    params
  );
  const totals = await counts(scopeId);
  await markQueueStats(scopeId, totals);
  return rowCount || 0;
}

async function failedMatchRows(scopeId, limit = 500) {
  const pool = db.getPool();
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT id,
       CASE
         WHEN match_error LIKE 'no-candidate%' THEN 'no-candidate'
         WHEN match_error LIKE 'unparseable%' THEN 'unparseable'
         WHEN match_error LIKE 'ambiguous-candidate%' THEN 'ambiguous-candidate'
         WHEN match_error LIKE 'season-related%' OR match_error LIKE 'missing-season%' THEN 'season-related'
         WHEN match_error LIKE 'search-unavailable%' OR match_error LIKE 'lookup-error%' THEN 'search-unavailable'
         ELSE 'other'
       END AS reason,
       match_attempts AS attempts,
       (match_status='skipped') AS terminal,
       match_next_retry_at AS next_retry_at
      FROM lib_items
      WHERE scope_id=$1 AND removed_at IS NULL
        AND (match_status='failed' OR (match_status='skipped' AND match_error IS NOT NULL))
      ORDER BY match_attempts DESC, id ASC LIMIT $2`,
    [scopeId, Math.max(1, Math.min(500, Number.parseInt(limit, 10) || 500))]
  );
  return rows;
}

// Reconcile a provider snapshot against the local index. Only new/changed rows
// are written; unchanged rows are left untouched; rows no longer present are
// soft-deleted. Returns the diff counts.
async function reconcile(scopeId, records) {
  const pool = await ensure();
  const started = Date.now();
  const client = await pool.connect();
  const incoming = Array.isArray(records) ? records : [];
  const seenKeys = new Set();
  const counts = { scanned: (records || []).length, added: 0, changed: 0, removed: 0, unchanged: 0,
    duplicates: 0 };
  try {
    await client.query('BEGIN');
    // Serialise concurrent refreshes for the same scope, including across app processes.
    await client.query('SELECT pg_advisory_xact_lock(741, hashtext($1))', [scopeId]);
    await client.query(`CREATE TEMP TABLE ll_sync_stage ON COMMIT DROP AS
      SELECT ${INSERT_COLUMNS.join(', ')} FROM lib_items WITH NO DATA`);
    await client.query(`ALTER TABLE ll_sync_stage ADD COLUMN preserve_match boolean NOT NULL DEFAULT false`);
    await client.query('CREATE UNIQUE INDEX ll_sync_stage_key_idx ON ll_sync_stage (provider, source_id)');

    for (let end = incoming.length; end > 0; end -= WRITE_CHUNK) {
      const chunk = [];
      // Walk newest-to-oldest so duplicate provider keys retain the previous
      // last-record-wins behavior without holding a Map of every raw record.
      for (let i = end - 1; i >= Math.max(0, end - WRITE_CHUNK); i--) {
        const record = incoming[i];
        const key = recordKey(record);
        if (seenKeys.has(key)) { counts.duplicates++; continue; }
        seenKeys.add(key);
        chunk.push(record);
      }
      if (!chunk.length) continue;
      const tuples = [];
      const params = [];
      let p = 1;
      for (const r of chunk) {
        tuples.push(`(${INSERT_COLUMNS.map(() => `$${p++}`).join(', ')})`);
        params.push(scopeId, r.provider, r.source_id, r.source_kind, r.name, r.norm_title, r.search_text,
          r.media_type, r.is_series, r.is_anime, r.year, r.season, r.episode, r.season_start,
          r.season_end, r.episode_end, r.size, toTimestamp(r.source_updated_at),
          toTimestamp(r.source_created_at), r.state, JSON.stringify(r.raw), r.content_hash);
      }
      await client.query(`INSERT INTO ll_sync_stage (${INSERT_COLUMNS.join(', ')}) VALUES ${tuples.join(',')}`, params);
    }
    await client.query('ANALYZE ll_sync_stage');

    // Matcher output is canonical and can differ from the original filename
    // parse (for example split seasons or inferred media type). Compare raw
    // records through the same source parser before deciding that a changed
    // provider snapshot needs another TMDB match. Only inspect existing,
    // successful rows that otherwise differ in the staged reconciliation.
    const { rows: matchCandidates } = await client.query(
      `SELECT i.id, i.raw AS previous_raw, s.raw AS incoming_raw, s.source_id
         FROM ll_sync_stage s JOIN lib_items i
           ON i.scope_id=s.scope_id AND i.provider=s.provider AND i.source_id=s.source_id
        WHERE i.removed_at IS NULL AND i.match_status='matched'
          AND (i.content_hash IS DISTINCT FROM s.content_hash
            OR i.norm_title IS DISTINCT FROM s.norm_title OR i.media_type IS DISTINCT FROM s.media_type
            OR i.is_series IS DISTINCT FROM s.is_series OR i.is_anime IS DISTINCT FROM s.is_anime
            OR i.year IS DISTINCT FROM s.year OR i.season IS DISTINCT FROM s.season
            OR i.season_start IS DISTINCT FROM s.season_start OR i.season_end IS DISTINCT FROM s.season_end
            OR i.episode IS DISTINCT FROM s.episode OR i.episode_end IS DISTINCT FROM s.episode_end)`
    );
    const preserveMatchIds = [];
    const sameSourceIdentity = (a, b) => ['norm_title', 'media_type', 'is_series', 'is_anime', 'year',
      'season', 'season_start', 'season_end', 'episode', 'episode_end']
      .every((key) => (a[key] ?? null) === (b[key] ?? null));
    for (const row of matchCandidates) {
      const before = buildRecord(row.previous_raw, row.source_id);
      const after = buildRecord(row.incoming_raw, row.source_id);
      if (sameSourceIdentity(before, after)) preserveMatchIds.push(Number(row.id));
    }
    if (preserveMatchIds.length) {
      await client.query(
        `UPDATE ll_sync_stage s SET preserve_match=true
          FROM lib_items i WHERE i.scope_id=s.scope_id AND i.provider=s.provider AND i.source_id=s.source_id
            AND i.id=ANY($1::bigint[])`, [preserveMatchIds]
      );
    }
    counts.matchPreserved = preserveMatchIds.length;

    const { rows: diffRows } = await client.query(
      `SELECT count(*) FILTER (WHERE i.id IS NULL)::int AS added,
              count(*) FILTER (WHERE i.id IS NOT NULL AND
                (i.content_hash IS DISTINCT FROM s.content_hash OR i.removed_at IS NOT NULL
                 OR (NOT s.preserve_match AND (
                   i.norm_title IS DISTINCT FROM s.norm_title OR i.media_type IS DISTINCT FROM s.media_type
                   OR i.is_series IS DISTINCT FROM s.is_series OR i.is_anime IS DISTINCT FROM s.is_anime
                   OR i.year IS DISTINCT FROM s.year OR i.season IS DISTINCT FROM s.season
                   OR i.episode IS DISTINCT FROM s.episode OR i.season_start IS DISTINCT FROM s.season_start
                   OR i.season_end IS DISTINCT FROM s.season_end OR i.episode_end IS DISTINCT FROM s.episode_end
                 ))))::int AS changed,
              count(*) FILTER (WHERE i.id IS NOT NULL AND i.content_hash = s.content_hash
                AND i.removed_at IS NULL AND (s.preserve_match OR (
                  i.norm_title IS NOT DISTINCT FROM s.norm_title AND i.media_type IS NOT DISTINCT FROM s.media_type
                  AND i.is_series IS NOT DISTINCT FROM s.is_series AND i.is_anime IS NOT DISTINCT FROM s.is_anime
                  AND i.year IS NOT DISTINCT FROM s.year AND i.season IS NOT DISTINCT FROM s.season
                  AND i.episode IS NOT DISTINCT FROM s.episode AND i.season_start IS NOT DISTINCT FROM s.season_start
                  AND i.season_end IS NOT DISTINCT FROM s.season_end AND i.episode_end IS NOT DISTINCT FROM s.episode_end
                )))::int AS unchanged
              ,count(*) FILTER (WHERE i.id IS NOT NULL AND i.name IS DISTINCT FROM s.name)::int AS name_changed
              ,count(*) FILTER (WHERE i.id IS NOT NULL AND i.norm_title IS DISTINCT FROM s.norm_title)::int AS title_changed
              ,count(*) FILTER (WHERE i.id IS NOT NULL AND i.media_type IS DISTINCT FROM s.media_type)::int AS type_changed
              ,count(*) FILTER (WHERE i.id IS NOT NULL AND (i.year IS DISTINCT FROM s.year OR i.season IS DISTINCT FROM s.season
                OR i.season_start IS DISTINCT FROM s.season_start OR i.season_end IS DISTINCT FROM s.season_end
                OR i.episode IS DISTINCT FROM s.episode OR i.episode_end IS DISTINCT FROM s.episode_end))::int AS numbering_changed
         FROM ll_sync_stage s LEFT JOIN lib_items i
           ON i.scope_id = s.scope_id AND i.provider = s.provider AND i.source_id = s.source_id`,
      []
    );
    Object.assign(counts, diffRows[0] || {});

    const { rows: removeRows } = await client.query(
      `SELECT count(*)::int AS removed,
              (SELECT count(*)::int FROM lib_items WHERE scope_id = $1 AND removed_at IS NULL) AS live_count,
              md5(coalesce(string_agg(provider || chr(1) || source_id, ' ' ORDER BY provider, source_id), '')) AS fingerprint
         FROM lib_items i
        WHERE i.scope_id = $1 AND i.removed_at IS NULL AND NOT EXISTS (
          SELECT 1 FROM ll_sync_stage s WHERE s.provider = i.provider AND s.source_id = i.source_id
        )`, [scopeId]
    );
    const removal = removeRows[0] || { removed: 0, live_count: 0, fingerprint: '' };
    const removedCount = Number(removal.removed || 0);
    counts.removed = removedCount;
    const decision = massRemovalDecision(scopeId, removedCount, Number(removal.live_count || 0), removal.fingerprint);
    if (!decision.apply) {
      console.warn(`[Library] ${scopeId}: refusing to remove ${removedCount}/${removal.live_count} items in one sync (strike ${decision.strikes}/3), keeping rows`);
      counts.removed = 0;
    } else if (decision.strikes >= 3) {
      console.warn(`[Library] ${scopeId}: mass removal confirmed ${decision.strikes}x running, applying ${removedCount}/${removal.live_count} removals`);
    }

    await client.query(
      `INSERT INTO lib_items (${INSERT_COLUMNS.join(', ')}, match_status, match_attempts, match_meta,
          tmdb_id, imdb_id, removed_at, synced_at)
       SELECT ${INSERT_COLUMNS.join(', ')}, 'pending', 0, NULL, NULL, NULL, NULL, now() FROM ll_sync_stage
       ON CONFLICT (scope_id, provider, source_id) DO UPDATE SET
         source_kind=EXCLUDED.source_kind, name=EXCLUDED.name,
         norm_title=CASE WHEN (${PRESERVE_MATCH_SQL}) THEN lib_items.norm_title ELSE EXCLUDED.norm_title END,
         search_text=EXCLUDED.search_text,
         media_type=CASE WHEN (${PRESERVE_MATCH_SQL}) THEN lib_items.media_type ELSE EXCLUDED.media_type END,
         is_series=CASE WHEN (${PRESERVE_MATCH_SQL}) THEN lib_items.is_series ELSE EXCLUDED.is_series END,
         is_anime=CASE WHEN (${PRESERVE_MATCH_SQL}) THEN lib_items.is_anime ELSE EXCLUDED.is_anime END,
         year=CASE WHEN (${PRESERVE_MATCH_SQL}) THEN lib_items.year ELSE EXCLUDED.year END,
         season=CASE WHEN (${PRESERVE_MATCH_SQL}) THEN lib_items.season ELSE EXCLUDED.season END,
         episode=CASE WHEN (${PRESERVE_MATCH_SQL}) THEN lib_items.episode ELSE EXCLUDED.episode END,
         season_start=CASE WHEN (${PRESERVE_MATCH_SQL}) THEN lib_items.season_start ELSE EXCLUDED.season_start END,
         season_end=CASE WHEN (${PRESERVE_MATCH_SQL}) THEN lib_items.season_end ELSE EXCLUDED.season_end END,
         episode_end=CASE WHEN (${PRESERVE_MATCH_SQL}) THEN lib_items.episode_end ELSE EXCLUDED.episode_end END,
         size=EXCLUDED.size, source_updated_at=EXCLUDED.source_updated_at, source_created_at=EXCLUDED.source_created_at,
         state=EXCLUDED.state, raw=EXCLUDED.raw, content_hash=EXCLUDED.content_hash,
         match_status=CASE WHEN lib_items.match_status='matched' AND (${PRESERVE_MATCH_SQL}) THEN lib_items.match_status ELSE 'pending' END,
         match_attempts=CASE WHEN lib_items.match_status='matched' AND (${PRESERVE_MATCH_SQL}) THEN lib_items.match_attempts ELSE 0 END,
         match_error=CASE WHEN lib_items.match_status='matched' AND (${PRESERVE_MATCH_SQL}) THEN lib_items.match_error ELSE NULL END,
         match_meta=CASE WHEN lib_items.match_status='matched' AND (${PRESERVE_MATCH_SQL}) THEN lib_items.match_meta ELSE NULL END,
         tmdb_id=CASE WHEN lib_items.match_status='matched' AND (${PRESERVE_MATCH_SQL}) THEN lib_items.tmdb_id ELSE NULL END,
         imdb_id=CASE WHEN lib_items.match_status='matched' AND (${PRESERVE_MATCH_SQL}) THEN lib_items.imdb_id ELSE NULL END,
         match_version=CASE WHEN lib_items.match_status='matched' AND (${PRESERVE_MATCH_SQL}) THEN lib_items.match_version ELSE NULL END,
         match_next_retry_at=CASE WHEN lib_items.match_status='matched' AND (${PRESERVE_MATCH_SQL}) THEN lib_items.match_next_retry_at ELSE NULL END,
         removed_at=NULL,
         identity_status=CASE WHEN lib_items.match_status='matched' AND (${PRESERVE_MATCH_SQL}) THEN lib_items.identity_status ELSE 'pending' END,
         entity_key=CASE WHEN lib_items.match_status='matched' AND (${PRESERVE_MATCH_SQL}) THEN lib_items.entity_key ELSE NULL END,
         identity_error=CASE WHEN lib_items.match_status='matched' AND (${PRESERVE_MATCH_SQL}) THEN lib_items.identity_error ELSE NULL END,
         search_alt=CASE WHEN lib_items.match_status='matched' AND (${PRESERVE_MATCH_SQL}) THEN lib_items.search_alt ELSE NULL END,
         last_seen_at=now(), synced_at=now()
       WHERE lib_items.content_hash IS DISTINCT FROM EXCLUDED.content_hash OR lib_items.removed_at IS NOT NULL
          OR (NOT (${PRESERVE_MATCH_SQL}) AND (
            lib_items.norm_title IS DISTINCT FROM EXCLUDED.norm_title
            OR lib_items.media_type IS DISTINCT FROM EXCLUDED.media_type
            OR lib_items.is_series IS DISTINCT FROM EXCLUDED.is_series
            OR lib_items.is_anime IS DISTINCT FROM EXCLUDED.is_anime
            OR lib_items.year IS DISTINCT FROM EXCLUDED.year
            OR lib_items.season IS DISTINCT FROM EXCLUDED.season
            OR lib_items.episode IS DISTINCT FROM EXCLUDED.episode
            OR lib_items.season_start IS DISTINCT FROM EXCLUDED.season_start
            OR lib_items.season_end IS DISTINCT FROM EXCLUDED.season_end
            OR lib_items.episode_end IS DISTINCT FROM EXCLUDED.episode_end
          ))`
    );
    if (decision.apply && removedCount) {
      await client.query(
        `UPDATE lib_items i SET removed_at=now(), match_status='skipped'
          WHERE i.scope_id=$1 AND i.removed_at IS NULL AND NOT EXISTS (
            SELECT 1 FROM ll_sync_stage s WHERE s.provider=i.provider AND s.source_id=i.source_id
          )`, [scopeId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* transaction may already be aborted */ }
    massRemovalStrikes.delete(scopeId);
    throw err;
  } finally {
    client.release();
  }
  counts.durationMs = Date.now() - started;
  return counts;
}

async function counts(scopeId) {
  const pool = db.getPool();
  if (!pool) return null;
  const version = matchVersion();
  const retry = retryVersion();
  const { rows } = await pool.query(
    `SELECT
        count(*) FILTER (WHERE removed_at IS NULL) AS item_count,
        count(*) FILTER (WHERE removed_at IS NULL AND match_status = 'matched') AS matched_count,
        count(*) FILTER (WHERE removed_at IS NULL AND match_status IN ('pending','matching')) AS pending_count,
        count(*) FILTER (WHERE removed_at IS NOT NULL) AS removed_count,
        count(*) FILTER (WHERE removed_at IS NULL AND (match_status = 'failed'
          OR (match_status = 'skipped' AND match_error IS NOT NULL))) AS failed_count,
        count(*) FILTER (WHERE removed_at IS NULL AND match_status = 'failed'
          AND (match_version IS DISTINCT FROM $3
            OR match_next_retry_at IS NULL OR match_next_retry_at <= now())) AS retryable_count,
        count(*) FILTER (WHERE removed_at IS NULL AND match_status = 'skipped'
          AND match_error IS NOT NULL AND match_version IS DISTINCT FROM $3) AS stale_terminal_count,
        count(*) FILTER (WHERE removed_at IS NULL AND match_status = 'matched'
          AND (match_version IS NULL OR match_version <> $2)) AS stale_count,
        min(first_seen_at) FILTER (WHERE removed_at IS NULL AND match_status IN ('pending','matching')) AS oldest_pending_at,
        min(CASE WHEN match_status = 'skipped' OR match_version IS DISTINCT FROM $3
          THEN now() ELSE match_next_retry_at END)
          FILTER (WHERE removed_at IS NULL AND (
            (match_status = 'failed' AND (match_version IS DISTINCT FROM $3
              OR match_next_retry_at IS NULL OR match_next_retry_at <= now()))
            OR (match_status = 'skipped' AND match_error IS NOT NULL AND match_version IS DISTINCT FROM $3)
          )) AS oldest_retry_at
     FROM lib_items WHERE scope_id = $1`,
    [scopeId, version, retry]
  );
  const row = rows[0] || {};
  return {
    item_count: Number(row.item_count || 0),
    matched_count: Number(row.matched_count || 0),
    pending_count: Number(row.pending_count || 0),
    removed_count: Number(row.removed_count || 0),
    failed_count: Number(row.failed_count || 0),
    retryable_count: Number(row.retryable_count || 0) + Number(row.stale_terminal_count || 0),
    stale_count: Number(row.stale_count || 0),
    oldest_pending_at: row.oldest_pending_at || null,
    oldest_retry_at: row.oldest_retry_at || null,
  };
}

async function markQueueStats(scopeId, totals) {
  const pool = db.getPool();
  if (!pool || !totals) return;
  await pool.query(
    `UPDATE lib_scopes SET pending_count=$2, failed_count=$3, retryable_count=$4,
       oldest_pending_at=$5, oldest_retry_at=$6 WHERE scope_id=$1`,
    [scopeId, totals.pending_count || 0, totals.failed_count || 0, totals.retryable_count || 0,
      totals.oldest_pending_at, totals.oldest_retry_at]
  );
}

async function aggregateQueueStats() {
  const pool = db.getPool();
  if (!pool) return null;
  const retry = retryVersion();
  const { rows } = await pool.query(
    `SELECT count(DISTINCT s.scope_id)::int AS scopes,
            count(i.id) FILTER (WHERE i.removed_at IS NULL AND i.match_status IN ('pending','matching'))::int AS pending_count,
            count(i.id) FILTER (WHERE i.removed_at IS NULL AND (i.match_status = 'failed'
              OR (i.match_status = 'skipped' AND i.match_error IS NOT NULL)))::int AS failed_count,
            count(i.id) FILTER (WHERE i.removed_at IS NULL AND i.match_status = 'failed'
              AND (i.match_version IS DISTINCT FROM $1 OR i.match_next_retry_at IS NULL
                OR i.match_next_retry_at <= now()))::int AS retryable_failed_count,
            count(i.id) FILTER (WHERE i.removed_at IS NULL AND i.match_status = 'skipped'
              AND i.match_error IS NOT NULL AND i.match_version IS DISTINCT FROM $1)::int AS retryable_terminal_count,
            coalesce(max(s.consecutive_errors),0)::int AS consecutive_errors,
            count(DISTINCT s.scope_id) FILTER (WHERE s.consecutive_errors > 0)::int AS error_scopes,
            max(s.last_success_at) AS last_success_at,
            max(s.last_error_at) AS last_error_at,
            min(i.first_seen_at) FILTER (WHERE i.removed_at IS NULL AND i.match_status IN ('pending','matching')) AS oldest_pending_at,
            min(CASE WHEN i.match_status='skipped' THEN now() ELSE i.match_next_retry_at END)
              FILTER (WHERE i.removed_at IS NULL AND (
                (i.match_status='failed' AND (i.match_version IS DISTINCT FROM $1
                  OR i.match_next_retry_at IS NULL OR i.match_next_retry_at <= now()))
                OR (i.match_status='skipped' AND i.match_error IS NOT NULL AND i.match_version IS DISTINCT FROM $1)
              )) AS oldest_retry_at
       FROM lib_scopes s
       LEFT JOIN lib_items i ON i.scope_id = s.scope_id`,
    [retry]
  );
  const row = rows[0] || {};
  const ageSeconds = (value) => value ? Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000)) : null;
  return {
    scopes: Number(row.scopes || 0), pending: Number(row.pending_count || 0),
    failed: Number(row.failed_count || 0),
    retryable: Number(row.retryable_failed_count || 0) + Number(row.retryable_terminal_count || 0),
    consecutiveErrors: Number(row.consecutive_errors || 0), errorScopes: Number(row.error_scopes || 0),
    lastSuccessAt: row.last_success_at || null, lastErrorAt: row.last_error_at || null,
    oldestPendingAt: row.oldest_pending_at || null, oldestPendingAgeSeconds: ageSeconds(row.oldest_pending_at),
    oldestRetryAt: row.oldest_retry_at || null, retryOverdueSeconds: ageSeconds(row.oldest_retry_at),
  };
}

async function claimMatchJobs(scopeId, limit) {
  const pool = await ensure();
  // Newest items match first: a fresh download jumps the queue and shows up
  // within a sync or two even while an old backlog is still draining. Starving
  // old rows is impossible in practice (users never add 50+ items per pass).
  const { rows } = await pool.query(
    `UPDATE lib_items SET match_status = 'matching',
        match_attempts = CASE
          WHEN match_status IN ('failed','skipped') AND match_version IS DISTINCT FROM $3 THEN 1
          ELSE match_attempts + 1
        END
      WHERE id IN (
        SELECT id FROM lib_items
         WHERE scope_id = $1 AND removed_at IS NULL
           AND (match_status = 'pending'
             OR (match_status = 'failed'
               AND (match_version IS DISTINCT FROM $3
                 OR match_next_retry_at IS NULL OR match_next_retry_at <= now()))
             OR (match_status = 'skipped' AND match_error IS NOT NULL
               AND match_version IS DISTINCT FROM $3)
             OR (match_status = 'matched'
               AND (match_version IS NULL OR match_version <> $4)))
         -- Fresh work first, then due retries, then version-stale
         -- re-resolves last: a migration wave must never block new content
         -- or stampede TMDB behind it.
         ORDER BY
           CASE WHEN match_status = 'pending' THEN 0
                WHEN match_status IN ('failed','skipped') THEN 1
                ELSE 2 END,
           first_seen_at DESC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, provider, source_id, raw, media_type, is_series, is_anime, name, season, episode`,
    [scopeId, Math.max(1, limit), retryVersion(), matchVersion()]
  );
  return rows;
}

async function saveMatch(id, { status, tmdbId = null, imdbId = null, matchMeta = null, error = null, version = null, classification = null }) {
  const pool = await ensure();
  // Failed matches use exponential backoff (permanent misses: 1, 2, 4...24h;
  // upstream errors: 5, 10, 20...320m) and stop after the attempt budget.
  // Matched rows clear any scheduled retry. The deciding retry version lets
  // a later resolver/policy change re-queue terminal rows exactly once.
  await pool.query(
    `UPDATE lib_items SET
        match_status = CASE WHEN $2 = 'failed' AND match_attempts >= $16 THEN 'skipped' ELSE $2 END,
        tmdb_id = $3,
        imdb_id = $4,
        match_meta = $5,
        match_error = $6,
        match_version = $7,
        media_type = COALESCE($8, media_type),
        is_series = CASE WHEN $8 IS NULL THEN is_series ELSE $8 IN ('series','anime') END,
        is_anime = CASE WHEN $8 IS NULL THEN is_anime ELSE $8 = 'anime' END,
        norm_title = CASE WHEN $8 IS NULL OR $9::text IS NULL THEN norm_title ELSE $9::text END,
        year = CASE WHEN $8 IS NULL THEN year ELSE $10 END,
        season = CASE WHEN $8 IS NULL THEN season ELSE $11 END,
        season_start = CASE WHEN $8 IS NULL THEN season_start ELSE $12 END,
        season_end = CASE WHEN $8 IS NULL THEN season_end ELSE $13 END,
        episode = CASE WHEN $8 IS NULL THEN episode ELSE $14 END,
        episode_end = CASE WHEN $8 IS NULL THEN episode_end ELSE $15 END,
        kitsu_id = CASE WHEN $8 IS NULL THEN kitsu_id ELSE NULL END,
        identity_status = CASE WHEN $8 IS NULL THEN identity_status ELSE 'pending' END,
        entity_key = CASE WHEN $8 IS NULL THEN entity_key ELSE NULL END,
        identity_error = CASE WHEN $8 IS NULL THEN identity_error ELSE NULL END,
        search_alt = CASE WHEN $8 IS NULL THEN search_alt ELSE NULL END,
        match_next_retry_at = CASE
          WHEN $2 = 'failed' AND match_attempts < $16
          THEN now() + CASE
            WHEN $6 LIKE 'search-unavailable%' OR $6 LIKE 'lookup-error%'
              THEN (LEAST(320, 5 * POWER(2, GREATEST(match_attempts, 1) - 1)) || ' minutes')::interval
            ELSE (LEAST(24, POWER(2, GREATEST(match_attempts, 1) - 1)) || ' hours')::interval
          END
          ELSE NULL
        END
      WHERE id = $1`,
    [id, status, tmdbId, imdbId, matchMeta ? JSON.stringify(matchMeta) : null, error, version,
      classification?.mediaType || null,
      classification?.title ? normalizeTitle(classification.title) : null,
      Number.isInteger(classification?.year) ? classification.year : null,
      classification?.season ?? null,
      classification?.seasonStart ?? null,
      classification?.seasonEnd ?? null,
      classification?.episode ?? null,
      classification?.episodeEnd ?? null,
      MAX_MATCH_ATTEMPTS]
  );
}

async function markMatchSkipped(scopeId) {
  const pool = await ensure();
  await pool.query(
    `UPDATE lib_items SET match_status = 'skipped'
      WHERE scope_id = $1 AND match_status = 'pending' AND removed_at IS NULL`,
    [scopeId]
  );
}

const ROW_COLUMNS = `id, provider, source_id, name, norm_title, media_type, season, episode,
            season_start, season_end, episode_end, size, source_created_at, source_updated_at,
            raw, match_meta, tmdb_id, imdb_id, entity_key, identity_status, search_alt`;

async function catalogRows(scopeId, mediaType, provider = null) {
  const pool = db.getPool();
  if (!pool) return [];
  const params = [scopeId, mediaType];
  let providerFilter = '';
  if (provider) { params.push(provider); providerFilter = `AND provider = $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT ${ROW_COLUMNS}
       FROM lib_items
      WHERE scope_id = $1 AND media_type = $2 AND removed_at IS NULL AND match_status = 'matched'
        AND match_meta IS NOT NULL
        ${providerFilter}
      ORDER BY first_seen_at ASC`,
    params
  );
  return rows;
}

function buildTsQuery(query) {
  // Keep single-character tokens (e.g. "7" in "series title 7"): dropping them
  // silently moved the trailing prefix marker onto the previous word, which
  // made the tsquery match the whole library.
  const tokens = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 1);
  if (!tokens.length || !tokens.some((t) => t.length >= 2)) return null;
  return tokens.map((t, i) => (i === tokens.length - 1 ? `${t}:*` : t)).join(' & ');
}

async function searchRows(scopeId, mediaType, query, limit = 50, provider = null) {
  const pool = db.getPool();
  if (!pool) return [];
  const norm = normalizeTitle(query);
  const like = `%${norm}%`;
  const prefix = `${norm}%`;
  const tsq = buildTsQuery(query);
  const params = [scopeId, mediaType, like, Math.max(1, Math.min(200, limit)), prefix];
  const textFilter = ['(norm_title LIKE $3 OR search_text LIKE $3 OR search_alt LIKE $3'];
  if (tsq) {
    params.push(tsq);
    textFilter[0] += ` OR to_tsvector('simple', coalesce(search_text, '')) @@ to_tsquery('simple', $${params.length})`;
  }
  textFilter[0] += ')';
  if (provider) { params.push(provider); textFilter.push(`provider = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT ${ROW_COLUMNS}
       FROM lib_items
      WHERE scope_id = $1 AND media_type = $2 AND removed_at IS NULL AND match_status = 'matched'
        AND ${textFilter.join(' AND ')}
      ORDER BY
        CASE WHEN norm_title = $5 THEN 0 WHEN norm_title LIKE $5 THEN 1 ELSE 2 END,
        source_created_at DESC NULLS LAST
      LIMIT $4`,
    params
  );
  return rows;
}

async function tmdbItems(scopeId, tmdbId) {
  const pool = db.getPool();
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT ${ROW_COLUMNS}
       FROM lib_items
      WHERE scope_id = $1 AND tmdb_id = $2 AND removed_at IS NULL AND match_status = 'matched'
      ORDER BY first_seen_at ASC`,
    [scopeId, String(tmdbId)]
  );
  return rows;
}

// ── Identity / metadata layer ──────────────────────────────────────────────

async function resetStuckIdentities() {
  const pool = db.getPool();
  if (!pool) return 0;
  const { rowCount } = await pool.query(
    `UPDATE lib_items SET identity_status = 'pending' WHERE identity_status = 'resolving'`
  );
  return rowCount || 0;
}

async function getIdentityVersion(scopeId) {
  const pool = db.getPool();
  if (!pool) return 0;
  const { rows } = await pool.query(`SELECT identity_version FROM lib_scopes WHERE scope_id = $1`, [scopeId]);
  return rows[0]?.identity_version || 0;
}

async function bumpIdentityVersion(scopeId) {
  const pool = await ensure();
  const { rows } = await pool.query(
    `UPDATE lib_scopes SET identity_version = identity_version + 1 WHERE scope_id = $1 RETURNING identity_version`,
    [scopeId]
  );
  return rows[0]?.identity_version || 0;
}

async function claimIdentityJobs(scopeId, limit) {
  const pool = await ensure();
  const { rows } = await pool.query(
    `UPDATE lib_items SET identity_status = 'resolving'
      WHERE id IN (
        SELECT id FROM lib_items
         WHERE scope_id = $1 AND identity_status = 'pending' AND match_status = 'matched'
           AND tmdb_id IS NOT NULL AND removed_at IS NULL
         ORDER BY first_seen_at DESC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, media_type, tmdb_id, imdb_id, name, match_meta`,
    [scopeId, Math.max(1, limit)]
  );
  return rows;
}

async function markIdentityStatus(itemIds, status, error = null) {
  if (!itemIds || !itemIds.length) return;
  const pool = await ensure();
  await pool.query(
    `UPDATE lib_items SET identity_status = $2, identity_error = $3 WHERE id = ANY($1::bigint[])`,
    [itemIds, status, error]
  );
}

async function saveIdentity(entityKey, resolved) {
  const pool = await ensure();
  const { ids = {}, meta = {}, provider = null, status = 'matched', confidence = null, error = null, mediaType = null } = resolved;
  await pool.query(
    `INSERT INTO lib_identities (
       entity_key, media_type, tmdb_id, imdb_id, tvdb_id, kitsu_id, anilist_id, mal_id, anidb_id,
       title, canonical_title, alt_titles, year, poster, background, logo, genres, status,
       episode_count, metadata, metadata_provider, metadata_status, metadata_confidence,
       metadata_updated_at, metadata_error
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,
       $10,$11,$12::jsonb,$13,$14,$15,$16,$17::jsonb,$18,
       $19,$20::jsonb,$21,$22,$23, now(), $24
     )
     ON CONFLICT (entity_key) DO UPDATE SET
       media_type=EXCLUDED.media_type, tmdb_id=EXCLUDED.tmdb_id, imdb_id=EXCLUDED.imdb_id,
       tvdb_id=EXCLUDED.tvdb_id, kitsu_id=EXCLUDED.kitsu_id, anilist_id=EXCLUDED.anilist_id,
       mal_id=EXCLUDED.mal_id, anidb_id=EXCLUDED.anidb_id, title=EXCLUDED.title,
       canonical_title=EXCLUDED.canonical_title, alt_titles=EXCLUDED.alt_titles, year=EXCLUDED.year,
       poster=EXCLUDED.poster, background=EXCLUDED.background, logo=EXCLUDED.logo, genres=EXCLUDED.genres,
       status=EXCLUDED.status, episode_count=EXCLUDED.episode_count, metadata=EXCLUDED.metadata,
       metadata_provider=EXCLUDED.metadata_provider, metadata_status=EXCLUDED.metadata_status,
       metadata_confidence=EXCLUDED.metadata_confidence, metadata_updated_at=now(), metadata_error=EXCLUDED.metadata_error`,
    [
      entityKey, mediaType, ids.tmdbId ?? null, ids.imdbId ?? null, ids.tvdbId ?? null,
      ids.kitsuId ?? null, ids.anilistId ?? null, ids.malId ?? null, ids.anidbId ?? null,
      meta.title ?? null, meta.canonicalTitle ?? null, JSON.stringify(meta.altTitles || []), meta.year ?? null,
      meta.poster ?? null, meta.background ?? null, meta.logo ?? null, JSON.stringify(meta.genres || []), meta.status ?? null,
      meta.episodeCount ?? null, JSON.stringify({ overview: meta.overview || null }), provider, status, confidence, error,
    ]
  );
}

async function replaceEpisodes(entityKey, episodes) {
  const pool = await ensure();
  await pool.query(`DELETE FROM lib_episodes WHERE entity_key = $1`, [entityKey]);
  // TVDB (and occasionally other sources) can list two entries for the same
  // season/episode (e.g. a special and its re-issue). A multi-row INSERT with
  // duplicate keys fails with "ON CONFLICT DO UPDATE cannot affect row a second
  // time", which aborted the whole insert. Keep the first per season/episode.
  const seen = new Set();
  const list = [];
  for (const e of (episodes || [])) {
    if (!e || e.episode == null) continue;
    const key = `${e.season ?? 1}:${e.episode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(e);
  }
  for (let offset = 0; offset < list.length; offset += 200) {
    const chunk = list.slice(offset, offset + 200);
    const tuples = [];
    const params = [entityKey];
    let p = 2;
    for (const e of chunk) {
      tuples.push(`($1,$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++}::jsonb)`);
      params.push(
        e.season ?? 1, e.episode, e.absolute ?? null, e.title || null,
        toTimestamp(e.airDate), e.runtime ?? null, e.overview || null, JSON.stringify(e.ids || {})
      );
    }
    await pool.query(
      `INSERT INTO lib_episodes (entity_key, season, episode, absolute, title, air_date, runtime, overview, ids)
       VALUES ${tuples.join(',')}
       ON CONFLICT (entity_key, season, episode) DO UPDATE SET
         absolute = EXCLUDED.absolute, title = EXCLUDED.title, air_date = EXCLUDED.air_date,
         runtime = EXCLUDED.runtime, overview = EXCLUDED.overview, ids = EXCLUDED.ids, updated_at = now()`,
      params
    );
  }
}

// Link the resolved entity to its library files. media_type may change (a
// series reclassified as anime); search_alt holds alternate titles so the
// local search index matches romaji/synonyms.
async function linkItems(itemIds, { entityKey, mediaType = null, searchAlt = null, status = 'enriched' }) {
  if (!itemIds || !itemIds.length) return;
  const pool = await ensure();
  await pool.query(
    `UPDATE lib_items SET entity_key = $2, identity_status = $3,
        media_type = COALESCE($4, media_type), search_alt = $5
      WHERE id = ANY($1::bigint[])`,
    [itemIds, entityKey, status, mediaType, searchAlt]
  );
}

async function identityCounts(scopeId) {
  const pool = db.getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT
        count(*) FILTER (WHERE identity_status IN ('pending','resolving')) AS pending,
        count(*) FILTER (WHERE identity_status = 'enriched') AS enriched,
        count(*) FILTER (WHERE identity_status = 'failed') AS failed,
        count(*) FILTER (WHERE entity_key IS NOT NULL) AS linked
     FROM lib_items WHERE scope_id = $1 AND removed_at IS NULL`,
    [scopeId]
  );
  const row = rows[0] || {};
  return {
    pending: Number(row.pending || 0),
    enriched: Number(row.enriched || 0),
    failed: Number(row.failed || 0),
    linked: Number(row.linked || 0),
  };
}

// Identity coverage per id type, counted over the scope's distinct entities.
async function identityCoverage(scopeId) {
  const pool = db.getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT
        count(DISTINCT i.entity_key) AS entities,
        count(DISTINCT i.entity_key) FILTER (WHERE i.tvdb_id IS NOT NULL) AS tvdb,
        count(DISTINCT i.entity_key) FILTER (WHERE i.imdb_id IS NOT NULL) AS imdb,
        count(DISTINCT i.entity_key) FILTER (WHERE i.kitsu_id IS NOT NULL) AS kitsu,
        count(DISTINCT i.entity_key) FILTER (WHERE i.anilist_id IS NOT NULL) AS anilist,
        count(DISTINCT i.entity_key) FILTER (WHERE i.mal_id IS NOT NULL) AS mal,
        count(DISTINCT i.entity_key) FILTER (WHERE i.anidb_id IS NOT NULL) AS anidb
       FROM lib_identities i
       JOIN lib_items it ON it.entity_key = i.entity_key AND it.scope_id = $1 AND it.removed_at IS NULL`,
    [scopeId]
  );
  const r = rows[0] || {};
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v || 0)]));
}

async function mediaTypeCounts(scopeId) {
  const pool = db.getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT media_type, count(*) AS n FROM lib_items
      WHERE scope_id = $1 AND removed_at IS NULL GROUP BY media_type`,
    [scopeId]
  );
  return Object.fromEntries(rows.map((r) => [r.media_type || 'unknown', Number(r.n)]));
}

export interface StoreApi {
  ensure: any;
  listScopes: any;
  getScope: any;
  touchScope: any;
  markScopeSyncing: any;
  markScopeResult: any;
  resetStuckMatches: any;
  releaseMatchJobs: any;
  requeueSplitMismatches: any;
  requeueReparsedSeasonRanges: any;
  terminalizeExhaustedMatches: any;
  requeueFailedMatches: any;
  failedMatchRows: any;
  massRemovalDecision: any;
  reconcile: any;  counts: any;
  markQueueStats: any;
  aggregateQueueStats: any;
  claimMatchJobs: any;
  saveMatch: any;
  markMatchSkipped: any;
  catalogRows: any;
  searchRows: any;
  tmdbItems: any;
  toTimestamp: any;
  resetStuckIdentities: any;
  getIdentityVersion: any;
  bumpIdentityVersion: any;
  claimIdentityJobs: any;
  markIdentityStatus: any;
  saveIdentity: any;
  replaceEpisodes: any;
  linkItems: any;
  identityCounts: any;
  identityCoverage: any;
  mediaTypeCounts: any;
}

module.exports = {
  ensure,
  listScopes,
  getScope,
  touchScope,
  markScopeSyncing,
  markScopeResult,
  resetStuckMatches,
  releaseMatchJobs,
  requeueSplitMismatches,
  requeueReparsedSeasonRanges,
  terminalizeExhaustedMatches,
  requeueFailedMatches,
  failedMatchRows,
  massRemovalDecision,
  reconcile,
  counts,
  markQueueStats,
  aggregateQueueStats,
  claimMatchJobs,
  saveMatch,
  markMatchSkipped,
  catalogRows,
  searchRows,
  tmdbItems,
  toTimestamp,
  resetStuckIdentities,
  getIdentityVersion,
  bumpIdentityVersion,
  claimIdentityJobs,
  markIdentityStatus,
  saveIdentity,
  replaceEpisodes,
  linkItems,
  identityCounts,
  identityCoverage,
  mediaTypeCounts,
} satisfies StoreApi;
