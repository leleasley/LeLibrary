'use strict';
// Is a library's TMDB key usable? Matching with a missing or rejected key used
// to fail every row as "search unavailable", burn all of its retries over
// about 15 hours and then skip it for good. Now the matcher asks first: a key
// problem leaves rows pending (nothing is spent), the Library page says what
// is wrong, and the first good check afterwards re-opens rows that failed
// because of it.
//
// The check is one lightweight TMDB request (/configuration), cached per key
// hash. The key itself is never stored, logged or returned.

const crypto = require('node:crypto');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const CHECK_TTL_MS = 10 * 60 * 1000;
const UNKNOWN_TTL_MS = 60 * 1000;

export type KeyState = 'ok' | 'missing' | 'rejected' | 'unknown';

const checks = new Map<string, { state: KeyState; at: number }>();
const scopes = new Map<string, KeyState>();

function keyHash(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

function auth(apiKey: string): { headers: Record<string, string>; params: Record<string, string> } {
  return apiKey.startsWith('eyJ')
    ? { headers: { Authorization: `Bearer ${apiKey}` }, params: {} }
    : { headers: {}, params: { api_key: apiKey } };
}

async function request(apiKey: string): Promise<KeyState> {
  const axios = require('axios');
  const a = auth(apiKey);
  try {
    await axios.get(`${TMDB_BASE}/configuration`, { headers: a.headers, params: a.params, timeout: 8000 });
    return 'ok';
  } catch (err: any) {
    const status = err && err.response && err.response.status;
    // 401 = invalid key; 403/404 here also mean TMDB will not take it. Anything
    // else (timeouts, 429, 5xx) says nothing about the key.
    return status === 401 || status === 403 || status === 404 ? 'rejected' : 'unknown';
  }
}

async function check(apiKey: string | null | undefined, { fetch = request }: { fetch?: (key: string) => Promise<KeyState> } = {}): Promise<KeyState> {
  const key = String(apiKey || '').trim();
  if (!key) return 'missing';
  const hash = keyHash(key);
  const hit = checks.get(hash);
  if (hit && Date.now() - hit.at < (hit.state === 'unknown' ? UNKNOWN_TTL_MS : CHECK_TTL_MS)) return hit.state;
  const state = await fetch(key).catch((): KeyState => 'unknown');
  checks.set(hash, { state, at: Date.now() });
  if (checks.size > 5000) checks.delete(checks.keys().next().value as string);
  return state;
}

// Record a scope's latest state; returns the previous one (null on first sight
// in this process).
function noteScope(scopeId: string, state: KeyState): KeyState | null {
  const before = scopes.has(scopeId) ? scopes.get(scopeId) as KeyState : null;
  scopes.set(scopeId, state);
  return before;
}

// 'missing' | 'rejected' when the last check found a key problem, else null.
function scopeProblem(scopeId: string): 'missing' | 'rejected' | null {
  const state = scopes.get(scopeId);
  return state === 'missing' || state === 'rejected' ? state : null;
}

function reset(): void {
  checks.clear();
  scopes.clear();
}

export interface TmdbKeyApi {
  check: typeof check;
  noteScope: typeof noteScope;
  scopeProblem: typeof scopeProblem;
  reset: typeof reset;
}

module.exports = { check, noteScope, scopeProblem, reset } satisfies TmdbKeyApi;
