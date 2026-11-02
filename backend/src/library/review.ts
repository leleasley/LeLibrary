'use strict';
// Read side of the Library page: what LeLibrary found in one library (scope)
// and why anything is missing. Returns display fields only. Provider ids,
// hashes, download links and the raw provider record never leave the server;
// rows are addressed by our own internal id, always checked against the scope.

const store = require('./store.ts');
const { guessMediaInfo } = require('../media/parser.ts');

export type ReviewView = 'attention' | 'matched' | 'ignored';

export interface ReviewItem {
  id: number;
  provider: string;
  kind: string | null;
  name: string;
  size: number | null;
  mediaType: string | null;
  season: number | null;
  episode: number | null;
  seasonStart: number | null;
  seasonEnd: number | null;
  status: string;
  reason: string | null;
  title: string | null;
  year: string | null;
  poster: string | null;
  tmdbId: number | null;
  fixed: boolean;
  guess: string | null;
  guessYear: number | null;
  // Main video file inside the item (largest), shown when the item's own name
  // says little (a bare hash, a pack folder), plus how many other videos.
  inner: string | null;
  innerCount: number;
}

// Resolver failure codes are stored as "<code> [detail]". Only the code is
// shown (as a known label key); details stay internal.
const KNOWN_REASONS = new Set([
  'no-candidate', 'ambiguous-candidate', 'season-missing', 'unparseable',
  'meta-build-failed', 'manual-fix-unavailable', 'search-unavailable', 'lookup-error',
]);

function reasonCode(error: unknown): string | null {
  if (typeof error !== 'string' || !error) return null;
  const code = error.trim().split(/[\s:\[]/)[0].toLowerCase();
  return KNOWN_REASONS.has(code) ? code : 'other';
}

function intOrNull(value: unknown): number | null {
  const n = Number(value);
  return value !== null && value !== undefined && Number.isFinite(n) ? Math.trunc(n) : null;
}

function posterOrNull(value: unknown): string | null {
  return typeof value === 'string' && /^https:\/\/image\.tmdb\.org\//.test(value) ? value : null;
}

function baseName(path: unknown): string | null {
  if (typeof path !== 'string' || !path) return null;
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || null;
}

function stripExt(name: string): string {
  return name.replace(/\.[a-z0-9]{2,4}$/i, '');
}

const HASH_NAME = /^[a-f0-9]{32,}$/i;

function toItem(row: Record<string, unknown>): ReviewItem {
  const name = String(row['name'] || '');
  const innerFile = baseName(row['main_file']);
  const inner = innerFile && stripExt(innerFile) !== stripExt(name) ? innerFile : null;
  const outerGuess = typeof row['norm_title'] === 'string' && row['norm_title'] ? (row['norm_title'] as string) : null;
  // A hash tells the fix search nothing: read the title from the inner file.
  let guess = outerGuess;
  let guessYear = intOrNull(row['parsed_year']);
  if (inner && (!outerGuess || HASH_NAME.test(name.trim()) || HASH_NAME.test(outerGuess.replace(/\s+/g, '')))) {
    try {
      const info = guessMediaInfo(inner);
      if (info?.title) { guess = String(info.title); guessYear = intOrNull(info.year); }
    } catch { /* keep the outer guess */ }
  }
  return {
    id: Number(row['id']),
    provider: String(row['provider'] || ''),
    kind: typeof row['source_kind'] === 'string' ? (row['source_kind'] as string) : null,
    name: String(row['name'] || ''),
    size: intOrNull(row['size']),
    mediaType: typeof row['media_type'] === 'string' ? (row['media_type'] as string) : null,
    season: intOrNull(row['season']),
    episode: intOrNull(row['episode']),
    seasonStart: intOrNull(row['season_start']),
    seasonEnd: intOrNull(row['season_end']),
    status: String(row['match_status'] || ''),
    reason: row['match_status'] === 'matched' || row['match_status'] === 'ignored' ? null : reasonCode(row['match_error']),
    title: typeof row['title'] === 'string' ? (row['title'] as string) : null,
    year: typeof row['release_year'] === 'string' && row['release_year'] ? (row['release_year'] as string) : null,
    poster: posterOrNull(row['poster']),
    tmdbId: intOrNull(row['tmdb_id']),
    fixed: row['fixed'] === true,
    guess,
    guessYear,
    inner,
    innerCount: Math.max(0, (intOrNull(row['video_count']) || 0) - (inner ? 1 : 0)),
  };
}

const VIEW_FILTER: Record<ReviewView, string> = {
  attention: `(i.match_status = 'failed' OR (i.match_status = 'skipped' AND i.match_error IS NOT NULL))`,
  matched: `i.match_status = 'matched'`,
  ignored: `i.match_status = 'ignored'`,
};

async function summary(scopeId: string) {
  const pool = await store.ensure();
  const [{ rows: providers }, scope] = await Promise.all([
    pool.query(
      `SELECT provider,
              count(*) FILTER (WHERE source_id NOT LIKE '%#film:%')::int AS files,
              count(*) FILTER (WHERE match_status = 'matched')::int AS matched,
              count(*) FILTER (WHERE ${VIEW_FILTER.attention.replace(/i\./g, '')})::int AS attention,
              count(*) FILTER (WHERE match_status = 'ignored')::int AS ignored,
              count(*) FILTER (WHERE match_status IN ('pending', 'matching'))::int AS pending,
              count(DISTINCT tmdb_id) FILTER (WHERE match_status = 'matched' AND media_type = 'movie')::int AS films,
              count(DISTINCT tmdb_id) FILTER (WHERE match_status = 'matched' AND media_type IN ('series', 'anime'))::int AS shows
         FROM lib_items
        WHERE scope_id = $1 AND removed_at IS NULL
        GROUP BY provider
        ORDER BY provider`,
      [scopeId]
    ),
    store.getScope(scopeId).catch(() => null),
  ]);
  const { rows: totals } = await pool.query(
    `SELECT count(DISTINCT tmdb_id) FILTER (WHERE match_status = 'matched' AND media_type = 'movie')::int AS films,
            count(DISTINCT tmdb_id) FILTER (WHERE match_status = 'matched' AND media_type IN ('series', 'anime'))::int AS shows
       FROM lib_items WHERE scope_id = $1 AND removed_at IS NULL`,
    [scopeId]
  );
  const sum = (field: string) => providers.reduce((total: number, row: Record<string, number>) => total + (row[field] || 0), 0);
  return {
    files: sum('files'),
    matched: sum('matched'),
    attention: sum('attention'),
    ignored: sum('ignored'),
    pending: sum('pending'),
    films: totals[0]?.films || 0,
    shows: totals[0]?.shows || 0,
    providers: providers.map((row: Record<string, unknown>) => ({
      provider: String(row['provider']),
      files: Number(row['files']) || 0,
      matched: Number(row['matched']) || 0,
      attention: Number(row['attention']) || 0,
    })),
    lastSyncAt: scope?.last_sync_at ? new Date(scope.last_sync_at).toISOString() : null,
    lastStatus: typeof scope?.last_status === 'string' ? scope.last_status : null,
    // Matching is paused while the setup's TMDB key is missing or rejected.
    tmdbKeyProblem: require('./tmdb-key.ts').scopeProblem(scopeId),
  };
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

async function items(scopeId: string, { view = 'attention', q = '', limit = 50, offset = 0 }: { view?: ReviewView; q?: string; limit?: number; offset?: number } = {}) {
  const pool = await store.ensure();
  const filter = VIEW_FILTER[view] || VIEW_FILTER.attention;
  const params: unknown[] = [scopeId];
  let search = '';
  const query = String(q || '').trim().slice(0, 120);
  if (query) {
    params.push(likePattern(query));
    search = ` AND (i.name ILIKE $${params.length} OR i.match_meta->>'name' ILIKE $${params.length})`;
  }
  const where = `i.scope_id = $1 AND i.removed_at IS NULL AND ${filter}${search}`;
  const order = view === 'matched' ? 'i.first_seen_at DESC, i.id DESC' : 'lower(i.name) ASC, i.id ASC';
  const pageLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 50));
  const pageOffset = Math.max(0, Math.min(100000, Math.trunc(offset) || 0));
  const [{ rows }, { rows: count }] = await Promise.all([
    pool.query(
      `SELECT i.id, i.provider, i.source_kind, i.name, i.size, i.media_type, i.season, i.episode,
              i.season_start, i.season_end, i.match_status, i.match_error, i.tmdb_id,
              i.norm_title, i.year AS parsed_year,
              i.match_meta->>'name' AS title, i.match_meta->>'releaseInfo' AS release_year,
              i.match_meta->>'poster' AS poster,
              (o.scope_id IS NOT NULL) AS fixed,
              vf.main_file, vf.video_count
         FROM lib_items i
         LEFT JOIN LATERAL (
           SELECT (array_agg(f.fname ORDER BY f.fsize DESC NULLS LAST))[1] AS main_file,
                  count(*)::int AS video_count
             FROM (
               SELECT COALESCE(e->>'short_name', e->>'name', e->>'path', e->>'filename') AS fname,
                      CASE WHEN COALESCE(e->>'size', e->>'bytes') ~ '^[0-9]+$'
                           THEN COALESCE(e->>'size', e->>'bytes')::numeric END AS fsize
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(i.raw->'files') = 'array' THEN i.raw->'files' ELSE '[]'::jsonb END) e
             ) f
            WHERE f.fname ~* '\\.(mkv|mp4|avi|m4v|mov|ts|wmv|webm)$'
              AND f.fname !~* '(^|[^a-z])sample([^a-z]|$)'
         ) vf ON true
         LEFT JOIN lib_match_overrides o
           ON o.scope_id = i.scope_id AND o.provider = i.provider AND o.source_id = i.source_id
        WHERE ${where}
        ORDER BY ${order}
        LIMIT ${pageLimit} OFFSET ${pageOffset}`,
      params
    ),
    pool.query(`SELECT count(*)::int AS total FROM lib_items i WHERE ${where}`, params),
  ]);
  return { total: count[0]?.total || 0, items: rows.map(toItem) };
}

// Full row for applying a fix (internal only: includes the provider record).
async function itemForFix(scopeId: string, id: number) {
  const pool = await store.ensure();
  const { rows } = await pool.query(
    `SELECT id, provider, source_id, name, raw, season, episode, season_start, season_end, media_type, match_status
       FROM lib_items WHERE scope_id = $1 AND id = $2 AND removed_at IS NULL`,
    [scopeId, id]
  );
  return rows[0] || null;
}

// Hand a row back to automatic matching (after an override is removed).
async function requeue(scopeId: string, id: number): Promise<boolean> {
  const pool = await store.ensure();
  const { rowCount } = await pool.query(
    `UPDATE lib_items SET match_status = 'pending', match_attempts = 0, match_error = NULL,
            match_next_retry_at = NULL, match_version = NULL
      WHERE scope_id = $1 AND id = $2 AND removed_at IS NULL`,
    [scopeId, id]
  );
  return (rowCount || 0) > 0;
}

// "At a glance" numbers for the top of the Library page. Titles are counted
// once however many files they have. 4K and HDR use the same tags as the
// 4K / HDR & Dolby Vision rows (library/quality-filter.ts), over the release
// name and the file names inside packs. About 1.6s on a 10,000-file library,
// so it is cached per library for 10 minutes and loaded after the summary.
const STATS_TTL = 600;
const FILE_NAMES = `coalesce((SELECT string_agg(coalesce(f->>'name', f->>'short_name', f->>'path', ''), ' ')
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(raw->'files') = 'array' THEN raw->'files' ELSE '[]'::jsonb END) f), '')`;
const UHD_RE = String.raw`\y(2160P|4K|UHD)\y`;
const HDR_RE = String.raw`(DOLBY.?VISION|\yDV\y|\yDOVI\y|\yHDR(10)?(\+|PLUS)?\y)`;

export interface LibraryStats {
  titles: number;
  films: number;
  shows: number;
  sizeBytes: number;
  uhd: number;
  hdr: number;
  addedWeek: number;
  recent: { type: 'movie' | 'series'; title: string; year: string | null; poster: string | null }[];
}

async function stats(scopeId: string): Promise<LibraryStats> {
  const cache = require('../runtime/cache.ts');
  const key = cache.makeKey('libstats:v1', scopeId);
  const hit = await cache.get(key).catch(() => null);
  if (hit && typeof hit === 'object' && typeof (hit as LibraryStats).titles === 'number') return hit as LibraryStats;
  const pool = await store.ensure();
  const [{ rows: counts }, { rows: sizes }, { rows: recent }] = await Promise.all([
    pool.query(
      `WITH titles AS (
         SELECT media_type, tmdb_id,
                bool_or(upper(name || ' ' || ${FILE_NAMES}) ~ $2) AS uhd,
                bool_or(upper(name || ' ' || ${FILE_NAMES}) ~ $3) AS hdr,
                min(coalesce(source_created_at, first_seen_at)) AS added
           FROM lib_items
          WHERE scope_id = $1 AND removed_at IS NULL AND match_status = 'matched' AND tmdb_id IS NOT NULL
          GROUP BY media_type, tmdb_id)
       SELECT count(*)::int AS titles,
              count(*) FILTER (WHERE media_type = 'movie')::int AS films,
              count(*) FILTER (WHERE media_type IN ('series', 'anime'))::int AS shows,
              count(*) FILTER (WHERE uhd)::int AS uhd,
              count(*) FILTER (WHERE hdr)::int AS hdr,
              count(*) FILTER (WHERE added > now() - interval '7 days')::int AS week
         FROM titles`,
      [scopeId, UHD_RE, HDR_RE]
    ),
    // Box-set film rows (#film:) point into a file already counted.
    pool.query(
      `SELECT coalesce(sum(size), 0)::text AS bytes FROM lib_items
        WHERE scope_id = $1 AND removed_at IS NULL AND source_id NOT LIKE '%#film:%'`,
      [scopeId]
    ),
    pool.query(
      `SELECT media_type, title, year, poster FROM (
         SELECT DISTINCT ON (media_type, tmdb_id) media_type,
                match_meta->>'name' AS title, match_meta->>'releaseInfo' AS year, match_meta->>'poster' AS poster,
                coalesce(source_created_at, first_seen_at) AS added
           FROM lib_items
          WHERE scope_id = $1 AND removed_at IS NULL AND match_status = 'matched' AND tmdb_id IS NOT NULL
            AND coalesce(source_created_at, first_seen_at) > now() - interval '7 days'
          ORDER BY media_type, tmdb_id, coalesce(source_created_at, first_seen_at) DESC) t
        ORDER BY added DESC LIMIT 12`,
      [scopeId]
    ),
  ]);
  const row = counts[0] || {};
  const out: LibraryStats = {
    titles: Number(row.titles) || 0,
    films: Number(row.films) || 0,
    shows: Number(row.shows) || 0,
    sizeBytes: Number(sizes[0]?.bytes) || 0,
    uhd: Number(row.uhd) || 0,
    hdr: Number(row.hdr) || 0,
    addedWeek: Number(row.week) || 0,
    recent: recent
      .filter((r: Record<string, unknown>) => typeof r['title'] === 'string' && r['title'])
      .map((r: Record<string, unknown>) => ({
        type: r['media_type'] === 'movie' ? 'movie' as const : 'series' as const,
        title: String(r['title']),
        year: typeof r['year'] === 'string' && r['year'] ? String(r['year']).slice(0, 4) : null,
        poster: posterOrNull(r['poster']),
      })),
  };
  cache.set(key, out, STATS_TTL).catch(() => {});
  return out;
}

export interface ReviewApi {
  summary: typeof summary;
  stats: typeof stats;
  items: typeof items;
  itemForFix: typeof itemForFix;
  requeue: typeof requeue;
  reasonCode: typeof reasonCode;
}

module.exports = { summary, stats, items, itemForFix, requeue, reasonCode } satisfies ReviewApi;
