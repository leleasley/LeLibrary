'use strict';
// Owner fixes from the Library page.
//
// An override pins one provider item (scope_id, provider, source_id) to a TMDB
// title the owner picked, or marks it ignored. It belongs to the library
// (the debrid key hash), never to the shared match cache, so one person's
// choice can never change anyone else's library. The matcher consults these
// before its own resolver (see matcher.ts), so a fix survives re-syncs,
// resolver upgrades and startup repairs; the resolver itself still never
// guesses.

const db = require('./db.ts');
const store = require('./store.ts');
const builder = require('../catalog/builder.ts');
const tmdb = require('../media/tmdb.ts');
const { matchVersion } = require('../matching/resolve.ts');

export type OverrideAction = 'match' | 'ignore';
export type OverrideMediaType = 'movie' | 'series' | 'anime';

export interface Override {
  action: OverrideAction;
  tmdbId: number | null;
  mediaType: OverrideMediaType | null;
  season: number | null;
  episode: number | null;
}

export interface OverrideJob {
  id: number | string;
  provider: string;
  source_id: string;
  raw?: unknown;
  season?: number | null;
  episode?: number | null;
  season_start?: number | null;
  season_end?: number | null;
}

const TMDB_BASE = 'https://api.themoviedb.org/3';

function key(provider: string, sourceId: string): string {
  return `${provider}\u0000${sourceId}`;
}

function toOverride(row: Record<string, unknown>): Override {
  return {
    action: row['action'] === 'ignore' ? 'ignore' : 'match',
    tmdbId: Number.isInteger(row['tmdb_id']) ? (row['tmdb_id'] as number) : null,
    mediaType: (['movie', 'series', 'anime'] as const).includes(row['media_type'] as OverrideMediaType)
      ? (row['media_type'] as OverrideMediaType) : null,
    season: Number.isInteger(row['season']) ? (row['season'] as number) : null,
    episode: Number.isInteger(row['episode']) ? (row['episode'] as number) : null,
  };
}

// Overrides for a batch of claimed match jobs, keyed provider + source id.
async function forJobs(scopeId: string, jobs: OverrideJob[]): Promise<Map<string, Override>> {
  const out = new Map<string, Override>();
  const pool = db.getPool();
  if (!pool || !scopeId || !jobs.length) return out;
  const { rows } = await pool.query(
    `SELECT provider, source_id, action, tmdb_id, media_type, season, episode
       FROM lib_match_overrides
      WHERE scope_id = $1 AND (provider, source_id) IN (
        SELECT * FROM unnest($2::text[], $3::text[]))`,
    [scopeId, jobs.map((job) => String(job.provider)), jobs.map((job) => String(job.source_id))]
  );
  for (const row of rows) out.set(key(row.provider, row.source_id), toOverride(row));
  return out;
}

function lookup(map: Map<string, Override>, job: OverrideJob): Override | undefined {
  return map.get(key(String(job.provider), String(job.source_id)));
}

async function save(scopeId: string, provider: string, sourceId: string, override: Override): Promise<void> {
  const pool = await store.ensure();
  await pool.query(
    `INSERT INTO lib_match_overrides (scope_id, provider, source_id, action, tmdb_id, media_type, season, episode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (scope_id, provider, source_id) DO UPDATE SET
       action = EXCLUDED.action, tmdb_id = EXCLUDED.tmdb_id, media_type = EXCLUDED.media_type,
       season = EXCLUDED.season, episode = EXCLUDED.episode, updated_at = now()`,
    [scopeId, provider, sourceId, override.action, override.tmdbId, override.mediaType, override.season, override.episode]
  );
}

async function remove(scopeId: string, provider: string, sourceId: string): Promise<boolean> {
  const pool = await store.ensure();
  const { rowCount } = await pool.query(
    'DELETE FROM lib_match_overrides WHERE scope_id = $1 AND provider = $2 AND source_id = $3',
    [scopeId, provider, sourceId]
  );
  return (rowCount || 0) > 0;
}

// TMDB details shaped like a search result, which is what buildMatchMeta and
// the anime check expect (id, title/name, poster_path, dates, genres,
// original_language). Small per-process cache: an owner fixing a season of
// episodes picks the same title many times.
const sourceCache = new Map<string, { at: number; value: Record<string, unknown> }>();
const SOURCE_TTL_MS = 6 * 60 * 60 * 1000;

function tmdbAuth(apiKey: string): { headers: Record<string, string>; params: Record<string, string> } {
  if (!apiKey) return { headers: {}, params: {} };
  return apiKey.startsWith('eyJ')
    ? { headers: { Authorization: `Bearer ${apiKey}` }, params: {} }
    : { headers: {}, params: { api_key: apiKey } };
}

// One TMDB GET with the setup's own key (v3 key or v4 bearer). Small
// in-process cache: the fix dialog asks for the same show and seasons often.
const getCache = new Map<string, { at: number; value: unknown }>();
async function tmdbGet(apiKey: string, path: string, params: Record<string, string | number | boolean> = {}): Promise<any> {
  const cacheKey = `${path}?${new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]))}`;
  const hit = getCache.get(cacheKey);
  if (hit && Date.now() - hit.at < SOURCE_TTL_MS) return hit.value;
  const axios = require('axios');
  const auth = tmdbAuth(apiKey);
  const res = await axios.get(`${TMDB_BASE}${path}`, { headers: auth.headers, params: { ...auth.params, ...params }, timeout: 8000 });
  if (getCache.size > 1000) getCache.clear();
  getCache.set(cacheKey, { at: Date.now(), value: res.data });
  return res.data;
}

async function fetchTmdbSource(apiKey: string, mediaType: OverrideMediaType, tmdbId: number, lang = 'en-US'): Promise<Record<string, unknown> | null> {
  const apiType = mediaType === 'movie' ? 'movie' : 'tv';
  const cacheKey = `${apiType}:${tmdbId}:${lang}`;
  const hit = sourceCache.get(cacheKey);
  if (hit && Date.now() - hit.at < SOURCE_TTL_MS) return hit.value;
  const axios = require('axios');
  const auth = tmdbAuth(apiKey);
  try {
    const res = await axios.get(`${TMDB_BASE}/${apiType}/${tmdbId}`, {
      headers: auth.headers, params: { ...auth.params, language: lang }, timeout: 8000,
    });
    const detail = res.data && typeof res.data === 'object' ? res.data : null;
    if (!detail || !Number.isInteger(detail.id)) return null;
    const value = { ...detail, isJapaneseAnimation: tmdb.isTmdbAnimeItem(detail) };
    if (sourceCache.size > 500) sourceCache.clear();
    sourceCache.set(cacheKey, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

// Apply an override to one library row: the same write the matcher makes for
// its own matches (canonical version stamp, classification, identity reset),
// or the terminal 'ignored' status that catalogs never show.
async function apply(job: OverrideJob, override: Override, { tmdbApiKey, lang = 'en-US', origin = 'owner' }: { tmdbApiKey: string; lang?: string; origin?: 'owner' | 'shared' }): Promise<'matched' | 'ignored' | 'failed'> {
  const pool = await store.ensure();
  if (override.action === 'ignore') {
    await pool.query(
      `UPDATE lib_items SET match_status = 'ignored', match_error = NULL, match_version = $2,
              match_next_retry_at = NULL
        WHERE id = $1`,
      [job.id, matchVersion()]
    );
    return 'ignored';
  }
  if (!override.tmdbId || !override.mediaType || !tmdbApiKey) return 'failed';
  const source = await fetchTmdbSource(tmdbApiKey, override.mediaType, override.tmdbId, lang);
  if (!source) return 'failed';
  const isMovie = override.mediaType === 'movie';
  // A whole-season pack keeps the range the parser found unless the owner
  // picked a specific season; single files take the owner's season/episode.
  const season = isMovie ? null : (override.season ?? job.season ?? null);
  const episode = isMovie ? null : (override.season != null ? override.episode : (override.episode ?? job.episode ?? null));
  const seasonStart = isMovie || override.season != null ? null : (job.season_start ?? null);
  const seasonEnd = isMovie || override.season != null ? null : (job.season_end ?? null);
  const meta = builder.buildMatchMeta(source, override.mediaType, job.raw || {}, season, episode, null, seasonStart, seasonEnd);
  if (!meta || !meta.tmdbId) return 'failed';
  const { torboxItem, ...stored } = meta;
  const imdbId = await tmdb.getImdbId(tmdbApiKey, isMovie ? 'movie' : 'tv', override.tmdbId).catch(() => null);
  const released = String(source['release_date'] || source['first_air_date'] || '');
  await store.saveMatch(job.id, {
    status: 'matched',
    tmdbId: override.tmdbId,
    imdbId: imdbId || null,
    // manual: this library's own fix; shared: learned from other owners.
    matchMeta: { ...stored, imdbId: imdbId || undefined, torboxItem: undefined, ...(origin === 'shared' ? { shared: true } : { manual: true }) },
    version: matchVersion(),
    classification: {
      mediaType: override.mediaType,
      title: meta.name || null,
      year: /^\d{4}/.test(released) ? Number(released.slice(0, 4)) : null,
      season,
      seasonStart,
      seasonEnd,
      episode,
      episodeEnd: null,
    },
  });
  return 'matched';
}

export interface OverridesApi {
  forJobs: typeof forJobs;
  lookup: typeof lookup;
  save: typeof save;
  remove: typeof remove;
  apply: typeof apply;
  fetchTmdbSource: typeof fetchTmdbSource;
  tmdbGet: typeof tmdbGet;
}

module.exports = { forJobs, lookup, save, remove, apply, fetchTmdbSource, tmdbGet } satisfies OverridesApi;
