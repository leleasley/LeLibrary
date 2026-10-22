// Self-host access gate. A self-hosted instance has no accounts, so the one
// operator-level control is SELFHOST_CONFIGS_SECRET: sending it (header) or
// proving it (the HMAC cookie set on the setup pages) unlocks the legacy saved
// configs and the v5.5 setup list.
//
// Everything is resolved at call time rather than module load: the secret is
// read from the environment, and a test (or a restart with a new .env) must see
// the current value.
const crypto = require('node:crypto') as typeof import('node:crypto');

const COOKIE_NAME = 'lelibrary_selfhost_access';
const COOKIE_CONTEXT = 'lelibrary-selfhost-configs';

type Env = Record<string, string | undefined>;

function secret(env: Env = process.env): string {
  return String(env.SELFHOST_CONFIGS_SECRET || '');
}

function configured(env: Env = process.env): boolean {
  return secret(env).length > 0;
}

// The list is on by default whenever the gate exists. Operators on a shared
// instance can hide it without disabling the rest of the self-host features.
function listEnabled(env: Env = process.env): boolean {
  if (!configured(env)) return false;
  return String(env.SELFHOST_LIST_SETUPS || '').toLowerCase() !== 'off';
}

// Derived cookie value: a browser never learns the secret, only an HMAC of it.
function cookieValue(env: Env = process.env): string {
  const value = secret(env);
  return value ? crypto.createHmac('sha256', value).update(COOKIE_CONTEXT).digest('hex') : '';
}

function safeEqual(candidate: string, expected: string): boolean {
  if (!candidate || !expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function authorized(req: { get(name: string): string | undefined }, env: Env = process.env): boolean {
  const expected = secret(env);
  if (!expected) return false;
  if (safeEqual(String(req.get('x-selfhost-secret') || ''), expected)) return true;

  const prefix = `${COOKIE_NAME}=`;
  const cookie = String(req.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  const value = cookie ? cookie.slice(prefix.length) : '';
  return safeEqual(value, cookieValue(env));
}

export interface SelfhostAccessApi {
  COOKIE_NAME: string;
  secret: (env?: Env) => string;
  configured: (env?: Env) => boolean;
  listEnabled: (env?: Env) => boolean;
  cookieValue: (env?: Env) => string;
  authorized: (req: { get(name: string): string | undefined }, env?: Env) => boolean;
}

module.exports = {
  COOKIE_NAME,
  secret,
  configured,
  listEnabled,
  cookieValue,
  authorized,
} satisfies SelfhostAccessApi;
