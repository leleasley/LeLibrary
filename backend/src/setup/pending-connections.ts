// Staged watchlist connects for the edit page (v6).
//
// The edit page promises "nothing changes until you save", so a Simkl or
// AniList sign-in made there must not land in the saved setup straight away.
// The OAuth callback parks the fresh connection here instead: in memory only,
// sealed with a per-process key, bound to the setup UUID AND to the edit
// session that started the sign-in (a hash of its bearer token, never the
// token itself), for 30 minutes. The page only ever learns an opaque pending
// id and the account name; the tokens never reach the browser. The edit save
// (PUT /api/setup/:uuid, `connections`) commits it, authorised by that same
// edit token; Clear my edits discards it; anything left simply expires.
import type { WatchlistConn } from './connections.ts';
import type { BoundedMapApi } from '../runtime/bounded-map.ts';
import type { SealApi, SealedEnvelope } from './seal.ts';

const crypto = require('node:crypto') as typeof import('node:crypto');
const { boundedSet } = require('../runtime/bounded-map.ts') as BoundedMapApi;
const { seal, unseal } = require('./seal.ts') as SealApi;

export type StagedProvider = 'simkl' | 'trakt' | 'anilist';

const PENDING_CONNECTION_TTL_MS = 30 * 60 * 1000;
const PENDING_CONNECTION_MAX = 2000;
const STAGED_PROVIDERS: readonly StagedProvider[] = ['simkl', 'trakt', 'anilist'];

// Lives and dies with the process: a pending connect never outlives a restart.
const processKey: Buffer = crypto.randomBytes(32);

interface PendingConnection {
  uuid: string;
  sessionHash: string;
  provider: StagedProvider;
  sealed: SealedEnvelope;
  expiresAt: number;
}

const pendingConnections = new Map<string, PendingConnection>();

// Binds a pending entry to one edit session without keeping the bearer.
function editSessionHash(editToken: string): string {
  return crypto.createHash('sha256').update(`edit-session:${editToken}`).digest('base64url');
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function stagePendingConnection(input: {
  uuid: string;
  sessionHash: string;
  provider: StagedProvider;
  connection: WatchlistConn;
  nowMs?: number;
}): { pendingId: string; expiresAt: number } {
  const nowMs = input.nowMs ?? Date.now();
  const pendingId = crypto.randomBytes(24).toString('base64url');
  const expiresAt = nowMs + PENDING_CONNECTION_TTL_MS;
  boundedSet(pendingConnections, pendingId, {
    uuid: input.uuid.toLowerCase(),
    sessionHash: input.sessionHash,
    provider: input.provider,
    sealed: seal(processKey, input.connection),
    expiresAt,
  }, PENDING_CONNECTION_MAX, (entry) => entry.expiresAt <= nowMs);
  return { pendingId, expiresAt };
}

// The pending entry when it belongs to this setup, edit session and provider
// and is still live; null otherwise. Does not consume it: the save drops it
// only once the row is written.
function readPendingConnection(input: {
  pendingId: unknown;
  uuid: string;
  editToken: string;
  provider: string;
  nowMs?: number;
}): WatchlistConn | null {
  if (typeof input.pendingId !== 'string' || !input.pendingId || input.pendingId.length > 100) return null;
  const found = pendingConnections.get(input.pendingId);
  if (!found) return null;
  if (found.expiresAt <= (input.nowMs ?? Date.now())) { pendingConnections.delete(input.pendingId); return null; }
  if (found.uuid !== input.uuid.toLowerCase() || found.provider !== input.provider) return null;
  if (!sameHash(found.sessionHash, editSessionHash(input.editToken))) return null;
  const opened = unseal(processKey, found.sealed);
  return opened && typeof opened === 'object' ? opened as WatchlistConn : null;
}

// Discard one pending entry (Clear my edits, a second connect, a save).
// Same binding as a read: another session or setup cannot drop it.
function discardPendingConnection(input: { pendingId: unknown; uuid: string; editToken: string }): boolean {
  if (typeof input.pendingId !== 'string' || !input.pendingId) return false;
  const found = pendingConnections.get(input.pendingId);
  if (!found || found.uuid !== input.uuid.toLowerCase()) return false;
  if (!sameHash(found.sessionHash, editSessionHash(input.editToken))) return false;
  pendingConnections.delete(input.pendingId);
  return true;
}

function pendingConnectionCount(): number {
  return pendingConnections.size;
}

function resetPendingConnections(): void {
  pendingConnections.clear();
}

export type StagedChange = { pendingId: string } | { remove: true };

// The edit save's `connections` field, checked: per provider either a
// pending id (a connect made on the page) or `{ remove: true }`. Pure.
function parseStagedConnections(raw: unknown): { ok: true; changes: Partial<Record<StagedProvider, StagedChange>> } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, changes: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Invalid connections' };
  const changes: Partial<Record<StagedProvider, StagedChange>> = {};
  for (const [provider, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(STAGED_PROVIDERS as readonly string[]).includes(provider)) return { ok: false, error: 'Unknown connection' };
    const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
    if (record && record['remove'] === true) { changes[provider as StagedProvider] = { remove: true }; continue; }
    if (record && typeof record['pendingId'] === 'string' && record['pendingId']) {
      changes[provider as StagedProvider] = { pendingId: record['pendingId'] };
      continue;
    }
    return { ok: false, error: 'Invalid connections' };
  }
  return { ok: true, changes };
}

// The watchlist envelope after the staged changes, plus whether an older
// setup's public AniList name goes with them (an AniList login or
// disconnect replaces it) and which pending ids to drop once saved.
// `editToken` is null when the save was not authorised by an edit session:
// removals still apply, a pending connect cannot. Pure apart from reading
// the pending map.
function applyStagedConnections(input: {
  uuid: string;
  editToken: string | null;
  currentWatchlist: Record<string, unknown>;
  changes: Partial<Record<StagedProvider, StagedChange>>;
  nowMs?: number;
}): { ok: true; watchlist: Record<string, unknown>; anilistTouched: boolean; consumed: string[] } | { ok: false; status: number; error: string } {
  const watchlist = { ...input.currentWatchlist };
  const consumed: string[] = [];
  let anilistTouched = false;
  for (const provider of STAGED_PROVIDERS) {
    const change = input.changes[provider];
    if (!change) continue;
    if (provider === 'anilist') anilistTouched = true;
    if ('remove' in change) { delete watchlist[provider]; continue; }
    if (!input.editToken) return { ok: false, status: 401, error: 'Unlock the setup to save a new connection' };
    const conn = readPendingConnection({ pendingId: change.pendingId, uuid: input.uuid, editToken: input.editToken, provider, ...(input.nowMs ? { nowMs: input.nowMs } : {}) });
    if (!conn) return { ok: false, status: 409, error: 'That sign-in expired. Connect again, then save.' };
    watchlist[provider] = conn;
    consumed.push(change.pendingId);
  }
  return { ok: true, watchlist, anilistTouched, consumed };
}

function dropPendingConnections(ids: readonly string[]): void {
  for (const id of ids) pendingConnections.delete(id);
}

export interface PendingConnectionsApi {
  PENDING_CONNECTION_TTL_MS: number;
  PENDING_CONNECTION_MAX: number;
  editSessionHash: (editToken: string) => string;
  stagePendingConnection: (input: { uuid: string; sessionHash: string; provider: StagedProvider; connection: WatchlistConn; nowMs?: number }) => { pendingId: string; expiresAt: number };
  readPendingConnection: (input: { pendingId: unknown; uuid: string; editToken: string; provider: string; nowMs?: number }) => WatchlistConn | null;
  discardPendingConnection: (input: { pendingId: unknown; uuid: string; editToken: string }) => boolean;
  pendingConnectionCount: () => number;
  resetPendingConnections: () => void;
  parseStagedConnections: (raw: unknown) => { ok: true; changes: Partial<Record<StagedProvider, StagedChange>> } | { ok: false; error: string };
  applyStagedConnections: (input: {
    uuid: string;
    editToken: string | null;
    currentWatchlist: Record<string, unknown>;
    changes: Partial<Record<StagedProvider, StagedChange>>;
    nowMs?: number;
  }) => { ok: true; watchlist: Record<string, unknown>; anilistTouched: boolean; consumed: string[] } | { ok: false; status: number; error: string };
  dropPendingConnections: (ids: readonly string[]) => void;
}

module.exports = {
  PENDING_CONNECTION_TTL_MS,
  PENDING_CONNECTION_MAX,
  editSessionHash,
  stagePendingConnection,
  readPendingConnection,
  discardPendingConnection,
  pendingConnectionCount,
  resetPendingConnections,
  parseStagedConnections,
  applyStagedConnections,
  dropPendingConnections,
} satisfies PendingConnectionsApi;
