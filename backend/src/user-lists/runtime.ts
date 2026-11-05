'use strict';
// Shared plumbing for personal list rows: the per-user cache, single-flight,
// 429 backoff markers and the activity gate.
//
// Every cache key carries a fingerprint of the credential (or username) that
// read the list (`hashShort`), so one setup can never be served another's
// rows: there is no shared cache for personal lists, and a stale entry is
// only ever served back to the same fingerprint. Logs name the provider and
// the HTTP status, never a key, token or username.
import type { BoundedMapApi } from '../runtime/bounded-map.ts';

const { boundedSet } = require('../runtime/bounded-map.ts') as BoundedMapApi;
const { hashShort } = require('../runtime/cache-fingerprint.ts') as { hashShort: (value: unknown) => string };

export interface HttpLike {
  get: (url: string, options?: Record<string, unknown>) => Promise<{ status?: number; data?: unknown; headers?: Record<string, unknown> }>;
  post: (url: string, body?: unknown, options?: Record<string, unknown>) => Promise<{ status?: number; data?: unknown; headers?: Record<string, unknown> }>;
}

export interface StoreLike {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown, ttlSeconds: number) => Promise<unknown>;
}

export interface UserListContext {
  http: HttpLike;
  store: StoreLike;
  now: () => number;
  log: (line: string) => void;
}

// The live context. Tests pass their own (fake http, in-memory store).
function defaultContext(): UserListContext {
  const axios = require('axios');
  const cache = require('../runtime/cache.ts');
  return {
    http: { get: (url, options) => axios.get(url, options), post: (url, body, options) => axios.post(url, body, options) },
    store: { get: (key) => cache.get(key), set: (key, value, ttl) => cache.set(key, value, ttl) },
    now: () => Date.now(),
    log: (line) => console.warn(line),
  };
}

function withContext(partial?: Partial<UserListContext>): UserListContext {
  if (partial && partial.http && partial.store && partial.now && partial.log) return partial as UserListContext;
  return { ...defaultContext(), ...(partial || {}) };
}

// Cache namespace. Bump the version when a stored shape changes.
const NS = 'ulist:v1';

// One fingerprint per provider + credential: never the value itself.
function credentialFp(provider: string, credential: string): string {
  return hashShort(`${provider}:${credential}`);
}

function cacheKey(...parts: string[]): string {
  return [NS, ...parts].join(':');
}

// ── Single-flight ─────────────────────────────────────────────────────
// Keyed by cache key (so per user); bounded, entries live only while their
// promise runs.
const FLIGHT_MAX = 2000;
const inflight = new Map<string, Promise<unknown>>();

function singleFlight<T>(key: string, work: () => Promise<T>): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const pending = Promise.resolve().then(work).finally(() => { if (inflight.get(key) === pending) inflight.delete(key); });
  boundedSet(inflight, key, pending as Promise<unknown>, FLIGHT_MAX);
  return pending;
}

// ── 429 backoff ───────────────────────────────────────────────────────
// A provider that answered 429 is left alone until its Retry-After passes:
// per user for Simkl and MDBList (their quotas are per account), server-wide
// for AniList (its limit is per IP). Memory only: a restart forgets, which
// only costs one more 429.
const BACKOFF_MAX = 5000;
const DEFAULT_RETRY_S = 60;
const MAX_RETRY_S = 3600;
// After a non-429 failure: client errors (bad key, deleted list) rest
// longer than network or server errors.
const ERROR_REST_S = 300;
const NETWORK_REST_S = 60;
const backoff = new Map<string, number>();

function retryAfterSeconds(err: unknown): number {
  const headers = ((err as { response?: { headers?: Record<string, unknown> } })?.response?.headers) || {};
  const raw = headers['retry-after'] ?? headers['Retry-After'];
  const seconds = Number(String(raw ?? '').trim());
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(MAX_RETRY_S, Math.ceil(seconds));
  const date = Date.parse(String(raw ?? ''));
  if (Number.isFinite(date)) return Math.max(1, Math.min(MAX_RETRY_S, Math.ceil((date - Date.now()) / 1000)));
  return DEFAULT_RETRY_S;
}

function statusOf(err: unknown): number {
  return Number((err as { response?: { status?: number } })?.response?.status || 0);
}

// A 429 we raise ourselves (still inside a provider's wait, or over our own
// budget): it must never extend the wait it reports.
function waitingError(message: string): Error {
  return Object.assign(new Error(message), { response: { status: 429 }, local: true });
}

function isUpstream429(err: unknown): boolean {
  return statusOf(err) === 429 && (err as { local?: boolean })?.local !== true;
}

function markBackoff(key: string, seconds: number, now: number): void {
  const until = now + Math.max(1, seconds) * 1000;
  boundedSet(backoff, key, until, BACKOFF_MAX, (at) => at <= now);
}

function backedOff(key: string, now: number): boolean {
  const until = backoff.get(key);
  if (until === undefined) return false;
  if (until <= now) { backoff.delete(key); return false; }
  return true;
}

// Test seam: forget every marker and flight.
function resetRuntime(): void {
  backoff.clear();
  inflight.clear();
}

// ── The gated bucket ──────────────────────────────────────────────────
// One cached upstream read for one user. Fresh for `freshMs`; after that the
// cheap activity stamp (if the provider has one) decides: unchanged = the
// entry is fresh again without a re-pull (up to `maxAgeMs`), changed = pull.
// An upstream failure serves this same user's last entry, else null.
export interface BucketEntry<T> { at: number; loadedAt: number; stamp: string | null; data: T }

export interface BucketOptions<T> {
  ctx: UserListContext;
  key: string;
  backoffKey: string;
  label: string;
  freshMs: number;
  maxAgeMs: number;
  storeTtlS: number;
  stamp?: () => Promise<string | null>;
  load: () => Promise<T>;
}

async function gatedBucket<T>(options: BucketOptions<T>): Promise<T | null> {
  const { ctx, key, backoffKey, label, freshMs, maxAgeMs, storeTtlS, stamp, load } = options;
  const read = async (): Promise<BucketEntry<T> | null> => {
    const raw = await ctx.store.get(key).catch(() => null);
    return raw && typeof raw === 'object' && 'data' in (raw as object) ? raw as BucketEntry<T> : null;
  };
  const entry = await read();
  const now = ctx.now();
  if (entry && now - Number(entry.at || 0) < freshMs) return entry.data;
  if (backedOff(backoffKey, now) || backedOff(`${key}:err`, now)) return entry ? entry.data : null;
  return singleFlight(key, async () => {
    const current = (await read()) || entry;
    const at = ctx.now();
    if (current && at - Number(current.at || 0) < freshMs) return current.data;
    try {
      let mark: string | null = null;
      if (stamp) {
        mark = await stamp();
        if (current && mark && current.stamp === mark && at - Number(current.loadedAt || 0) < maxAgeMs) {
          await ctx.store.set(key, { ...current, at }, storeTtlS).catch(() => {});
          return current.data;
        }
      }
      const data = await load();
      await ctx.store.set(key, { at, loadedAt: at, stamp: mark, data } satisfies BucketEntry<T>, storeTtlS).catch(() => {});
      return data;
    } catch (err) {
      const status = statusOf(err);
      // 429: the provider's own wait, for every row of this user (or the
      // server). Anything else: this one row rests a while, so a dead key or
      // a deleted list is not asked again on every catalogue open.
      if (status === 429) { if (isUpstream429(err)) markBackoff(backoffKey, retryAfterSeconds(err), ctx.now()); }
      else markBackoff(`${key}:err`, status >= 400 && status < 500 ? ERROR_REST_S : NETWORK_REST_S, ctx.now());
      ctx.log(`[user-lists] ${label} failed: status=${status || 'network'}${current ? ' (serving last copy)' : ''}`);
      return current ? current.data : null;
    }
  });
}

// A small cached value (an activity stamp, a username) for one user, also
// single-flighted. Errors propagate to the caller (a 429 marks the backoff).
async function cachedValue<T>(ctx: UserListContext, key: string, backoffKey: string, ttlS: number, work: () => Promise<T>): Promise<T> {
  const hit = await ctx.store.get(key).catch(() => null) as { value: T } | null;
  if (hit && typeof hit === 'object' && 'value' in hit) return hit.value;
  if (backedOff(backoffKey, ctx.now())) throw waitingError('backed off');
  return singleFlight(key, async () => {
    try {
      const value = await work();
      await ctx.store.set(key, { value }, ttlS).catch(() => {});
      return value;
    } catch (err) {
      if (isUpstream429(err)) markBackoff(backoffKey, retryAfterSeconds(err), ctx.now());
      throw err;
    }
  });
}

export interface UserListRuntimeApi {
  NS: string;
  defaultContext: typeof defaultContext;
  withContext: typeof withContext;
  credentialFp: typeof credentialFp;
  cacheKey: typeof cacheKey;
  singleFlight: typeof singleFlight;
  retryAfterSeconds: typeof retryAfterSeconds;
  statusOf: typeof statusOf;
  waitingError: typeof waitingError;
  isUpstream429: typeof isUpstream429;
  markBackoff: typeof markBackoff;
  backedOff: typeof backedOff;
  resetRuntime: typeof resetRuntime;
  gatedBucket: typeof gatedBucket;
  cachedValue: typeof cachedValue;
}

module.exports = {
  NS, defaultContext, withContext, credentialFp, cacheKey, singleFlight, retryAfterSeconds, statusOf, waitingError, isUpstream429,
  markBackoff, backedOff, resetRuntime, gatedBucket, cachedValue,
} satisfies UserListRuntimeApi;
