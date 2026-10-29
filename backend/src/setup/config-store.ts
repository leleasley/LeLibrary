// The v5.5 config model: one row per setup, addressed by UUID, readable with the
// install token, editable with the password.
import type { SealApi } from './seal.ts';
const { seal, unseal } = require('./seal.ts') as SealApi;
import type { PasswordApi } from './password.ts';
const { hashPassword, verifyPassword, recordFromRow } = require('./password.ts') as PasswordApi;
import type { TokenApi } from './token.ts';
const { newUuid, newSecret, buildInstallToken, parseInstallToken, secretHash, isUuid } = require('./token.ts') as TokenApi;

export type Tier = 'quick' | 'partial' | 'full';

// Structural shape of the pool we use. Kept local so the store does not depend
// on the pg typings and stays trivially fakeable in tests.
export interface QueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}

export interface PoolLike {
  query<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<Row>>;
}

export interface ConfigRow {
  uuid: string;
  secret_hash: string;
  secret_sealed: unknown;
  tier: string;
  name: string | null;
  password_salt: string | null;
  password_hash: string | null;
  password_kdf: unknown;
  encrypted_config: unknown;
  encrypted_keys: unknown;
  created_at: Date | null;
  updated_at: Date | null;
  last_used_at: Date | null;
}

/** A stored row opened for serving. */
export interface OpenedConfig {
  uuid: string;
  tier: Tier;
  name: string | null;
  config: Record<string, unknown>;
  keys: Record<string, unknown>;
  hasPassword: boolean;
  secret: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface CreateInput {
  tier?: string;
  name?: unknown;
  config?: Record<string, unknown>;
  keys?: Record<string, unknown>;
  password?: string | null;
}

// Read-only projection for the self-host setup list. Deliberately excludes the
// secret, the sealed config and the keys: a UUID alone can neither watch nor
// edit, so the list is safe to render without any decryption.
export interface SetupSummary {
  uuid: string;
  name: string | null;
  tier: Tier;
  hasPassword: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
  lastUsedAt: Date | null;
}

export interface SaveInput {
  config?: Record<string, unknown>;
  keys?: Record<string, unknown>;
  tier?: string;
  name?: unknown;
  // Explicit removals: omitted fields are always kept, so deleting a saved
  // key or preference names it here instead of sending an empty value.
  clearKeys?: string[];
  clearConfig?: string[];
}

export interface ConfigStore {
  migrate(): Promise<void>;
  create(input?: CreateInput): Promise<{ uuid: string; secret: string; installToken: string; tier: Tier; createdAt: Date | null }>;
  resolveByToken(token: unknown): Promise<OpenedConfig | null>;
  resolveByUuid(uuid: unknown): Promise<OpenedConfig | null>;
  save(uuid: unknown, input?: SaveInput): Promise<{ uuid: string; tier: Tier; updatedAt: Date | null } | null>;
  setPassword(uuid: unknown, password: string): Promise<boolean>;
  checkPassword(uuid: unknown, password: unknown): Promise<boolean>;
  rotateSecret(uuid: unknown): Promise<{ uuid: string; secret: string; installToken: string } | null>;
  list(input?: { limit?: unknown }): Promise<SetupSummary[]>;
  remove(uuid: unknown): Promise<boolean>;
  toEngineConfig(opened: OpenedConfig): Record<string, unknown>;
}

export interface ConfigStoreOptions {
  pool?: PoolLike | null;
  key?: Buffer | null;
  logger?: { warn?: (...args: unknown[]) => void };
}

const TIERS: Tier[] = ['quick', 'partial', 'full'];
const DEFAULT_TIER: Tier = 'quick';

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS configs (
     uuid text PRIMARY KEY,
     secret_hash text NOT NULL UNIQUE,
     secret_sealed jsonb NOT NULL,
     tier text NOT NULL DEFAULT 'quick',
     name text,
     password_salt text,
     password_hash text,
     password_kdf jsonb,
     encrypted_config jsonb,
     encrypted_keys jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     last_used_at timestamptz
   )`,
  'CREATE INDEX IF NOT EXISTS configs_last_used_idx ON configs (last_used_at DESC)',
];

async function migrate(pool: PoolLike): Promise<void> {
  for (const statement of MIGRATIONS) await pool.query(statement);
}

function normaliseTier(tier: unknown): Tier {
  return TIERS.includes(tier as Tier) ? (tier as Tier) : DEFAULT_TIER;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function withoutCleared(record: Record<string, unknown>, clear: unknown): Record<string, unknown> {
  if (!Array.isArray(clear)) return record;
  for (const field of clear) delete record[String(field)];
  return record;
}

function openRow(row: ConfigRow | undefined, key: Buffer): OpenedConfig | null {
  if (!row) return null;
  return {
    uuid: row.uuid,
    tier: normaliseTier(row.tier),
    name: row.name ?? null,
    config: asRecord(unseal(key, row.encrypted_config)),
    keys: asRecord(unseal(key, row.encrypted_keys)),
    hasPassword: typeof row.password_hash === 'string' && row.password_hash.length > 0,
    secret: typeof unseal(key, row.secret_sealed) === 'string' ? unseal(key, row.secret_sealed) as string : null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function toEngineConfig(opened: OpenedConfig): Record<string, unknown> {
  return { ...opened.config, ...opened.keys };
}

function createConfigStore(options: ConfigStoreOptions = {}): ConfigStore {
  const { pool, key, logger } = options;
  if (!pool) throw new Error('config store requires a database pool');
  if (!key) throw new Error('config store requires a server key');

  const touchThrottle = new Map<string, number>();

  return {
    migrate: () => migrate(pool),

    async create({ tier, name, config = {}, keys = {}, password = null }: CreateInput = {}) {
      const uuid = newUuid();
      const secret = newSecret();
      const credentials = password ? await hashPassword(password) : null;
      const result = await pool.query<{ uuid: string; tier: string; created_at: Date | null }>(
        `INSERT INTO configs (uuid, secret_hash, secret_sealed, tier, name, password_salt, password_hash, password_kdf, encrypted_config, encrypted_keys)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING uuid, tier, created_at`,
        [
          uuid,
          secretHash(secret),
          seal(key, secret),
          normaliseTier(tier),
          typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : null,
          credentials ? credentials.salt : null,
          credentials ? credentials.hash : null,
          credentials ? credentials.kdf : null,
          seal(key, config),
          seal(key, keys),
        ],
      );
      return {
        uuid,
        secret,
        installToken: buildInstallToken(uuid, secret),
        tier: normaliseTier(tier),
        createdAt: result.rows[0]?.created_at ?? null,
      };
    },

    // Addon read path: uuid + secret, no password, ever.
    async resolveByToken(token) {
      const parsed = parseInstallToken(token);
      if (!parsed) return null;
      const row = await pool.query<ConfigRow>(
        'SELECT * FROM configs WHERE uuid = $1 AND secret_hash = $2',
        [parsed.uuid, secretHash(parsed.secret)],
      );
      const opened = openRow(row.rows[0], key);
      if (!opened) return null;
      const timestamp = Date.now();
      const last = touchThrottle.get(opened.uuid) ?? 0;
      if (timestamp - last > 60_000) {
        touchThrottle.set(opened.uuid, timestamp);
        pool.query('UPDATE configs SET last_used_at = now() WHERE uuid = $1', [opened.uuid]).catch((error: Error) => {
          logger?.warn?.('[setup] last_used_at write failed:', error.message);
        });
      }
      return opened;
    },

    async resolveByUuid(uuid) {
      if (!isUuid(uuid)) return null;
      const row = await pool.query<ConfigRow>('SELECT * FROM configs WHERE uuid = $1', [uuid.toLowerCase()]);
      return openRow(row.rows[0], key);
    },

    async save(uuid, { config, keys, tier, name, clearKeys, clearConfig }: SaveInput = {}) {
      if (!isUuid(uuid)) return null;
      const id = uuid.toLowerCase();
      const current = await pool.query<Pick<ConfigRow, 'uuid' | 'tier' | 'name' | 'encrypted_config' | 'encrypted_keys'>>(
        'SELECT uuid, tier, name, encrypted_config, encrypted_keys FROM configs WHERE uuid = $1',
        [id],
      );
      const row = current.rows[0];
      if (!row) return null;
      // Partial updates merge: the edit page saves one section at a time and
      // can never read sealed secrets back, so omitted fields must survive.
      // Only an explicit clear list removes a stored field. Buckets with no
      // changes keep their original envelope untouched.
      const nextConfig = config === undefined && !Array.isArray(clearConfig)
        ? row.encrypted_config
        : seal(key, withoutCleared({ ...asRecord(unseal(key, row.encrypted_config)), ...asRecord(config) }, clearConfig));
      const nextKeys = keys === undefined && !Array.isArray(clearKeys)
        ? row.encrypted_keys
        : seal(key, withoutCleared({ ...asRecord(unseal(key, row.encrypted_keys)), ...asRecord(keys) }, clearKeys));
      const nextTier = tier === undefined ? row.tier : normaliseTier(tier);
      const nextName = name === undefined
        ? row.name
        : (typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : null);
      const updated = await pool.query<{ uuid: string; tier: string; updated_at: Date | null }>(
        `UPDATE configs SET encrypted_config = $2, encrypted_keys = $3, tier = $4, name = $5, updated_at = now()
         WHERE uuid = $1 RETURNING uuid, tier, updated_at`,
        [id, nextConfig, nextKeys, nextTier, nextName],
      );
      return { uuid: id, tier: normaliseTier(updated.rows[0]?.tier ?? nextTier), updatedAt: updated.rows[0]?.updated_at ?? null };
    },

    async setPassword(uuid, password) {
      if (!isUuid(uuid)) return false;
      const credentials = await hashPassword(password);
      const result = await pool.query(
        'UPDATE configs SET password_salt = $2, password_hash = $3, password_kdf = $4, updated_at = now() WHERE uuid = $1',
        [uuid.toLowerCase(), credentials.salt, credentials.hash, credentials.kdf],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async checkPassword(uuid, password) {
      if (!isUuid(uuid)) return false;
      const result = await pool.query<Pick<ConfigRow, 'password_salt' | 'password_hash' | 'password_kdf'>>(
        'SELECT password_salt, password_hash, password_kdf FROM configs WHERE uuid = $1',
        [uuid.toLowerCase()],
      );
      return verifyPassword(password, recordFromRow(result.rows[0] ?? null));
    },

    async list(input = {}) {
      const requested = Number(input.limit);
      const limit = Number.isFinite(requested) && requested > 0
        ? Math.min(Math.floor(requested), 200)
        : 50;
      const result = await pool.query<{
        uuid: string;
        name: string | null;
        tier: string;
        has_password: boolean;
        created_at: Date | null;
        updated_at: Date | null;
        last_used_at: Date | null;
      }>(
        `SELECT uuid, name, tier, (password_hash IS NOT NULL AND password_hash <> '') AS has_password,
                created_at, updated_at, last_used_at
           FROM configs
          ORDER BY COALESCE(last_used_at, updated_at, created_at) DESC, uuid
          LIMIT $1`,
        [limit],
      );
      return (result.rows || []).map((row) => ({
        uuid: String(row.uuid),
        name: row.name ? String(row.name) : null,
        tier: normaliseTier(row.tier),
        hasPassword: row.has_password === true,
        createdAt: row.created_at ? new Date(row.created_at) : null,
        updatedAt: row.updated_at ? new Date(row.updated_at) : null,
        lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
      }));
    },

    // Full erasure for the "delete all my data" action: the row holds the
    // structural config AND the sealed secrets, so one DELETE removes
    // everything the server stores for this UUID. Library index rows and
    // artwork caches are keyed by provider-hash, shared across installs and
    // TTL-bound - they are nobody's personal data store and are left to age
    // out, never deleted per-UUID (that would nuke other installs).
    async remove(uuid) {
      if (!isUuid(uuid)) return false;
      const result = await pool.query('DELETE FROM configs WHERE uuid = $1', [uuid.toLowerCase()]);
      return (result.rowCount ?? 0) > 0;
    },

    async rotateSecret(uuid) {
      if (!isUuid(uuid)) return null;
      const secret = newSecret();
      const result = await pool.query<{ uuid: string }>(
        'UPDATE configs SET secret_hash = $2, secret_sealed = $3, updated_at = now() WHERE uuid = $1 RETURNING uuid',
        [uuid.toLowerCase(), secretHash(secret), seal(key, secret)],
      );
      if (!(result.rowCount ?? 0)) return null;
      return { uuid: uuid.toLowerCase(), secret, installToken: buildInstallToken(uuid.toLowerCase(), secret) };
    },

    toEngineConfig,
  };
}

export interface ConfigStoreApi {
  createConfigStore: (options?: ConfigStoreOptions) => ConfigStore;
  migrate: (pool: PoolLike) => Promise<void>;
  toEngineConfig: (opened: OpenedConfig) => Record<string, unknown>;
  normaliseTier: (tier: unknown) => Tier;
  TIERS: Tier[];
  DEFAULT_TIER: Tier;
  MIGRATIONS: string[];
}
module.exports = { createConfigStore, migrate, toEngineConfig, normaliseTier, TIERS, DEFAULT_TIER, MIGRATIONS } satisfies ConfigStoreApi;
