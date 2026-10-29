// One-time migration from the removed account model into a v5.5 setup.
// Read-only against the old tables: it looks up an account by email or by a
// saved token id, decrypts that account's own provider keys with the old
// server key, and creates a fresh configs row. Raw keys never leave the
// server: the browser only learns which services came across, never values.
import type { ConfigStore, OpenedConfig, Tier } from './config-store.ts';
import type { PoolLike } from './config-store.ts';

const { unseal } = require('./seal.ts') as { unseal: (key: Buffer, from: unknown) => unknown };
const crypto = require('node:crypto') as typeof import('node:crypto');
const { keyFromString } = require('./keys.ts') as { keyFromString: (value: unknown) => Buffer | null };
const { createConfigStore, normaliseTier } = require('./config-store.ts') as {
  createConfigStore: (options: { pool: PoolLike; key: Buffer }) => ConfigStore;
  normaliseTier: (tier: unknown) => Tier;
};

export interface MigrateInput {
  // How the setup to import is identified - one of:
  // - tokenId: the old saved token id from the user's own install link. It
  //   is the proof of ownership: whoever holds the install link owns it.
  // - email + idMasked: the account email plus the masked id shown in the
  //   import picker (e.g. "4v18…epA"). The operator chose picker-only import
  //   for convenience; anyone who knows the account email can import, so this
  //   trades the link-ownership proof for one click.
  tokenId?: string;
  email?: string;
  idMasked?: string;
  password: string;
  tier?: string;
  // Destructive and opt-in: delete the migrated token row ('token') or the
  // whole old account row, which cascades to every old table ('account').
  purgeToken?: boolean;
  purgeAccount?: boolean;
}

export interface SetupSummary {
  // Masked (first 4 + last 3 chars): enough to recognise your own setup in
  // the picker, useless as proof. The full id comes only from the install URL.
  idMasked: string;
  label: string | null;
  // 'collection' for collection/wizard setups (config.collection_setup or
  // config.wizard), 'token' for plain addon tokens. Drives the picker pills.
  kind: 'collection' | 'token';
  createdAt: unknown;
  lastUsedAt: unknown;
  enabledKeyServices: string[] | null;
}

export interface AccountLookup {
  setups: SetupSummary[];
  keyServices: string[];
  collections: CollectionSummary;
}

export interface CollectionSummary {
  contexts: number;
  collections: number;
}

export interface MigrateResult {
  uuid: string;
  tier: Tier;
  installToken: string;
  keyServices: string[];
  collections: CollectionSummary;
  sourceLabel: string | null;
  purged: 'none' | 'token' | 'account';
}

export interface MigrateDeps {
  pool: PoolLike;
  key: Buffer;
  createStore?: (options: { pool: PoolLike; key: Buffer }) => ConfigStore;
}

class MigrateError extends Error {
  readonly code: 'not_found' | 'bad_request' | 'unavailable';
  constructor(code: MigrateError['code'], message: string) {
    super(message);
    this.name = 'MigrateError';
    this.code = code;
  }
}

// Every secret an old account holds, decrypted with the previous server key:
// provider keys as strings, watchlist/push connections as objects under the
// watchlist/push envelope keys (exactly where the v5.5 readers look). A value
// that no longer decrypts is skipped, never surfaced.
async function unsealAccountSecrets(pool: PoolLike, userId: string): Promise<{
  keys: Record<string, unknown>;
  carriedConnections: { watchlist: string[]; push: string[] };
}> {
  const keys: Record<string, unknown> = {};
  const carriedConnections: { watchlist: string[]; push: string[] } = { watchlist: [], push: [] };
  const oldKey = keyFromString(process.env.ENCRYPTION_KEY);
  if (!oldKey) return { keys, carriedConnections };
  try {
    const saved = await pool.query<{ service: string; sealed: unknown }>(
      'SELECT service, sealed FROM provider_keys WHERE user_id = $1', [userId]);
    for (const row of saved.rows) {
      if (typeof row.service !== 'string' || !row.service) continue;
      let value: unknown = unseal(oldKey, row.sealed);
      if (typeof value !== 'string' || !value) value = unsealOldString(oldKey, row.sealed);
      if (typeof value === 'string' && value) keys[row.service] = value;
    }
  } catch { /* key rows unreadable: migrate the structure without secrets */ }
  try {
    const saved = await pool.query<{ provider: string; sealed: unknown }>(
      'SELECT provider, sealed FROM watchlist_conns WHERE user_id = $1', [userId]);
    const envelope: Record<string, unknown> = {};
    for (const row of saved.rows) {
      if (typeof row.provider !== 'string' || !row.provider) continue;
      const value: unknown = unseal(oldKey, row.sealed);
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      envelope[row.provider] = value;
      carriedConnections.watchlist.push(row.provider);
    }
    if (Object.keys(envelope).length > 0) keys.watchlist = envelope;
  } catch { /* absent table: nothing to carry */ }
  try {
    const saved = await pool.query<{ platform: string; sealed: unknown }>(
      'SELECT platform, sealed FROM push_conns WHERE user_id = $1', [userId]);
    const envelope: Record<string, unknown> = {};
    for (const row of saved.rows) {
      if (typeof row.platform !== 'string' || !row.platform) continue;
      const value: unknown = unseal(oldKey, row.sealed);
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      envelope[row.platform] = value;
      carriedConnections.push.push(row.platform);
    }
    if (Object.keys(envelope).length > 0) keys.push = envelope;
  } catch { /* absent table: nothing to carry */ }
  return { keys, carriedConnections };
}

// Picker masking shared by the list and the selection resolver: first 4 +
function maskId(id: string): string {
  return id.length > 7 ? `${id.slice(0, 4)}…${id.slice(-3)}` : '…';
}

// Key fields are never copied out of an old saved config, even though the old
// model kept them out of the stored document: defence in depth, one line.
const SECRET_FIELDS = new Set([
  'torboxApiKey', 'rdApiKey', 'adApiKey', 'pmApiKey', 'tmdbApiKey',
  'mdblistKey', 'erdbToken', 'rpdbKey', 'fanartKey', 'omdbKey',
  'webdavUrl', 'webdavUser', 'webdavPassword',
]);

// The old account model sealed provider keys as raw strings (enc.seal), not
// JSON (enc.sealJson). The shared unseal() JSON-parses after decrypting, so
// it returns null for those rows. This mirrors the old raw-string open.
function unsealOldString(key: Buffer, envelope: unknown): string | null {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null;
  const { iv, tag, ct } = envelope as { iv?: unknown; tag?: unknown; ct?: unknown };
  if (typeof iv !== 'string' || typeof tag !== 'string' || typeof ct !== 'string') return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const out = Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]);
    const text = out.toString('utf8');
    return text ? text : null;
  } catch {
    return null;
  }
}

function splitConfigAndKeys(raw: unknown): { config: Record<string, unknown>; carriedKeys: string[] } {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const config: Record<string, unknown> = { ...source };
  const carriedKeys: string[] = [];
  for (const field of SECRET_FIELDS) {
    if (config[field] !== undefined) {
      carriedKeys.push(field);
      delete config[field];
    }
  }
  return { config, carriedKeys };
}

// Resolve an old token row from the picker selection (account email +
// masked id shown in the import list). Shared by preview, full import and
// the selection leg of migration so the three can never disagree.
async function resolveSourceToken(pool: PoolLike, email: string, idMasked: string): Promise<{
  userId: string; tokenId: string; config: Record<string, unknown>; label: string | null;
}> {
  const address = typeof email === 'string' ? email.trim() : '';
  const masked = typeof idMasked === 'string' ? idMasked.trim() : '';
  if (!address || address.length > 320 || !address.includes('@') || !masked) {
    throw new MigrateError('bad_request', 'Pick one of your setups to import');
  }
  let userId: string;
  try {
    const found = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE lower(email) = lower($1)', [address]);
    if (!found.rows[0]) throw new MigrateError('not_found', 'No account matches that email');
    userId = String(found.rows[0].id);
  } catch (error) {
    if (error instanceof MigrateError) throw error;
    throw new MigrateError('not_found', 'No account matches that email');
  }
  let candidates;
  try {
    candidates = await pool.query<{ id: string; user_id: string; config: unknown; label: string | null }>(
      'SELECT id, user_id, config, label FROM tokens WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  } catch {
    throw new MigrateError('not_found', 'No saved setup matches that selection');
  }
  const matches = (candidates.rows || []).filter((row) => maskId(String(row.id)) === masked);
  if (matches.length !== 1) {
    throw new MigrateError('not_found', 'No saved setup matches that selection');
  }
  const row = matches[0];
  return {
    userId,
    tokenId: String(row.id),
    config: (row.config && typeof row.config === 'object' ? row.config : {}) as Record<string, unknown>,
    label: row.label ?? null,
  };
}

// Picker data for the import screen: which saved setups an old email owns,
// what key services exist (names only, never decrypted here) and how much
// collection structure there is. Nothing written, nothing secret returned.
async function listAccountSetups(deps: MigrateDeps, email: unknown): Promise<AccountLookup> {
  const { pool } = deps;
  const address = typeof email === 'string' ? email.trim() : '';
  if (!address || address.length > 320 || !address.includes('@')) {
    throw new MigrateError('bad_request', 'Provide an account email');
  }
  let userId: string;
  try {
    const found = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE lower(email) = lower($1)', [address]);
    if (!found.rows[0]) throw new MigrateError('not_found', 'No account matches that email');
    userId = String(found.rows[0].id);
  } catch (error) {
    if (error instanceof MigrateError) throw error;
    throw new MigrateError('not_found', 'No account matches that email');
  }
  let setups: SetupSummary[] = [];
  let keyServices: string[] = [];
  let contexts = 0;
  let collections = 0;
  try {
    const rows = await pool.query<{
      id: string; label: string | null; config: unknown;
      created_at: unknown; last_used_at: unknown;
    }>(
      `SELECT id, label, config, created_at, last_used_at FROM tokens
       WHERE user_id = $1 AND revoked_at IS NULL
       ORDER BY last_used_at DESC NULLS LAST, created_at DESC LIMIT 25`, [userId]);
    setups = rows.rows.map((row) => {
      const config = (row.config && typeof row.config === 'object' ? row.config : {}) as Record<string, unknown>;
      const enabled = Array.isArray(config.enabledKeyServices)
        ? (config.enabledKeyServices as unknown[]).filter((s): s is string => typeof s === 'string')
        : null;
      const id = String(row.id);
      // Collection/wizard setups live in the same tokens table as plain
      // addon tokens; the flags mirror the old account model's own
      // collection-setup queries (config->>'collection_setup', wizard).
      const kind = config.collection_setup === true || config.wizard === true
        ? 'collection'
        : 'token';
      return {
        idMasked: maskId(id),
        label: row.label ?? null,
        kind,
        createdAt: row.created_at ?? null, lastUsedAt: row.last_used_at ?? null,
        enabledKeyServices: enabled,
      };
    });
  } catch { /* token table unreadable: return what we have */ }
  try {
    const names = await pool.query<{ service: string }>(
      'SELECT service FROM provider_keys WHERE user_id = $1', [userId]);
    keyServices = names.rows
      .map((row) => row.service)
      .filter((service): service is string => typeof service === 'string' && !!service);
  } catch { /* key table absent: leave the list empty */ }
  try {
    const counted = await pool.query<{ contexts: string; collections: string }>(
      `SELECT (SELECT COUNT(*) FROM collection_contexts WHERE user_id = $1) AS contexts,
              (SELECT COUNT(*) FROM collections WHERE user_id = $1) AS collections`, [userId]);
    contexts = Number(counted.rows[0]?.contexts || 0);
    collections = Number(counted.rows[0]?.collections || 0);
  } catch { /* collection tables absent: leave the counts at zero */ }
  return { setups, keyServices, collections: { contexts, collections } };
}

async function migrateAccount(deps: MigrateDeps, input: MigrateInput): Promise<MigrateResult> {
  const { pool, key } = deps;
  const createStore = deps.createStore ?? createConfigStore;
  const rawTokenId = typeof input.tokenId === 'string' ? input.tokenId.trim() : '';
  const rawEmail = typeof input.email === 'string' ? input.email.trim() : '';
  const rawMasked = typeof input.idMasked === 'string' ? input.idMasked.trim() : '';
  if (typeof input.password !== 'string' || input.password.length < 8) {
    throw new MigrateError('bad_request', 'Password must be at least 8 characters');
  }

  // Resolve the source token row: direct id first, else the picker
  // selection (account email + masked id shown in the import list).
  let source: { userId: string; tokenId: string; config: Record<string, unknown>; label: string | null };
  if (rawTokenId) {
    if (rawTokenId.length > 128) {
      throw new MigrateError('bad_request', 'Pick one of your setups to import');
    }
    // The old tables may not exist at all (self-hosted installs never had them).
    try {
      const found = await pool.query<{ id: string; user_id: string; config: unknown; label: string | null }>(
        'SELECT id, user_id, config, label FROM tokens WHERE id = $1 AND revoked_at IS NULL', [rawTokenId]);
      const row = found.rows[0];
      if (!row) throw new MigrateError('not_found', 'No saved setup matches that token id');
      source = {
        userId: String(row.user_id),
        tokenId: String(row.id),
        config: (row.config && typeof row.config === 'object' ? row.config : {}) as Record<string, unknown>,
        label: row.label ?? null,
      };
    } catch (error) {
      if (error instanceof MigrateError) throw error;
      // Missing tables or an unreachable database read the same as "nothing to
      // migrate" from the outside; the message stays generic on purpose.
      throw new MigrateError('not_found', 'No saved setup matches that identifier');
    }
  } else {
    source = await resolveSourceToken(pool, rawEmail, rawMasked);
  }
  const { userId, tokenId } = source;

  // Decrypt that account's own secrets with the previous server key. A value
  // that no longer decrypts is skipped, never surfaced. Shared with the
  // full-data import below so the two can never disagree on what an account
  // holds.
  const { keys, carriedConnections } = await unsealAccountSecrets(pool, userId);

  const { config, carriedKeys } = splitConfigAndKeys(source.config);
  const keyServices = [
    ...Object.keys(keys).filter((service) => service !== 'watchlist' && service !== 'push'),
    ...carriedKeys.filter((field) => !(field in keys)),
    ...carriedConnections.watchlist.map((provider) => `watchlist:${provider}`),
    ...carriedConnections.push.map((platform) => `push:${platform}`),
  ];

  let contexts = 0;
  let collections = 0;
  try {
    const counted = await pool.query<{ contexts: string; collections: string }>(
      `SELECT (SELECT COUNT(*) FROM collection_contexts WHERE user_id = $1) AS contexts,
              (SELECT COUNT(*) FROM collections WHERE user_id = $1) AS collections`, [userId]);
    contexts = Number(counted.rows[0]?.contexts || 0);
    collections = Number(counted.rows[0]?.collections || 0);
  } catch { /* collection tables absent: leave the counts at zero */ }

  const store = createStore({ pool, key });
  const created = await store.create({
    tier: normaliseTier(input.tier ?? 'partial'),
    name: source.label || 'Imported setup',
    config,
    keys,
    password: input.password,
  });
  // Start the library for the imported setup straight away (same reason as
  // creation: the build takes minutes and the setup is usually pushed at once).
  try {
    require('../runtime/refresh.ts').registerBackgroundRefresh(created.installToken, { ...config, ...keys });
  } catch { /* warming is best effort */ }

  // Opt-in cleanup runs only after the new row exists. The caller proved
  // ownership by holding the install link, so deleting the migrated token
  // or the whole account is scoped and deliberate. A purge failure never
  // fails the migration itself.
  let purged: MigrateResult['purged'] = 'none';
  if (input.purgeAccount || input.purgeToken) {
    try {
      if (input.purgeAccount) {
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        purged = 'account';
      } else {
        await pool.query('DELETE FROM tokens WHERE id = $1', [source.tokenId]);
        purged = 'token';
      }
    } catch { /* leave the old rows: the new setup already exists */ }
  }

  return {
    uuid: created.uuid,
    tier: created.tier,
    installToken: created.installToken,
    keyServices,
    collections: { contexts, collections },
    sourceLabel: source.label,
    purged,
  };
}

export interface ImportPreview {
  // Structural config only: every secret-shaped field is stripped by the
  // same splitConfigAndKeys the migration uses, so the browser can render
  // the old setup's settings without ever touching its secrets.
  config: Record<string, unknown>;
  sourceLabel: string | null;
  kind: 'collection' | 'token';
  keyServices: string[];
  watchlist: string[];
  push: string[];
  collections: CollectionSummary;
}

async function previewImport(deps: MigrateDeps, input: { email: string; idMasked: string }): Promise<ImportPreview> {
  const { pool } = deps;
  const source = await resolveSourceToken(pool, input.email, input.idMasked);
  const { userId } = source;
  const rawConfig = source.config;
  const { config } = splitConfigAndKeys(rawConfig);
  const kind = rawConfig.collection_setup === true || rawConfig.wizard === true ? 'collection' : 'token';

  const keyServices: string[] = [];
  const watchlist: string[] = [];
  const push: string[] = [];
  try {
    const names = await pool.query<{ service: string }>(
      'SELECT service FROM provider_keys WHERE user_id = $1', [userId]);
    for (const row of names.rows) {
      if (typeof row.service === 'string' && row.service) keyServices.push(row.service);
    }
  } catch { /* key table absent: leave the list empty */ }
  try {
    const rows = await pool.query<{ provider: string }>(
      'SELECT provider FROM watchlist_conns WHERE user_id = $1', [userId]);
    for (const row of rows.rows) {
      if (typeof row.provider === 'string' && row.provider) watchlist.push(row.provider);
    }
  } catch { /* absent table: leave the list empty */ }
  try {
    const rows = await pool.query<{ platform: string }>(
      'SELECT platform FROM push_conns WHERE user_id = $1', [userId]);
    for (const row of rows.rows) {
      if (typeof row.platform === 'string' && row.platform) push.push(row.platform);
    }
  } catch { /* absent table: leave the list empty */ }

  let contexts = 0;
  let collections = 0;
  try {
    const counted = await pool.query<{ contexts: string; collections: string }>(
      `SELECT (SELECT COUNT(*) FROM collection_contexts WHERE user_id = $1) AS contexts,
              (SELECT COUNT(*) FROM collections WHERE user_id = $1) AS collections`, [userId]);
    contexts = Number(counted.rows[0]?.contexts || 0);
    collections = Number(counted.rows[0]?.collections || 0);
  } catch { /* collection tables absent: leave the counts at zero */ }

  return {
    config,
    sourceLabel: source.label ?? null,
    kind,
    keyServices,
    watchlist,
    push,
    collections: { contexts, collections },
  };
}

export interface OldSetupData {
  // Everything the import modal folds into the page in one go. Secrets ARE
  // included by explicit operator decision: the picker selection (account
  // email + masked id) gates it, it is rate limited, and values are only
  // ever shown to the browser that asked for its own account's setup.
  keys: Record<string, unknown>;
  watchlist: string[];
  push: string[];
  // Collection + home-row documents from the setup's own context (token
  // keyContext first, then same-integration, then anything), with the
  // legacy user-level row as the final fallback.
  collections: unknown[];
  homeRows: unknown[];
  context: { integration: string; profileId: string } | null;
  config: Record<string, unknown>;
  sourceLabel: string | null;
  kind: 'collection' | 'token';
}

function isDocArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

// One-way cleanup after a staged import is created: deletes the whole old
// account row, which cascades to every old table (tokens, keys, logins,
// contexts, collections, legacy config). The email goes with it, so a later
// import lookup finds nothing and the picker reads empty. Deliberately
// gated exactly like the import itself (account email + masked picker id):
// whoever could import can purge, and the UI only offers it as the silent
// aftermath of a successful creation, never as a standalone button.
// After a setup is imported and its new v5.5 setup created: remove the
// imported old setup, and remove the whole old account (email, keys, logins,
// collections, sessions; the users row cascades) only once it has no other
// old setups left to import. An account with two old setups keeps the second
// until that one is imported too. Collection rows that pointed at the deleted
// setup are kept by the account and lose only that link (FK is SET NULL).
async function purgeOldAccount(deps: { pool: PoolLike }, input: { email: string; idMasked: string }): Promise<{ purged: 'token' | 'account'; tokenId: string }> {
  const { pool } = deps;
  const source = await resolveSourceToken(pool, input.email, input.idMasked);
  await pool.query('DELETE FROM tokens WHERE id = $1 AND user_id = $2', [source.tokenId, source.userId]);
  const left = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM tokens WHERE user_id = $1 AND revoked_at IS NULL', [source.userId]);
  if (Number(left.rows[0]?.n || 0) === 0) {
    await pool.query('DELETE FROM users WHERE id = $1', [source.userId]);
    return { purged: 'account', tokenId: source.tokenId };
  }
  return { purged: 'token', tokenId: source.tokenId };
}

async function importOldSetupData(deps: MigrateDeps, input: { email: string; idMasked: string }): Promise<OldSetupData> {
  const { pool } = deps;
  const source = await resolveSourceToken(pool, input.email, input.idMasked);
  const { userId } = source;
  const rawConfig = source.config;
  const { config } = splitConfigAndKeys(rawConfig);
  const kind = rawConfig.collection_setup === true || rawConfig.wizard === true ? 'collection' : 'token';
  const { keys, carriedConnections } = await unsealAccountSecrets(pool, userId);

  let collections: unknown[] = [];
  let homeRows: unknown[] = [];
  let context: { integration: string; profileId: string } | null = null;
  try {
    const rows = await pool.query<{
      integration: string; profile_id: string; collections: unknown; home_rows: unknown;
    }>(
      `SELECT integration, profile_id, collections, home_rows FROM collection_contexts
        WHERE user_id = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 25`, [userId]);
    const list = rows.rows || [];
    if (list.length > 0) {
      const keyContext = (rawConfig.keyContext && typeof rawConfig.keyContext === 'object'
        ? rawConfig.keyContext : {}) as { integration?: unknown; profile_id?: unknown };
      const pick =
        list.find((row) => String(row.integration) === String(keyContext.integration || '')
          && String(row.profile_id) === String(keyContext.profile_id || '')) ||
        list.find((row) => String(row.integration) === String(keyContext.integration || '')) ||
        list.find((row) => String(row.integration) === 'nuvio') ||
        list[0];
      if (pick) {
        if (isDocArray(pick.collections)) collections = pick.collections;
        if (isDocArray(pick.home_rows)) homeRows = pick.home_rows;
        context = { integration: String(pick.integration), profileId: String(pick.profile_id) };
      }
    }
  } catch { /* contexts table absent: fall through to the legacy row */ }
  if (!context) {
    try {
      const legacy = await pool.query<{ collections: unknown; home_rows: unknown }>(
        'SELECT collections, home_rows FROM collection_config WHERE user_id = $1', [userId]);
      const row = legacy.rows[0];
      if (row) {
        if (isDocArray(row.collections)) collections = row.collections;
        if (isDocArray(row.home_rows)) homeRows = row.home_rows;
      }
    } catch { /* legacy row absent: leave both empty */ }
  }

  return {
    keys,
    watchlist: carriedConnections.watchlist,
    push: carriedConnections.push,
    collections,
    homeRows,
    context,
    config,
    sourceLabel: source.label ?? null,
    kind,
  };
}

export interface MigrateApi {
  migrateAccount: typeof migrateAccount;
  listAccountSetups: typeof listAccountSetups;
  previewImport: typeof previewImport;
  importOldSetupData: typeof importOldSetupData;
  purgeOldAccount: typeof purgeOldAccount;
  splitConfigAndKeys: typeof splitConfigAndKeys;
  maskId: typeof maskId;
  MigrateError: typeof MigrateError;
}

module.exports = { migrateAccount, listAccountSetups, previewImport, importOldSetupData, purgeOldAccount, splitConfigAndKeys, maskId, MigrateError } satisfies MigrateApi;
