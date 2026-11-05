'use strict';
// Simkl personal rows: Plan to Watch, Watching, Completed, Up Next and
// Airing Next, read with the setup's own Simkl connection (the existing V1
// app: SIMKL_CLIENT_ID + the user's token in keys.watchlist.simkl).
//
// Quota care (free accounts get ~500 calls a day): each status list is one
// cached bucket per user, fresh for an hour; after that one call to
// /sync/activities decides whether anything changed before a list is pulled
// again. Airing Next joins the public calendar files (no user token, one
// shared copy for the server) with the user's own shows. Every call names
// the app (client_id, app-name, app-version and a User-Agent) as Simkl asks.
import type { UserListContext, UserListRuntimeApi } from './runtime.ts';
import type { ListItem } from './metas.ts';

const rt = require('./runtime.ts') as UserListRuntimeApi;
const { version: APP_VERSION } = require('../../../package.json') as { version: string };

const API = 'https://api.simkl.com';
const CALENDAR = 'https://data.simkl.in/calendar';
const APP_NAME = 'lelibrary';
const FRESH_MS = 60 * 60 * 1000;
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const STORE_TTL_S = 2 * 24 * 60 * 60;
const STAMP_TTL_S = 5 * 60;
const USER_TTL_S = 24 * 60 * 60;
const CALENDAR_TTL_S = 6 * 60 * 60;
const BUCKET_CAP = 500;
// Calendar entries that aired up to this long ago still count as "next".
const AIRING_GRACE_MS = 6 * 60 * 60 * 1000;

export type SimklKind = 'shows' | 'anime' | 'movies';
export type SimklStatus = 'plantowatch' | 'watching' | 'completed';

// One title from a status list, compact (it is stored per user).
export interface SimklEntry {
  simkl: number | null;
  item: ListItem;
  // Sort time: when added (plan to watch) or last watched.
  at: string;
  next?: string | null;
}

export interface SimklAuth { token: string; clientId: string }

function appParams(clientId: string): Record<string, string> {
  return { client_id: clientId, 'app-name': APP_NAME, 'app-version': APP_VERSION };
}

function headers(auth: SimklAuth | null, clientId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': `LeLibrary/${APP_VERSION}`,
    'simkl-api-key': clientId,
    ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function posterOf(media: Record<string, unknown>): string | null {
  const raw = typeof media['poster'] === 'string' ? (media['poster'] as string).trim() : '';
  if (!raw) return null;
  if (/^https:\/\//.test(raw)) return raw;
  return /^[A-Za-z0-9/_-]+$/.test(raw) ? `https://simkl.in/posters/${raw}_m.jpg` : null;
}

function episodeCode(value: unknown): string {
  const raw = String(value || '').trim().toUpperCase();
  return /^S\d{1,4}E\d{1,5}$/.test(raw) ? raw : '';
}

// One /sync/all-items response -> compact entries, newest first, capped.
function entriesFrom(data: unknown, kind: SimklKind, status: SimklStatus): SimklEntry[] {
  const body = asRecord(data);
  const list = Array.isArray(body[kind]) ? body[kind] as unknown[] : [];
  const out: SimklEntry[] = [];
  for (const raw of list) {
    const row = asRecord(raw);
    const media = asRecord(kind === 'movies' ? row['movie'] : row['show']);
    const ids = asRecord(media['ids']);
    const title = String(media['title'] || '').trim();
    if (!title) continue;
    const isMovie = kind === 'movies' || (kind === 'anime' && String(row['anime_type'] || '').toLowerCase() === 'movie');
    const simkl = Number(ids['simkl'] ?? ids['simkl_id']);
    const next = episodeCode(row['next_to_watch']);
    const info = asRecord(row['next_to_watch_info']);
    const nextTitle = typeof info['title'] === 'string' ? (info['title'] as string).trim() : '';
    out.push({
      simkl: Number.isInteger(simkl) && simkl > 0 ? simkl : null,
      item: {
        type: isMovie ? 'movie' : 'series',
        title,
        imdb: typeof ids['imdb'] === 'string' ? ids['imdb'] as string : null,
        tmdb: Number(ids['tmdb']) || null,
        year: Number(media['year']) || null,
        poster: posterOf(media),
      },
      at: String((status === 'plantowatch' ? row['added_to_watchlist_at'] : row['last_watched_at']) || row['added_to_watchlist_at'] || ''),
      ...(next ? { next: nextTitle ? `${next} ${nextTitle}`.slice(0, 160) : next } : {}),
    });
  }
  out.sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0));
  return out.slice(0, BUCKET_CAP);
}

function fpOf(auth: SimklAuth): string {
  return rt.credentialFp('simkl', auth.token);
}

// The user's activity stamp: changes whenever any list changes.
function activityStamp(ctx: UserListContext, auth: SimklAuth): () => Promise<string | null> {
  const fp = fpOf(auth);
  return () => rt.cachedValue(ctx, rt.cacheKey('simkl', 'act', fp), rt.cacheKey('simkl', 'backoff', fp), STAMP_TTL_S, async () => {
    const res = await ctx.http.get(`${API}/sync/activities`, { headers: headers(auth, auth.clientId), params: appParams(auth.clientId), timeout: 15000 });
    const data = asRecord(res?.data);
    const all = typeof data['all'] === 'string' ? data['all'] as string : '';
    return all || require('../runtime/cache-fingerprint.ts').hashShort(JSON.stringify(data));
  });
}

async function bucket(ctx: UserListContext, auth: SimklAuth, kind: SimklKind, status: SimklStatus): Promise<SimklEntry[]> {
  const fp = fpOf(auth);
  const data = await rt.gatedBucket<SimklEntry[]>({
    ctx,
    key: rt.cacheKey('simkl', 'items', kind, status, fp),
    backoffKey: rt.cacheKey('simkl', 'backoff', fp),
    label: `simkl ${kind}/${status}`,
    freshMs: FRESH_MS,
    maxAgeMs: MAX_AGE_MS,
    storeTtlS: STORE_TTL_S,
    stamp: activityStamp(ctx, auth),
    load: async () => {
      const res = await ctx.http.get(`${API}/sync/all-items/${kind}/${status}`, {
        headers: headers(auth, auth.clientId),
        params: { ...appParams(auth.clientId), extended: 'full', ...(status === 'watching' && kind !== 'movies' ? { next_watch_info: 'yes' } : {}) },
        timeout: 20000,
      });
      return entriesFrom(res?.data, kind, status);
    },
  });
  return Array.isArray(data) ? data : [];
}

// Public calendar (tv or anime): shared by every user, nothing personal sent.
export interface CalendarEntry { simkl: number; at: string; episode: string }

function calendarFrom(data: unknown): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const raw of Array.isArray(data) ? data : []) {
    const row = asRecord(raw);
    const ids = asRecord(row['ids']);
    const simkl = Number(ids['simkl_id'] ?? ids['simkl']);
    const at = String(row['date'] || row['release_date'] || '');
    if (!Number.isInteger(simkl) || simkl <= 0 || !Number.isFinite(Date.parse(at))) continue;
    const ep = asRecord(row['episode']);
    const season = Number(ep['season']);
    const episode = Number(ep['episode']);
    out.push({
      simkl,
      at: new Date(Date.parse(at)).toISOString(),
      episode: Number.isInteger(episode) && episode > 0
        ? `S${String(Number.isInteger(season) && season >= 0 ? season : 1).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
        : '',
    });
  }
  return out;
}

async function calendar(ctx: UserListContext, kind: 'tv' | 'anime', clientId: string): Promise<CalendarEntry[]> {
  const key = rt.cacheKey('simkl', 'calendar', kind);
  const data = await rt.gatedBucket<CalendarEntry[]>({
    ctx,
    key,
    backoffKey: rt.cacheKey('simkl', 'calendar-backoff'),
    label: `simkl calendar/${kind}`,
    freshMs: CALENDAR_TTL_S * 1000,
    maxAgeMs: CALENDAR_TTL_S * 1000,
    storeTtlS: STORE_TTL_S,
    load: async () => {
      const res = await ctx.http.get(`${CALENDAR}/${kind}.json`, { headers: headers(null, clientId), params: appParams(clientId), timeout: 20000 });
      return calendarFrom(res?.data);
    },
  });
  return Array.isArray(data) ? data : [];
}

function dedupe(entries: SimklEntry[]): SimklEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entry.simkl ? `s${entry.simkl}` : `${entry.item.type}:${entry.item.imdb || entry.item.tmdb || entry.item.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function newestFirst(entries: SimklEntry[]): SimklEntry[] {
  return entries.slice().sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0));
}

function airingDate(iso: string): string {
  return iso.slice(0, 10);
}

// One row's items for one user, in row order.
async function simklRowItems(ctx: UserListContext, auth: SimklAuth, list: string, type: 'movie' | 'series'): Promise<ListItem[]> {
  if (!auth.token || !auth.clientId) return [];
  const forType = (entries: SimklEntry[]) => entries.filter((entry) => entry.item.type === type);
  if (list === 'plantowatch' || list === 'completed') {
    const status = list as SimklStatus;
    const parts = type === 'movie'
      ? await Promise.all([bucket(ctx, auth, 'movies', status), bucket(ctx, auth, 'anime', status)])
      : await Promise.all([bucket(ctx, auth, 'shows', status), bucket(ctx, auth, 'anime', status)]);
    return dedupe(newestFirst(forType(parts.flat()))).map((entry) => entry.item);
  }
  if (type !== 'series') return [];
  if (list === 'watching' || list === 'upnext') {
    const parts = await Promise.all([bucket(ctx, auth, 'shows', 'watching'), bucket(ctx, auth, 'anime', 'watching')]);
    let entries = dedupe(newestFirst(forType(parts.flat())));
    if (list === 'upnext') entries = entries.filter((entry) => entry.next);
    return entries.map((entry) => (list === 'upnext' && entry.next ? { ...entry.item, note: `Next: ${entry.next}` } : entry.item));
  }
  if (list === 'airing') {
    const [mine, tv, anime] = await Promise.all([
      Promise.all([
        bucket(ctx, auth, 'shows', 'watching'), bucket(ctx, auth, 'anime', 'watching'),
        bucket(ctx, auth, 'shows', 'plantowatch'), bucket(ctx, auth, 'anime', 'plantowatch'),
      ]).then((parts) => forType(parts.flat())),
      calendar(ctx, 'tv', auth.clientId),
      calendar(ctx, 'anime', auth.clientId),
    ]);
    const byId = new Map<number, SimklEntry>();
    for (const entry of mine) if (entry.simkl && !byId.has(entry.simkl)) byId.set(entry.simkl, entry);
    const since = new Date(ctx.now() - AIRING_GRACE_MS).toISOString();
    const upcoming = [...tv, ...anime]
      .filter((entry) => byId.has(entry.simkl) && entry.at >= since)
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const seen = new Set<number>();
    const out: ListItem[] = [];
    for (const next of upcoming) {
      if (seen.has(next.simkl)) continue;
      seen.add(next.simkl);
      const entry = byId.get(next.simkl) as SimklEntry;
      out.push({ ...entry.item, note: `${next.episode ? `${next.episode} ` : ''}airs ${airingDate(next.at)}` });
    }
    return out;
  }
  return [];
}

// Display name for the edit page ("Connected as ..."), cached a day per token.
async function simklUsername(ctx: UserListContext, auth: SimklAuth): Promise<string | null> {
  if (!auth.token || !auth.clientId) return null;
  const fp = fpOf(auth);
  try {
    return await rt.cachedValue(ctx, rt.cacheKey('simkl', 'user', fp), rt.cacheKey('simkl', 'backoff', fp), USER_TTL_S, async () => {
      const res = await ctx.http.post(`${API}/users/settings`, {}, { headers: headers(auth, auth.clientId), params: appParams(auth.clientId), timeout: 8000 });
      const user = asRecord(asRecord(res?.data)['user']);
      const name = typeof user['name'] === 'string' ? (user['name'] as string).trim().slice(0, 80) : '';
      return name || null;
    });
  } catch {
    return null;
  }
}

export interface SimklListsApi {
  entriesFrom: typeof entriesFrom;
  calendarFrom: typeof calendarFrom;
  simklRowItems: typeof simklRowItems;
  simklUsername: typeof simklUsername;
  FRESH_MS: number;
}

module.exports = { entriesFrom, calendarFrom, simklRowItems, simklUsername, FRESH_MS } satisfies SimklListsApi;
