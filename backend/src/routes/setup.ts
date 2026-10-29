// v5.5 setup surface: create a config, open it for editing, save it, rotate the
// install secret and change the password.
//
// Auth model (see Docs/plans/v5.5 frontend.md): the install URL is the
// capability, so reading serves with no password at all. A password is only
// required to EDIT, and every mutation here re-checks it. Mutations are also
// rate limited per IP and locked out per UUID after repeated failures.
// CommonJS values plus erased type imports: a value `import` would make this
// file an ES module and break its own require() calls.
import type { Express, Request, Response } from 'express';
import type { RuntimeApi } from '../setup/runtime.ts';
import type { ConfigStoreApi, OpenedConfig } from '../setup/config-store.ts';
import type { TokenApi } from '../setup/token.ts';
import type { EditSessionsApi, EditSessionStore } from '../setup/edit-sessions.ts';
import type { ErrorHandlerApi } from '../middleware/error-handler.ts';
import type { OAuthApi } from '../setup/oauth.ts';
import type { ConfigStore } from '../setup/config-store.ts';
import type { SelfhostAccessApi } from '../platform/selfhost-access.ts';

const express = require('express') as typeof import('express');
const runtime = require('../setup/runtime.ts') as RuntimeApi;
const configStore = require('../setup/config-store.ts') as ConfigStoreApi;
const token = require('../setup/token.ts') as TokenApi;
const editSessionsModule = require('../setup/edit-sessions.ts') as EditSessionsApi;
const oauth = require('../setup/oauth.ts') as OAuthApi;
const selfhostAccess = require('../platform/selfhost-access.ts') as SelfhostAccessApi;
const { rateLimit } = require('../middleware/rate-limit.ts') as {
  rateLimit: (options?: { windowMs?: number; max?: number }) => any;
};

const { getSetupStore, getSetupLimiter } = runtime;
const { TIERS, DEFAULT_TIER } = configStore;
const { isUuid, parseInstallToken } = token;
const { createEditSessionStore, bearerToken, DEFAULT_TTL_MS } = editSessionsModule;
const { migrateAccount, MigrateError } = require('../setup/migrate.ts') as {
  migrateAccount: (deps: any, input: any) => Promise<{
    uuid: string; tier: string; installToken: string; keyServices: string[];
    collections: { contexts: number; collections: number }; sourceLabel: string | null;
    purged: 'none' | 'token' | 'account';
  }>;
  listAccountSetups: (deps: any, email: unknown) => Promise<{
    setups: { id: string; label: string | null; createdAt: unknown; lastUsedAt: unknown; enabledKeyServices: string[] | null }[];
    keyServices: string[];
    collections: { contexts: number; collections: number };
  }>;
  MigrateError: new (code: string, message: string) => Error & { code: string };
};

export interface SetupRoutesOptions {
  basePath?: string;
  editSessions?: EditSessionStore;
  // Test seam only: production resolves the lazy Postgres store.
  getStore?: () => Promise<ConfigStore | null>;
}

export interface SetupRoutesApi {
  mountSetupRoutes: (app: Express, options?: SetupRoutesOptions) => void;
  editorConfigView: (opened: OpenedConfig) => { config: Record<string, unknown> };
  resolveRevealKey: (
    opened: OpenedConfig,
    service: unknown,
  ) => { ok: true; key: string } | { ok: false; status: number; error: string };
}

function clientIp(req: Request): string {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

// Services whose saved value the editor may reveal on explicit demand (see
// the reveal route below). This is deliberately a closed list of key-shaped
// fields: connection objects and anything else sealed in the row can never
// come back out through it.
const REVEALABLE_KEY_SERVICES = new Set([
  'torboxApiKey',
  'rdApiKey',
  'adApiKey',
  'pmApiKey',
  'tmdbApiKey',
  'tvdbApiKey',
  'omdbKey',
  'mdblistKey',
  'erdbToken',
  'rpdbKey',
  'fanartKey',
]);

// Pure decision step for key reveal, exported for unit tests. Returns the
// value only when the setup is password-protected (on a passwordless setup
// the UUID alone is the only authority, which must never export secrets to
// a browser) and the service is allowlisted and actually stored.
function resolveRevealKey(opened: OpenedConfig, service: unknown): { ok: true; key: string } | { ok: false; status: number; error: string } {
  if (!opened || !opened.hasPassword) {
    return { ok: false, status: 403, error: 'Set a password on this setup to enable key reveal' };
  }
  if (typeof service !== 'string' || !REVEALABLE_KEY_SERVICES.has(service)) {
    return { ok: false, status: 400, error: 'Unknown key service' };
  }
  const keys = (opened.keys ?? {}) as Record<string, unknown>;
  const value = keys[service];
  if (typeof value !== 'string' || !value) {
    return { ok: false, status: 404, error: 'No saved key for that service' };
  }
  return { ok: true, key: value };
}

// Never return secrets to the browser: the editor gets the structural config
// and the names of which credentials exist, not their values.
function publicView(opened: OpenedConfig) {
  return {
    uuid: opened.uuid,
    tier: opened.tier,
    name: opened.name,
    hasPassword: opened.hasPassword,
    installToken: opened.secret ? `${opened.uuid}.${opened.secret}` : null,
    config: opened.config,
    keyServices: Object.keys(opened.keys),
    updatedAt: opened.updatedAt,
  };
}

// Saved structural config for the editor: pre-fills pickers (poster
// provider, stream preset, badge pack) without ever exposing secrets. Keys
// live in a separate sealed column and are excluded by construction.
function editorConfigView(opened: OpenedConfig) {
  const { connectedWatchlistIds, withLegacyWatchlistRows } = require('../setup/watchlist-home.ts');
  return { config: withLegacyWatchlistRows(opened.config ?? {}, opened.tier, connectedWatchlistIds(opened)) };
}

function mountSetupRoutes(app: Express, { basePath = '/api/setup', editSessions, getStore }: SetupRoutesOptions = {}): void {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));
  const sessions: EditSessionStore = editSessions || createEditSessionStore();

  // Edits are authorised by either a bearer edit token from /unlock or the
  // password itself. Both arrive in the request (never a cookie), so nothing
  // ambient is sent by the browser and CSRF does not apply.
  async function authorizeEdit(req: Request, uuid: string, store: ReturnType<ConfigStoreApi['createConfigStore']>, opened: OpenedConfig): Promise<boolean> {
    const bearer = bearerToken(req);
    if (bearer) {
      const session = sessions.verify(bearer);
      return Boolean(session && session.uuid === uuid);
    }
    if (!opened.hasPassword) return true;
    const password = (req.body as { password?: unknown } | undefined)?.password;
    if (typeof password !== 'string') return false;
    return store.checkPassword(uuid, password);
  }

  const withStore = async (res: Response) => {
    try {
      const store = getStore ? await getStore() : await getSetupStore();
      if (!store) {
        res.status(503).json({ error: 'Setup storage is unavailable on this instance' });
        return null;
      }
      return store;
    } catch {
      // A dropped Postgres connection (or a failed lazy migration) used to
      // reject out of an async Express 4 handler: no response, and the
      // rejection surfaced as an unhandledRejection. Treat it as unavailable.
      if (!res.headersSent) {
        res.status(503).json({ error: 'Setup storage is unavailable on this instance' });
      }
      return null;
    }
  };

  // Create a config. Returns the install token exactly once.
  router.post('/', async (req: Request, res: Response) => {
    const store = await withStore(res);
    if (!store) return;
    const { tier, name, config, keys, password } = (req.body ?? {}) as Record<string, unknown>;
    if (password !== undefined && password !== null && String(password).length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }
    // TMDB powers matching, metadata, posters and search, and every tier marks
    // it required in the UI. Enforce it here too so an API call cannot create a
    // setup that the interface would have refused.
    const keyRecord = (keys && typeof keys === 'object' ? keys : {}) as Record<string, unknown>;
    if (!String(keyRecord['tmdbApiKey'] || '').trim()) {
      res.status(400).json({ error: 'A TMDB API key is required' });
      return;
    }
    if (tier !== undefined && !TIERS.includes(tier as never)) {
      res.status(400).json({ error: `Tier must be one of: ${TIERS.join(', ')}` });
      return;
    }
    try {
      const { normaliseSetupConfigCollections } = require('../setup/collections.ts') as {
        normaliseSetupConfigCollections: <T>(config: T) => T;
      };
      const created = await store.create({
        tier: (tier as string) || DEFAULT_TIER,
        name,
        config: normaliseSetupConfigCollections((config && typeof config === 'object' ? config : {}) as Record<string, unknown>),
        keys: (keys && typeof keys === 'object' ? keys : {}) as Record<string, unknown>,
        password: password ? String(password) : null,
      });
      // Start the library now, not at the first client request. The build takes
      // minutes on a big account, and a setup is often pushed within a minute of
      // being created: warming here lets that overlap with the person reading
      // the end screen instead of making their push wait for it.
      try {
        const { registerBackgroundRefresh } = require('../runtime/refresh.ts');
        registerBackgroundRefresh(created.installToken, {
          ...((config && typeof config === 'object' ? config : {}) as Record<string, unknown>),
          ...((keys && typeof keys === 'object' ? keys : {}) as Record<string, unknown>),
        });
      } catch { /* warming is best effort: the first manifest request still starts it */ }
      res.status(201).json({
        uuid: created.uuid,
        tier: created.tier,
        installToken: created.installToken,
        manifestPath: `/${created.installToken}/manifest.json`,
      });
    } catch {
      res.status(500).json({ error: 'Could not create the setup' });
    }
  });

  // Which watchlist providers this server can connect (public: the setup
  // pages need it before any UUID exists). Registered before /:uuid so the
  // single-segment path is not swallowed by the metadata route.
  router.get('/watchlist-config', async (_req: Request, res: Response) => {
    res.json({
      simkl: oauth.oauthConfigured('simkl'),
      trakt: oauth.oauthConfigured('trakt'),
    });
  });

  // Self-host saved setups (GitHub issue #4). Summaries only: never the secret,
  // the sealed config or any key, so a UUID here can neither watch nor edit.
  // Hidden unless the operator configured SELFHOST_CONFIGS_SECRET, and
  // SELFHOST_LIST_SETUPS=off hides it on shared instances.
  router.get('/', rateLimit({ windowMs: 60_000, max: 30 }), async (req: Request, res: Response) => {
    if (!selfhostAccess.listEnabled()) { res.status(404).json({ error: 'Not found' }); return; }
    if (!selfhostAccess.authorized(req)) { res.status(401).json({ error: 'Invalid selfhost secret' }); return; }
    const store = await withStore(res);
    if (!store) return;
    try {
      const setups = await store.list({ limit: req.query.limit });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ setups });
    } catch {
      res.status(500).json({ error: 'Could not list setups' });
    }
  });

  // Metadata only: tells the editor whether a password is set, nothing secret.
  router.get('/:uuid', async (req: Request, res: Response) => {
    const store = await withStore(res);
    if (!store) return;
    const opened = await store.resolveByUuid(req.params.uuid);
    if (!opened) { res.status(404).json({ error: 'Setup not found' }); return; }
    res.json({
      uuid: opened.uuid, tier: opened.tier, name: opened.name,
      hasPassword: opened.hasPassword, keyServices: Object.keys(opened.keys),
      updatedAt: opened.updatedAt,
    });
  });

  // Open for editing. One password check, then a bearer token; no session cookie.
  router.post('/:uuid/unlock', async (req: Request, res: Response) => {
    const store = await withStore(res);
    if (!store) return;
    const uuid = String(req.params.uuid || '').toLowerCase();
    if (!isUuid(uuid)) { res.status(400).json({ error: 'Invalid setup id' }); return; }
    const limiter = getSetupLimiter();
    const gate = limiter.check(clientIp(req), uuid);
    if (!gate.allowed) {
      res.set('Retry-After', String(Math.ceil(gate.retryAfterMs / 1000)));
      res.status(429).json({ error: 'Too many attempts. Try again shortly.' });
      return;
    }
    const password = (req.body as { password?: unknown } | undefined)?.password;
    if (typeof password !== 'string' || !password) { res.status(400).json({ error: 'Password required' }); return; }
    const opened = await store.resolveByUuid(uuid);
    if (!opened) {
      await store.checkPassword(uuid, password);
      res.status(401).json({ error: 'Setup not found or password incorrect' });
      return;
    }
    if (opened.hasPassword && !(await store.checkPassword(uuid, password))) {
      const failure = limiter.fail(clientIp(req), uuid);
      if (failure.locked) res.set('Retry-After', String(Math.ceil(failure.retryAfterMs / 1000)));
      res.status(401).json({ error: 'Setup not found or password incorrect' });
      return;
    }
    limiter.succeed(clientIp(req), uuid);
    // Short-lived bearer session for the editor. Sent as an Authorization
    // header from here on; the password is never stored or re-sent.
    const session = sessions.issue(uuid);
    res.json({
      ...publicView(opened),
      editToken: session.token,
      editTokenExpiresAt: session.expiresAt,
      editTokenExpiresInMs: DEFAULT_TTL_MS,
    });
  });

  // Saved structural config for an unlocked editor: pre-fills the pickers
  // (poster provider, stream preset, badge pack) so an edit starts where the
  // setup left off. Bearer edit token required; secrets are never included.
  router.get('/:uuid/config', async (req: Request, res: Response) => {
    const store = await withStore(res);
    if (!store) return;
    const uuid = String(req.params.uuid || '').toLowerCase();
    if (!isUuid(uuid)) { res.status(400).json({ error: 'Invalid setup id' }); return; }
    const opened = await store.resolveByUuid(uuid);
    if (!opened) { res.status(404).json({ error: 'Setup not found' }); return; }
    if (!(await authorizeEdit(req, uuid, store, opened))) { res.status(401).json({ error: 'Unlock the setup first' }); return; }
    const view = editorConfigView(opened);
    // Saved collections can still name relative or retired artwork links
    // (made before 5.8): the editor gets the full link to the current art.
    if (Array.isArray(view.config['collections'])) {
      const origin = (process.env['BASE_URL'] || '').replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;
      const { upgradeCollectionArtwork } = require('../catalog/collection-artwork.ts');
      view.config = { ...view.config, collections: upgradeCollectionArtwork(view.config['collections'], origin) };
    }
    res.json(view);
  });

  // Reveal one saved key value to an unlocked editor so the UI can prefill
  // it (and key-dependent previews, like Pictorium, can render from the saved
  // value). Explicit per-service action only: bearer edit token required,
  // tight per-IP rate limit, password-protected setups only, allowlisted
  // services only, and the value itself is never logged.
  router.post('/:uuid/keys/reveal',
    (req, res, next) => {
      const { rateLimit } = require('../middleware/rate-limit.ts') as {
        rateLimit: (options?: { windowMs?: number; max?: number }) => (req: any, res: any, next: () => void) => void;
      };
      rateLimit({ windowMs: 60_000, max: 20 })(req, res, next);
    },
    async (req: Request, res: Response) => {
      const store = await withStore(res);
      if (!store) return;
      const uuid = String(req.params.uuid || '').toLowerCase();
      if (!isUuid(uuid)) { res.status(400).json({ error: 'Invalid setup id' }); return; }
      const opened = await store.resolveByUuid(uuid);
      if (!opened) { res.status(404).json({ error: 'Setup not found' }); return; }
      if (!(await authorizeEdit(req, uuid, store, opened))) { res.status(401).json({ error: 'Unlock the setup first' }); return; }
      const decided = resolveRevealKey(opened, (req.body as { service?: unknown } | undefined)?.service);
      if (!decided.ok) { res.status(decided.status).json({ error: decided.error }); return; }
      console.warn(`[setup] key reveal: uuid=${uuid.slice(0, 8)} service=${(req.body as { service?: unknown } | undefined)?.service}`);
      res.json({ service: (req.body as { service?: unknown } | undefined)?.service, key: decided.key });
    });

  // Save an edit. Password or bearer token required; the secret never changes here.
  router.put('/:uuid', async (req: Request, res: Response) => {
    const store = await withStore(res);
    if (!store) return;
    const uuid = String(req.params.uuid || '').toLowerCase();
    if (!isUuid(uuid)) { res.status(400).json({ error: 'Invalid setup id' }); return; }
    const limiter = getSetupLimiter();
    const gate = limiter.check(clientIp(req), uuid);
    if (!gate.allowed) {
      res.set('Retry-After', String(Math.ceil(gate.retryAfterMs / 1000)));
      res.status(429).json({ error: 'Too many attempts. Try again shortly.' });
      return;
    }
    const { config, keys, tier, name, clearKeys, clearConfig } = (req.body ?? {}) as Record<string, unknown>;
    const opened = await store.resolveByUuid(uuid);
    if (!opened) { res.status(404).json({ error: 'Setup not found' }); return; }
    if (!(await authorizeEdit(req, uuid, store, opened))) {
      const failure = limiter.fail(clientIp(req), uuid);
      if (failure.locked) res.set('Retry-After', String(Math.ceil(failure.retryAfterMs / 1000)));
      res.status(401).json({ error: 'Unlock the setup before editing it' });
      return;
    }
    if (tier !== undefined && !TIERS.includes(tier as never)) { res.status(400).json({ error: 'Invalid tier' }); return; }
    limiter.succeed(clientIp(req), uuid);
    const { normaliseSetupConfigCollections } = require('../setup/collections.ts') as {
      normaliseSetupConfigCollections: <T>(config: T) => T;
    };
    const saved = await store.save(uuid, {
      config: config === undefined ? undefined : normaliseSetupConfigCollections(config as Record<string, unknown>),
      keys: keys as Record<string, unknown> | undefined,
      tier: tier as string | undefined,
      name,
      clearKeys: clearKeys as string[] | undefined,
      clearConfig: clearConfig as string[] | undefined,
    });
    // A save can change the provider keys or the language, so re-warm the
    // library from the stored values instead of waiting for the next request.
    try {
      const after = await store.resolveByUuid(uuid);
      if (after?.secret) {
        require('../runtime/refresh.ts').registerBackgroundRefresh(`${after.uuid}.${after.secret}`, require('../setup/config-store.ts').toEngineConfig(after));
      }
    } catch { /* warming is best effort */ }
    res.json({ ok: true, ...saved });
  });

  // Delete everything stored for this UUID (setup row: config + sealed keys).
  // Same edit authorization as save: bearer token or password. All edit
  // sessions for the UUID die with it, so a logged-in tab cannot keep
  // writing after deletion. The install URL stops working immediately.
  router.delete('/:uuid', async (req: Request, res: Response) => {
    const store = await withStore(res);
    if (!store) return;
    const uuid = String(req.params.uuid || '').toLowerCase();
    if (!isUuid(uuid)) { res.status(400).json({ error: 'Invalid setup id' }); return; }
    const opened = await store.resolveByUuid(uuid);
    if (!opened) { res.status(404).json({ error: 'Setup not found' }); return; }
    if (!(await authorizeEdit(req, uuid, store, opened))) { res.status(401).json({ error: 'Unlock the setup first' }); return; }
    const removed = await store.remove(uuid);
    if (!removed) { res.status(404).json({ error: 'Setup not found' }); return; }
    sessions.revokeUuid(uuid);
    // Its sealed Nuvio manager backups go with it.
    try {
      const nuvioBackups = require('../nuvio/backups.ts').defaultBackupStore();
      if (nuvioBackups) await nuvioBackups.removeAll(uuid);
    } catch { /* best effort: the rows are sealed and keyed to a uuid that no longer exists */ }
    console.warn(`[setup] deleted setup uuid=${uuid.slice(0, 8)}`);
    res.json({ ok: true });
  });

  // Rotate the install secret: invalidates the old URL immediately.
  router.post('/:uuid/secret', async (req: Request, res: Response) => {
    const store = await withStore(res);
    if (!store) return;
    const uuid = String(req.params.uuid || '').toLowerCase();
    if (!isUuid(uuid)) { res.status(400).json({ error: 'Invalid setup id' }); return; }
    const opened = await store.resolveByUuid(uuid);
    if (!opened) { res.status(404).json({ error: 'Setup not found' }); return; }
    if (!(await authorizeEdit(req, uuid, store, opened))) { res.status(401).json({ error: 'Unlock the setup first' }); return; }
    const rotated = await store.rotateSecret(uuid);
    // The old install URL is dead: no edit session should outlive it.
    sessions.revokeUuid(uuid);
    res.json({ ok: true, installToken: rotated?.installToken, manifestPath: `/${rotated?.installToken}/manifest.json` });
  });

  // Set or replace the edit password.
  router.post('/:uuid/password', async (req: Request, res: Response) => {
    const store = await withStore(res);
    if (!store) return;
    const uuid = String(req.params.uuid || '').toLowerCase();
    if (!isUuid(uuid)) { res.status(400).json({ error: 'Invalid setup id' }); return; }
    const opened = await store.resolveByUuid(uuid);
    if (!opened) { res.status(404).json({ error: 'Setup not found' }); return; }
    if (!(await authorizeEdit(req, uuid, store, opened))) {
      const limiter = getSetupLimiter();
      const failure = limiter.fail(clientIp(req), uuid);
      if (failure.locked) res.set('Retry-After', String(Math.ceil(failure.retryAfterMs / 1000)));
      res.status(401).json({ error: 'Unlock the setup first' });
      return;
    }
    const next = (req.body as { password?: unknown } | undefined)?.password;
    if (typeof next !== 'string' || next.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }
    await store.setPassword(uuid, next);
    // Every existing edit session is invalidated by a password change.
    sessions.revokeUuid(uuid);
    res.json({ ok: true });
  });

  // One-time import from the removed account model. The caller pastes the
  // install link or token id of the setup to import: holding that link is the
  // proof of ownership, so no email, session or SMTP is involved. The old
  // provider keys are resealed into a fresh setup and a UUID is handed back;
  // nothing account-shaped is recreated. Pass purgeToken to also delete the
  // migrated token row, or purgeAccount to delete the whole old account
  // (every old table cascades off it).
  router.post('/migrate', (req, res, next) => {
    const { rateLimit } = require('../middleware/rate-limit.ts') as {
      rateLimit: (options?: { windowMs?: number; max?: number }) => (req: any, res: any, next: () => void) => void;
    };
    rateLimit({ windowMs: 60_000, max: 10 })(req, res, next);
  }, async (req: Request, res: Response) => {
    const { loadServerKey } = require('../setup/keys.ts') as { loadServerKey: () => Buffer | null };
    const { getSetupPool } = require('../setup/runtime.ts') as { getSetupPool: () => any };
    const pool = getSetupPool();
    if (!pool) { res.status(503).json({ error: 'Setup storage is unavailable on this instance' }); return; }
    const key = loadServerKey();
    if (!key) { res.status(503).json({ error: 'Setup storage is unavailable on this instance' }); return; }
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const migrated = await migrateAccount(
        { pool, key },
        {
          tokenId: body.tokenId as string | undefined,
          email: body.email as string | undefined,
          idMasked: body.idMasked as string | undefined,
          password: body.password as string,
          tier: body.tier as string | undefined,
          purgeToken: body.purgeToken === true,
          purgeAccount: body.purgeAccount === true,
        },
      );
      res.status(201).json({
        uuid: migrated.uuid,
        tier: migrated.tier,
        installToken: migrated.installToken,
        manifestPath: `/${migrated.installToken}/manifest.json`,
        keyServices: migrated.keyServices,
        collections: migrated.collections,
        sourceLabel: migrated.sourceLabel,
        purged: migrated.purged,
      });
    } catch (error) {
      if (error instanceof MigrateError && error.code === 'not_found') {
        res.status(404).json({ error: 'No saved setup matches that identifier' });
        return;
      }
      if (error instanceof MigrateError && error.code === 'bad_request') {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Could not migrate that setup' });
    }
  });

  // Structural preview for the import modal: the old setup's settings
  // without its secrets, so the page can stage the import visibly before
  // any password exists. Same narrow contract as the picker (email + masked
  // id, rate limited); secrets never leave regardless.
  router.post('/migrate/preview', (req, res, next) => {
    const { rateLimit } = require('../middleware/rate-limit.ts') as {
      rateLimit: (options?: { windowMs?: number; max?: number }) => (req: any, res: any, next: () => void) => void;
    };
    rateLimit({ windowMs: 60_000, max: 10 })(req, res, next);
  }, async (req: Request, res: Response) => {
    const { loadServerKey } = require('../setup/keys.ts') as { loadServerKey: () => Buffer | null };
    const { getSetupPool } = require('../setup/runtime.ts') as { getSetupPool: () => any };
    const pool = getSetupPool();
    if (!pool) { res.status(503).json({ error: 'Setup storage is unavailable on this instance' }); return; }
    const key = loadServerKey();
    if (!key) { res.status(503).json({ error: 'Setup storage is unavailable on this instance' }); return; }
    try {
      const { previewImport } = require('../setup/migrate.ts') as {
        previewImport: (deps: any, input: any) => Promise<unknown>;
      };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const preview = await previewImport(
        { pool, key },
        { email: body.email as string | undefined, idMasked: body.idMasked as string | undefined },
      );
      res.json(preview);
    } catch (error) {
      if (error instanceof MigrateError && error.code === 'not_found') {
        res.status(404).json({ error: 'No saved setup matches that selection' });
        return;
      }
      if (error instanceof MigrateError && error.code === 'bad_request') {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Could not preview that setup' });
    }
  });

  // Full old-setup payload for the import modal: decrypted keys, logins and
  // collection documents in one rate-limited call, so picking a setup fills
  // the whole page. Secrets included by explicit operator decision (see
  // OldSetupData): picker selection gates it, values only go to the browser
  // that asked for its own account's setup.
  router.post('/migrate/data', (req, res, next) => {
    const { rateLimit } = require('../middleware/rate-limit.ts') as {
      rateLimit: (options?: { windowMs?: number; max?: number }) => (req: any, res: any, next: () => void) => void;
    };
    rateLimit({ windowMs: 60_000, max: 10 })(req, res, next);
  }, async (req: Request, res: Response) => {
    const { loadServerKey } = require('../setup/keys.ts') as { loadServerKey: () => Buffer | null };
    const { getSetupPool } = require('../setup/runtime.ts') as { getSetupPool: () => any };
    const pool = getSetupPool();
    if (!pool) { res.status(503).json({ error: 'Setup storage is unavailable on this instance' }); return; }
    const key = loadServerKey();
    if (!key) { res.status(503).json({ error: 'Setup storage is unavailable on this instance' }); return; }
    try {
      const { importOldSetupData } = require('../setup/migrate.ts') as {
        importOldSetupData: (deps: any, input: any) => Promise<unknown>;
      };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const data = await importOldSetupData(
        { pool, key },
        { email: body.email as string | undefined, idMasked: body.idMasked as string | undefined },
      );
      res.json(data);
    } catch (error) {
      if (error instanceof MigrateError && error.code === 'not_found') {
        res.status(404).json({ error: 'No saved setup matches that selection' });
        return;
      }
      if (error instanceof MigrateError && error.code === 'bad_request') {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Could not import that setup' });
    }
  });

  // One-way cleanup after a staged import is created: the UI calls this in
  // the background once creation succeeds, so the old collections, keys and
  // email vanish and a later import finds nothing. Tight limit: same
  // email+mask gate as the import, never a standalone button.
  router.post('/migrate/purge', (req, res, next) => {
    const { rateLimit } = require('../middleware/rate-limit.ts') as {
      rateLimit: (options?: { windowMs?: number; max?: number }) => (req: any, res: any, next: () => void) => void;
    };
    rateLimit({ windowMs: 60_000, max: 5 })(req, res, next);
  }, async (req: Request, res: Response) => {
    const { getSetupPool } = require('../setup/runtime.ts') as { getSetupPool: () => any };
    const pool = getSetupPool();
    if (!pool) { res.status(503).json({ error: 'Setup storage is unavailable on this instance' }); return; }
    try {
      const { purgeOldAccount } = require('../setup/migrate.ts') as {
        purgeOldAccount: (deps: any, input: any) => Promise<{ purged: 'token' | 'account'; tokenId: string }>;
      };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = await purgeOldAccount(
        { pool, key: null },
        { email: body.email as string | undefined, idMasked: body.idMasked as string | undefined },
      );
      // The old setup's Redis leftovers: its saved stream settings and its
      // background-refresh registration. Best effort; the rows are gone either way.
      try {
        const cache = require('../runtime/cache.ts');
        const digest = require('node:crypto').createHash('sha256').update(String(result.tokenId)).digest('hex');
        await Promise.all([
          cache.del(`userconfig:account:${digest}`),
          cache.del(`refresh:account-token:${result.tokenId}`),
        ]);
      } catch { /* cache unavailable: entries expire on their own */ }
      res.json({ ok: true, purged: result.purged });
    } catch (error) {
      if (error instanceof MigrateError && error.code === 'not_found') {
        res.status(404).json({ error: 'No saved setup matches that selection' });
        return;
      }
      if (error instanceof MigrateError && error.code === 'bad_request') {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Could not remove that data' });
    }
  });

  // Picker data for the import screen: which saved setups an old email owns.
  // Metadata only (labels, dates, service names); nothing is created here.
  router.post('/migrate/lookup', (req, res, next) => {
    const { rateLimit } = require('../middleware/rate-limit.ts') as {
      rateLimit: (options?: { windowMs?: number; max?: number }) => (req: any, res: any, next: () => void) => void;
    };
    rateLimit({ windowMs: 60_000, max: 10 })(req, res, next);
  }, async (req: Request, res: Response) => {
    const { loadServerKey } = require('../setup/keys.ts') as { loadServerKey: () => Buffer | null };
    const { getSetupPool } = require('../setup/runtime.ts') as { getSetupPool: () => any };
    const pool = getSetupPool();
    if (!pool) { res.status(503).json({ error: 'Setup storage is unavailable on this instance' }); return; }
    const key = loadServerKey();
    if (!key) { res.status(503).json({ error: 'Setup storage is unavailable on this instance' }); return; }
    try {
      const { listAccountSetups } = require('../setup/migrate.ts') as {
        listAccountSetups: (deps: any, email: unknown) => Promise<{
          setups: unknown[]; keyServices: string[];
          collections: { contexts: number; collections: number };
        }>;
      };
      const found = await listAccountSetups({ pool, key }, (req.body as Record<string, unknown> | undefined)?.email);
      res.json(found);
    } catch (error) {
      if (error instanceof MigrateError && error.code === 'not_found') {
        res.status(404).json({ error: 'No saved setup matches that identifier' });
        return;
      }
      if (error instanceof MigrateError && error.code === 'bad_request') {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Could not look up that email' });
    }
  });

  // Sanity check for the UI: is this install token valid, and for which tier?
  router.get('/:uuid/validate', async (req: Request, res: Response) => {
    const store = await getSetupStore();
    if (!store) { res.status(503).json({ error: 'Setup storage is unavailable' }); return; }
    const value = String(req.query.token || '');
    if (!parseInstallToken(value)) { res.status(400).json({ error: 'Invalid install token' }); return; }
    const opened = await store.resolveByToken(value);
    if (!opened) { res.status(404).json({ valid: false }); return; }
    res.json({ valid: true, uuid: opened.uuid, tier: opened.tier, hasPassword: opened.hasPassword });
  });

  app.use(basePath, router);
}

module.exports = { mountSetupRoutes, editorConfigView, resolveRevealKey } satisfies SetupRoutesApi;
