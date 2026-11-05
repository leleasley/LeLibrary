'use strict';
// Personal list rows (v6): Simkl, MDBList and AniList lists as catalogue
// rows, served from the requesting setup's own connection, key or username.
//
// Entry points:
// - buildUserListCatalog: one catalogue request (routes/catalog.ts), the
//   setup resolved from its install token like every other catalogue.
// - userListIdentities: "Connected as ..." names for the edit page.
// - checkAnilistUser: the setup config's `anilistUser` rule.
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

// Display names per connected service (never a key). Each lookup is cached
// (a day) and bounded by a short timeout, so the edit page never waits long.
async function userListIdentities(config: Config, ctxIn?: Partial<UserListContext>, timeoutMs = 4000): Promise<UserListIdentities> {
  const ctx = rt.withContext(ctxIn);
  const services = rows.userListServices(config);
  const within = <T>(work: Promise<T>): Promise<T | null> => Promise.race([
    work.catch(() => null),
    new Promise<null>((resolve) => { const timer = setTimeout(() => resolve(null), timeoutMs); (timer as { unref?: () => void }).unref?.(); }),
  ]);
  const [mdb, sim, ani] = await Promise.all([
    services.mdblist ? within(mdblist.mdblistUsername(ctx, String(config['mdblistKey'] || '').trim())) : null,
    services.simkl ? within(simkl.simklUsername(ctx, simklAuth(config))) : null,
    services.anilist ? within(anilist.anilistName(ctx, anilistAuth(config))) : null,
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
  checkAnilistUser: typeof checkAnilistUser;
  parseUserListId: UserListRowsApi['parseUserListId'];
  isUserListCatalogId: UserListRowsApi['isUserListCatalogId'];
  userListServices: UserListRowsApi['userListServices'];
  userListTitle: UserListRowsApi['userListTitle'];
  mdblistLists: MdblistListsApi['mdblistLists'];
}

module.exports = {
  buildUserListCatalog, userListIdentities, checkAnilistUser,
  parseUserListId: rows.parseUserListId,
  isUserListCatalogId: rows.isUserListCatalogId,
  userListServices: rows.userListServices,
  userListTitle: rows.userListTitle,
  mdblistLists: mdblist.mdblistLists,
} satisfies UserListsApi;
