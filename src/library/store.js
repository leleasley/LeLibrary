// Postgres store for the index-first library engine. All writes are batched and
// only touch new/changed rows, so an unchanged library costs one read + zero
// per-item writes per sync.
const db = require('./db');
const { diffRecords, recordKey, normalizeTitle } = require('./diff');

const WRITE_CHUNK = 250;
const INSERT_COLUMNS = [
  'scope_id', 'provider', 'source_id', 'source_kind', 'name', 'norm_title', 'search_text',
  'media_type', 'is_series', 'is_anime', 'year', 'season', 'episode', 'season_start',
  'season_end', 'episode_end', 'size', 'source_updated_at', 'source_created_at', 'state',
  'raw', 'content_hash',
];

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
            item_count, matched_count, pending_count, removed_count, last_sync_ms, identity_version
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
            last_added, last_changed, last_removed, last_unchanged, identity_version
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
    `UPDATE lib_scopes SET last_status = 'syncing', last_error = NULL WHERE scope_id = $1`,
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
        last_error = $4,
        provider = COALESCE($5, provider),
        item_count = COALESCE($6, item_count),
        matched_count = COALESCE($7, matched_count),
        pending_count = COALESCE($8, pending_count),
        removed_count = COALESCE($9, removed_count),
        last_added = COALESCE($10, last_added),
        last_changed = COALESCE($11, last_changed),
        last_removed = COALESCE($12, last_removed),
        last_unchanged = COALESCE($13, last_unchanged)
     WHERE scope_id = $1`,
    [
      scopeId, Math.round(durationMs) || 0, status, error, totals.provider || null,
      totals.item_count, totals.matched_count, totals.pending_count, totals.removed_count,
      counts.added, counts.changed, counts.removed, counts.unchanged,
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

// Reconcile a provider snapshot against the local index. Only new/changed rows
// are written; unchanged rows are left untouched; rows no longer present are
// soft-deleted. Returns the diff counts.
async function reconcile(scopeId, records) {
  const pool = await ensure();
  const started = Date.now();

  const existing = new Map();
  const { rows: existingRows } = await pool.query(
    `SELECT provider, source_id, content_hash, removed_at FROM lib_items WHERE scope_id = $1`,
    [scopeId]
  );
  for (const row of existingRows) {
    existing.set(`${row.provider}\u0001${row.source_id}`, {
      content_hash: row.content_hash,
      removed: !!row.removed_at,
    });
  }

  const { toWrite, removedKeys, counts } = diffRecords(existing, records, recordKey);

  for (let offset = 0; offset < toWrite.length; offset += WRITE_CHUNK) {
    const chunk = toWrite.slice(offset, offset + WRITE_CHUNK);
    const tuples = [];
    const params = [];
    let p = 1;
    for (const r of chunk) {
      tuples.push(`(
        $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++},
        $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++},
        $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++},
        'pending', 0, NULL, NULL, NULL, NULL, now()
      )`);
      params.push(
        scopeId, r.provider, r.source_id, r.source_kind, r.name, r.norm_title, r.search_text,
        r.media_type, r.is_series, r.is_anime, r.year, r.season, r.episode, r.season_start,
        r.season_end, r.episode_end, r.size, toTimestamp(r.source_updated_at),
        toTimestamp(r.source_created_at), r.state, JSON.stringify(r.raw), r.content_hash
      );
    }
    await pool.query(
      `INSERT INTO lib_items (
         ${INSERT_COLUMNS.join(', ')},
         match_status, match_attempts, match_meta, tmdb_id, imdb_id, removed_at, synced_at
       ) VALUES ${tuples.join(',')}
       ON CONFLICT (scope_id, provider, source_id) DO UPDATE SET
         source_kind = EXCLUDED.source_kind,
         name = EXCLUDED.name,
         norm_title = EXCLUDED.norm_title,
         search_text = EXCLUDED.search_text,
         media_type = EXCLUDED.media_type,
         is_series = EXCLUDED.is_series,
         is_anime = EXCLUDED.is_anime,
         year = EXCLUDED.year,
         season = EXCLUDED.season,
         episode = EXCLUDED.episode,
         season_start = EXCLUDED.season_start,
         season_end = EXCLUDED.season_end,
         episode_end = EXCLUDED.episode_end,
         size = EXCLUDED.size,
         source_updated_at = EXCLUDED.source_updated_at,
         source_created_at = EXCLUDED.source_created_at,
         state = EXCLUDED.state,
         raw = EXCLUDED.raw,
         content_hash = EXCLUDED.content_hash,
         match_status = 'pending',
         match_attempts = 0,
         match_error = NULL,
         match_meta = NULL,
         tmdb_id = NULL,
         imdb_id = NULL,
         removed_at = NULL,
         identity_status = 'pending',
         entity_key = NULL,
         identity_error = NULL,
         search_alt = NULL,
         last_seen_at = now(),
         synced_at = now()`,
      params
    );
  }

  if (removedKeys.length) {
    const providersList = [];
    const idsList = [];
    for (const key of removedKeys) {
      const [provider, sourceId] = key.split('\u0001');
      providersList.push(provider);
      idsList.push(sourceId);
    }
    await pool.query(
      `UPDATE lib_items SET removed_at = now(), match_status = 'skipped'
        WHERE scope_id = $1
          AND (provider, source_id) IN (SELECT * FROM unnest($2::text[], $3::text[]))`,
      [scopeId, providersList, idsList]
    );
  }

  counts.durationMs = Date.now() - started;
  return counts;
}

async function counts(scopeId) {
  const pool = db.getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT
        count(*) FILTER (WHERE removed_at IS NULL) AS item_count,
        count(*) FILTER (WHERE removed_at IS NULL AND match_status = 'matched') AS matched_count,
        count(*) FILTER (WHERE removed_at IS NULL AND match_status IN ('pending','matching')) AS pending_count,
        count(*) FILTER (WHERE removed_at IS NOT NULL) AS removed_count,
        count(*) FILTER (WHERE removed_at IS NULL AND match_status = 'failed') AS failed_count
     FROM lib_items WHERE scope_id = $1`,
    [scopeId]
  );
  const row = rows[0] || {};
  return {
    item_count: Number(row.item_count || 0),
    matched_count: Number(row.matched_count || 0),
    pending_count: Number(row.pending_count || 0),
    removed_count: Number(row.removed_count || 0),
    failed_count: Number(row.failed_count || 0),
  };
}

async function claimMatchJobs(scopeId, limit) {
  const pool = await ensure();
  const { rows } = await pool.query(
    `UPDATE lib_items SET match_status = 'matching', match_attempts = match_attempts + 1
      WHERE id IN (
        SELECT id FROM lib_items
         WHERE scope_id = $1 AND match_status = 'pending' AND removed_at IS NULL
         ORDER BY first_seen_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, provider, source_id, raw, media_type, is_series, is_anime, name, season, episode`,
    [scopeId, Math.max(1, limit)]
  );
  return rows;
}

async function saveMatch(id, { status, tmdbId = null, imdbId = null, matchMeta = null, error = null }) {
  const pool = await ensure();
  await pool.query(
    `UPDATE lib_items SET
        match_status = $2,
        tmdb_id = $3,
        imdb_id = $4,
        match_meta = $5,
        match_error = $6
      WHERE id = $1`,
    [id, status, tmdbId, imdbId, matchMeta ? JSON.stringify(matchMeta) : null, error]
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
         ORDER BY first_seen_at ASC
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

module.exports = {
  ensure,
  listScopes,
  getScope,
  touchScope,
  markScopeSyncing,
  markScopeResult,
  resetStuckMatches,
  reconcile,
  counts,
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
};
