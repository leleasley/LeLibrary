// v5.5 setup connections: platform push credentials, watchlist OAuth and
// the Nuvio community proxy, all keyed by setup UUID instead of an account.
//
// Auth model: every route here (except the OAuth callback, which carries a
// single-use state) requires the bearer edit token. Reads never include
// secrets: the browser only learns which connections exist, never values.
// Platform logins happen browser-to-platform; only the resulting tokens are
// posted here for sealing. Passwords never touch these routes.
import type { Express, Request, Response } from 'express';
import type { RuntimeApi } from '../setup/runtime.ts';
import type { TokenApi } from '../setup/token.ts';
import type { EditSessionsApi, EditSessionStore } from '../setup/edit-sessions.ts';
import type { ConnectionsApi, SetupStoreLike } from '../setup/connections.ts';
import type { PushApi, PushConnection } from '../setup/push.ts';
import type { OAuthApi, WatchlistOAuthProvider } from '../setup/oauth.ts';

const express = require('express') as typeof import('express');
const runtime = require('../setup/runtime.ts') as RuntimeApi;
const editSessionsModule = require('../setup/edit-sessions.ts') as EditSessionsApi;
const conns = require('../setup/connections.ts') as ConnectionsApi;
const push = require('../setup/push.ts') as PushApi;
const oauth = require('../setup/oauth.ts') as OAuthApi;
const tokenModule = require('../setup/token.ts') as TokenApi;
const community = require('../catalog/nuvio-community.ts') as {
  MAX_UPSTREAM_BYTES: number;
  listParams: (query: unknown) => Record<string, unknown>;
  failurePayload: (input: { status?: number; code?: string }) => { status: number; error: string; code: string };
  compactListPayload: (data: unknown) => unknown;
};

const { getSetupStore } = runtime;
const { isUuid } = tokenModule;
const { createEditSessionStore, bearerToken } = editSessionsModule;

type Store = SetupStoreLike;

export interface SetupConnectionRoutesOptions {
  basePath?: string;
  editSessions?: EditSessionStore;
}

export interface SetupConnectionRoutesApi {
  mountSetupConnectionRoutes: (app: Express, options?: SetupConnectionRoutesOptions) => void;
}

const PLATFORMS = ['nuvio', 'stremio'];
const WATCHLIST_PROVIDERS = ['simkl', 'trakt'];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function publicOrigin(req: Request): string {
  const configured = (process.env['BASE_URL'] || '').replace(/\/+$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}`;
}

function displayUser(conn: PushConnection | null, platform: string): string | null {
  const user = platform === 'stremio' ? conn?.stremioUser : conn?.nuvioUser;
  const record = asRecord(user);
  for (const key of ['email', 'username', 'name']) {
    if (typeof record[key] === 'string' && (record[key] as string).trim()) return (record[key] as string).trim();
  }
  return null;
}

function mountSetupConnectionRoutes(app: Express, { basePath = '/api/setup', editSessions }: SetupConnectionRoutesOptions = {}): void {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));
  const sessions: EditSessionStore = editSessions || createEditSessionStore();

  const withStore = async (res: Response): Promise<Store | null> => {
    const store = await getSetupStore();
    if (!store) res.status(503).json({ error: 'Setup storage is unavailable on this instance' });
    return (store as unknown as Store) || null;
  };

  function authorizeBearer(req: Request, uuid: string): boolean {
    const bearer = bearerToken(req);
    if (!bearer) return false;
    const session = sessions.verify(bearer);
    return Boolean(session && session.uuid === uuid);
  }

  function rateLimited(windowMs: number, max: number) {
    return (req: Request, res: Response, next: () => void) => {
      const { rateLimit } = require('../middleware/rate-limit.ts') as {
        rateLimit: (options?: { windowMs?: number; max?: number }) => (req: unknown, res: unknown, next: () => void) => void;
      };
      rateLimit({ windowMs, max })(req, res, next);
    };
  }

  async function persistPush(uuid: string, store: Store, platform: string, connection: PushConnection): Promise<void> {
    const current = await store.resolveByUuid(uuid).catch(() => null);
    if (!current) return;
    await store.save(uuid, { keys: conns.mergePushKeys(asRecord(current.keys), platform, connection as Record<string, unknown>) }).catch(() => {});
  }

  // Connection status. Anonymous callers learn nothing: possession of a UUID
  // is not authorization.
  router.get('/:uuid/push-connect/:platform', async (req: Request, res: Response) => {
    const store = await withStore(res);
    if (!store) return;
    const uuid = String(req.params['uuid'] || '').toLowerCase();
    const platform = String(req.params['platform'] || '');
    if (!isUuid(uuid) || !PLATFORMS.includes(platform)) { res.status(400).json({ error: 'Invalid request' }); return; }
    const opened = await store.resolveByUuid(uuid);
    if (!opened) { res.status(404).json({ error: 'Setup not found' }); return; }
    if (!authorizeBearer(req, uuid)) { res.status(401).json({ error: 'Unlock the setup first' }); return; }
    const conn = conns.readPush(opened, platform);
    if (!conn) { res.json({ connected: false }); return; }
    res.json({
      connected: true,
      user: displayUser(conn, platform),
      selectedProfile: platform === 'nuvio' ? (conn.nuvioSelectedProfile ?? null) : null,
    });
  });

  // Seal a browser-obtained platform session into the row. The tokens were
  // minted browser-to-platform; this route only stores them.
  router.post('/:uuid/push-connect', rateLimited(60_000, 10), async (req: Request, res: Response) => {
    const store = await withStore(res);
    if (!store) return;
    const uuid = String(req.params['uuid'] || '').toLowerCase();
    if (!isUuid(uuid)) { res.status(400).json({ error: 'Invalid setup id' }); return; }
    const opened = await store.resolveByUuid(uuid);
    if (!opened) { res.status(404).json({ error: 'Setup not found' }); return; }
    if (!authorizeBearer(req, uuid)) { res.status(401).json({ error: 'Unlock the setup first' }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const platform = String(body['platform'] || '');
    const problem = !PLATFORMS.includes(platform)
      ? 'Unknown platform'
      : conns.validatePushConnection(platform, body['connection']);
    if (problem) { res.status(400).json({ error: problem }); return; }
    await store.save(uuid, {
      keys: conns.mergePushKeys(asRecord(opened.keys), platform, asRecord(body['connection'])),
    });
    res.json({ ok: true });
  });

  // Remember which Nuvio profile receives the setup.
  router.put('/:uuid/push-connect/nuvio/profile', rateLimited(60_000, 10), async (req: Request, res: Response) => {
    const store = await withStore(res);
    if (!store) return;
    const uuid = String(req.params['uuid'] || '').toLowerCase();
    if (!isUuid(uuid)) { res.status(400).json({ error: 'Invalid setup id' }); return; }
    const opened = await store.resolveByUuid(uuid);
    if (!opened) { res.status(404).json({ error: 'Setup not found' }); return; }
    if (!authorizeBearer(req, uuid)) { res.status(401).json({ error: 'Unlock the setup first' }); return; }
    const profileId = Number((req.body as Record<string, unknown> | undefined)?.['profile_id']);
    if (!Number.isFinite(profileId) || profileId < 1) { res.status(400).json({ error: 'Invalid profile' }); return; }
    const conn = conns.readPush(opened, 'nuvio');
    if (!conn) { res.status(400).json({ error: 'Nuvio is not connected' }); return; }
    await store.save(uuid, {
      keys: conns.mergePushKeys(asRecord(opened.keys), 'nuvio', { ...conn, nuvioSelectedProfile: Math.trunc(profileId) }),
    });
    res.json({ ok: true, profile_id: Math.trunc(profileId) });
  });

  router.post('/:uuid/push-connect/:platform/disconnect', rateLimited(60_000, 10), async (req: Request, res: Response) => {
    const store = await withStore(res);
    if (!store) return;
    const uuid = String(req.params['uuid'] || '').toLowerCase();
    const platform = String(req.params['platform'] || '');
    if (!isUuid(uuid) || !PLATFORMS.includes(platform)) { res.status(400).json({ error: 'Invalid request' }); return; }
    const opened = await store.resolveByUuid(uuid);
    if (!opened) { res.status(404).json({ error: 'Setup not found' }); return; }
    if (!authorizeBearer(req, uuid)) { res.status(401).json({ error: 'Unlock the setup first' }); return; }
    await store.save(uuid, { keys: conns.dropEnvelopeKey(asRecord(opened.keys), 'push', platform) });
    res.json({ ok: true });
  });

  // Live Nuvio profiles for the picker. Refreshes an expired session once.
  router.get('/:uuid/push-profiles', rateLimited(60_000, 10), async (req: Request, res: Response) => {
    const store = await withStore(res);
    if (!store) return;
    const uuid = String(req.params['uuid'] || '').toLowerCase();
    if (!isUuid(uuid)) { res.status(400).json({ error: 'Invalid setup id' }); return; }
    const opened = await store.resolveByUuid(uuid);
    if (!opened) { res.status(404).json({ error: 'Setup not found' }); return; }
    if (!authorizeBearer(req, uuid)) { res.status(401).json({ error: 'Unlock the setup first' }); return; }
    let conn = conns.readPush(opened, 'nuvio');
    let token = conn ? push.savedNuvioAccessToken(conn) : '';
    if (!token) { res.status(400).json({ error: 'Nuvio is not connected' }); return; }
    try {
      const profiles = await push.pullNuvioProfiles(token);
      res.json({ profiles, selected: conn?.nuvioSelectedProfile ?? null });
    } catch (err) {
      const detail = err as { response?: { status?: number } };
      if (Number(detail?.response?.status) !== 401 || !conn) {
        res.status(502).json({ error: 'Could not load Nuvio profiles' });
        return;
      }
      const refresh = await push.refreshNuvioToken(conn);
      if (!refresh.refreshed) { res.status(401).json({ error: 'Nuvio session expired. Reconnect Nuvio and try again.' }); return; }
      await persistPush(uuid, store, 'nuvio', refresh.data);
      try {
        const profiles = await push.pullNuvioProfiles(push.savedNuvioAccessToken(refresh.data));
        res.json({ profiles, selected: refresh.data.nuvioSelectedProfile ?? null });
      } catch {
        res.status(502).json({ error: 'Could not load Nuvio profiles' });
      }
    }
  });

  // Push the setup: install the manifest, publish collections, sync home
  // order and badge pack. A one-time `temporary_connection` may stand in for
  // the saved one; it is never persisted.
  router.post('/:uuid/push', rateLimited(60_000, 4), async (req: Request, res: Response) => {
    const store = await withStore(res);
    if (!store) return;
    const uuid = String(req.params['uuid'] || '').toLowerCase();
    if (!isUuid(uuid)) { res.status(400).json({ error: 'Invalid setup id' }); return; }
    const opened = await store.resolveByUuid(uuid);
    if (!opened) { res.status(404).json({ error: 'Setup not found' }); return; }
    if (!authorizeBearer(req, uuid)) { res.status(401).json({ error: 'Unlock the setup first' }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const platform = String(body['platform'] || '');
    if (!PLATFORMS.includes(platform)) { res.status(400).json({ error: 'Unknown platform' }); return; }
    const temporary = asRecord(body['temporary_connection']);
    const hasTemporary = Object.keys(temporary).length > 0;
    if (hasTemporary) {
      const problem = conns.validatePushConnection(platform, temporary);
      if (problem) { res.status(400).json({ error: problem }); return; }
    }
    const saved = conns.readPush(opened, platform);
    const requestedProfile = body['profile_id'];
    const connection = (hasTemporary ? temporary : saved) as PushConnection | null;
    if (!connection) { res.status(400).json({ error: `${platform === 'nuvio' ? 'Nuvio' : 'Stremio'} is not connected` }); return; }
    if (!opened.secret) { res.status(500).json({ error: 'Install link unavailable' }); return; }
    const config = asRecord(opened.config);
    const result = await push.installSetup({
      uuid,
      installToken: `${opened.uuid}.${opened.secret}`,
      connection,
      platform: platform as 'nuvio' | 'stremio',
      profileId: platform === 'nuvio'
        ? (typeof requestedProfile === 'string' || typeof requestedProfile === 'number'
          ? requestedProfile
          : ((saved as PushConnection | null)?.nuvioSelectedProfile ?? 'default'))
        : null,
      document: {
        collections: Array.isArray(config['collections']) ? config['collections'] as unknown[] : [],
        homeRows: Array.isArray(config['collectionHomeRows']) ? config['collectionHomeRows'] as PushConnection[] & never[] : [],
        sources: Array.isArray(config['collectionSources']) ? config['collectionSources'] as unknown[] : [],
      },
      // One parser for badge + playback options (shared with the background
      // replay), so the two push paths cannot drift.
      options: { ...push.pushOptionsFromConfig(config), replaceOtherCollections: body['replace_other_collections'] === true },
      origin: publicOrigin(req),
      port: parseInt(process.env['PORT'] || '', 10) || undefined,
    });
    if (!result.ok) {
      res.status(result.reason === 'push-rate-limited' ? 429 : 502).json({ error: result.error || 'Push failed' });
      return;
    }
    // Persist a rotated Nuvio session; a temporary connection is never saved.
    if (!hasTemporary && result.connection && platform === 'nuvio') {
      await persistPush(uuid, store, platform, result.connection);
    }
    // A partial push (the owned library was still building) finishes itself in
    // the background; a complete one cancels any follow-up already queued.
    const pendingPush = require('../setup/pending-push.ts');
    if (platform === 'nuvio' && result.libraryPending) {
      await pendingPush.schedulePendingPublish({ uuid, origin: publicOrigin(req), profileId: result.profile_id ?? null }).catch(() => {});
    } else {
      await pendingPush.cancelPendingPublish(uuid).catch(() => {});
    }
    res.json({ ok: true, platform: result.platform, profile_id: result.profile_id, libraryPending: result.libraryPending === true });
  });

  // Watchlist status. Nothing secret leaves the server.
  router.get('/:uuid/watchlist', async (req: Request, res: Response) => {
    const store = await withStore(res);
    if (!store) return;
    const uuid = String(req.params['uuid'] || '').toLowerCase();
    if (!isUuid(uuid)) { res.status(400).json({ error: 'Invalid setup id' }); return; }
    const opened = await store.resolveByUuid(uuid);
    if (!opened) { res.status(404).json({ error: 'Setup not found' }); return; }
    if (!authorizeBearer(req, uuid)) { res.status(401).json({ error: 'Unlock the setup first' }); return; }
    const status: Record<string, { connected: boolean; configured: boolean }> = {};
    for (const provider of WATCHLIST_PROVIDERS) {
      status[provider] = {
        connected: conns.readWatchlist(opened, provider) !== null,
        configured: oauth.oauthConfigured(provider),
      };
    }
    res.json(status);
  });

  router.post('/:uuid/watchlist/:provider/disconnect', rateLimited(60_000, 10), async (req: Request, res: Response) => {
    const store = await withStore(res);
    if (!store) return;
    const uuid = String(req.params['uuid'] || '').toLowerCase();
    const provider = String(req.params['provider'] || '');
    if (!isUuid(uuid) || !WATCHLIST_PROVIDERS.includes(provider)) { res.status(400).json({ error: 'Invalid request' }); return; }
    const opened = await store.resolveByUuid(uuid);
    if (!opened) { res.status(404).json({ error: 'Setup not found' }); return; }
    if (!authorizeBearer(req, uuid)) { res.status(401).json({ error: 'Unlock the setup first' }); return; }
    await store.save(uuid, { keys: conns.dropEnvelopeKey(asRecord(opened.keys), 'watchlist', provider) });
    res.json({ ok: true });
  });

  // Start a pre-creation watchlist OAuth flow. No bearer: there is no row
  // yet. The pending state binds no UUID, so the callback hands the tokens
  // to the opener instead of sealing them; the page seals them at creation.
  router.get('/oauth/:provider', rateLimited(60_000, 10), async (req: Request, res: Response) => {
    const provider = String(req.params['provider'] || '');
    if (!WATCHLIST_PROVIDERS.includes(provider)) { res.status(400).json({ error: 'Unknown provider' }); return; }
    if (!oauth.oauthConfigured(provider)) { res.status(503).json({ error: `${provider} connections are not enabled on this server` }); return; }
    const { state } = oauth.createPendingOAuth(null, provider as WatchlistOAuthProvider);
    res.json({ url: oauth.authorizeUrl(provider as WatchlistOAuthProvider, state, publicOrigin(req)) });
  });

  // Start a watchlist OAuth flow. Returns the provider URL as JSON (a popup
  // cannot send an Authorization header, so a redirect would lose the bearer).
  router.get('/:uuid/oauth/:provider', rateLimited(60_000, 10), async (req: Request, res: Response) => {    const store = await withStore(res);
    if (!store) return;
    const uuid = String(req.params['uuid'] || '').toLowerCase();
    const provider = String(req.params['provider'] || '');
    if (!isUuid(uuid) || !WATCHLIST_PROVIDERS.includes(provider)) { res.status(400).json({ error: 'Invalid request' }); return; }
    const opened = await store.resolveByUuid(uuid);
    if (!opened) { res.status(404).json({ error: 'Setup not found' }); return; }
    if (!authorizeBearer(req, uuid)) { res.status(401).json({ error: 'Unlock the setup first' }); return; }
    if (!oauth.oauthConfigured(provider)) { res.status(503).json({ error: `${provider} connections are not enabled on this server` }); return; }
    const { state } = oauth.createPendingOAuth(uuid, provider as WatchlistOAuthProvider);
    res.json({ url: oauth.authorizeUrl(provider as WatchlistOAuthProvider, state, publicOrigin(req)) });
  });

  // OAuth callback: no bearer here (the provider redirects), so the
  // single-use state is the authorization. Renders a self-closing page.
  router.get('/oauth/:provider/callback', rateLimited(60_000, 10), async (req: Request, res: Response) => {
    const provider = String(req.params['provider'] || '');
    if (!WATCHLIST_PROVIDERS.includes(provider)) {
      res.status(404).type('html').send(oauth.popupPage(provider, false, 'Unknown provider.'));
      return;
    }
    const pending = oauth.consumePendingOAuth(req.query['state']);
    if (!pending || pending.provider !== provider) {
      res.status(400).type('html').send(oauth.popupPage(provider, false, 'Sign-in expired. Close this and try again.'));
      return;
    }
    const code = String(req.query['code'] || '');
    if (!code) {
      res.status(400).type('html').send(oauth.popupPage(provider, false, 'Missing sign-in code.'));
      return;
    }
    const store = await getSetupStore();
    if (!store) {
      res.status(503).type('html').send(oauth.popupPage(provider, false, 'Setup storage is unavailable.'));
      return;
    }
    try {
      const conn = await oauth.exchangeCode(
        provider as WatchlistOAuthProvider, code, publicOrigin(req),
      );
      if (!pending.uuid) {
        res.type('html').send(oauth.popupPageWithTokens(provider, conn));
        return;
      }
      const opened = await store.resolveByUuid(pending.uuid);
      if (!opened) throw new Error('Setup not found');
      await store.save(pending.uuid, {
        keys: conns.mergeWatchlistKeys(asRecord(opened.keys), provider, conn as Record<string, unknown>),
      });
      res.type('html').send(oauth.popupPage(provider, true, `${provider === 'simkl' ? 'Simkl' : 'Trakt'} connected. This window closes itself.`));
    } catch (err) {
      res.status(502).type('html').send(oauth.popupPage(provider, false, (err as Error).message || 'Connection failed.'));
    }
  });

  async function communityProxy(req: Request, res: Response, detail: boolean): Promise<void> {
    const store = await withStore(res);
    if (!store) return;
    const uuid = String(req.params['uuid'] || '').toLowerCase();
    if (!isUuid(uuid)) { res.status(400).json({ error: 'Invalid setup id' }); return; }
    const opened = await store.resolveByUuid(uuid);
    if (!opened) { res.status(404).json({ error: 'Setup not found' }); return; }
    if (!authorizeBearer(req, uuid)) { res.status(401).json({ error: 'Unlock the setup first' }); return; }
    let conn = conns.readPush(opened, 'nuvio');
    let token = conn ? push.savedNuvioAccessToken(conn) : '';
    if (!token) { res.status(401).json({ error: 'Connect Nuvio before browsing public collections.' }); return; }
    const axios = require('axios');
    async function fetchUpstream(bearer: string): Promise<unknown> {
      if (detail) {
        const id = String(req.params['id'] || '').trim();
        if (!/^[a-z0-9][a-z0-9-]{0,127}$/i.test(id)) throw { response: { status: 400 } };
        const response = await axios.get(`https://nuvio.tv/api/community-collections/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
          timeout: 20000,
          maxContentLength: community.MAX_UPSTREAM_BYTES,
          validateStatus: (status: number) => status >= 200 && status < 300,
        });
        return response.data;
      }
      const response = await axios.get('https://nuvio.tv/api/community-collections', {
        headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
        params: community.listParams(req.query),
        timeout: 20000,
        maxContentLength: community.MAX_UPSTREAM_BYTES,
        validateStatus: (status: number) => status >= 200 && status < 300,
      });
      return community.compactListPayload(response.data);
    }
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await fetchUpstream(token));
    } catch (err) {
      const detailErr = err as { response?: { status?: number; headers?: Record<string, string> }; code?: string; cause?: { code?: string } };
      if (Number(detailErr?.response?.status) === 401 && conn) {
        const refresh = await push.refreshNuvioToken(conn);
        if (refresh.refreshed) {
          await persistPush(uuid, store, 'nuvio', refresh.data);
          try {
            res.setHeader('Cache-Control', 'no-store');
            res.json(await fetchUpstream(push.savedNuvioAccessToken(refresh.data)));
            return;
          } catch (retryErr) {
            communityError(res, retryErr);
            return;
          }
        }
      }
      communityError(res, err);
    }
  }

  function communityError(res: Response, err: unknown): void {
    const detail = err as { response?: { status?: number; headers?: Record<string, string> }; code?: string; cause?: { code?: string } };
    const status = Number(detail?.response?.status || 0);
    if (status === 429) {
      const retryAfter = String(detail?.response?.headers?.['retry-after'] || '60').replace(/[^0-9]/g, '') || '60';
      res.setHeader('Retry-After', retryAfter);
    }
    const failure = community.failurePayload({ status, code: (detail as { code?: string })?.code || (detail as { cause?: { code?: string } })?.cause?.code });
    res.status(failure.status).json({ error: failure.error, code: failure.code });
  }

  router.get('/:uuid/nuvio-community/collections', rateLimited(60_000, 30), async (req: Request, res: Response) => {
    await communityProxy(req, res, false);
  });

  router.get('/:uuid/nuvio-community/collections/:id', rateLimited(60_000, 30), async (req: Request, res: Response) => {
    await communityProxy(req, res, true);
  });

  app.use(basePath, router);
}

module.exports = { mountSetupConnectionRoutes } satisfies SetupConnectionRoutesApi;
