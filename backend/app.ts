const express = require('express');

const { resolveConfig } = require('./src/config/resolve-config.ts');
const addonRoutes = require('./src/routes/addon.ts');
const { mountSetupRoutes } = require('./src/routes/setup.ts');
const { mountSetupConnectionRoutes } = require('./src/routes/setup-connections.ts');
const { mountSetupLibraryRoutes } = require('./src/routes/setup-library.ts');
const { mountSetupNuvioRoutes } = require('./src/routes/setup-nuvio.ts');
const { createEditSessionStore } = require('./src/setup/edit-sessions.ts');
const { mountCoreRoutes, mountAddonRoutes } = addonRoutes;

const { cors } = require('./src/middleware/cors.ts');
const { requestLogger } = require('./src/middleware/request-logger.ts');
const { securityHeaders } = require('./src/middleware/security-headers.ts');
const { errorHandler } = require('./src/middleware/error-handler.ts');
const fs      = require('fs');
const path    = require('path');

const { version: APP_VERSION } = require('../package.json');

let createWebRoutes = null;
try {
  const websiteDir = path.join(__dirname, '..', 'website');
  const webEntry = fs.existsSync(path.join(websiteDir, 'index.js'))
    ? path.join(websiteDir, 'index.js')
    : fs.existsSync(path.join(websiteDir, 'index.example.js'))
      ? path.join(websiteDir, 'index.example.js')
      : null;
  // The public web router is tracked in backend/src/routes. Use it directly
  // when a deployment has no thin website shim (for example, a fresh dev
  // checkout or self-host build) so the React setup routes still mount.
  createWebRoutes = webEntry
    ? require(webEntry)
    : require('./src/routes/website.ts');
} catch (err: any) {
  console.warn(`[website] Web routes unavailable (${err.message}): addon routes only`);
}

// The private addon identity (gitignored backend/src/registry.ts) is read by
// the route modules that need it (manifest, catalog, collections), each with
// a self-hosted fallback.

const http  = require('http');
const https = require('https');

// Reuse TCP/TLS connections to provider APIs (TorBox, Real-Debrid, TMDB).
// axios opens a brand-new connection per request by default and each TLS
// handshake can cost 100ms–1s depending on the provider: keep-alive makes the
// repeated calls (key verify, catalog/meta/stream builds, TMDB proxy) faster.
http.globalAgent.keepAlive  = true;
https.globalAgent.keepAlive = true;

const app = express();
app.disable('x-powered-by');

// Compress text responses (JSON/HTML/CSS/JS) at the app level. Hosted
// deployments sit behind a Brotli proxy, but self-hosted setups expose Node
// directly, so this keeps large catalog/configure payloads and text assets
// small on the wire. The default filter skips images and already-encoded
// responses, and compression patches ETag handling for the compressed body.
// Express 5 parses query strings with the "simple" parser by default; keep the
// Express 4 behaviour (qs, nested keys) so existing links and clients parse the same.
app.set('query parser', 'extended');
app.use(require('compression')({ threshold: 1024 }));

// No async wrapper: Express 5 (router 2) forwards a rejected promise from any
// handler or middleware to next(err), so async route errors reach the terminal
// errorHandler below (test/express-async-errors.test.ts pins this).

app.use(cors);
app.use(requestLogger);
app.use(require('./src/middleware/perf-timing.ts').perfMiddleware);
app.use(securityHeaders);

app.set('trust proxy', 1);

// ── Website routes (landing, configure, library, discover, proxies) ──
mountCoreRoutes(app, { resolveConfig, version: APP_VERSION });

// Hosted-only Releases API. Mounted before the website router so the shared
// router's trailing 404 catch-all cannot swallow /api/releases. The router
// self-gates: with no shared TMDB key every route returns 404.
require('./src/routes/releases.ts').mountReleasesRoutes(app);

if (createWebRoutes) app.use(createWebRoutes(resolveConfig));

mountAddonRoutes(app, { resolveConfig });

// v5.5 setup surface (create / unlock / save / rotate). Registered with the
// other API routers so the SPA shell, mounted below, never claims it.
// One edit-session store for every setup route: bearer tokens issued at
// unlock must verify on the connection/push routes too.
const setupEditSessions = createEditSessionStore();
mountSetupRoutes(app, { editSessions: setupEditSessions });
mountSetupConnectionRoutes(app, { editSessions: setupEditSessions });
mountSetupNuvioRoutes(app, { editSessions: setupEditSessions });
mountSetupLibraryRoutes(app, { editSessions: setupEditSessions });

// ── v5.5 React frontend (served at /) ──
// The bundle lives at the root now; /app/* deep links from the migration
// window redirect to their root equivalents. Hashed assets stay immutable;
// page shells must never be cached so a deploy is picked up immediately.
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
const FRONTEND_SPA = process.env.FRONTEND_SPA !== 'off'
  && fs.existsSync(path.join(FRONTEND_DIST, 'index.html'));
if (FRONTEND_SPA) {
  app.use('/app', express.static(FRONTEND_DIST, { index: false, redirect: false, maxAge: '30d', immutable: true }));
  app.get('/app', (req: any, res: any) => res.redirect(302, '/configure'));
  app.get('/app/landing', (req: any, res: any) => res.redirect(302, '/'));
  app.get('/app/privacy', (req: any, res: any) => res.redirect(302, '/privacy'));
  app.get('/app/status', (req: any, res: any) => res.redirect(302, '/status'));
  app.get('/app/quick', (req: any, res: any) => res.redirect(302, '/configure/quick'));
  app.get('/app/partial', (req: any, res: any) => res.redirect(302, '/configure/partial'));
  app.get('/app/full', (req: any, res: any) => res.redirect(302, '/configure/full'));
  app.get(/^\/app\/([^\/]+)$/, (req: any, res: any) => res.redirect(302, '/' + req.params[0]));
  app.get(/^\/app(?:\/.*)?$/, (req: any, res: any) => res.redirect(302, '/configure'));
}

app.use(errorHandler);

module.exports = app;
// Exported for tests: the manifest Home-visibility rules (wizard-managed vs
// legacy/self-host installs) are verified in test/manifest-home.test.js.
module.exports.getConfiguredManifest = addonRoutes.getConfiguredManifest;
module.exports.resolveIntegration = addonRoutes.resolveIntegration;
module.exports.posterFp = addonRoutes.posterFp;

export interface AppComposition {
  version: string;
}
