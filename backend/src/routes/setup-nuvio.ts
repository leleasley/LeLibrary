// Nuvio manager API: /api/setup/:uuid/nuvio/*
// Contract: Docs/plans/5.8-nuvio-api-contract.md.
//
// Same authority as editing: the bearer edit token for this setup. Every
// call works on the setup's sealed Nuvio connection (keys.push.nuvio); a
// rotated Nuvio token is saved back. Responses are never cached and never
// carry tokens, PIN hashes or other addons' links; nothing user-specific is
// logged (errors are logged as status and code only).
import type { Express, Request, Response } from 'express';
import type { EditSessionsApi, EditSessionStore } from '../setup/edit-sessions.ts';
import type { RuntimeApi } from '../setup/runtime.ts';
import type { ConnectionsApi, SetupStoreLike } from '../setup/connections.ts';
import type { PushConnection } from '../setup/push.ts';
import type { HttpTransport, NuvioClientApi } from '../nuvio/client.ts';
import type { BackupStore, BackupsApi } from '../nuvio/backups.ts';
import type { NuvioService, NuvioServiceApi } from '../nuvio/service.ts';

const express = require('express') as typeof import('express');
const runtime = require('../setup/runtime.ts') as RuntimeApi;
const { createEditSessionStore, bearerToken } = require('../setup/edit-sessions.ts') as EditSessionsApi;
const conns = require('../setup/connections.ts') as ConnectionsApi;
const clientModule = require('../nuvio/client.ts') as NuvioClientApi;
const backupsModule = require('../nuvio/backups.ts') as BackupsApi;
const serviceModule = require('../nuvio/service.ts') as NuvioServiceApi;

export interface SetupNuvioDeps {
  getStore?: () => Promise<SetupStoreLike | null>;
  getBackups?: () => BackupStore | null;
  http?: HttpTransport;
  fetchManifestName?: (url: string) => Promise<string | null>;
}

export interface SetupNuvioRoutesOptions {
  basePath?: string;
  editSessions?: EditSessionStore;
  deps?: SetupNuvioDeps;
}

export interface SetupNuvioRoutesApi {
  mountSetupNuvioRoutes: (app: Express, options?: SetupNuvioRoutesOptions) => void;
  fetchManifestName: (url: string) => Promise<string | null>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROW_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const COLLECTION_ID_RE = /^[^\s/]{1,200}$/;
const READ_LIMIT = 30;
const WRITE_LIMIT = 20;
const MANIFEST_BYTES = 512 * 1024;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rateLimited(max: number) {
  return (req: Request, res: Response, next: () => void) => {
    const { rateLimit } = require('../middleware/rate-limit.ts') as {
      rateLimit: (options?: { windowMs?: number; max?: number; scope?: string }) => (req: unknown, res: unknown, next: () => void) => void;
    };
    rateLimit({ windowMs: 60_000, max, scope: 'nuvio' })(req, res, next);
  };
}

function publicOrigin(req: Request): string {
  const configured = (process.env['BASE_URL'] || '').replace(/\/+$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}`;
}

function displayUser(conn: PushConnection): string {
  const record = asRecord(conn.nuvioUser);
  for (const key of ['email', 'username', 'name']) {
    if (typeof record[key] === 'string' && (record[key] as string).trim()) return (record[key] as string).trim();
  }
  return '';
}

// Read an addon's display name from its manifest: public hosts only, the DNS
// answer pinned, no redirects, size and time capped. null on any failure.
async function fetchManifestName(url: string): Promise<string | null> {
  try {
    const aio = require('../streams/aiostreams.ts');
    const parsed = new URL(url);
    const lookup = await aio.pinnedLookup(parsed.hostname, { allowPrivate: aio.allowPrivateHosts() });
    if (!lookup) return null;
    const axios = require('axios');
    const response = await axios.get(parsed.toString(), {
      lookup,
      timeout: 6000,
      maxContentLength: MANIFEST_BYTES,
      maxBodyLength: MANIFEST_BYTES,
      maxRedirects: 0,
      validateStatus: (status: number) => status === 200,
      headers: { Accept: 'application/json' },
    });
    const name = asRecord(response.data)['name'];
    return typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : null;
  } catch {
    return null;
  }
}

function mountSetupNuvioRoutes(app: Express, { basePath = '/api/setup', editSessions, deps = {} }: SetupNuvioRoutesOptions = {}): void {
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));
  const sessions: EditSessionStore = editSessions || createEditSessionStore();
  const getStore = deps.getStore || (async () => (await runtime.getSetupStore()) as unknown as SetupStoreLike | null);
  const getBackups = deps.getBackups || backupsModule.defaultBackupStore;
  const nameOf = deps.fetchManifestName || fetchManifestName;

  router.use('/:uuid/nuvio', (_req: Request, res: Response, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  function sendError(res: Response, status: number, code: string, error: string): void {
    res.status(status).json({ error, code });
  }

  interface Context { uuid: string; conn: PushConnection; service: NuvioService }

  async function context(req: Request, res: Response): Promise<Context | null> {
    const uuid = String(req.params['uuid'] || '').toLowerCase();
    if (!UUID_RE.test(uuid)) { sendError(res, 400, 'invalid', 'Invalid setup id'); return null; }
    const bearer = bearerToken(req);
    const session = bearer ? sessions.verify(bearer) : null;
    if (!session || session.uuid !== uuid) { sendError(res, 401, 'unauthorized', 'Unlock the setup first'); return null; }
    const store = await getStore().catch(() => null);
    const backups = getBackups();
    if (!store || !backups) { sendError(res, 503, 'nuvio-error', 'Setup storage is unavailable on this instance'); return null; }
    const opened = await store.resolveByUuid(uuid);
    if (!opened) { sendError(res, 404, 'not-found', 'Setup not found'); return null; }
    const conn = conns.readPush(opened, 'nuvio');
    if (!conn || !(conn.nuvioToken || conn['access_token'] || conn['accessToken'] || conn['token'])) {
      sendError(res, 409, 'nuvio-not-connected', 'Sign in to Nuvio on this setup first.');
      return null;
    }
    const client = clientModule.createNuvioClient({
      uuid,
      connection: conn,
      http: deps.http,
      reload: async () => conns.readPush(await store.resolveByUuid(uuid), 'nuvio'),
      persist: async (next) => {
        const current = await store.resolveByUuid(uuid);
        if (!current) return;
        // Keep the newest saved selection etc.; only the tokens change.
        const saved = conns.readPush(current, 'nuvio') || {};
        await store.save(uuid, {
          keys: conns.mergePushKeys(asRecord(current.keys), 'nuvio', {
            ...saved,
            nuvioToken: next.nuvioToken,
            nuvioRefresh: next.nuvioRefresh,
          }),
        });
      },
    });
    const service = serviceModule.createNuvioService({
      client,
      backups,
      own: { origin: publicOrigin(req), uuid },
      fetchManifestName: nameOf,
    });
    return { uuid, conn, service };
  }

  function profileIndex(req: Request, res: Response): number | null {
    const index = Number(req.params['index']);
    if (!Number.isInteger(index) || index < 1 || index > clientModule.MAX_PROFILES) {
      sendError(res, 400, 'invalid', 'Invalid profile');
      return null;
    }
    return index;
  }

  function handleError(res: Response, err: unknown): void {
    if (err instanceof clientModule.NuvioManagerError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    const status = err instanceof clientModule.NuvioHttpError ? err.status : 0;
    const pgCode = err instanceof clientModule.NuvioHttpError ? err.pgCode : '';
    console.warn('[Nuvio manager] Nuvio call failed', status || 'network', pgCode || '');
    if (status === 409) { sendError(res, 409, 'nuvio-conflict', 'This changed on a device since it was loaded. Reload and try again.'); return; }
    sendError(res, 502, 'nuvio-error', 'Nuvio did not accept the change. Try again in a moment.');
  }

  type Handler = (ctx: Context, req: Request) => Promise<unknown>;

  function route(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, limit: number, handler: Handler, withIndex = false): void {
    router[method](`/:uuid/nuvio${path}`, rateLimited(limit), async (req: Request, res: Response) => {
      if (withIndex && profileIndex(req, res) === null) return;
      const ctx = await context(req, res);
      if (!ctx) return;
      try {
        res.json(await handler(ctx, req));
      } catch (err) {
        handleError(res, err);
      }
    });
  }

  const body = (req: Request) => asRecord(req.body);
  const index = (req: Request) => Number(req.params['index']);
  const idParam = (req: Request, re: RegExp): string => {
    const id = String(req.params['id'] || '');
    if (!re.test(id)) throw new clientModule.NuvioManagerError(404, 'not-found', 'Not found');
    return id;
  };

  route('get', '', READ_LIMIT, async (ctx) => {
    const { profiles, maxProfiles } = await ctx.service.overview();
    const selected = Number(ctx.conn.nuvioSelectedProfile);
    return {
      user: displayUser(ctx.conn),
      profiles,
      selected: Number.isInteger(selected) && selected >= 1 ? selected : null,
      maxProfiles,
    };
  });

  route('get', '/backups', READ_LIMIT, async (ctx, req) => {
    const raw = req.query['profile'];
    let profile: number | null = null;
    if (raw !== undefined && raw !== '') {
      profile = Number(raw);
      if (!Number.isInteger(profile) || profile < 1 || profile > clientModule.MAX_PROFILES) {
        throw new clientModule.NuvioManagerError(400, 'invalid', 'Invalid profile');
      }
    }
    return ctx.service.listBackups(profile);
  });

  route('post', '/backups/:id/restore', WRITE_LIMIT, async (ctx, req) => (
    ctx.service.restore(idParam(req, UUID_RE), body(req))
  ));

  route('post', '/profiles', WRITE_LIMIT, async (ctx, req) => ctx.service.createProfile(body(req)));
  route('get', '/profiles/:index', READ_LIMIT, async (ctx, req) => ctx.service.profileState(index(req)), true);
  route('patch', '/profiles/:index', WRITE_LIMIT, async (ctx, req) => ctx.service.patchProfile(index(req), body(req)), true);
  route('delete', '/profiles/:index', WRITE_LIMIT, async (ctx, req) => ctx.service.deleteProfile(index(req), body(req)), true);
  route('post', '/profiles/:index/copy', WRITE_LIMIT, async (ctx, req) => ctx.service.copyProfile(index(req), body(req)), true);
  route('patch', '/profiles/:index/settings', WRITE_LIMIT, async (ctx, req) => ctx.service.updateSettings(index(req), body(req)), true);
  route('post', '/profiles/:index/addons', WRITE_LIMIT, async (ctx, req) => ctx.service.addAddon(index(req), body(req)), true);
  // Registered before /addons/:id so "order" is never taken for a row id.
  route('put', '/profiles/:index/addons/order', WRITE_LIMIT, async (ctx, req) => ctx.service.reorderAddons(index(req), body(req)), true);
  route('patch', '/profiles/:index/addons/:id', WRITE_LIMIT, async (ctx, req) => (
    ctx.service.updateAddon(index(req), idParam(req, ROW_ID_RE), body(req))
  ), true);
  route('delete', '/profiles/:index/addons/:id', WRITE_LIMIT, async (ctx, req) => (
    ctx.service.deleteAddon(index(req), idParam(req, ROW_ID_RE))
  ), true);
  route('put', '/profiles/:index/collections/order', WRITE_LIMIT, async (ctx, req) => ctx.service.reorderCollections(index(req), body(req)), true);
  route('patch', '/profiles/:index/collections/:id', WRITE_LIMIT, async (ctx, req) => (
    ctx.service.setCollectionHidden(index(req), idParam(req, COLLECTION_ID_RE), body(req))
  ), true);
  route('delete', '/profiles/:index/collections/:id', WRITE_LIMIT, async (ctx, req) => (
    ctx.service.deleteCollection(index(req), idParam(req, COLLECTION_ID_RE))
  ), true);
  route('put', '/profiles/:index/home', WRITE_LIMIT, async (ctx, req) => ctx.service.setHome(index(req), body(req)), true);
  route('post', '/profiles/:index/backups', WRITE_LIMIT, async (ctx, req) => ctx.service.backupNow(index(req)), true);
  route('post', '/profiles/:index/undo', WRITE_LIMIT, async (ctx, req) => ctx.service.undo(index(req)), true);

  // Prefill while creating a setup: no setup row exists yet, so the browser
  // sends the Nuvio session it just signed in with (x-nuvio-access-token, the
  // same header the community proxy uses). Read only: the profile's settings
  // as SettingId values. The token is used for these reads and never stored.
  router.post('/nuvio/preview-settings', rateLimited(10), async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = String(req.get('x-nuvio-access-token') || '').trim();
    const profile = Number(asRecord(req.body)['profile']);
    if (!token || token.length > 4096) { sendError(res, 401, 'nuvio-session-expired', 'Sign in to Nuvio again.'); return; }
    if (!Number.isInteger(profile) || profile < 1 || profile > clientModule.MAX_PROFILES) { sendError(res, 400, 'invalid', 'Invalid profile'); return; }
    try {
      const client = clientModule.createNuvioClient({ uuid: 'preview', connection: { nuvioToken: token } as PushConnection, http: deps.http });
      const [tv, mobile, home] = await Promise.all([
        client.pullSettings(profile, 'tv'),
        client.pullSettings(profile, 'mobile'),
        client.pullHome(profile),
      ]);
      res.json({ settings: serviceModule.settingsFrom(tv.blob, mobile.blob, home.doc) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.use(basePath, router);
}

module.exports = { mountSetupNuvioRoutes, fetchManifestName } satisfies SetupNuvioRoutesApi;
