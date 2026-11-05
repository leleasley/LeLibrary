'use strict';
// MDBList personal rows (Watchlist, Up Next, the user's own and liked lists)
// and the "Your MDBList lists" picker, read with the setup's own MDBList key.
//
// Quota care (free accounts: 1,000 calls a day, shared with the user's other
// apps): each list is one cached bucket per key, fresh for an hour; after
// that /sync/last_activities (one call) decides whether to pull again. List
// items page with MDBList's cursor and stop at ITEM_CAP. The key only ever
// travels to api.mdblist.com; it is never logged or returned.
import type { HttpLike, UserListContext, UserListRuntimeApi } from './runtime.ts';
import type { ListItem } from './metas.ts';

const rt = require('./runtime.ts') as UserListRuntimeApi;

const API = 'https://api.mdblist.com';
const FRESH_MS = 60 * 60 * 1000;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const STORE_TTL_S = 2 * 24 * 60 * 60;
const STAMP_TTL_S = 5 * 60;
const USER_TTL_S = 24 * 60 * 60;
const LISTS_TTL_S = 10 * 60;
// Items kept per list (and per watchlist), over at most PAGE_MAX requests.
const ITEM_CAP = 500;
const PAGE_LIMIT = 250;
const PAGE_MAX = 4;
const UPNEXT_LIMIT = 100;
const LIKED_PAGE = 100;
const LIKED_MAX_PAGES = 3;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function headerValue(headers: unknown, name: string): string {
  const record = asRecord(headers);
  const direct = record[name] ?? record[name.toLowerCase()];
  if (direct !== undefined) return String(direct);
  const get = (headers as { get?: (n: string) => unknown } | null)?.get;
  return typeof get === 'function' ? String(get.call(headers, name) ?? '') : '';
}

// All pages of one MDBList items endpoint (a list or the watchlist), up to
// `cap` items. Cursor paging (`next_cursor`, top level or in `pagination`);
// a response that says it has more but gives no cursor falls back to the
// deprecated offset. Movies and shows arrive in separate arrays.
async function mdblistItemPages(get: HttpLike['get'], url: string, params: Record<string, unknown>, cap = ITEM_CAP): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let cursor = '';
  for (let page = 0; page < PAGE_MAX && out.length < cap; page++) {
    const limit = Math.min(PAGE_LIMIT, cap - out.length);
    const query: Record<string, unknown> = { ...params, limit };
    if (cursor) query['cursor'] = cursor;
    else if (page > 0) query['offset'] = out.length;
    const res = await get(url, { params: query, timeout: 20000 });
    const data = asRecord(res?.data);
    const items = [
      ...(Array.isArray(res?.data) ? res?.data as unknown[] : []),
      ...(Array.isArray(data['movies']) ? data['movies'] as unknown[] : []),
      ...(Array.isArray(data['shows']) ? data['shows'] as unknown[] : []),
      ...(Array.isArray(data['items']) ? data['items'] as unknown[] : []),
    ].map(asRecord);
    out.push(...items);
    const pagination = asRecord(data['pagination']);
    const next = String(pagination['next_cursor'] ?? data['next_cursor'] ?? '').trim();
    const more = next !== '' || pagination['has_more'] === true || data['has_more'] === true || headerValue(res?.headers, 'X-Has-More') === 'true';
    if (!items.length || !more) break;
    cursor = next;
  }
  return out.slice(0, cap);
}

function itemFrom(raw: Record<string, unknown>): ListItem | null {
  const ids = asRecord(raw['ids']);
  const mediatype = String(raw['mediatype'] || raw['type'] || '').toLowerCase();
  if (mediatype && mediatype !== 'movie' && mediatype !== 'show') return null;
  const title = String(raw['title'] || raw['name'] || '').trim();
  if (!title) return null;
  const poster = typeof raw['poster'] === 'string' ? raw['poster'] as string : typeof raw['poster_path'] === 'string' ? raw['poster_path'] as string : null;
  return {
    type: mediatype === 'show' ? 'series' : 'movie',
    title,
    imdb: String(raw['imdb_id'] || ids['imdb'] || '') || null,
    tmdb: Number(ids['tmdb'] ?? raw['tmdb_id'] ?? raw['id']) || null,
    year: Number(raw['release_year'] || raw['year']) || null,
    poster,
  };
}

function upnextFrom(data: unknown): ListItem[] {
  const out: ListItem[] = [];
  for (const raw of Array.isArray(asRecord(data)['items']) ? asRecord(data)['items'] as unknown[] : []) {
    const row = asRecord(raw);
    const show = asRecord(row['show']);
    const ids = asRecord(show['ids']);
    const title = String(show['title'] || '').trim();
    if (!title) continue;
    const next = asRecord(row['next_episode']);
    const code = typeof next['display_code'] === 'string' ? (next['display_code'] as string).trim()
      : Number.isInteger(Number(next['episode'])) && next['episode'] !== undefined
        ? `S${String(Number(next['season']) || 0).padStart(2, '0')}E${String(Number(next['episode'])).padStart(2, '0')}` : '';
    const name = typeof next['title'] === 'string' ? (next['title'] as string).trim() : '';
    out.push({
      type: 'series',
      title,
      imdb: typeof ids['imdb'] === 'string' ? ids['imdb'] as string : null,
      tmdb: Number(ids['tmdb']) || null,
      year: Number(show['year']) || null,
      poster: typeof show['poster'] === 'string' ? show['poster'] as string : null,
      note: code ? `Next: ${code}${name ? ` ${name}` : ''}`.slice(0, 160) : null,
    });
  }
  return out;
}

function fpOf(key: string): string {
  return rt.credentialFp('mdblist', key);
}

function activityStamp(ctx: UserListContext, key: string): () => Promise<string | null> {
  const fp = fpOf(key);
  return () => rt.cachedValue(ctx, rt.cacheKey('mdblist', 'act', fp), rt.cacheKey('mdblist', 'backoff', fp), STAMP_TTL_S, async () => {
    const res = await ctx.http.get(`${API}/sync/last_activities`, { params: { apikey: key, append_to_response: 'liked_lists' }, timeout: 10000 });
    return require('../runtime/cache-fingerprint.ts').hashShort(JSON.stringify(res?.data ?? null));
  });
}

async function listBucket(ctx: UserListContext, key: string, list: string): Promise<ListItem[]> {
  const fp = fpOf(key);
  const listId = list.startsWith('list.') ? list.slice(5) : '';
  const data = await rt.gatedBucket<ListItem[]>({
    ctx,
    key: rt.cacheKey('mdblist', 'items', list, fp),
    backoffKey: rt.cacheKey('mdblist', 'backoff', fp),
    label: `mdblist ${listId ? 'list' : list}`,
    freshMs: FRESH_MS,
    maxAgeMs: MAX_AGE_MS,
    storeTtlS: STORE_TTL_S,
    stamp: activityStamp(ctx, key),
    load: async () => {
      if (list === 'upnext') {
        const res = await ctx.http.get(`${API}/upnext`, { params: { apikey: key, limit: UPNEXT_LIMIT }, timeout: 20000 });
        return upnextFrom(res?.data);
      }
      const url = list === 'watchlist' ? `${API}/watchlist/items` : `${API}/lists/${encodeURIComponent(listId)}/items`;
      const raw = await mdblistItemPages(ctx.http.get, url, { apikey: key });
      return raw.map(itemFrom).filter((item): item is ListItem => item !== null);
    },
  });
  return Array.isArray(data) ? data : [];
}

async function mdblistRowItems(ctx: UserListContext, key: string, list: string, type: 'movie' | 'series'): Promise<ListItem[]> {
  if (!key) return [];
  if (list === 'upnext' && type !== 'series') return [];
  if (list !== 'watchlist' && list !== 'upnext' && !/^list\.\d{1,12}$/.test(list)) return [];
  return (await listBucket(ctx, key, list)).filter((item) => item.type === type);
}

// ── "Your MDBList lists" picker ─────────────────────────────────────────
export interface MdblistListSummary {
  id: number;
  name: string;
  user_name: string;
  mediatype: string;
  items: number;
  likes: number;
  source: 'own' | 'liked';
}

function summaryOf(raw: unknown, source: 'own' | 'liked', fallbackUser: string): MdblistListSummary | null {
  const row = asRecord(raw);
  const id = Number(row['id']);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    name: String(row['name'] || `List ${id}`).slice(0, 120),
    user_name: String(row['user_name'] || fallbackUser || '').slice(0, 80),
    mediatype: String(row['mediatype'] || '').slice(0, 20),
    items: Math.max(0, Number(row['items']) || 0),
    likes: Math.max(0, Number(row['likes']) || 0),
    source,
  };
}

// Own (incl. private) + liked lists, display fields only. Cached ten minutes
// per key; `refresh` skips the cache.
async function mdblistLists(ctx: UserListContext, key: string, refresh = false): Promise<MdblistListSummary[]> {
  const fp = fpOf(key);
  const cacheKey = rt.cacheKey('mdblist', 'lists', fp);
  if (!refresh) {
    const hit = await ctx.store.get(cacheKey).catch(() => null) as { value?: MdblistListSummary[] } | null;
    if (hit && Array.isArray(hit.value)) return hit.value;
  }
  if (rt.backedOff(rt.cacheKey('mdblist', 'backoff', fp), ctx.now())) throw rt.waitingError('rate limited');
  return rt.singleFlight(cacheKey, async () => {
    try {
      const username = await mdblistUsername(ctx, key).catch(() => null);
      const own = await ctx.http.get(`${API}/lists/user`, { params: { apikey: key }, timeout: 15000 });
      const liked: unknown[] = [];
      for (let page = 0; page < LIKED_MAX_PAGES; page++) {
        const res = await ctx.http.get(`${API}/lists/liked`, { params: { apikey: key, limit: LIKED_PAGE, offset: page * LIKED_PAGE }, timeout: 15000 });
        const data = asRecord(res?.data);
        const rows = Array.isArray(data['lists']) ? data['lists'] as unknown[] : Array.isArray(res?.data) ? res?.data as unknown[] : [];
        liked.push(...rows);
        if (!rows.length || asRecord(data['pagination'])['has_more'] !== true) break;
      }
      const seen = new Set<number>();
      const out: MdblistListSummary[] = [];
      for (const [rows, source] of [[Array.isArray(own?.data) ? own.data as unknown[] : asRecord(own?.data)['lists'] as unknown[] || [], 'own'], [liked, 'liked']] as const) {
        for (const raw of Array.isArray(rows) ? rows : []) {
          const summary = summaryOf(raw, source, source === 'own' ? username || '' : '');
          if (!summary || seen.has(summary.id)) continue;
          seen.add(summary.id);
          out.push(summary);
        }
      }
      await ctx.store.set(cacheKey, { value: out }, LISTS_TTL_S).catch(() => {});
      return out;
    } catch (err) {
      if (rt.isUpstream429(err)) rt.markBackoff(rt.cacheKey('mdblist', 'backoff', fp), rt.retryAfterSeconds(err), ctx.now());
      ctx.log(`[user-lists] mdblist lists failed: status=${rt.statusOf(err) || 'network'}`);
      throw err;
    }
  });
}

// "Connected as ...": the account's username from GET /user, cached a day
// per key. Only the username is kept (the response also carries account
// tokens and quota figures).
async function mdblistUsername(ctx: UserListContext, key: string): Promise<string | null> {
  if (!key) return null;
  const fp = fpOf(key);
  try {
    return await rt.cachedValue(ctx, rt.cacheKey('mdblist', 'user', fp), rt.cacheKey('mdblist', 'backoff', fp), USER_TTL_S, async () => {
      const res = await ctx.http.get(`${API}/user`, { params: { apikey: key }, timeout: 8000 });
      const name = asRecord(res?.data)['username'];
      return typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : null;
    });
  } catch {
    return null;
  }
}

export interface MdblistListsApi {
  mdblistItemPages: typeof mdblistItemPages;
  itemFrom: typeof itemFrom;
  upnextFrom: typeof upnextFrom;
  mdblistRowItems: typeof mdblistRowItems;
  mdblistLists: typeof mdblistLists;
  mdblistUsername: typeof mdblistUsername;
  ITEM_CAP: number;
}

module.exports = { mdblistItemPages, itemFrom, upnextFrom, mdblistRowItems, mdblistLists, mdblistUsername, ITEM_CAP } satisfies MdblistListsApi;
