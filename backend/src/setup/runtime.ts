// Lazily-built shared resources for the setup model. Nothing is created until a
// setup route or an install-token read actually needs the store, so an instance
// with no database keeps working in legacy token-only mode.
const { Pool } = require('pg') as typeof import('pg');
import type { ConfigStore, PoolLike } from './config-store.ts';
import type { PasswordLimiter } from './rate-limit.ts';
import type { KeysApi } from './keys.ts';
const { loadServerKey } = require('./keys.ts') as KeysApi;
import type { ConfigStoreApi } from './config-store.ts';
const { createConfigStore } = require('./config-store.ts') as ConfigStoreApi;
import type { RateLimitApi } from './rate-limit.ts';
const { createPasswordLimiter } = require('./rate-limit.ts') as RateLimitApi;

let pool: PoolLike | null = null;
let store: ConfigStore | null = null;
let migratePromise: Promise<void> | null = null;
let limiter: PasswordLimiter | null = null;

function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function getSetupPool(): PoolLike | null {
  if (!hasDatabase()) return null;
  if (!pool) {
    // pg is already a dependency of the library engine; the pool is only built
    // when a database is actually configured.
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4,
      // Fail a request quickly when Postgres is unreachable; the route turns
      // the error into a 503 instead of waiting for the OS TCP timeout.
      connectionTimeoutMillis: 5000,
    }) as unknown as PoolLike;
  }
  return pool;
}

function getSetupLimiter(): PasswordLimiter {
  if (!limiter) limiter = createPasswordLimiter();
  return limiter;
}

// Returns a migrated store, or null when there is no database configured.
async function getSetupStore(): Promise<ConfigStore | null> {
  const currentPool = getSetupPool();
  if (!currentPool) return null;
  if (!store) store = createConfigStore({ pool: currentPool, key: loadServerKey(), logger: console });
  if (!migratePromise) {
    migratePromise = store.migrate().catch((error: unknown) => {
      migratePromise = null;
      throw error;
    });
  }
  await migratePromise;
  return store;
}

function resetSetupRuntime(): void {
  pool = null; store = null; migratePromise = null; limiter = null;
}

export interface RuntimeApi {
  getSetupStore: () => Promise<ConfigStore | null>;
  getSetupPool: () => PoolLike | null;
  getSetupLimiter: () => PasswordLimiter;
  hasDatabase: () => boolean;
  resetSetupRuntime: () => void;
}
module.exports = { getSetupStore, getSetupPool, getSetupLimiter, hasDatabase, resetSetupRuntime } satisfies RuntimeApi;
