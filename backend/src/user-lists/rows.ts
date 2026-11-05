'use strict';
// Personal list rows (v6): which rows exist, their catalogue ids and which
// setups can have them. Pure: no network, no cache.
//
// Row ids are `lelibrary-user-{provider}-{list}-{type}` (type movie|series).
// The watchlist rows declared since v5.5 (`torbox-watchlist-{provider}-{type}`)
// stay as aliases: Simkl's is Plan to Watch, MDBList's is the Watchlist, so
// Home rows pushed before v6 fill in without a re-push. Trakt is no longer
// offered (an API app needs Trakt VIP); its old rows answer empty.

export type UserListProvider = 'simkl' | 'mdblist' | 'anilist';
export type UserListType = 'movie' | 'series';

export interface UserListRef {
  provider: UserListProvider;
  // simkl: upnext|airing|plantowatch|watching|completed
  // mdblist: watchlist|upnext|list.{id}
  // anilist: current|planning|completed
  list: string;
  type: UserListType;
  // The old torbox-watchlist-* id this ref was parsed from, if any.
  alias?: string;
}

export interface UserListRowDef {
  provider: UserListProvider;
  list: string;
  types: UserListType[];
  title: string;
}

// Every fixed row. MDBList lists (`list.{id}`) are picked per setup and take
// the list's own name.
const ROW_DEFS: UserListRowDef[] = [
  { provider: 'simkl', list: 'upnext', types: ['series'], title: 'Simkl Up Next' },
  { provider: 'simkl', list: 'airing', types: ['series'], title: 'Simkl Airing Next' },
  { provider: 'simkl', list: 'plantowatch', types: ['movie', 'series'], title: 'Simkl Plan to Watch' },
  { provider: 'simkl', list: 'watching', types: ['series'], title: 'Simkl Watching' },
  { provider: 'simkl', list: 'completed', types: ['movie', 'series'], title: 'Simkl Completed' },
  { provider: 'mdblist', list: 'watchlist', types: ['movie', 'series'], title: 'MDBList Watchlist' },
  { provider: 'mdblist', list: 'upnext', types: ['series'], title: 'MDBList Up Next' },
  { provider: 'anilist', list: 'current', types: ['series', 'movie'], title: 'AniList Watching' },
  { provider: 'anilist', list: 'planning', types: ['series', 'movie'], title: 'AniList Plan to Watch' },
  { provider: 'anilist', list: 'completed', types: ['series', 'movie'], title: 'AniList Completed' },
];

const ID_PATTERN = /^lelibrary-user-(simkl|mdblist|anilist)-([a-z]+|list\.\d{1,12})-(movie|series)$/;
const ALIAS_PATTERN = /^torbox-watchlist-([a-z]+)-(movie|series)$/;
const ALIAS_TARGET: Record<string, { provider: UserListProvider; list: string }> = {
  simkl: { provider: 'simkl', list: 'plantowatch' },
  mdblist: { provider: 'mdblist', list: 'watchlist' },
};
// AniList usernames: 2-20 letters, digits or underscores.
const ANILIST_USER = /^[A-Za-z0-9_]{2,20}$/;

function rowDef(provider: string, list: string): UserListRowDef | null {
  return ROW_DEFS.find((def) => def.provider === provider && def.list === list) || null;
}

function isMdblistListId(list: string): boolean {
  return /^list\.\d{1,12}$/.test(list);
}

// A catalogue id -> the row it names, or null. Aliases resolve to their
// v6 row; Trakt's old rows (and anything unknown) are null.
function parseUserListId(catalogId: unknown): UserListRef | null {
  const id = String(catalogId || '');
  const direct = id.match(ID_PATTERN);
  if (direct) {
    const provider = direct[1] as UserListProvider;
    const list = direct[2] as string;
    const type = direct[3] as UserListType;
    if (provider === 'mdblist' && isMdblistListId(list)) return { provider, list, type };
    const def = rowDef(provider, list);
    if (!def || !def.types.includes(type)) return null;
    return { provider, list, type };
  }
  const alias = id.match(ALIAS_PATTERN);
  if (alias) {
    const target = ALIAS_TARGET[alias[1] as string];
    if (!target) return null;
    return { ...target, type: alias[2] as UserListType, alias: id };
  }
  return null;
}

// Any personal list id, the old aliases (Trakt's too) included.
function isUserListCatalogId(catalogId: unknown): boolean {
  const id = String(catalogId || '');
  return ID_PATTERN.test(id) || ALIAS_PATTERN.test(id);
}

function userListId(provider: UserListProvider, list: string, type: UserListType): string {
  return `lelibrary-user-${provider}-${list}-${type}`;
}

function normaliseAnilistUser(value: unknown): string | null {
  const name = typeof value === 'string' ? value.trim() : '';
  return ANILIST_USER.test(name) ? name : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// The OAuth connection stored for one provider in an engine config (the
// setup's keys merged over its config), or null.
function watchlistToken(config: Record<string, unknown>, provider: string): string {
  const conn = asRecord(asRecord(config['watchlist'])[provider]);
  const token = conn['access_token'];
  if (typeof token !== 'string' || !token) return '';
  const expires = Number(conn['expires_at'] || 0);
  if (expires && expires <= Date.now()) return '';
  return token;
}

export interface UserListServices { simkl: boolean; mdblist: boolean; anilist: boolean }

// Which personal list services one engine config can serve.
function userListServices(config: Record<string, unknown> | null | undefined): UserListServices {
  const c = config || {};
  return {
    simkl: Boolean(watchlistToken(c, 'simkl')),
    mdblist: typeof c['mdblistKey'] === 'string' && Boolean((c['mdblistKey'] as string).trim()),
    anilist: Boolean(normaliseAnilistUser(c['anilistUser']) || watchlistToken(c, 'anilist')),
  };
}

// Default display title of a row (manifest name, Home row title).
function userListTitle(ref: UserListRef, listName = ''): string {
  if (ref.provider === 'mdblist' && isMdblistListId(ref.list)) {
    const name = String(listName || '').trim();
    return (name || 'MDBList list').slice(0, 80);
  }
  return rowDef(ref.provider, ref.list)?.title || 'Your list';
}

// Every fixed row a set of services offers, in picker order.
function fixedRowsFor(services: UserListServices): { id: string; provider: UserListProvider; list: string; type: UserListType; title: string }[] {
  const out: { id: string; provider: UserListProvider; list: string; type: UserListType; title: string }[] = [];
  for (const def of ROW_DEFS) {
    if (!services[def.provider]) continue;
    for (const type of def.types) out.push({ id: userListId(def.provider, def.list, type), provider: def.provider, list: def.list, type, title: def.title });
  }
  return out;
}

// MDBList list mediatype -> the row types it fills ('mixed', unified or
// unknown lists fill both).
function mdblistListTypes(mediatype: unknown): UserListType[] {
  const value = String(mediatype || '').toLowerCase();
  if (value === 'movie') return ['movie'];
  if (value === 'show' || value === 'series' || value === 'tv') return ['series'];
  return ['movie', 'series'];
}

export interface UserListRowsApi {
  ROW_DEFS: UserListRowDef[];
  parseUserListId: typeof parseUserListId;
  isUserListCatalogId: typeof isUserListCatalogId;
  userListId: typeof userListId;
  normaliseAnilistUser: typeof normaliseAnilistUser;
  watchlistToken: typeof watchlistToken;
  userListServices: typeof userListServices;
  userListTitle: typeof userListTitle;
  fixedRowsFor: typeof fixedRowsFor;
  mdblistListTypes: typeof mdblistListTypes;
  isMdblistListId: typeof isMdblistListId;
}

module.exports = {
  ROW_DEFS, parseUserListId, isUserListCatalogId, userListId, normaliseAnilistUser, watchlistToken,
  userListServices, userListTitle, fixedRowsFor, mdblistListTypes, isMdblistListId,
} satisfies UserListRowsApi;
