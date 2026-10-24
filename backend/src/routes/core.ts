// Core instance routes: health, the stream-notice stub, the library engine
// status and manual sync, and the TMDB image proxy. All of these must be
// registered BEFORE the website router, whose trailing 404 would otherwise
// answer them first.
import type { Express } from 'express';

import type { RateLimitApi } from '../middleware/rate-limit.ts';
import type { ImageRoutesApi } from './images.ts';

const { rateLimit } = require('../middleware/rate-limit.ts') as RateLimitApi;
const { mountCoreImageRoutes } = require('./images.ts') as ImageRoutesApi;
const hosted = require('../platform/hosted.ts') as { releasesEnabled: () => boolean };
const selfhostAccess = require('../platform/selfhost-access.ts') as {
  listEnabled: () => boolean;
};
const providers = require('../providers/index.ts') as { getUserKey: (config: any) => string };
const libraryEngine = require('../library/engine.ts') as {
  status: () => unknown;
  isIndexed: () => boolean;
  scopeStatus: (scopeId: string) => Promise<unknown>;
  triggerSync: (token: string, config: unknown) => Promise<unknown>;
  retryFailed: (token: string, config: unknown, itemId?: string | null) => Promise<{ enabled: boolean; requeued: number }>;
  failedMatches: (scopeId: string, limit?: number) => Promise<Array<Record<string, unknown>>>;
};

export interface CoreDeps {
  resolveConfig: (token: string) => Promise<Record<string, any> | null>;
  version: string;
}

export interface CoreApi {
  mountCoreRoutes: (app: Express, deps: CoreDeps) => void;
}

function mountCoreRoutes(app: Express, deps: CoreDeps): void {
  const { resolveConfig, version } = deps;
  // Keep the container health endpoint ahead of the website router's final 404
  // handler. This endpoint is public and contains no user configuration.
  app.get('/health', async (req: any, res: any) => {
    // Keep Docker liveness independent of Redis statistics and upstream work.
    // A slow provider must never make the whole addon look dead.
    res.json({ status: 'ok', version });
  });

  // A deliberately empty URL used only to let Nuvio render informational stream
  // rows. It is not media and returns no content if someone selects the notice.
  app.get('/stream-notice', (req: any, res: any) => res.status(204).end());

  // Runtime feature flags for the React app. Hosted-only capabilities are
  // advertised here (never credentials, never keys) so the nav and route guards
  // can match the server exactly. Always mounted; false on self-hosted installs.
  app.get('/api/features', (req: any, res: any) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      releases: hosted.releasesEnabled(),
      savedSetups: selfhostAccess.listEnabled(),
      unavailableStreamAddons: require('../streams/streamAddons.ts').unavailableStreamAddons(),
      // Self-host only: the operator set WEBDAV_SOURCE=on.
      webdavSource: require('../providers/webdav.ts').webdavEnabled(),
    });
  });

  // ── Index-first library engine status / manual sync ───────────────────────
  // Aggregate, privacy-safe observability: counts and timings only, never keys,
  // titles, ids or URLs. `/api/library/status` is instance-wide; the token route
  // reports one scope's sync state.
  app.get('/api/library/status', rateLimit({ windowMs: 60000, max: 120 }), async (req: any, res: any) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await libraryEngine.status()); }
    catch (err: any) { res.status(503).json({ error: 'Library engine status unavailable' }); }
  });

  app.get('/:token/library/status', rateLimit({ windowMs: 60000, max: 120 }), async (req: any, res: any) => {
    if (!libraryEngine.isIndexed()) return res.json({ enabled: false });
    const config = await resolveConfig(req.params.token);
    if (!config) return res.status(400).json({ error: 'Invalid token' });
    const scopeId = providers.getUserKey(config);
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json({ enabled: true, scope: scopeId, status: await libraryEngine.scopeStatus(scopeId) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Failed rows remain visible after exhausting automatic retries. This view
  // exposes only internal row keys, attempt counts, and sanitized reason codes.
  app.get('/:token/library/failed', rateLimit({ windowMs: 60000, max: 60 }), async (req: any, res: any) => {
    if (!libraryEngine.isIndexed()) return res.status(409).json({ error: 'Indexed engine disabled' });
    const config = await resolveConfig(req.params.token);
    if (!config) return res.status(400).json({ error: 'Invalid token' });
    try {
      const scopeId = providers.getUserKey(config);
      const limit = Math.max(1, Math.min(500, Number.parseInt(req.query.limit, 10) || 500));
      const rows = await libraryEngine.failedMatches(scopeId, limit);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ count: rows.length, rows });
    } catch {
      res.status(500).json({ error: 'Failed matches unavailable' });
    }
  });

  // POST {"itemId":"123"} to requeue one row from the scoped failed list,
  // or {"all":true} to requeue every failed/terminal row in the scope.
  app.post('/:token/library/retry', rateLimit({ windowMs: 60000, max: 5 }), async (req: any, res: any) => {
    if (!libraryEngine.isIndexed()) return res.status(409).json({ error: 'Indexed engine disabled' });
    const config = await resolveConfig(req.params.token);
    if (!config) return res.status(400).json({ error: 'Invalid token' });
    const itemId = req.body?.itemId;
    const all = req.body?.all === true;
    const validItemId = typeof itemId === 'string' && /^[1-9]\d{0,19}$/.test(itemId);
    if ((all && itemId != null) || (!all && !validItemId)) {
      return res.status(400).json({ error: 'Specify itemId as a decimal string or set all to true' });
    }
    try {
      const result = await libraryEngine.retryFailed(req.params.token, config, all ? null : itemId);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true, requeued: result.requeued, scopeEnabled: result.enabled });
    } catch {
      res.status(500).json({ error: 'Failed matches could not be requeued' });
    }
  });

  app.post('/:token/library/sync', rateLimit({ windowMs: 60000, max: 10 }), async (req: any, res: any) => {
    if (!libraryEngine.isIndexed()) return res.status(409).json({ error: 'Indexed engine disabled' });
    const config = await resolveConfig(req.params.token);
    if (!config) return res.status(400).json({ error: 'Invalid token' });
    try {
      const status = await libraryEngine.triggerSync(req.params.token, config);
      res.json({ ok: true, status });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });


  // Proxy TMDB images to avoid CORS blocking (must be BEFORE web routes so the
  // router's 404 catch-all does not intercept image requests)
  mountCoreImageRoutes(app);
}

module.exports = { mountCoreRoutes } satisfies CoreApi;
