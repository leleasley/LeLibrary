'use strict';
// "Your genres" rows: My Movies / My Shows narrowed to one genre
// (`torbox-movies-g-horror`, `torbox-series-g-comedy` ...).
//
// Library matching never stored genres for films, so they are filled in the
// background: one TMDB details read per title, kept in lib_tmdb_genres. A
// title's genres are a fact about the title, the same for everyone, so the
// table is shared by every library and a title is only ever fetched once.
// Key: the server's own TMDB key when it has one (hosted), else the setup's
// own key, exactly like matching. Nothing about the library or the setup is
// sent: only a TMDB id.

const axios = require('axios');
const store = require('./store.ts');

const TMDB = 'https://api.themoviedb.org/3';

export interface GenreDef {
  slug: string;
  name: string;
  // TMDB genre ids that count, per media type. TV merges some genres
  // ("Action & Adventure", "Sci-Fi & Fantasy", "War & Politics").
  movie: number[];
  tv: number[];
  // TV merges some genres on TMDB, so a show row is named after the merged
  // genre ("Action & Adventure") and the partner genre has no show row.
  tvName?: string;
}

// Slugs are part of saved catalogue ids: never rename one.
const GENRES: readonly GenreDef[] = [
  { slug: 'action', name: 'Action', movie: [28], tv: [10759], tvName: 'Action & Adventure' },
  { slug: 'adventure', name: 'Adventure', movie: [12], tv: [] },
  { slug: 'animation', name: 'Animation', movie: [16], tv: [16] },
  { slug: 'comedy', name: 'Comedy', movie: [35], tv: [35] },
  { slug: 'crime', name: 'Crime', movie: [80], tv: [80] },
  { slug: 'documentary', name: 'Documentary', movie: [99], tv: [99] },
  { slug: 'drama', name: 'Drama', movie: [18], tv: [18] },
  { slug: 'family', name: 'Family', movie: [10751], tv: [10751] },
  { slug: 'fantasy', name: 'Fantasy', movie: [14], tv: [] },
  { slug: 'history', name: 'History', movie: [36], tv: [] },
  { slug: 'horror', name: 'Horror', movie: [27], tv: [] },
  { slug: 'kids', name: 'Kids', movie: [], tv: [10762] },
  { slug: 'music', name: 'Music', movie: [10402], tv: [] },
  { slug: 'mystery', name: 'Mystery', movie: [9648], tv: [9648] },
  { slug: 'reality', name: 'Reality', movie: [], tv: [10764] },
  { slug: 'romance', name: 'Romance', movie: [10749], tv: [] },
  { slug: 'scifi', name: 'Sci-Fi', movie: [878], tv: [10765], tvName: 'Sci-Fi & Fantasy' },
  { slug: 'thriller', name: 'Thriller', movie: [53], tv: [] },
  { slug: 'war', name: 'War', movie: [10752], tv: [10768], tvName: 'War & Politics' },
  { slug: 'western', name: 'Western', movie: [37], tv: [37] },
];
const BY_SLUG = new Map(GENRES.map((genre) => [genre.slug, genre]));

function genreBySlug(slug: unknown): GenreDef | null {
  return BY_SLUG.get(String(slug || '')) || null;
}

// Genres that exist for a library kind (Horror has no TV genre on TMDB).
function genresFor(kind: 'movies' | 'series'): GenreDef[] {
  return GENRES.filter((genre) => (kind === 'movies' ? genre.movie : genre.tv).length > 0);
}

// Server key first: on the hosted site no setup's key is spent on a fact
// shared by everyone.
function serverKey(): string {
  return String(process.env['ART_TMDB_API_KEY'] || process.env['RELEASES_TMDB_API_KEY'] || '').trim();
}

function auth(apiKey: string): { headers: Record<string, string>; params: Record<string, string> } {
  return apiKey.startsWith('eyJ')
    ? { headers: { Authorization: `Bearer ${apiKey}` }, params: {} }
    : { headers: {}, params: { api_key: apiKey } };
}

// Keys TMDB rejected are left alone for an hour (matching has its own gate).
const rejected = new Map<string, number>();
const REJECT_MS = 60 * 60 * 1000;

const FILL_PER_TICK = Math.max(1, Number(process.env['LIBRARY_GENRE_FILL'] || 150));
const CONCURRENCY = 4;

// Titles in this library without a genre row yet.
async function missing(scopeId: string, limit: number): Promise<{ apiType: 'movie' | 'tv'; tmdbId: number }[]> {
  const pool = await store.ensure();
  const { rows } = await pool.query(
    `SELECT DISTINCT CASE WHEN i.media_type = 'movie' THEN 'movie' ELSE 'tv' END AS api_type, i.tmdb_id
       FROM lib_items i
      WHERE i.scope_id = $1 AND i.removed_at IS NULL AND i.match_status = 'matched' AND i.tmdb_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM lib_tmdb_genres g
                         WHERE g.media_type = CASE WHEN i.media_type = 'movie' THEN 'movie' ELSE 'tv' END
                           AND g.tmdb_id = i.tmdb_id)
      LIMIT $2`,
    [scopeId, limit]
  );
  return rows.map((row: Record<string, unknown>) => ({ apiType: row['api_type'] === 'movie' ? 'movie' : 'tv', tmdbId: Number(row['tmdb_id']) }));
}

async function fetchGenreIds(apiKey: string, apiType: 'movie' | 'tv', tmdbId: number, get = axios.get): Promise<number[] | null | 'rejected'> {
  const { headers, params } = auth(apiKey);
  try {
    const res = await get(`${TMDB}/${apiType}/${tmdbId}`, { headers, params, timeout: 8000 });
    const genres = Array.isArray(res?.data?.genres) ? res.data.genres : [];
    return genres.map((genre: { id?: unknown }) => Number(genre?.id)).filter((id: number) => Number.isInteger(id) && id > 0);
  } catch (err: any) {
    const status = Number(err?.response?.status) || 0;
    if (status === 401) return 'rejected';
    // Gone from TMDB: store "no genres" so it is never asked again.
    if (status === 404) return [];
    return null; // try again on a later tick
  }
}

// One background pass for one library. Returns how many titles were filled.
async function fillForScope(scopeId: string, setupKey: string | null | undefined, options: { limit?: number; get?: typeof axios.get } = {}): Promise<number> {
  const apiKey = serverKey() || String(setupKey || '').trim();
  if (!apiKey) return 0;
  const until = rejected.get(apiKey);
  if (until && until > Date.now()) return 0;
  const todo = await missing(scopeId, options.limit ?? FILL_PER_TICK);
  if (!todo.length) return 0;
  const pool = await store.ensure();
  let filled = 0;
  let stop = false;
  let index = 0;
  async function worker() {
    while (!stop && index < todo.length) {
      const job = todo[index++]!;
      const ids = await fetchGenreIds(apiKey, job.apiType, job.tmdbId, options.get);
      if (ids === 'rejected') { rejected.set(apiKey, Date.now() + REJECT_MS); stop = true; return; }
      if (ids === null) continue;
      await pool.query(
        `INSERT INTO lib_tmdb_genres (media_type, tmdb_id, genre_ids, fetched_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (media_type, tmdb_id) DO UPDATE SET genre_ids = EXCLUDED.genre_ids, fetched_at = now()`,
        [job.apiType, job.tmdbId, ids]
      );
      filled++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  if (filled) bumpVersion();
  return filled;
}

// TMDB ids of one kind that carry the genre. Cached briefly: a catalogue page
// asks once per request, and the set only grows as the fill runs.
const idCache = new Map<string, { at: number; ids: Set<number> }>();
const ID_TTL_MS = 60 * 1000;

async function tmdbIdsWithGenre(kind: 'movies' | 'series', slug: string): Promise<Set<number>> {
  const genre = genreBySlug(slug);
  const genreIds = genre ? (kind === 'movies' ? genre.movie : genre.tv) : [];
  if (!genreIds.length) return new Set();
  const key = `${kind}:${slug}`;
  const hit = idCache.get(key);
  if (hit && Date.now() - hit.at < ID_TTL_MS) return hit.ids;
  const pool = await store.ensure();
  const { rows } = await pool.query(
    `SELECT tmdb_id FROM lib_tmdb_genres WHERE media_type = $1 AND genre_ids && $2::int[]`,
    [kind === 'movies' ? 'movie' : 'tv', genreIds]
  );
  const ids = new Set<number>(rows.map((row: Record<string, unknown>) => Number(row['tmdb_id'])));
  idCache.set(key, { at: Date.now(), ids });
  return ids;
}

// Changes whenever the fill adds titles, so cached genre pages are rebuilt
// instead of staying empty while the first fill runs.
let version = 0;
function bumpVersion() { version++; idCache.clear(); }
function genreVersion(): number { return version; }

export interface GenresApi {
  GENRES: readonly GenreDef[];
  genreBySlug: typeof genreBySlug;
  genresFor: typeof genresFor;
  fillForScope: typeof fillForScope;
  fetchGenreIds: typeof fetchGenreIds;
  tmdbIdsWithGenre: typeof tmdbIdsWithGenre;
  genreVersion: typeof genreVersion;
}

module.exports = { GENRES, genreBySlug, genresFor, fillForScope, fetchGenreIds, tmdbIdsWithGenre, genreVersion } satisfies GenresApi;
