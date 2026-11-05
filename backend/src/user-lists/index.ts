'use strict';
// Personal list rows (v6): Simkl, MDBList and AniList lists as catalogue
// rows, served from the requesting setup's own connection, key or username.
//
// Entry points:
// - buildUserListCatalog: one catalogue request (routes/catalog.ts), the
//   setup resolved from its install token like every other catalogue.
// - userListIdentities: "Connected as ..." names for the edit page.
// - connectionUsername: the account name asked once at OAuth connect.
// - checkAnilistUser: the setup config's `anilistUser` rule (an older
//   setup's public AniList name; the pages no longer write it).
// Errors become an empty row plus a log line without secrets.
import type { UserListContext, UserListRuntimeApi } from './runtime.ts';
import type { UserListRowsApi } from './rows.ts';
import type { UserListMetasApi, MetaDeps, ListItem } from './metas.ts';
import type { SimklListsApi } from './simkl.ts';
import type { MdblistListsApi } from './mdblist.ts';
import type { AnilistListsApi } from './anilist.ts';

const rt = require('./runtime.ts') as UserListRuntimeApi;
const rows = require('./rows.ts') as UserListRowsApi;
const { itemsToMetas } = require('./metas.ts') as UserListMetasApi;
const simkl = require('./simkl.ts') as SimklListsApi;
const mdblist = require('./mdblist.ts') as MdblistListsApi;
const anilist = require('./anilist.ts') as AnilistListsApi;

type Config = Record<string, unknown>;

function simklAuth(config: Config): { token: string; clientId: string } {
  const conn = (config['watchlist'] && typeof config['watchlist'] === 'object' ? (config['watchlist'] as Config)['simkl'] : null) as Config | null;
  return {
    token: rows.watchlistToken(config, 'simkl'),
    clientId: String(process.env['SIMKL_CLIENT_ID'] || (conn && conn['client_id']) || ''),
  };
}

function anilistAuth(config: Config): { user: string; token: string } {
  return { user: rows.normaliseAnilistUser(config['anilistUser']) || '', token: rows.watchlistToken(config, 'anilist') };
}

export interface UserListCatalogInput {
  config: Config;
  catalogId: string;
  type: string;
  skip?: number;
  search?: string;
  enhance?: Record<string, unknown>;
}

// The metas for one personal row. An id this module does not serve (Trakt's
// old rows, an unknown list) is an empty row, never an error.
async function buildUserListCatalog(input: UserListCatalogInput, ctxIn?: Partial<UserListContext>, metaDeps?: MetaDeps & { idMap?: () => Promise<Record<string, unknown>> }): Promise<Record<string, unknown>[]> {
  const ref = rows.parseUserListId(input.catalogId);
  if (!ref || ref.type !== (input.type === 'movie' ? 'movie' : 'series')) return [];
  const ctx = rt.withContext(ctxIn);
  const config = input.config || {};
  let items: ListItem[] = [];
  try {
    if (ref.provider === 'simkl') items = await simkl.simklRowItems(ctx, simklAuth(config), ref.list, ref.type);
    else if (ref.provider === 'mdblist') items = await mdblist.mdblistRowItems(ctx, String(config['mdblistKey'] || '').trim(), ref.list, ref.type);
    else if (ref.provider === 'anilist') items = await anilist.anilistRowItems(ctx, anilistAuth(config), ref.list, ref.type, metaDeps?.idMap ? { idMap: metaDeps.idMap as never } : {});
  } catch (err) {
    ctx.log(`[user-lists] ${ref.provider} ${ref.list.startsWith('list.') ? 'list' : ref.list} failed: status=${rt.statusOf(err) || 'error'}`);
    items = [];
  }
  return itemsToMetas(items, ref.type, {
    tmdbApiKey: String(config['tmdbApiKey'] || ''),
    enhance: input.enhance || {},
    skip: input.skip || 0,
    search: input.search || '',
    limit: 50,
  }, metaDeps || {});
}

export interface UserListIdentities { mdblist?: string; simkl?: string; anilist?: string }

// A display name as stored or shown: trimmed, no control characters,
// at most 80 characters; anything else is no name.
function cleanAccountName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
  return name || null;
}

// The account name stored with a live OAuth connection at connect time
// (`keys.watchlist.{provider}.username`, v6), or null for older ones.
function storedUsername(config: Config, provider: 'simkl' | 'anilist'): string | null {
  if (!rows.watchlistToken(config, provider)) return null;
  const conn = config['watchlist'] && typeof config['watchlist'] === 'object' ? (config['watchlist'] as Config)[provider] : null;
  return conn && typeof conn === 'object' ? cleanAccountName((conn as Config)['username']) : null;
}

// The account name behind a freshly exchanged token, asked once at connect
// time (OAuth callback) and stored with the connection. Simkl: GET
// /users/settings `user.name`; AniList: `Viewer { name }`. Never throws and
// never waits long: a missing name must not fail the connect.
async function connectionUsername(provider: string, token: string, ctxIn?: Partial<UserListContext>, timeoutMs = 5000): Promise<string | null> {
  if (!token || (provider !== 'simkl' && provider !== 'anilist')) return null;
  const ctx = rt.withContext(ctxIn);
  const work = provider === 'simkl'
    ? simkl.simklUsername(ctx, { token, clientId: String(process.env['SIMKL_CLIENT_ID'] || '') })
    : anilist.anilistName(ctx, { user: '', token });
  const name = await Promise.race([
    work.catch(() => null),
    new Promise<null>((resolve) => { const timer = setTimeout(() => resolve(null), timeoutMs); (timer as { unref?: () => void }).unref?.(); }),
  ]);
  return cleanAccountName(name);
}

// Display names per connected service (never a key). A name stored with the
// connection wins (no call); older connections fall back to a lookup cached
// a day and bounded by a short timeout, so the edit page never waits long.
async function userListIdentities(config: Config, ctxIn?: Partial<UserListContext>, timeoutMs = 4000): Promise<UserListIdentities> {
  const ctx = rt.withContext(ctxIn);
  const services = rows.userListServices(config);
  const within = <T>(work: Promise<T>): Promise<T | null> => Promise.race([
    work.catch(() => null),
    new Promise<null>((resolve) => { const timer = setTimeout(() => resolve(null), timeoutMs); (timer as { unref?: () => void }).unref?.(); }),
  ]);
  const [mdb, sim, ani] = await Promise.all([
    services.mdblist ? within(mdblist.mdblistUsername(ctx, String(config['mdblistKey'] || '').trim())) : null,
    services.simkl ? (storedUsername(config, 'simkl') || within(simkl.simklUsername(ctx, simklAuth(config)))) : null,
    services.anilist ? (storedUsername(config, 'anilist') || within(anilist.anilistName(ctx, anilistAuth(config)))) : null,
  ]);
  const out: UserListIdentities = {};
  if (mdb) out.mdblist = mdb;
  if (sim) out.simkl = sim;
  if (ani) out.anilist = ani;
  return out;
}

// `anilistUser` in a setup config: absent/empty is fine (dropped), a valid
// name is kept trimmed, anything else is refused.
function checkAnilistUser(config: Config): { ok: true; config: Config } | { ok: false; error: string } {
  if (!config || typeof config !== 'object' || !('anilistUser' in config)) return { ok: true, config };
  const raw = config['anilistUser'];
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    const { anilistUser: _dropped, ...rest } = config;
    return { ok: true, config: rest };
  }
  const name = rows.normaliseAnilistUser(raw);
  if (!name) return { ok: false, error: 'AniList username must be 2-20 letters, numbers or underscores' };
  return { ok: true, config: { ...config, anilistUser: name } };
}

export interface UserListsApi {
  buildUserListCatalog: typeof buildUserListCatalog;
  userListIdentities: typeof userListIdentities;
  connectionUsername: typeof connectionUsername;
  cleanAccountName: typeof cleanAccountName;
  checkAnilistUser: typeof checkAnilistUser;
  parseUserListId: UserListRowsApi['parseUserListId'];
  isUserListCatalogId: UserListRowsApi['isUserListCatalogId'];
  userListServices: UserListRowsApi['userListServices'];
  userListTitle: UserListRowsApi['userListTitle'];
  mdblistLists: MdblistListsApi['mdblistLists'];
}

module.exports = {
  buildUserListCatalog, userListIdentities, connectionUsername, cleanAccountName, checkAnilistUser,
  parseUserListId: rows.parseUserListId,
  isUserListCatalogId: rows.isUserListCatalogId,
  userListServices: rows.userListServices,
  userListTitle: rows.userListTitle,
  mdblistLists: mdblist.mdblistLists,
} satisfies UserListsApi;
