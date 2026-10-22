const { rateLimit } = require('../middleware/rate-limit.ts');
const { mountImageRoutes, mountCoreImageRoutes } = require('./images.ts');
const manifestRoutes = require('./manifest.ts');
const { mountCollectionsRoutes } = require('./collections.ts');
const { mountCatalogRoutes, handleCatalog } = require('./catalog.ts');
const { mountMetaRoutes, handleMeta } = require('./meta.ts');
const { mountStreamRoutes, handleStream } = require('./stream.ts');
const { mountIntegrationRoutes } = require('./integration.ts');
const { mountCoreRoutes } = require('./core.ts');
const { mountSettingsRoutes } = require('./settings.ts');
const {
  withCacheHints, streamResponseTtl, setPrivateResponseCache,
  markClientIntegrationStage, finishClientIntegrationStages,
  clientIntegrationTimingHeader, clientIntegrationTimingLog, posterFp, posterEnhance,
  safeDecode, parseExtra,
} = require('./shared.ts');
const { mountManifestRoutes, handleConfiguredManifest, franchiseRowName } = manifestRoutes;
const express = require('express');
const { cors } = require('../middleware/cors.ts');
const { requestLogger } = require('../middleware/request-logger.ts');
const { securityHeaders } = require('../middleware/security-headers.ts');
const { applyAsyncWrap } = require('../middleware/async-wrap.ts');
const { errorHandler } = require('../middleware/error-handler.ts');
const {
  TTL_CATALOG, TTL_STREAM, OWNED_CATALOG_CLIENT_TTL,
  knownConfigs, KNOWN_CONFIGS_MAX, knownConfigFailures, catalogBuildInFlight,
  providerRefreshSnapshots, providerRefreshInFlight,
  rememberConfig, registerBackgroundRefresh, restoreAccountRefreshRegistry,
  refreshDownloadsForUser, hashDownloads, buildAndCacheForConfigInner, buildAndCacheForConfig,
} = require('../runtime/refresh.ts');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const cache   = require('../runtime/cache.ts');
const pictoriumWarm = require('../runtime/pictorium-warm.ts');
const providers = require('../providers/index.ts');
const { buildCatalog, buildMeta, buildStreams, populateTmdbIndexFromMetas, applyStreamNotices, libraryStreamFmtFp } = require('../catalog/builder.ts');
const { buildDiscoveryCatalog, buildDiscoveryMeta, buildDiscoveryStreams, discoveryStreamKeyParts } = require('../catalog/discovery.ts');
const { buildCollectionsCatalog, cacheCollections, getCollectionMeta, getCollections, getCollectionForMovie } = require('../catalog/franchise-collections.ts');
const { normaliseNuvioArtwork, absoluteLocalArtwork } = require('../catalog/collection-artwork.ts');
const { compileCollectionPlan } = require('../catalog/collection-plan.ts');
const { buildLibraryCollection, collectionCatalogMetas } = require('../catalog/nuvio-library-collections.ts');
const { searchCatalog } = require('../media/search.ts');
const { decodeConfig } = require('../config/token.ts');
const { validateCustomStreamsConfig, hasCustomStreams, hasMappedCustomStreams, customStreamsFingerprint, customStreamCatalogEntries } = require('../media/custom-streams.ts');
const { getClientIntegration, listClientIntegrations } = require('../client-integrations/index.ts');
const libraryEngine = require('../library/engine.ts');
const { version: APP_VERSION } = require('../../../package.json');

const ROOT_DIR = path.resolve(__dirname, '..');

// Private addon identity (gitignored). When absent: self-hosted builds: the
// addon serves a generic manifest so self-hosters never expose the official
// id or the signed Stremio registry config.
let REGISTRY = null;
try { REGISTRY = require('../registry.ts'); } catch (e) { /* self-hosted build */ }

const http  = require('http');
const https = require('https');

// Simple per-IP rate limiter for the config-store routes. (This is a tiny copy
// of the one in website/index.js so the addon core doesn't depend on the
// private website file to guard these endpoints.)
// Reuse TCP/TLS connections to provider APIs (TorBox, Real-Debrid, TMDB).
// axios opens a brand-new connection per request by default and each TLS
// handshake can cost 100ms–1s depending on the provider: keep-alive makes the
// repeated calls (key verify, catalog/meta/stream builds, TMDB proxy) faster.
http.globalAgent.keepAlive  = true;
https.globalAgent.keepAlive = true;

function mountAddonRoutes(app: any, deps: any): void {
  const { resolveConfig } = deps;
  // v5.5 removed the hosted account extension. Guarded paths that used it now
  // degrade to their self-hosted behaviour instead of a session-based one.
  const HOSTED = null;
  mountSettingsRoutes(app, { resolveConfig });

  // ── Addon core routes ───────────────────────────────────────────────

  // The configure page encodes tokens with SHORT field names (see
  // config/token-map.ts) to keep the install URL small. Decode maps them
  // back to the canonical names here so every downstream consumer reads full keys
  //: old tokens that still use full names pass through unchanged.


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
