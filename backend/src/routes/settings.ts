// Settings surface: the server-side stream-settings store and the catalogue
// metadata endpoints the Configure pickers read. These five routes are
// registered here and nowhere else (the website router used to carry its own
// drifting copies of four of them).
//
// Mounted by mountAddonRoutes, after the website router. That router lets
// every /api/* path fall through its 404, so these are reached either way,
// and they still work on an instance whose website router failed to load.
import type { Express, RequestHandler } from 'express';

const express = require('express');
const { decodeConfig } = require('../config/token.ts') as { decodeConfig: (token: unknown) => Record<string, unknown> | null };
const providers = require('../providers/index.ts') as { getUserKey: (config: any) => string };
const { validateCustomStreamsConfig } = require('../media/custom-streams.ts') as {
  validateCustomStreamsConfig: (config: any) => any;
};
const { rateLimit } = require('../middleware/rate-limit.ts') as {
  rateLimit: (options?: { windowMs?: number; max?: number }) => RequestHandler;
};

export interface SettingsConfigStore {
  saveStreamSettings: (config: any) => Promise<string | null>;
  loadStreamSettings: (config: any) => Promise<unknown>;
}

export interface SettingsDeps {
  resolveConfig: (token: string) => Promise<Record<string, any> | null>;
  // Test seams. Production uses runtime/configstore.ts and
  // catalog/collection-cache-warm.ts.
  configStore?: SettingsConfigStore;
  warmLibraryCatalogs?: (config: any) => Promise<unknown>;
}

export interface SettingsApi {
  mountSettingsRoutes: (app: Express, deps: SettingsDeps) => void;
  clientConfig: (value: unknown) => Record<string, unknown> | null;
  SETTINGS_ROUTES: ReadonlyArray<readonly [string, string]>;
}

// Every route this module owns, as [method, path]. Tests assert each one is
// registered exactly once across the whole app.
const SETTINGS_ROUTES = [
  ['post', '/api/save-config'],
  ['get', '/api/config/:token'],
  ['get', '/api/catalog-library'],
  ['get', '/api/catalog-quick-picks'],
  ['get', '/api/curated-collections'],
] as const;

// A browser-sent config is plain JSON, so it can carry an own
// `__configScope` (or any other `__` internal) that the resolver normally
// sets as a hidden property. saveStreamSettings keys the store on that
// scope: a spoofed `{ type: 'config', uuid }` would write into another
// setup's stream settings, which the addon then merges over its own. Drop
// every `__` key so a browser save can only ever land in its own legacy
// key-hash scope.
function clientConfig(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith('__')) continue;
    out[key] = v;
  }
  return out;
}

function mountSettingsRoutes(app: Express, deps: SettingsDeps): void {
  const { resolveConfig } = deps;
  const configStore = (): SettingsConfigStore => deps.configStore || require('../runtime/configstore.ts');
  const warmLibraryCatalogs = (config: any): Promise<unknown> => deps.warmLibraryCatalogs
    ? deps.warmLibraryCatalogs(config)
    : require('../catalog/collection-cache-warm.ts').warmConfiguredLibraryCatalogs(config);

  // ── Server-side stream settings store ──
  // Legacy (self-contained token) Configure saves keep the heavy stream
  // settings here, keyed by the user's provider-key hash; the addon merges
  // them back on every stream/meta request. v5.5 setups are edited through
  // /api/setup and never written here.
  // Save payloads carry the full form state and can exceed body-parser's
  // 100kb default. The website router already parses with the same limit;
  // this parser is a no-op then and covers an instance without that router.
  app.post('/api/save-config', express.json({ limit: '2mb' }), rateLimit({ windowMs: 60000, max: 30 }), async (req: any, res: any) => {
    // Failure logging only: status + reason + body size, never body content
    // (it carries API keys) and never the token value.
    const bodyBytes = Number(req.headers['content-length'] || 0) || '?';
    const saveFail = (status: unknown, reason: unknown) => console.error(`[Web] POST /api/save-config → ${status}: ${reason} (body ${bodyBytes}B)`);
    try {
      let config: any = clientConfig(req.body && req.body.config);
      if (!config) { saveFail(400, 'Missing config'); return res.status(400).json({ error: 'Missing config' }); }
      config = validateCustomStreamsConfig(config);
      if (config.posterProvider === 'custom') {
        const checked = require('../media/poster-template.ts').validate(config.customPosterTemplate);
        if (!checked.ok) { saveFail(400, checked.error); return res.status(400).json({ error: checked.error }); }
        config.customPosterTemplate = checked.value;
      }
      // A legacy base64 token carries its config itself: nothing to check.
      // Any other token is either unknown or a v5.5 install token, which is a
      // read capability only: editing goes through /{uuid} with the password.
      // Neither may write here.
      const tokenId = req.body && req.body.token;
      if (typeof tokenId === 'string' && tokenId && !decodeConfig(tokenId)) {
        const known = tokenId.length <= 256 ? await resolveConfig(tokenId) : null;
        if (!known) { saveFail(403, 'unknown install token'); return res.status(403).json({ error: 'Unknown or expired install token' }); }
        saveFail(403, 'setup token on legacy save');
        return res.status(403).json({ error: 'This setup is edited from its own setup page.' });
      }
      // Turnstile bot gate (managed, invisible): saves must carry a fresh
      // `cf-turnstile-response` for action "save-config" once
      // TURNSTILE_SECRET + TURNSTILE_HOSTNAMES are set. Unconfigured
      // instances (self-hosters, pre-secret dev) proceed exactly as before.
      const turnstile = require('../platform/turnstile.ts');
      if (turnstile.turnstileConfigured()) {
        const verdict = await turnstile.verifyTurnstile(req.body && req.body['cf-turnstile-response'], {
          action: 'save-config',
          remoteip: req.ip,
        });
        if (!verdict.ok) { saveFail(403, `bot check: ${verdict.error || 'rejected'}`); return res.status(403).json({ error: 'Bot check failed. Reload the page and try again.' }); }
      }
      const userKey = await configStore().saveStreamSettings(config);
      // Providerless legacy installs carry their bounded mapping table inside
      // the self-contained install token. Validation above is still required,
      // but there is intentionally no server-side scope to persist here.
      if (!userKey && Array.isArray(config.customStreams) && config.customStreams.length > 0) {
        return res.json({ ok: true, selfContained: true });
      }
      if (!userKey) { saveFail(400, 'no usable API keys in config'); return res.status(400).json({ error: 'Config has no usable API keys' }); }
      // Warm the configured library catalogues on the same cache path the
      // catalogue route uses. `warmCollections: true` waits so new folders
      // are ready on first open; ordinary saves stay responsive.
      const waitForWarm = req.body?.warmCollections === true;
      const warm = warmLibraryCatalogs(config);
      const warmResult = waitForWarm
        ? await warm
        : (warm.catch((err: any) => console.warn('[Collection cache] Background warm failed:', err.message)), null);
      res.json({ ok: true, userKey, ...(warmResult ? { collectionCache: warmResult } : {}) });
    } catch (err: any) {
      const status = err.statusCode || 500;
      saveFail(status, err.message);
      res.status(status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    }
  });

  // Return the server-side stream settings for a token's user so the
  // configure form can pre-fill them even when the token itself is missing
  // them. Same scope rule as configstore.mergeStoredConfig: a config with no
  // provider key is only read when it has its own account/config scope.
  app.get('/api/config/:token', rateLimit({ windowMs: 60000, max: 60 }), async (req: any, res: any) => {
    try {
      const config = await resolveConfig(req.params.token);
      if (!config) return res.status(400).json({ error: 'Invalid token' });
      const userKey = providers.getUserKey(config);
      const stored = (userKey || ['account', 'config'].includes(config.__configScope?.type))
        ? await configStore().loadStreamSettings(config)
        : null;
      res.json(stored || null);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Catalogue metadata for the Configure pickers ──
  // The catalogue definitions (id, name, type, group, icon) so the picker
  // renders without shipping the whole table. No params (ids/keys) are
  // exposed: just display metadata. Static for the process lifetime, so it
  // is validated once and served as a cached JSON string.
  let catalogLibraryPayload: string | null = null;
  app.get('/api/catalog-library', (req: any, res: any) => {
    try {
      if (!catalogLibraryPayload) {
        const { listPickerSources, validateSourceDefinitions } = require('../catalog/catalog-source-registry.ts');
        const validation = validateSourceDefinitions();
        if (!validation.ok) return res.status(500).json({ error: 'Invalid catalogue source registry', details: validation.errors });
        catalogLibraryPayload = JSON.stringify({ catalogs: listPickerSources(), total: validation.total });
      }
      res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      res.type('application/json').send(catalogLibraryPayload);
    } catch {
      res.status(500).json({ error: 'Could not load catalogue library' });
    }
  });

  // Curated one-click packs for the Collections Wizard. The source ids within
  // each pack are validated by the server before being exposed to the UI.
  app.get('/api/catalog-quick-picks', (req: any, res: any) => {
    const { listQuickPicks, validateQuickPicks } = require('../catalog/catalog-quick-picks.ts');
    const validation = validateQuickPicks();
    if (!validation.ok) return res.status(500).json({ error: 'Invalid quick picks', details: validation.errors });
    res.json({ quickPicks: listQuickPicks(), total: validation.total });
  });

  // Shared Nuvio collection packs for the public Configure page. One cached
  // body per Hide anime choice and origin. no-cache + the ETag Express adds
  // means a browser always re-checks (an unchanged list is a 304), so a new
  // release's packs show at once instead of an hour-old copy.
  const curatedPayloads = new Map<string, string>();
  app.get('/api/curated-collections', (req: any, res: any) => {
    try {
      const hideAnime = req.query.hideAnime === 'true';
      const origin = String(process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
      const variant = `${hideAnime ? 'no-anime' : 'all'}|${origin}`;
      let curatedPayload = curatedPayloads.get(variant);
      if (!curatedPayload) {
        const curated = require('../catalog/curated-collections.ts');
        const validation = curated.validateCuratedCollections();
        if (!validation.ok) return res.status(500).json({ error: 'Invalid curated collections', details: validation.errors });
        curatedPayload = JSON.stringify({ ...curated.curatedCollectionsPayload({ compact: true, hideAnime, origin }), ...validation });
        // The origin comes from the Host header: bound the map so a stream
        // of made-up hosts cannot grow it without limit.
        if (curatedPayloads.size >= 32) curatedPayloads.clear();
        curatedPayloads.set(variant, curatedPayload);
      }
      res.set('Cache-Control', 'no-cache');
      res.type('application/json').send(curatedPayload);
    } catch {
      res.status(500).json({ error: 'Could not load curated collections' });
    }
  });
}

module.exports = { mountSettingsRoutes, clientConfig, SETTINGS_ROUTES } satisfies SettingsApi;
