'use strict';
// AniList personal rows: Watching, Plan to Watch and Completed anime.
//
// Public lists are read by username (config `anilistUser`, no login); an
// optional AniList connection (keys.watchlist.anilist, one-year token, no
// refresh) reads the viewer's own lists, private ones included. One GraphQL
// call returns all three lists for a user, cached three hours.
//
// AniList currently allows about 30 requests a minute PER SERVER IP, shared
// by every hosted setup. So: single-flight per user, a long cache, a
// server-wide budget (THROTTLE_PER_MIN, below AniList's limit) and a
// server-wide wait after a 429. A user over the budget gets their last copy
// (or an empty row) and their row tries again a minute later.
//
// AniList ids map to IMDb / TMDB through the same Fribb anime-lists map
// Anime This Season uses (catalog/anilist-season.ts). Unmapped titles are
// left out, never guessed.
import type { UserListContext, UserListRuntimeApi } from './runtime.ts';
import type { ListItem } from './metas.ts';

const rt = require('./runtime.ts') as UserListRuntimeApi;

const GRAPHQL = 'https://graphql.anilist.co';
const FRESH_MS = 3 * 60 * 60 * 1000;
const STORE_TTL_S = 2 * 24 * 60 * 60;
const VIEWER_TTL_S = 24 * 60 * 60;
const LIST_CAP = 500;
const THROTTLE_PER_MIN = 20;
const SERVER_BACKOFF = 'ulist:v1:anilist:backoff';

export type AnilistList = 'current' | 'planning' | 'completed';
type Mapped = { imdb?: string; tv?: number; movie?: number };

// Stored per user: AniList ids per list (mapping happens on read, so a map
// update reaches cached lists).
export interface AnilistEntry { id: number; title: string; year: number | null; movie: boolean; cover: string | null }
export type AnilistLists = Record<AnilistList, AnilistEntry[]>;

const LISTS_QUERY = `query ($userName: String, $userId: Int) {
  MediaListCollection(userName: $userName, userId: $userId, type: ANIME, status_in: [CURRENT, REPEATING, PLANNING, COMPLETED], sort: UPDATED_TIME_DESC, forceSingleCompletedList: true) {
    lists { status entries { status media { id format isAdult title { english romaji } startDate { year } coverImage { large } } } }
  }
}`;
const VIEWER_QUERY = 'query { Viewer { id name } }';

// ── Server-wide budget ──────────────────────────────────────────────────
const sent: number[] = [];

function takeBudget(now: number): boolean {
  while (sent.length && now - (sent[0] as number) >= 60_000) sent.shift();
  if (sent.length >= THROTTLE_PER_MIN) return false;
  sent.push(now);
  return true;
}

// Test seam.
function resetBudget(): void {
  sent.length = 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function graphql(ctx: UserListContext, query: string, variables: Record<string, unknown>, token: string): Promise<Record<string, unknown>> {
  if (rt.backedOff(SERVER_BACKOFF, ctx.now())) throw rt.waitingError('AniList is cooling down');
  if (!takeBudget(ctx.now())) throw Object.assign(new Error('AniList budget used'), { budget: true });
  try {
    const res = await ctx.http.post(GRAPHQL, { query, variables }, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      timeout: 15000,
    });
    return asRecord(asRecord(res?.data)['data']);
  } catch (err) {
    // AniList's limit is per IP: a 429 makes the whole server wait.
    if (rt.isUpstream429(err)) rt.markBackoff(SERVER_BACKOFF, rt.retryAfterSeconds(err), ctx.now());
    throw err;
  }
}

function listsFrom(data: Record<string, unknown>): AnilistLists {
  const out: AnilistLists = { current: [], planning: [], completed: [] };
  const collection = asRecord(data['MediaListCollection']);
  for (const list of Array.isArray(collection['lists']) ? collection['lists'] as unknown[] : []) {
    for (const raw of Array.isArray(asRecord(list)['entries']) ? asRecord(list)['entries'] as unknown[] : []) {
      const entry = asRecord(raw);
      const status = String(entry['status'] || asRecord(list)['status'] || '');
      const target: AnilistList | null = status === 'CURRENT' || status === 'REPEATING' ? 'current'
        : status === 'PLANNING' ? 'planning' : status === 'COMPLETED' ? 'completed' : null;
      if (!target || out[target].length >= LIST_CAP) continue;
      const media = asRecord(entry['media']);
      const id = Number(media['id']);
      if (!Number.isInteger(id) || id <= 0 || media['isAdult'] === true) continue;
      const title = asRecord(media['title']);
      if (out[target].some((item) => item.id === id)) continue;
      out[target].push({
        id,
        title: String(title['english'] || title['romaji'] || '').slice(0, 200),
        year: Number(asRecord(media['startDate'])['year']) || null,
        movie: String(media['format'] || '') === 'MOVIE',
        cover: typeof asRecord(media['coverImage'])['large'] === 'string' ? asRecord(media['coverImage'])['large'] as string : null,
      });
    }
  }
  return out;
}

export interface AnilistAuth { user: string; token: string }

function fpOf(auth: AnilistAuth): string {
  // A connection reads private lists: its own fingerprint, never the
  // username's (a public read of the same name must not see them).
  return auth.token ? rt.credentialFp('anilist-token', auth.token) : rt.credentialFp('anilist-user', auth.user.toLowerCase());
}

async function viewerOf(ctx: UserListContext, token: string): Promise<{ id: number; name: string } | null> {
  const fp = rt.credentialFp('anilist-token', token);
  return rt.cachedValue(ctx, rt.cacheKey('anilist', 'viewer', fp), SERVER_BACKOFF, VIEWER_TTL_S, async () => {
    const data = await graphql(ctx, VIEWER_QUERY, {}, token);
    const viewer = asRecord(data['Viewer']);
    const id = Number(viewer['id']);
    return Number.isInteger(id) && id > 0 ? { id, name: String(viewer['name'] || '').slice(0, 40) } : null;
  });
}

async function anilistLists(ctx: UserListContext, auth: AnilistAuth): Promise<AnilistLists | null> {
  if (!auth.token && !auth.user) return null;
  const fp = fpOf(auth);
  return rt.gatedBucket<AnilistLists>({
    ctx,
    key: rt.cacheKey('anilist', 'lists', fp),
    backoffKey: SERVER_BACKOFF,
    label: 'anilist lists',
    freshMs: FRESH_MS,
    maxAgeMs: FRESH_MS,
    storeTtlS: STORE_TTL_S,
    load: async () => {
      let variables: Record<string, unknown> = { userName: auth.user };
      if (auth.token) {
        const viewer = await viewerOf(ctx, auth.token);
        if (!viewer) throw Object.assign(new Error('AniList connection has no viewer'), { response: { status: 401 } });
        variables = { userId: viewer.id };
      }
      return listsFrom(await graphql(ctx, LISTS_QUERY, variables, auth.token));
    },
  });
}

// AniList entries -> list items (movies or series) through the id map.
function mapEntries(entries: AnilistEntry[], map: Record<string, Mapped>, type: 'movie' | 'series'): ListItem[] {
  const out: ListItem[] = [];
  for (const entry of entries) {
    if ((type === 'movie') !== entry.movie) continue;
    const mapped = map[String(entry.id)];
    if (!mapped) continue;
    const tmdb = type === 'movie' ? mapped.movie : mapped.tv;
    if (!mapped.imdb && !tmdb) continue;
    out.push({ type, title: entry.title, imdb: mapped.imdb || null, tmdb: tmdb || null, year: entry.year, poster: entry.cover });
  }
  return out;
}

async function anilistRowItems(ctx: UserListContext, auth: AnilistAuth, list: string, type: 'movie' | 'series', deps: { idMap?: () => Promise<Record<string, Mapped>> } = {}): Promise<ListItem[]> {
  if (list !== 'current' && list !== 'planning' && list !== 'completed') return [];
  const lists = await anilistLists(ctx, auth);
  if (!lists) return [];
  const entries = lists[list as AnilistList] || [];
  if (!entries.some((entry) => (type === 'movie') === entry.movie)) return [];
  const idMap = deps.idMap || require('../catalog/anilist-season.ts').idMap;
  const map = await Promise.resolve(idMap()).catch(() => ({}));
  return mapEntries(entries, map as Record<string, Mapped>, type);
}

// Display name: the username, or the connected viewer's name.
async function anilistName(ctx: UserListContext, auth: AnilistAuth): Promise<string | null> {
  if (auth.token) {
    const viewer = await viewerOf(ctx, auth.token).catch(() => null);
    if (viewer?.name) return viewer.name;
  }
  return auth.user || null;
}

export interface AnilistListsApi {
  listsFrom: typeof listsFrom;
  mapEntries: typeof mapEntries;
  anilistRowItems: typeof anilistRowItems;
  anilistName: typeof anilistName;
  resetBudget: typeof resetBudget;
  THROTTLE_PER_MIN: number;
}

module.exports = { listsFrom, mapEntries, anilistRowItems, anilistName, resetBudget, THROTTLE_PER_MIN } satisfies AnilistListsApi;
