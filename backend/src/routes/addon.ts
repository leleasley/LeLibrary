// Addon router composition: mounts the Stremio-compatible surfaces (settings,
// images, manifest, collections, catalog, meta, stream, integration) in order.
// The handlers live in their own route modules; this file only wires them.
// Keep-alive for provider APIs is set once in app.ts (the composition root).
const { mountImageRoutes } = require('./images.ts');
const manifestRoutes = require('./manifest.ts');
const { mountCollectionsRoutes } = require('./collections.ts');
const { mountCatalogRoutes } = require('./catalog.ts');
const { mountMetaRoutes } = require('./meta.ts');
const { mountStreamRoutes } = require('./stream.ts');
const { mountIntegrationRoutes } = require('./integration.ts');
const { mountCoreRoutes } = require('./core.ts');
const { mountSettingsRoutes } = require('./settings.ts');
const { posterFp } = require('./shared.ts');
const { mountManifestRoutes } = manifestRoutes;
const cache   = require('../runtime/cache.ts');
const providers = require('../providers/index.ts');

function mountAddonRoutes(app: any, deps: any): void {
  const { resolveConfig } = deps;
  mountSettingsRoutes(app, { resolveConfig });

  // ── Addon core routes ───────────────────────────────────────────────

  mountImageRoutes(app, { resolveConfig });

  mountManifestRoutes(app, { resolveConfig });

  app.post('/cache/clear', async (req: any, res: any) => {
    // Admin-only: requires CACHE_CLEAR_SECRET to be set. Disabled otherwise,
    // so no anonymous visitor can wipe the whole cache (a DoS primitive).
    const secret = process.env.CACHE_CLEAR_SECRET;
    if (!secret) return res.status(403).json({ success: false, error: 'Global cache clear is disabled. Set CACHE_CLEAR_SECRET to enable.' });
    if (req.headers['x-cache-secret'] !== secret) return res.status(403).json({ success: false, error: 'Invalid cache secret' });
    try {
      const deleted = await cache.delPattern('*');
      res.json({ success: true, deleted, message: 'Cache cleared successfully' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/:token/cache/clear', async (req: any, res: any) => {
    const config = await resolveConfig(req.params.token);
    if (!config) return res.status(400).json({ error: 'Invalid token' });

    try {
      const userKey = providers.getUserKey(config);
      if (!userKey) return res.status(400).json({ error: 'No key configured' });
  
      const pattern = `*${userKey}*`;
      const deleted = await cache.delPattern(pattern);
      require('../media/tmdb.ts').clearCaches();
      res.json({ success: true, deleted, message: 'User cache cleared' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  mountCollectionsRoutes(app, { resolveConfig });

  mountCatalogRoutes(app, { resolveConfig });

  mountMetaRoutes(app, { resolveConfig });

  mountStreamRoutes(app, { resolveConfig });

  mountIntegrationRoutes(app, { resolveConfig });

  // Re-exported by app.ts: tests import these from the app module.
  Object.assign(module.exports, { getConfiguredManifest: manifestRoutes.getConfiguredManifest, resolveIntegration: manifestRoutes.resolveIntegration, posterFp });
}

export interface AddonApi {
  mountCoreRoutes: (app: any, deps: any) => void;
  mountAddonRoutes: (app: any, deps: any) => void;
}
module.exports = { mountCoreRoutes, mountAddonRoutes } satisfies AddonApi;
