import type { NextFunction, Request, Response, Router } from 'express';
import type { SelfhostAccessApi } from '../platform/selfhost-access.ts';

const path = require('path');
const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const { decodeConfig } = require('../config/token.ts');
const { validateCustomStreamsConfig } = require('../media/custom-streams.ts');
const { MAX_UPSTREAM_BYTES: NUVIO_COMMUNITY_MAX_BYTES, listParams: nuvioCommunityListParams, failurePayload: nuvioCommunityFailurePayload, compactListPayload: compactNuvioCommunityList } = require('../catalog/nuvio-community.ts');

const WEBSITE_DIR = path.resolve(__dirname, '..', '..', '..', 'website');
const PUBLIC_DIR = path.join(WEBSITE_DIR, 'public');
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
// v5.5 removed the private account area entirely. These constants stay so the
// remaining guards keep behaving exactly like a self-hosted install: the old
// /account* routes redirect, and nothing here reads the deleted files.

// Simple in-memory rate limiter (per IP, website only: addon untouched)
const rateLimitBuckets = new Map();
function rateLimit({ windowMs = 60000, max = 30 } = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    // Per IP *and* per route: one shared bucket let a busy endpoint (or a
    // retrying user) starve every other website route on the same IP.
    const route = req.route as { path?: string | string[] } | undefined;
    const pattern = Array.isArray(route?.path) ? route.path.join(',') : (route?.path || req.path);
    const key = `${ip} ${req.method} ${pattern}`;
    let bucket = rateLimitBuckets.get(key);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      rateLimitBuckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > max) {
      const wantsJson = (req.headers.accept || '').includes('application/json') || req.path.startsWith('/api/');
      if (wantsJson) return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
      return serveErrorPage(res, req, 429, 'Too Many Requests', ERROR_DESCRIPTIONS[429]);
    }
    next();
  };
}
// Cleanup stale buckets every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [ip, b] of rateLimitBuckets) { if (b.start < cutoff) rateLimitBuckets.delete(ip); }
}, 300000).unref?.();

// ── Error page helper ────────────────────────────────────
// Serves the shared error.html with injected code/title/description.
// API requests (Accept: application/json or /api/ prefix) get JSON instead.
const ERROR_PAGE = path.join(WEBSITE_DIR, 'error.html');
const ERROR_PAGE_HTML = fs.existsSync(ERROR_PAGE) ? fs.readFileSync(ERROR_PAGE, 'utf8') : null;
// v5.5 error surface: the React ErrorPage, served with the error data injected.
// Falls back to the legacy error.html until the frontend is built.
const FRONTEND_SHELL = path.join(ROOT_DIR, 'frontend', 'dist', 'index.html');
const FRONTEND_SHELL_HTML = fs.existsSync(FRONTEND_SHELL) ? fs.readFileSync(FRONTEND_SHELL, 'utf8') : null;

// v5.5 page shell: the React app owns /, /privacy, /status and /configure.
// Serves the built shell (never cached); returns false when there is no build
// so the caller falls back to the frozen legacy page.
function serveShell(res: any): boolean {
  if (!FRONTEND_SHELL_HTML) return false;
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(bootHtml.injectBoot(FRONTEND_SHELL_HTML, bootData()));
  return true;
}

// Boot data shipped inside every page (platform/boot-html.ts): the feature
// flags and the latest provider status, so the menu and the status pill are
// right on the first paint instead of popping in after a fetch.
const bootHtml = require('../platform/boot-html.ts');
let latestStatus: { at: number; data: unknown } | null = null;
const BOOT_STATUS_MAX_AGE = 10 * 60 * 1000;
function bootData(): { features: { releases: boolean; savedSetups: boolean }; status?: unknown } {
  let releases = false;
  let savedSetups = false;
  try { releases = require('../platform/hosted.ts').releasesEnabled() === true; } catch { /* self-host */ }
  try { savedSetups = require('../platform/selfhost-access.ts').listEnabled() === true; } catch { /* no secret */ }
  const fresh = latestStatus && Date.now() - latestStatus.at < BOOT_STATUS_MAX_AGE ? latestStatus.data : null;
  return { features: { releases, savedSetups }, ...(fresh ? { status: fresh } : {}) };
}

// The public homepage is pre-rendered at build time for search engines and
// clients that do not execute JavaScript. Other React routes keep the SPA shell.
let homeCache: { mtimeMs: number; html: string } | null = null;
function serveHome(res: any): boolean {
  const page = path.join(ROOT_DIR, 'frontend', 'dist', 'home.html');
  let stat;
  try { stat = fs.statSync(page); } catch { return false; }
  if (!homeCache || homeCache.mtimeMs !== stat.mtimeMs) homeCache = { mtimeMs: stat.mtimeMs, html: fs.readFileSync(page, 'utf8') };
  const boot = bootData();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.type('html').send(bootHtml.injectBoot(bootHtml.patchHome(homeCache.html, boot.status), boot));
  return true;
}

const ERROR_DESCRIPTIONS = {
  403: 'You don\'t have permission to access this page.',
  404: 'The page you\'re looking for doesn\'t exist or has been moved.',
  429: 'You\'re doing that too much. Please wait a moment and try again.',
  500: 'Something went wrong on our end. Please try again later.',
  502: 'The server received an invalid response. Please try again.',
  503: 'The service is temporarily unavailable. Please try again later.',
};

// JSON.stringify for inline <script> contexts: also escape <, > and the
// U+2028/U+2029 line separators so a value containing "</script>" cannot
// break out of the script element during HTML parsing.
function scriptSafeJson(value: any) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function serveErrorPage(res: any, req: any, code: any, title: any, desc: any) {
  const reqPath = req.originalUrl || req.path || '/';
  const wantsJson = (req.headers.accept || '').includes('application/json')
    || reqPath.startsWith('/api/')
    || reqPath.startsWith('/:token');
  if (wantsJson) {
    return res.status(code).json({ error: desc || title });
  }
  if (!ERROR_PAGE_HTML && !FRONTEND_SHELL_HTML) {
    return res.status(code).send(code + ' ' + title);
  }
  if (FRONTEND_SHELL_HTML) {
    const html = FRONTEND_SHELL_HTML
      .replace('</head>', `<script>window.__ERROR_PAGE__={code:${code},title:${scriptSafeJson(title)},desc:${scriptSafeJson(desc || '')},path:${scriptSafeJson(reqPath)}};</script></head>`);
    return res.status(code).send(html);
  }
  const html = (ERROR_PAGE_HTML as string)
    .replace('</head>', `<script>window.__ERROR_CODE__=${code};window.__ERROR_TITLE__=${scriptSafeJson(title)};window.__ERROR_DESC__=${scriptSafeJson(desc || '')};window.__ERROR_PATH__=${scriptSafeJson(reqPath)};</script></head>`);
  res.status(code).send(html);
}

// All functional website routes (pages, proxies, verify, status, scrapers,
// clear-cache). Shared by the private website/index.js (serves the private
// landing page) and the public website/index.example.js (redirects / to the
// configure page) so self-hosters get the same API surface.
function createWebRoutes(resolveConfig: any, options: any = {}): Router {
  const router: Router = express.Router();
  const hosted = options.hosted || null;
  // Gate + derived cookie live in one module so the v5.5 setup list and the
  // legacy saved-configs routes cannot drift apart.
  const selfhostAccess = require('../platform/selfhost-access.ts') as SelfhostAccessApi;
  const SELFHOST_COOKIE = selfhostAccess.COOKIE_NAME;
  function setSelfhostAccessCookie(req: any, res: any) {
    if (!selfhostAccess.configured()) return;
    const secure = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SELFHOST_COOKIE}=${selfhostAccess.cookieValue()}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict${secure}`);
  }
  // Save payloads carry the full form state (pasted collections.json in
  // importedRows, overrides, custom streams) and can exceed body-parser's
  // 100kb default: an over-limit save used to surface as a misleading
  // generic 500. 2mb matches the /api/preview route in app.ts.
  router.use(express.json({ limit: '2mb' }));
  router.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Nuvio imports these once per profile. Image URLs must be absolute HTTPS
  // URLs because Nuvio fetches them from another device, not this browser.
  function publicBaseUrl(req: any) {
    const host = String(req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
    return `https://${host}`;
  }
  router.get('/api/nuvio-badges/lelibrary-premium.json', (req, res) => {
    const badges = require('../catalog/nuvio-badges.ts');
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.json(badges.manifest(publicBaseUrl(req)));
  });
  router.get('/api/nuvio-badges/lelibrary-premium/:id.svg', (req, res) => {
    const svg = require('../catalog/nuvio-badges.ts').badgeSvg(req.params.id);
    if (!svg) return res.status(404).type('text/plain').send('Unknown badge');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('image/svg+xml').send(svg);
  });
  // PNG twin of the SVG above. Nuvio's badge image loader ships no SVG
  // decoder, so SVG badges decode to empty black chips there — the manifest
  // advertises these PNGs instead. Rendered once from the SVG source and
  // held in memory (37 small pills).
  const badgePngCache = new Map();
  router.get('/api/nuvio-badges/lelibrary-premium/:id.png', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!/^[\w-]+$/.test(id)) return res.status(404).type('text/plain').send('Unknown badge');
      let png = badgePngCache.get(id);
      if (!png) {
        const svg = require('../catalog/nuvio-badges.ts').badgeSvg(id);
        if (!svg) return res.status(404).type('text/plain').send('Unknown badge');
        png = await require('sharp')(Buffer.from(svg)).png().toBuffer();
        if (badgePngCache.size > 100) badgePngCache.clear();
        badgePngCache.set(id, png);
      }
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.type('image/png').send(png);
    } catch (err) {
      const detail = err as any;
      res.status(500).type('text/plain').send('Badge render failed');
    }
  });

  // Import helper for the Configure page. The browser cannot reliably fetch
  // third-party manifests because most addon hosts do not enable CORS. Keep
  // this JSON-only, size-limited and rate-limited; credentials in a URL are
  // never logged or echoed.
  //
  // SSRF hardening (mirrors the accounts router's import helper): the URL must
  // resolve to a PUBLIC address: loopback, RFC1918, link-local, CGNAT and the
  // metadata range are all rejected: and DNS is pinned into axios' lookup so
  // a DNS-rebinding swap between check and fetch cannot slip through. Redirects
  // are not followed (a public URL must not bounce to an internal one).
  const dns = require('node:dns').promises;
  const net = require('node:net');
  function isPublicIpAddress(address: any) {
    const family = net.isIP(address);
    if (family === 4) {
      const [a, b] = address.split('.').map(Number);
      return !(a === 0 || a === 10 || a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224);
    }
    if (family === 6) {
      const ip = address.toLowerCase();
      if (ip === '::' || ip === '::1' || ip.startsWith('::ffff:')) return false;
      const first = parseInt(ip.split(':')[0] || '0', 16);
      return !((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00);
    }
    return false;
  }
  async function pinPublicLookup(target: any) {
    const hostname = target.hostname.replace(/^\[|\]$/g, '');
    const records = net.isIP(hostname)
      ? [{ address: hostname, family: net.isIP(hostname) }]
      : await dns.lookup(hostname, { all: true, verbatim: true });
    if (!records.length || records.some(({ address }: any) => !isPublicIpAddress(address))) {
      throw new Error('That URL resolves to a private or non-public network.');
    }
    const { address, family } = records[0];
    return (_hostname: any, _options: any, callback: any) => callback(null, address, family);
  }

  router.get('/api/import-json', rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
    const sourceUrl = String(req.query.url || '').trim();
    let parsed;
    try { parsed = new URL(sourceUrl); } catch { return res.status(400).json({ error: 'Enter a valid manifest or JSON URL.' }); }
    if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ error: 'Only HTTP and HTTPS URLs are supported.' });
    try {
      const lookup = await pinPublicLookup(parsed);
      const axios = require('axios');
      const response = await axios.get(sourceUrl, {
        timeout: 15000,
        responseType: 'json',
        maxContentLength: 5 * 1024 * 1024,
        maxBodyLength: 5 * 1024 * 1024,
        maxRedirects: 0,
        lookup,
        validateStatus: (status: any) => status >= 200 && status < 300,
      });
      if (!response.data || typeof response.data !== 'object') throw new Error('The URL did not return a JSON object.');
      res.json(response.data);
    } catch (err) {
      const detail = err as any;
      res.status(detail.message && detail.message.includes('private') ? 400 : 502)
        .json({ error: `Could not fetch that JSON: ${detail.response?.status || detail.message}` });
    }
  });

  // Nuvio's public community catalogue is authenticated and does not expose
  // CORS to third-party sites. This deliberately narrow proxy accepts only a
  // caller's current Nuvio session, forwards only read-only community list or
  // detail requests, and never logs, stores or returns that session token.
  function nuvioCommunityToken(req: any) {
    const token = String(req.get('x-nuvio-access-token') || '').trim();
    return token.length >= 20 && token.length <= 8192 && !/[\r\n]/.test(token) ? token : '';
  }
  function nuvioCommunityError(res: any, err: any) {
    const status = Number(err.response?.status || 0);
    if (status === 429) {
      const retryAfter = String(err.response?.headers?.['retry-after'] || '60').replace(/[^0-9]/g, '') || '60';
      res.setHeader('Retry-After', retryAfter);
    }
    const failure = nuvioCommunityFailurePayload({ status, code: err.code || err.cause?.code });
    return res.status(failure.status).json({ error: failure.error, code: failure.code });
  }
  function nuvioCommunityHeaders(token: string) {
    return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  }
  router.get('/api/nuvio-community/collections', rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
    const token = nuvioCommunityToken(req);
    if (!token) return res.status(401).json({ error: 'Connect Nuvio before browsing public collections.' });
    try {
      const axios = require('axios');
      const response = await axios.get('https://nuvio.tv/api/community-collections', {
        headers: nuvioCommunityHeaders(token),
        params: nuvioCommunityListParams(req.query),
        timeout: 20000,
        maxContentLength: NUVIO_COMMUNITY_MAX_BYTES,
        validateStatus: (status: number) => status >= 200 && status < 300,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json(compactNuvioCommunityList(response.data));
    } catch (err) {
      const detail = err as any;
      nuvioCommunityError(res, err);
    }
  });
  router.get('/api/nuvio-community/collections/:id', rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
    const token = nuvioCommunityToken(req);
    const id = String(req.params.id || '').trim();
    if (!token) return res.status(401).json({ error: 'Connect Nuvio before browsing public collections.' });
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/i.test(id)) return res.status(400).json({ error: 'Invalid Nuvio collection ID.' });
    try {
      const axios = require('axios');
      const response = await axios.get(`https://nuvio.tv/api/community-collections/${encodeURIComponent(id)}`, {
        headers: nuvioCommunityHeaders(token),
        timeout: 20000,
        maxContentLength: NUVIO_COMMUNITY_MAX_BYTES,
        validateStatus: (status: number) => status >= 200 && status < 300,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json(response.data);
    } catch (err) {
      const detail = err as any;
      nuvioCommunityError(res, err);
    }
  });

  // Curated Nuvio packs are consumed by the public Configure page, so this
  // route must live in the shared website router. Routes declared later in
  // app.ts are unreachable after this router's 404 fallback runs.
  // Both reference payloads are static for the process lifetime: build and
  // validate them once, then serve the cached JSON string so a cold process
  // does not re-run asset validation on every request.
  let curatedPayload: string | null = null;
  router.get('/api/curated-collections', (req, res) => {
    try {
      if (!curatedPayload) {
        const curated = require('../catalog/curated-collections.ts');
        const validation = curated.validateCuratedCollections();
        if (!validation.ok) return res.status(500).json({ error: 'Invalid curated collections', details: validation.errors });
        curatedPayload = JSON.stringify({ collections: curated.listCuratedCollections(), ...validation });
      }
      res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      res.type('application/json').send(curatedPayload);
    } catch (err) {
      const detail = err as any;
      res.status(500).json({ error: 'Could not load curated collections' });
    }
  });

  // Catalogue library metadata is also consumed by the public Configure page.
  // Keep it in this router so it runs before the website 404 fallback.
  let catalogLibraryPayload: string | null = null;
  router.get('/api/catalog-library', (req, res) => {
    try {
      if (!catalogLibraryPayload) {
        const { listSources, validateSourceDefinitions } = require('../catalog/catalog-source-registry.ts');
        const validation = validateSourceDefinitions();
        if (!validation.ok) return res.status(500).json({ error: 'Invalid catalogue source registry', details: validation.errors });
        catalogLibraryPayload = JSON.stringify({ catalogs: listSources(), total: validation.total });
      }
      res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      res.type('application/json').send(catalogLibraryPayload);
    } catch (err) {
      const detail = err as any;
      res.status(500).json({ error: 'Could not load catalogue library' });
    }
  });

  // Config-store routes must also live here: app.ts mounts this router before
  // its addon routes, and the router has a 404 fallback at the end.
  router.post('/api/save-config', rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
    // Failure logging only: status + reason + body size, never body content
    // (it carries API keys) and never the token value.
    const bodyBytes = Number(req.headers['content-length'] || 0) || '?';
    const saveFail = (status: any, reason: any) => console.error(`[Web] POST /api/save-config → ${status}: ${reason} (body ${bodyBytes}B)`);
    try {
      let config = req.body && req.body.config;
      if (!config || typeof config !== 'object') { saveFail(400, 'Missing config'); return res.status(400).json({ error: 'Missing config' }); }
      config = validateCustomStreamsConfig(config);
      if (config.posterProvider === 'custom') {
        const checked = require('../media/poster-template.ts').validate(config.customPosterTemplate);
        if (!checked.ok) { saveFail(400, checked.error); return res.status(400).json({ error: checked.error }); }
        config.customPosterTemplate = checked.value;
      }
      const providers = require('../providers/index.ts');
      const tokenId = req.body && req.body.token;
      let configForStore = config;
      let ownershipVerified = false;
      if (typeof tokenId === 'string' && tokenId && tokenId.length <= 64 && !decodeConfig(tokenId) && hosted?.saveTokenConfig) {
        if (!(await hosted.ownsOpaqueToken(req, tokenId))) {
          saveFail(403, 'opaque token not owned by session');
          return res.status(403).json({ error: 'Sign in to the account that owns this saved setup before changing it.' });
        }
        await hosted.saveTokenConfig(tokenId, config).catch((err: any) => { saveFail('store', `saveTokenConfig: ${err.message}`); console.error('[token] saveTokenConfig failed:', err.message); });
        // Wizard/account saves deliberately never carry provider keys in the
        // browser payload. Resolve the just-saved opaque token on the server
        // so its settings, including libraryIdMode, are keyed to the same
        // library instead of leaving an older Redis toggle in charge.
        configForStore = await resolveConfig(tokenId) || config;
        // Ownership just passed a session check: the account area's push and
        // install flows skip the bot gate below untouched.
        ownershipVerified = true;
      }
      // Turnstile bot gate (managed, invisible): anonymous/legacy saves must
      // carry a fresh `cf-turnstile-response` for action "save-config" once
      // TURNSTILE_SECRET + TURNSTILE_HOSTNAMES are set. Unconfigured
      // instances (self-hosters, pre-secret dev) proceed exactly as before.
      if (!ownershipVerified) {
        const turnstile = require('../platform/turnstile.ts');
        if (turnstile.turnstileConfigured()) {
          const verdict = await turnstile.verifyTurnstile(req.body && req.body['cf-turnstile-response'], {
            action: 'save-config',
            remoteip: req.ip,
          });
          if (!verdict.ok) { saveFail(403, `bot check: ${verdict.error || 'rejected'}`); return res.status(403).json({ error: 'Bot check failed. Reload the page and try again.' }); }
        }
      }
      const userKey = await require('../runtime/configstore.ts').saveStreamSettings(configForStore);
      // Providerless legacy installs carry their bounded mapping table inside
      // the self-contained install token. Validation above is still required,
      // but there is intentionally no server-side scope to persist here.
      if (!userKey && Array.isArray(configForStore.customStreams) && configForStore.customStreams.length > 0) {
        return res.json({ ok: true, selfContained: true });
      }
      if (!userKey) { saveFail(400, 'no usable API keys in config'); return res.status(400).json({ error: 'Config has no usable API keys' }); }
      res.json({ ok: true, userKey });
    } catch (err) {
      const detail = err as any;
      const status = detail.statusCode || 500;
      saveFail(status, detail.message);
      res.status(status).json({ error: detail.message, ...(detail.details ? { details: detail.details } : {}) });
    }
  });

  router.get('/api/config/:token', rateLimit({ windowMs: 60000, max: 60 }), async (req, res) => {
    try {
      const config = await resolveConfig(req.params.token);
      if (!config) return res.status(400).json({ error: 'Invalid token' });
      const providers = require('../providers/index.ts');
      const userKey = providers.getUserKey(config);
      const stored = (userKey || config.__configScope?.type === 'account')
        ? await require('../runtime/configstore.ts').loadStreamSettings(config)
        : null;
      res.json(stored || null);
    } catch (err) {
      const detail = err as any;
      res.status(500).json({ error: detail.message });
    }
  });

  // The status UI may be served from the private legacy page or the private
  // React port. Self-hosted builds include neither, so they don't start the
  // provider polling loop or make on-demand status checks.
  const HAS_STATUS_PAGE = fs.existsSync(path.join(WEBSITE_DIR, 'status.html')) || (
    !!FRONTEND_SHELL_HTML && fs.existsSync(path.join(ROOT_DIR, 'frontend', 'src', 'features', 'site', 'StatusPage.tsx'))
  );

  // ── Page routes (BEFORE static to avoid immutable caching) ──

  // Landing page: the React app. Without a frontend build, the private
  // landing.html (when present) or the /configure redirect, as before.
  if (options.landing) {
    router.get('/', (req: Request, res: Response) => {
      setSelfhostAccessCookie(req, res);
      if (serveHome(res)) return;
      if (serveShell(res)) return;
      const legacyLanding = path.join(WEBSITE_DIR, 'landing.html');
      if (!fs.existsSync(legacyLanding)) return res.redirect('/configure');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(legacyLanding);
    });
  } else {
    // v5.5 deployments have no website shim, so this is the live branch. The
    // prerendered home page only exists when the hosted HomePage was built;
    // self-hosted builds skip it and keep the shell (which redirects to
    // /configure client-side).
    router.get('/', (req: Request, res: Response) => {
      setSelfhostAccessCookie(req, res);
      if (serveHome(res)) return;
      if (serveShell(res)) return;
      res.redirect('/configure');
    });
  }

  // Configure page: the React setup flow. The ?token= alias just cleans its
  // URL now (old tokens import through Move In instead of prefilling).
  router.get('/configure', async (req: Request, res: Response) => {
    // Establish the self-host access cookie BEFORE any early return: the React
    // shell is served here in v5.5, and the setup list depends on this cookie.
    setSelfhostAccessCookie(req, res);
    if (req.query.token && req.query.token !== 'configure') {
      return res.redirect('/configure');
    }
    if (serveShell(res)) return;
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    // Flag whether the hosted account area exists so the page can hide
    // account-only nav/links on self-hosted installs.
    const legacyConfigure = path.join(WEBSITE_DIR, 'configure.html');
    if (!fs.existsSync(legacyConfigure)) return res.status(503).send('Setup is temporarily unavailable. Please try again shortly.');
    const html = fs.readFileSync(legacyConfigure, 'utf8');
    const injected = html.replace(
      '</head>',
      `<script>window.__HOSTED__ = false;window.__TURNSTILE_SITE_KEY__ = ${scriptSafeJson(require('../platform/turnstile.ts').turnstileSiteKey())};</script></head>`
    );
    res.send(injected);
  });

  // Old token-configure links (manifest configureUrl, pasted tokens) land on
  // the setup flow; the token itself imports through Move In. Invalid tokens
  // still 400 as before.
  // React tier deep links: served the shell here so /configure/:token below
  // never mistakes quick/partial/full for a token.
  for (const tier of ['quick', 'partial', 'full']) {
    router.get(`/configure/${tier}`, (req: Request, res: Response) => {
      if (serveShell(res)) return;
      res.redirect('/configure');
    });
  }
  router.get('/configure/:token', async (req: Request, res: Response) => {
    if (!(await resolveConfig(req.params.token))) return res.status(400).send('Invalid token');
    res.redirect('/configure');
  });

  // ── Old account-era links ──
  // The account area was removed in v5.5 (archived outside the repo). Old
  // bookmarks and emailed links still land somewhere useful: a per-setup edit
  // link goes to that token's configure route (which sends it into the v5.5
  // import flow); everything else under /account goes to the setup picker.
  router.get([
    '/accounts/:token/configure',
    '/accounts/collections/:token/configure',
    '/account/collections/:token/configure',
  ], (req: Request, res: Response) => res.redirect(302, `/${encodeURIComponent(String(req.params.token))}/configure`));
  router.get(['/account', '/account/*', '/accounts', '/accounts/*'], (_req: Request, res: Response) => res.redirect(302, '/configure'));

  // ── Self-hosted saved configs ──
  // SELF-HOST ONLY: mounted only when the hosted account area is absent, so
  // these never run on the hosted instance (where saved configs = account
  // tokens in Postgres). Uses Redis only: self-hosters don't run Postgres.
  //
  // SECURITY: saved configs embed the provider API keys the browser sent with
  // them. These routes have no user accounts, so by default every read strips
  // credential fields before responding: a leaked list endpoint must not
  // hand out debrid keys. Operators who keep their instance private can set
  // SELFHOST_CONFIGS_SECRET in .env and send it as the `x-selfhost-secret`
  // header to get full configs (including keys) back.
  const KEY_FIELDS = ['torboxApiKey', 'rdApiKey', 'adApiKey', 'pmApiKey', 'tmdbApiKey', 'erdbToken', 'rpdbKey', 'fanartKey', 'omdbKey', 'mdblistKey'];
  function selfhostAuthorized(req: any) {
    return selfhostAccess.authorized(req);
  }
  function redactConfig(config: any) {
    if (!config || typeof config !== 'object' || selfhostAccess.configured()) return config;
    const clean = { ...config };
    for (const k of KEY_FIELDS) delete clean[k];
    return clean;
  }
  const selfhostConfigs = () => require('../platform/selfhost-configs.ts');

  // Self-host saved configs (always mounted since the account area is gone).
  {
    router.get('/api/selfhost-configs', rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
      try {
        if (!selfhostAuthorized(req)) return res.status(401).json({ error: 'Invalid selfhost secret' });
        const rows = await selfhostConfigs().list();
        res.json({ configs: rows.map((r: any) => ({ ...r, config: redactConfig(r.config) })) });
      } catch (err) {
        const detail = err as any;
        res.status(500).json({ error: detail.message });
      }
    });

    router.post('/api/selfhost-configs', rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
      if (!selfhostAuthorized(req)) return res.status(401).json({ error: 'Invalid selfhost secret' });
      const { label, config } = req.body || {};
      if (!config || typeof config !== 'object') return res.status(400).json({ error: 'Missing config' });
      try {
        if (config.posterProvider === 'custom') {
          const checked = require('../media/poster-template.ts').validate(config.customPosterTemplate);
          if (!checked.ok) return res.status(400).json({ error: checked.error });
          config.customPosterTemplate = checked.value;
        }
        const { id } = await selfhostConfigs().save({ label, config });
        res.json({ ok: true, id });
      } catch (err) {
        const detail = err as any;
        res.status(500).json({ error: detail.message });
      }
    });

    router.delete('/api/selfhost-configs/:id', rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
      try {
        if (!selfhostAuthorized(req)) return res.status(401).json({ error: 'Invalid selfhost secret' });
        await selfhostConfigs().remove(req.params.id);
        res.json({ ok: true });
      } catch (err) {
        const detail = err as any;
        res.status(500).json({ error: detail.message });
      }
    });

    // ── Personal AIOStreams connector (self-host) ──────────────────────────
    // The configured URL is verified, then sealed with SELFHOST_CONFIGS_SECRET
    // and addressed by a non-secret reference. The browser receives only safe
    // display metadata, never the URL again.
    router.post('/api/aiostreams', rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
      try {
        if (!selfhostAuthorized(req)) return res.status(401).json({ error: 'Invalid selfhost secret' });
        const store = require('../streams/aiostreams-store.ts');
        if (!store.selfHostEnabled()) return res.status(409).json({ error: 'Set SELFHOST_CONFIGS_SECRET in .env to enable My AIOStreams' });
        const url = req.body && typeof req.body.url === 'string' ? req.body.url.trim() : '';
        if (!url) return res.status(400).json({ error: 'Missing URL' });
        const verified = await require('../streams/aiostreams.ts').verifyManifest(url);
        if (!verified.ok) return res.status(400).json({ ok: false, error: verified.error || 'could_not_connect' });
        const ref = store.newRef();
        await store.setSelfHost(ref, url);
        res.json({ ok: true, ref, name: verified.name, version: verified.version, logo: verified.logo, fingerprint: verified.fingerprint });
      } catch (err) {
        const detail = err as any;
        res.status(500).json({ error: detail.message });
      }
    });

    router.delete('/api/aiostreams/:ref', rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
      try {
        if (!selfhostAuthorized(req)) return res.status(401).json({ error: 'Invalid selfhost secret' });
        await require('../streams/aiostreams-store.ts').removeSelfHost(req.params.ref);
        res.json({ ok: true });
      } catch (err) {
        const detail = err as any;
        res.status(500).json({ error: detail.message });
      }
    });

    // Re-verify a saved self-host connector ("Test again"). Never returns the URL.
    router.get('/api/aiostreams/:ref', rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
      try {
        if (!selfhostAuthorized(req)) return res.status(401).json({ error: 'Invalid selfhost secret' });
        const url = await require('../streams/aiostreams-store.ts').getSelfHost(req.params.ref);
        if (!url) return res.json({ connected: false });
        const verified = await require('../streams/aiostreams.ts').verifyManifest(url);
        res.json({ connected: true, ok: verified.ok, name: verified.name || null, version: verified.version || null, logo: verified.logo || null, fingerprint: verified.fingerprint || null });
      } catch (err) {
        const detail = err as any;
        res.status(500).json({ error: detail.message });
      }
    });
  }

  // Setup guide: the React app. There is no legacy guide page (the old
  // account-only guide was removed with the accounts area), so without a
  // frontend build send people to the setup picker instead.
  router.get('/guide', (req: Request, res: Response) => {
    if (serveShell(res)) return;
    return res.redirect('/configure');
  });

  // Provider status page: the React app. Without a frontend build, the
  // private status.html when present, else the configure redirect as before.
  router.get('/status', (req: Request, res: Response) => {
    if (serveShell(res)) return;
    const page = path.join(WEBSITE_DIR, 'status.html');
    if (!fs.existsSync(page)) return res.redirect('/configure');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(page);
  });

  // Privacy policy: the React app. Without a frontend build, the private
  // privacy.html when present, else the home redirect as before.
  router.get('/privacy', (req: Request, res: Response) => {
    if (serveShell(res)) return;
    const page = path.join(WEBSITE_DIR, 'privacy.html');
    if (!fs.existsSync(page)) return res.redirect('/');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(page);
  });

  // Releases (hosted-only). The React page is gated to the same capability as
  // the /api/releases routes; self-hosted installs have no such page and get a
  // clean 404 rather than the shell.
  router.get('/releases', (req: Request, res: Response) => {
    if (!require('../platform/hosted.ts').releasesEnabled()) {
      return serveErrorPage(res, req, 404, 'Page Not Found', ERROR_DESCRIPTIONS[404]);
    }
    if (serveShell(res)) return;
    return res.redirect('/');
  });

  // Releases title deep links, under the same hosted gate as the index. The
  // client router owns the view; without a server route a shared title URL
  // 404s on a hard load even though it works when clicked inside the app.
  router.get('/releases/:type/:id', (req: Request, res: Response) => {
    if (!require('../platform/hosted.ts').releasesEnabled()) {
      return serveErrorPage(res, req, 404, 'Page Not Found', ERROR_DESCRIPTIONS[404]);
    }
    if (serveShell(res)) return;
    return res.redirect('/');
  });

  // Supporters / credits (tracked, public on every install). It was /about
  // before v5.5: old links and bookmarks move permanently.
  router.get('/supporters', (req: Request, res: Response) => {
    if (serveShell(res)) return;
    return res.redirect('/');
  });
  router.get('/about', (req: Request, res: Response) => res.redirect(301, '/supporters'));

  // Configure with injected config (from Stremio addon)
  router.get('/:token/configure', async (req: Request, res: Response) => {
    // A v5.5 setup is edited at its own UUID (password gate, tier surface);
    // legacy self-contained tokens import through the setup flow, invalid
    // ones still 400 as before.
    const config = await resolveConfig(String(req.params.token));
    const target = configureRedirectTarget(config);
    if (!target) return res.status(400).send('Invalid token');
    return res.redirect(target);
  });

  // Wizard shared util — git-tracked, self-host safe (UMD)
  router.get('/wizard-shared.js', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.sendFile(path.join(ROOT_DIR, 'backend', 'src', 'config', 'wizard-shared.js'));
  });

  // Isomorphic libs, moved to backend TypeScript (single source of truth).
  // React setup loads these type-stripped builds through versioned browser
  // URLs; the modules themselves are also required by the backend.
  const { stripTypeScriptTypes } = require('node:module');
  const LEGACY_SCRIPT_COMPAT = {
    '/formatter.js': { file: path.join(ROOT_DIR, 'backend', 'src', 'streams', 'formatter.ts'), global: 'LeFormatter' },
    '/token-map.js': { file: path.join(ROOT_DIR, 'backend', 'src', 'config', 'token-map.ts'), global: 'TOKEN_MAP' },
    '/poster-template.js': { file: path.join(ROOT_DIR, 'backend', 'src', 'media', 'poster-template.ts'), global: 'LePosterTemplate' },
    '/pictorium-options.js': { file: path.join(ROOT_DIR, 'backend', 'src', 'runtime', 'pictorium-options.ts'), global: 'LePictoriumOptions' },
  };
  const legacyScriptCache = new Map();
  for (const [url, spec] of Object.entries(LEGACY_SCRIPT_COMPAT)) {
    router.get(url, (req, res) => {
      try {
        const stat = fs.statSync(spec.file);
        let entry = legacyScriptCache.get(spec.file);
        if (!entry || entry.mtimeMs !== stat.mtimeMs) {
          entry = { mtimeMs: stat.mtimeMs, js: stripTypeScriptTypes(fs.readFileSync(spec.file, 'utf8')) };
          legacyScriptCache.set(spec.file, entry);
        }
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(`window.${spec.global}=(function(){var module={exports:{}};var exports=module.exports;\n${entry.js}\nreturn module.exports;})();`);
      } catch (err) {
        const detail = err as any;
        console.warn(`[website] legacy script unavailable: ${url} (${detail.message})`);
        res.status(404).type('text/plain').send('not found');
      }
    });
  }

  // The SPA shell is not a page. express.static would happily serve
  // frontend/dist/index.html at /index.html, and the client router then treats
  // it as /{uuid} and renders "Setup not found". Answer with the real 404.
  router.get('/index.html', (req: Request, res: Response) => {
    serveErrorPage(res, req, 404, 'Page Not Found', ERROR_DESCRIPTIONS[404]);
  });

  // Static collection artwork, icons and manifests. Sources live in
  // frontend/public (Vite copies them verbatim into frontend/dist at build):
  // serve the build output when present, else the source tree, so every
  // /collection-assets/*, /provider-logos/* and icon URL keeps working with
  // or without a frontend build.
  const FRONTEND_PUBLIC = path.join(ROOT_DIR, 'frontend', 'public');
  const FRONTEND_DIST_ASSETS = path.join(ROOT_DIR, 'frontend', 'dist');
  // Only Vite's hashed /assets/* files are immutable. Everything else here
  // keeps its name across deploys (logos, icons, the Guide/overview videos and
  // their videos.json), so a 30-day immutable cache pinned stale copies in
  // browsers: the video manifest is always revalidated, the rest for an hour.
  const staticOpts = {
    etag: true,
    cacheControl: false,
    setHeaders(res: Response, filePath: string) {
      const rel = filePath.split(path.sep).join('/');
      if (rel.includes('/dist/assets/')) res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      else if (rel.endsWith('.json') || rel.endsWith('.webmanifest') || rel.endsWith('.xml') || rel.endsWith('.txt')) res.setHeader('Cache-Control', 'no-cache');
      else res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    },
  };
  // Retired Hub artwork. Collections already pushed to Nuvio keep these URLs,
  // so they move permanently to the current art instead of breaking.
  const RETIRED_ARTWORK: Record<string, string> = {
    '/collection-assets/collections/covers/lelibrary-hub-movies-v2.png': '/collection-assets/collections/covers/lelibrary-hub-movies-v3.jpg',
    '/collection-assets/collections/covers/lelibrary-hub-shows-v2.png': '/collection-assets/collections/covers/lelibrary-hub-shows-v3.jpg',
    '/collection-assets/collections/gifs/lelibrary-hub-movies-focus-v2.gif': '/collection-assets/collections/gifs/lelibrary-hub-movies-focus-v3.gif',
    '/collection-assets/collections/gifs/lelibrary-hub-shows-focus-v2.gif': '/collection-assets/collections/gifs/lelibrary-hub-shows-focus-v3.gif',
  };
  for (const [from, to] of Object.entries(RETIRED_ARTWORK)) {
    router.get(from, (req: Request, res: Response) => res.redirect(301, to));
  }
  router.use(express.static(FRONTEND_DIST_ASSETS, staticOpts));
  router.use(express.static(FRONTEND_PUBLIC, staticOpts));

  // Static files from website/public (frozen legacy configure JS/CSS only)
  if (fs.existsSync(PUBLIC_DIR)) {
    router.use(express.static(PUBLIC_DIR, {
      maxAge: '30d',
      etag: true,
      immutable: true,
    }));
  }

  // ── Clear user cache endpoint (authenticated via config token) ──
  // POST only: a GET was triggerable by any <img>/link load. Scope is limited
  // to the requesting user's own cache keys (no global meta wipe).
  router.post('/api/clear-cache/:token', rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
    const config = await resolveConfig(req.params.token);
    if (!config) return res.status(400).json({ error: 'Invalid token' });
    const userKey = require('../providers/index.ts').getUserKey(config);
    if (!userKey) return res.status(400).json({ error: 'No API key configured' });
    try {
      const cache = require('../runtime/cache.ts');
      const cleared = await cache.delPattern(`*${userKey}*`);
      // Catalog-library rows are shared (their contents have no provider-key
      // dependency), so the normal user-key pattern does not reach them.
      // Clear only sources selected by this setup; a refresh therefore rebuilds
      // today's deterministic rotation rather than changing its slot.
      const sourceIds = [...new Set([
        ...(Array.isArray(config.libraryCatalogs) ? config.libraryCatalogs : []),
        ...(Array.isArray(config.selectedHomeCatalogs) ? config.selectedHomeCatalogs : []),
      ].map((id) => String(id || '').replace(/^lib-/, '')).filter((id) => /^[a-z0-9_]+$/.test(id)))];
      const sharedCleared = await Promise.all(sourceIds.flatMap((id) => [
        cache.delPattern(`cat:lib4:${id}:*`),
        cache.delPattern(`cat:lib4-lkg:${id}:*`),
      ]));
      require('../media/tmdb.ts').clearCaches();
      res.json({ success: true, cleared: cleared + sharedCleared.reduce((sum, count) => sum + count, 0), message: 'Cache cleared! Refresh Stremio to see changes.' });
    } catch (err) {
      const detail = err as any;
      res.status(500).json({ error: detail.message });
    }
  });

  // ── Provider status aggregator (public health checks, no user keys) ──
  // Fetches debrid and shared stream-source endpoint status so the status
  // page, landing page and My Library can show live uptime. A background loop re-pings every
  // 60s ("server-side ping"), so /api/status always returns fresh data without
  // a page view having to wait for live checks. Each check reports its own
  // round-trip latency (ms) for the status page.
  // Instatus-style service states collapse to the four pill states so the
  // UI, history cells and overall rank speak one language.
  function normaliseServiceStatus(raw: any): string {
    const s = String(raw || '').toLowerCase();
    if (!s) return 'unknown';
    if (s.includes('operation')) return 'operational';
    if (s.includes('maintenance')) return 'maintenance';
    if (s.includes('down') || s.includes('outage') || s.includes('major') || s.includes('critical')) return 'down';
    return 'degraded';
  }

  // A Cloudflare 403 block page (an IP or bot rule), as opposed to the service
// itself answering 403.
function isCloudflareBlock(response: any): boolean {
  if (!response || response.status !== 403) return false;
  const server = String(response.headers?.server || '').toLowerCase();
  return server.includes('cloudflare') || !!response.headers?.['cf-mitigated'];
}

const STATUS_CHECKS = [
    {
      id: 'torbox',
      name: 'TorBox',
      url: 'https://status.torbox.app',
      async check(axios: any) {
        const t0 = Date.now();
        const r = await axios.get('https://status.torbox.app/index.json', { timeout: 8000 });
        const latency = Date.now() - t0;
        const attrs = r.data?.data?.attributes || {};
        const included = Array.isArray(r.data?.included) ? r.data.included : [];
        const sections: Record<string, string> = {};
        for (const item of included) {
          if (item?.type === 'status_page_section') sections[String(item.id)] = String(item.attributes?.name || '');
        }
        const services: { section: string; name: string; status: string; availability?: number }[] = [];
        for (const item of included) {
          if (item?.type !== 'status_page_resource' || services.length >= 40) continue;
          const at = item.attributes || {};
          const name = String(at.public_name || '').trim();
          if (!name) continue;
          const entry: { section: string; name: string; status: string; availability?: number } = {
            section: sections[String(at.status_page_section_id)] || '',
            name,
            status: normaliseServiceStatus(at.status),
          };
          if (typeof at.availability === 'number' && Number.isFinite(at.availability)) {
            entry.availability = Math.round(at.availability * 10000) / 100;
          }
          services.push(entry);
        }
        const activeMaintenanceTitles = included
          .filter((x: any) => x?.type === 'status_report'
            && x?.attributes?.report_type === 'maintenance'
            && x?.attributes?.aggregate_state !== 'resolved')
          .map((x: any) => String(x?.attributes?.title || '').trim())
          .filter(Boolean)
          .slice(0, 3);
        const aggregate = attrs.aggregate_state;
        if (aggregate === 'major_outage') {
          return { status: 'down', detail: 'Major outage reported', latency, services };
        }
        // Planned work is not an outage: it gets its own state (blue, not red)
        // even when the aggregate looks degraded, so a GPU-transcode window no
        // longer reads as "TorBox is down".
        if (activeMaintenanceTitles.length > 0 || services.some((s) => s.status === 'maintenance')) {
          return {
            status: 'maintenance',
            detail: activeMaintenanceTitles.length > 0 ? activeMaintenanceTitles.join(' · ') : 'Scheduled maintenance in progress',
            latency,
            maintenance: true,
            services,
            ...(activeMaintenanceTitles.length > 0 ? { note: activeMaintenanceTitles[0] } : {}),
          };
        }
        if (aggregate === 'operational') return { status: 'operational', detail: 'All systems operational', latency, services };
        return { status: 'degraded', detail: aggregate ? String(aggregate).replace(/_/g, ' ') : 'Status unknown', latency, services };
      },
    },
    {
      id: 'realdebrid',
      name: 'Real-Debrid',
      url: 'https://real-debrid.com',
      async check(axios: any) {
        const t0 = Date.now();
        await axios.get('https://api.real-debrid.com/rest/1.0/time', { timeout: 8000 });
        return { status: 'operational', detail: 'API responding normally', latency: Date.now() - t0 };
      },
    },
    {
      id: 'alldebrid',
      name: 'AllDebrid',
      url: 'https://alldebrid.com',
      async check(axios: any) {
        const t0 = Date.now();
        const r = await axios.get('https://api.alldebrid.com/v4/ping', { timeout: 8000 });
        const latency = Date.now() - t0;
        if (r.data?.status === 'success' && r.data?.data?.ping === 'pong') {
          return { status: 'operational', detail: 'API responding normally', latency };
        }
        return { status: 'degraded', detail: 'Unexpected API response', latency };
      },
    },
    {
      id: 'premiumize',
      name: 'Premiumize',
      url: 'https://premiumize.reamaze.com/status',
      async check(axios: any) {
        const t0 = Date.now();
        await axios.get('https://premiumize.reamaze.com/status', { timeout: 8000, maxRedirects: 5 });
        return { status: 'operational', detail: 'Status page responding', latency: Date.now() - t0 };
      },
    },
    // Public stream add-on endpoints are probed without any user's config or
    // debrid credentials. A reachable manifest/API confirms the service edge
    // is responding; it cannot guarantee search quality or playback success.
    {
      id: 'torrentio',
      name: 'Torrentio',
      url: 'https://torrentio.strem.fun',
      async check(axios: any) {
        const t0 = Date.now();
        let r;
        try {
          r = await axios.get('https://torrentio.strem.fun/manifest.json', { timeout: 8000 });
        } catch (err) {
          // Torrentio's Cloudflare refuses many cloud server IPs with a 403
          // block page. That says nothing about Torrentio itself, so it is
          // shown as not checked instead of counting as an outage.
          if (isCloudflareBlock((err as any)?.response)) {
            return { status: 'unknown', detail: "Can't check from our server", latency: Date.now() - t0 };
          }
          throw err;
        }
        const latency = Date.now() - t0;
        if (typeof r.data?.id === 'string' && typeof r.data?.name === 'string') {
          return { status: 'operational', detail: 'Public manifest responding', latency };
        }
        return { status: 'degraded', detail: 'Unexpected manifest response', latency };
      },
    },
    {
      id: 'comet',
      name: 'Comet',
      url: 'https://comet.feels.legal',
      async check(axios: any) {
        const t0 = Date.now();
        const r = await axios.get('https://comet.feels.legal/health', { timeout: 8000 });
        const latency = Date.now() - t0;
        return r.data?.status === 'ok'
          ? { status: 'operational', detail: 'Health endpoint responding', latency }
          : { status: 'degraded', detail: 'Unexpected health response', latency };
      },
    },
    {
      id: 'meteor',
      name: 'Meteor',
      url: 'https://meteorfortheweebs.midnightignite.me',
      async check(axios: any) {
        const t0 = Date.now();
        const r = await axios.get('https://meteorfortheweebs.midnightignite.me/manifest.json', { timeout: 8000 });
        const latency = Date.now() - t0;
        return typeof r.data?.id === 'string' && typeof r.data?.name === 'string'
          ? { status: 'operational', detail: 'Public manifest responding', latency }
          : { status: 'degraded', detail: 'Unexpected manifest response', latency };
      },
    },
    {
      id: 'mediafusion',
      name: 'MediaFusion',
      url: 'https://mediafusion.elfhosted.com',
      async check(axios: any) {
        const t0 = Date.now();
        const r = await axios.get('https://mediafusion.elfhosted.com/manifest.json', { timeout: 8000 });
        const latency = Date.now() - t0;
        return typeof r.data?.id === 'string' && typeof r.data?.name === 'string'
          ? { status: 'operational', detail: 'Public manifest responding', latency }
          : { status: 'degraded', detail: 'Unexpected manifest response', latency };
      },
    },
    {
      id: 'jackettio',
      name: 'Jackettio',
      url: 'https://jackettio.elfhosted.com',
      async check(axios: any) {
        const t0 = Date.now();
        const r = await axios.get('https://jackettio.elfhosted.com/manifest.json', { timeout: 8000 });
        const latency = Date.now() - t0;
        return typeof r.data?.id === 'string' && typeof r.data?.name === 'string'
          ? { status: 'operational', detail: 'Public manifest responding', latency }
          : { status: 'degraded', detail: 'Unexpected manifest response', latency };
      },
    },
    {
      id: 'knaben',
      name: 'KNABEN',
      url: 'https://knaben.org',
      async check(axios: any) {
        const t0 = Date.now();
        // Minimal anonymous probe: no user key and zero results requested.
        const r = await axios.post('https://api.knaben.org/v1', {
          query: 'lelibrary-healthcheck',
          search_type: 'score',
          search_field: 'title',
          size: 0,
          hide_unsafe: true,
        }, { timeout: 8000, headers: { Accept: 'application/json' } });
        const latency = Date.now() - t0;
        return Array.isArray(r.data?.hits)
          ? { status: 'operational', detail: 'Search API responding', latency }
          : { status: 'degraded', detail: 'Unexpected search API response', latency };
      },
    },
  ];
  // Local LeLibrary health is measured from inside the running process. These
  // checks expose only component state and timings, never user or library data.
  let redisMisses = 0;
  async function checkLeLibrary() {
    const startedAt = Date.now();
    const bounded = <T>(promise: Promise<T>, ms = 2000): Promise<T> => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), ms);
      timer.unref?.();
      promise.then(resolve, reject).finally(() => clearTimeout(timer));
    });
    let engineState: any = null;
    let indexed = false;
    let dbConfigured = false;
    let engineFailure = false;
    let db: any;
    let cache: any;
    try {
      const engine = require('../library/engine.ts');
      db = require('../library/db.ts');
      cache = require('../runtime/cache.ts');
      dbConfigured = !!db.enabled();
      // health() runs no queries; engine.status() aggregates the whole match
      // queue and timed out under the first sync after a deploy, which showed
      // the engine as failed and the database as not configured.
      engineState = engine.health();
      indexed = !!engineState.enabled;
    } catch {
      engineFailure = true;
    }
    const [databaseReady, redisState] = await Promise.all([
      // The Postgres pool may need its configured 5s connection window on a
      // cold reconnect; a 2s status timeout reported healthy databases as down.
      dbConfigured ? bounded(db.isReady(), 6000).catch(() => false) : Promise.resolve(null),
      (async () => {
        const client = cache?.getRedisClient();
        if (!client) return { status: 'operational', detail: 'In-memory cache active' };
        const ok = await cache.healthPing(3000).catch(() => false);
        redisMisses = ok ? 0 : redisMisses + 1;
        // One slow ping is noise; two checks in a row (a minute apart) is real.
        return redisMisses < 2
          ? { status: 'operational', detail: 'Redis responding' }
          : { status: 'degraded', detail: 'Redis unavailable; cache may fall back to memory' };
      })(),
    ]);
    const services = [
      { section: 'LeLibrary', name: 'Addon API', status: 'operational', detail: 'Status endpoint responding' },
      {
        section: 'LeLibrary', name: 'Indexed library engine',
        // Matching backlog and per-title failures are diagnostics, not service
        // availability. Keep those private; this component reports whether the
        // engine itself is running. Database availability is reported below.
        status: engineFailure ? 'degraded' : (!indexed ? 'operational' : (engineState.started ? 'operational' : 'degraded')),
        detail: engineFailure ? 'Engine health probe failed' : (!indexed ? 'Legacy library path active' : (engineState.started
          ? 'Background engine running'
          : 'Engine not started')),
      },
      {
        section: 'LeLibrary', name: 'PostgreSQL',
        status: !dbConfigured ? 'maintenance' : (databaseReady ? 'operational' : 'down'),
        detail: !dbConfigured ? 'Not configured; indexed engine is disabled' : (databaseReady
          ? 'Database connected'
          : 'Database unavailable'),
      },
      { section: 'LeLibrary', name: 'Cache', status: redisState.status, detail: redisState.detail },
    ];
    const status = services.reduce((worst, service) =>
      (STATUS_RANK[service.status] ?? 1) > (STATUS_RANK[worst] ?? 1) ? service.status : worst, 'operational');
    return {
      id: 'lelibrary', name: 'LeLibrary', url: '/', status,
      detail: `${services.filter((service) => service.status === 'operational').length}/${services.length} components healthy`,
      latency: Date.now() - startedAt, services,
    };
  }
  const STATUS_RANK: Record<string, number> = { operational: 0, maintenance: 1, degraded: 2, down: 3 };
  let statusCache: any = { at: 0, data: null };

  // Rolling uptime history (in-memory, one sample per background check).
  // Cleared on restart: the status page renders it as Uptime-Kuma-style cells.
  const HISTORY_WINDOW = 7 * 24 * 3600 * 1000; // keep 7 days of samples
  const statusHistory = new Map(); // providerId -> [{ t, status }]

  // Bucket the raw samples into Uptime-Kuma-style cells: each cell = one
  // individual 60s check beat (not an hourly/daily aggregate). This means
  // the cells update live every minute as new checks arrive.
  //   b24 = last 24 beats (~24 minutes of history)
  //   b7  = last  7 beats (~7 minutes of history)
  function aggregateHistory(history: any) {
    const out: { b24: any[]; b7: any[]; up24: number | null; up7: number | null } = { b24: [], b7: [], up24: null, up7: null };

    const last24 = history.slice(-24);
    last24.forEach((s: any) => out.b24.push({ t: s.t, status: s.status }));

    const last7 = history.slice(-7);
    last7.forEach((s: any) => out.b7.push({ t: s.t, status: s.status }));

    const pct = (slice: any) => {
      const checked = slice.filter((s: any) => s.status !== 'unknown');
      if (!checked.length) return null;
      return Math.round((checked.filter((s: any) => s.status !== 'down').length / checked.length) * 100);
    };
    out.up24 = pct(last24);
    out.up7 = pct(last7);

    return out;
  }

  async function runStatusCheck() {
    try {
      const axios = require('axios');
      const settled = await Promise.allSettled(STATUS_CHECKS.map(p => p.check(axios)));

      const providers: any[] = STATUS_CHECKS.map((p, i) => {
        if (settled[i].status === 'fulfilled') {
          return { id: p.id, name: p.name, url: p.url, ...settled[i].value };
        }
        const code = settled[i].reason?.response?.status;
        return {
          id: p.id, name: p.name, url: p.url,
          status: 'down',
          detail: code ? `Unavailable (HTTP ${code})` : 'Unreachable',
        };
      });
      providers.unshift(await checkLeLibrary());

      // A provider we could not check ('unknown') never changes the overall.
      const overall = providers.reduce((worst, p) => {
        if (p.status === 'unknown') return worst;
        return (STATUS_RANK[p.status] ?? 2) > STATUS_RANK[worst] ? p.status : worst;
      }, 'operational');

      // Append this check to the rolling history and attach the cell buckets.
      const now = Date.now();
      providers.forEach(p => {
        const h = statusHistory.get(p.id) || [];
        h.push({ t: now, status: p.status });
        while (h.length && h[0].t < now - HISTORY_WINDOW) h.shift();
        statusHistory.set(p.id, h);
        p.history = aggregateHistory(h);
      });

      statusCache = { at: Date.now(), data: { updatedAt: Date.now(), overall, providers } };
      latestStatus = { at: statusCache.at, data: statusCache.data };
    } catch (err) {
      const detail = err as any;
      console.error(`[Status] background check failed: ${detail.message}`);
    }
  }

  // Background "server-side ping": keep the cache warm every 60s. Only runs on
  // instances that ship one of the private status pages; self-hosters never
  // start it, so they make no background traffic to debrid providers.
  if (HAS_STATUS_PAGE) {
    runStatusCheck();
    setInterval(runStatusCheck, 60000).unref?.();
  }

  router.get('/api/status', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    // (OPTIONS never reaches a router.get handler: the app-level CORS
    // middleware answers all preflights before routing.)
    // Self-hosted instances have no status page, so never ping providers even
    // on-demand (a browser polling /api/status would otherwise trigger one).
    if (!HAS_STATUS_PAGE) {
      return res.json({ updatedAt: Date.now(), overall: 'unknown', providers: [] });
    }
    if (statusCache.data && Date.now() - statusCache.at < 60000) return res.json(statusCache.data);
    await runStatusCheck();
    res.json(statusCache.data || { updatedAt: Date.now(), overall: 'down', providers: [] });
  });

  // ── API key verification proxies ──
  // Keys are sent in the request body (never the URL) so they can't leak into
  // server/access logs. Rate-limited: each request is a free third-party ping
  // (provider + TMDB), so a per-IP cap stops anonymous users using the box as
  // a verification oracle. 60/min comfortably covers the configure flow (a
  // generate batch fires ~4-8 checks in parallel).
  router.use('/api/verify', rateLimit({ windowMs: 60000, max: 60 }));
  // TorBox: /v1/api/user/me returns 200+success for a valid API token,
  // 401/403 + BAD_TOKEN for an invalid/expired one.
  // "Your own" stream addon: confirm the link is a reachable Stremio addon
  // that serves streams. Returns only its name and version; the link itself
  // is never echoed, logged or cached (it often carries the user's own
  // credentials). Same host rules as playback: HTTPS, public hosts only
  // unless the operator opts in, pinned DNS, no redirects.
  router.post('/api/verify/addon', async (req, res) => {
    const url = (req.body && typeof req.body.url === 'string' ? req.body.url.trim() : '');
    if (!url || url.length > 2048) return res.json({ valid: false, error: 'Paste the addon link (its manifest.json).' });
    const aio = require('../streams/aiostreams.ts');
    const result = await aio.verifyManifest(url).catch(() => ({ ok: false, error: 'unreachable' }));
    if (result.ok) return res.json({ valid: true, name: result.name, version: result.version || null });
    const ERRORS: Record<string, string> = {
      invalid_url: 'That is not an https addon link.',
      blocked_host: 'That link points at a private or local address, which this server cannot reach.',
      no_stream_resource: 'That addon does not provide streams.',
      unauthorized: 'The addon refused the request. Check the link is complete.',
      redirect: 'The addon link redirects elsewhere. Paste its final manifest link.',
      unreachable: 'Could not reach that addon. Check the link and try again.',
    };
    res.json({ valid: false, error: ERRORS[result.error] || ERRORS.unreachable });
  });

  router.post('/api/verify/torbox', async (req, res) => {
    const key = (req.body && typeof req.body.key === 'string' ? req.body.key.trim() : '');
    if (!key) return res.json({ valid: false, error: 'Missing key' });
    try {
      const axios = require('axios');
      const r = await axios.get('https://api.torbox.app/v1/api/user/me', {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 8000,
        validateStatus: (s: number) => s < 500,
      });
      if (r.status === 200 && r.data?.success === true) {
        res.json({ valid: true, username: r.data?.data?.username || null });
      } else {
        const err = r.data?.detail || r.data?.error || 'Invalid TorBox API key';
        res.json({ valid: false, error: err });
      }
    } catch {
      res.json({ valid: false, error: 'Could not reach TorBox: try again' });
    }
  });

  // Real-Debrid: /user returns the account on a valid token, "bad_token" otherwise.
  router.post('/api/verify/realdebrid', async (req, res) => {
    const key = (req.body && typeof req.body.key === 'string' ? req.body.key.trim() : '');
    if (!key) return res.json({ valid: false, error: 'Missing key' });
    try {
      const axios = require('axios');
      const r = await axios.get('https://api.real-debrid.com/rest/1.0/user', {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 8000,
        validateStatus: (s: number) => s < 500,
      });
      if (r.status === 200 && r.data?.id) {
        res.json({ valid: true, username: r.data?.username || null });
      } else {
        const err = r.data?.error === 'bad_token'
          ? 'Invalid or expired Real-Debrid API key: generate a new one at real-debrid.com/apitoken'
          : (r.data?.error || 'Invalid Real-Debrid API key');
        res.json({ valid: false, error: err });
      }
    } catch {
      res.json({ valid: false, error: 'Could not reach Real-Debrid: try again' });
    }
  });

  // AllDebrid: /user returns account info for a valid key.
  router.post('/api/verify/alldebrid', async (req, res) => {
    const key = (req.body && typeof req.body.key === 'string' ? req.body.key.trim() : '');
    if (!key) return res.json({ valid: false, error: 'Missing key' });
    try {
      const { verifyAlldebridKey } = require('../providers/alldebrid.ts');
      res.json(await verifyAlldebridKey(key));
    } catch {
      res.json({ valid: false, error: 'Could not reach AllDebrid: try again' });
    }
  });

  // Premiumize: /account/info for a valid key. First use from a new IP may
  // require device authorization: we surface { needPin, pin, deviceUrl } so
  // the configure page can walk the user through it.
  router.post('/api/verify/premiumize', async (req, res) => {
    const key = (req.body && typeof req.body.key === 'string' ? req.body.key.trim() : '');
    if (!key) return res.json({ valid: false, error: 'Missing key' });
    try {
      const { verifyPremiumizeKey } = require('../providers/premiumize.ts');
      res.json(await verifyPremiumizeKey(key));
    } catch {
      res.json({ valid: false, error: 'Could not reach Premiumize: try again' });
    }
  });

  // TMDB: reject v4 Read Access Tokens (JWTs) with a clear message: v3 API
  // keys are a 32-char hex string and don't expire like session JWTs.
  router.post('/api/verify/tmdb', async (req, res) => {
    const key = (req.body && typeof req.body.key === 'string' ? req.body.key.trim() : '');
    if (!key) return res.json({ valid: false, error: 'Missing key' });
    if (/^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(key)) {
      return res.json({
        valid: false,
        code: 'V4_ACCESS_TOKEN',
        error: 'This is a TMDB v4 Read Access Token. Please use your v3 API key (32-character string from your TMDB settings) instead.',
      });
    }
    try {
      const axios = require('axios');
      const r = await axios.get('https://api.themoviedb.org/3/configuration', {
        params: { api_key: key },
        timeout: 5000,
      });
      res.json({ valid: r.status === 200 && r.data != null, error: r.status !== 200 ? 'Invalid TMDB API key' : undefined });
    } catch {
      res.json({ valid: false, error: 'Invalid TMDB API key' });
    }
  });

  router.post('/api/verify/erdb', async (req, res) => {
    const key = req.body && typeof req.body.key === 'string' ? req.body.key : '';
    if (!key) return res.json({ valid: false, error: 'Missing key' });
    try {
      const axios = require('axios');
      const r = await axios.get(`https://easyratingsdb.com/${encodeURIComponent(key)}/poster/tt0133093.jpg`, {
        timeout: 5000,
        responseType: 'text',
        validateStatus: (s: number) => s < 500,
      });
      res.json({ valid: r.status < 400, error: r.status >= 400 ? 'Invalid token' : undefined });
    } catch { res.json({ valid: false, error: 'Verification failed' }); }
  });

  router.post('/api/verify/rpdb', async (req, res) => {
    const key = req.body && typeof req.body.key === 'string' ? req.body.key : '';
    if (!key) return res.json({ valid: false, error: 'Missing key' });
    try {
      const axios = require('axios');
      const r = await axios.get(`https://api.ratingposterdb.com/${encodeURIComponent(key)}/isValid`, { timeout: 5000 });
      res.json({ valid: r.data?.valid === true, error: r.data?.valid !== true ? 'Invalid key' : undefined });
    } catch { res.json({ valid: false, error: 'Verification failed' }); }
  });

  router.post('/api/verify/omdb', async (req, res) => {
    const key = req.body && typeof req.body.key === 'string' ? req.body.key : '';
    if (!key) return res.json({ valid: false, error: 'Missing key' });
    try {
      const axios = require('axios');
      const r = await axios.get('https://www.omdbapi.com/', {
        params: { apikey: key, i: 'tt0133093', plot: 'short' },
        timeout: 5000,
      });
      res.json({ valid: r.data?.Response !== 'False', error: r.data?.Error || 'Invalid key' });
    } catch { res.json({ valid: false, error: 'Verification failed' }); }
  });

  router.post('/api/verify/fanart', async (req, res) => {
    const key = req.body && typeof req.body.key === 'string' ? req.body.key : '';
    if (!key) return res.json({ valid: false, error: 'Missing key' });
    try {
      const axios = require('axios');
      const r = await axios.get('https://webservice.fanart.tv/v3/movies/550', {
        params: { api_key: key },
        timeout: 5000,
      });
      res.json({ valid: r.status === 200 && r.data?.name != null, error: r.status !== 200 ? 'Invalid key' : undefined });
    } catch { res.json({ valid: false, error: 'Verification failed' }); }
  });

  // TheTVDB v4 key verify: exchange the key for a session token. TVDB is used
  // only by the background identity worker (better series matching + episode
  // data), never on a Nuvio request path.
  router.post('/api/verify/tvdb', async (req, res) => {
    const key = req.body && typeof req.body.key === 'string' ? req.body.key.trim() : '';
    if (!key) return res.json({ valid: false, error: 'Missing TVDB API key' });
    try {
      const { tvdbVerifyKey } = require('../library/identity/providers.ts');
      const ok = await tvdbVerifyKey(key);
      res.json(ok ? { valid: true } : { valid: false, error: 'Invalid TVDB API key' });
    } catch (err) {
      const detail = err as any;
      const status = err && detail.status;
      res.json({ valid: false, error: status === 401 || status === 403 ? 'Invalid TVDB API key' : 'Could not reach TheTVDB: try again' });
    }
  });

  // BetterPosters (btttr.cc) has no API key: this just confirms the service is
  // reachable so the configure page can surface it as available.
  router.post('/api/verify/betterposter', async (req, res) => {
    try {
      const axios = require('axios');
      const r = await axios.get('https://btttr.cc/poster/imdb/poster-default/tt0114709.jpg', {
        timeout: 8000,
        responseType: 'arraybuffer',
        validateStatus: (s: number) => s < 500,
      });
      res.json({ valid: r.status === 200 && (r.headers['content-type'] || '').includes('image'), error: r.status !== 200 ? 'Service unavailable' : undefined });
    } catch { res.json({ valid: false, error: 'Could not reach btttr.cc: try again' }); }
  });

  // MDBList key verify: GET /user with the apikey; valid when the account
  // object comes back with a username.
  router.post('/api/verify/mdblist', async (req, res) => {
    try {
      const axios = require('axios');
      const key = (req.body && req.body.key || '').trim();
      if (!key) return res.json({ valid: false, error: 'Missing MDBList API key' });
      const r = await axios.get('https://api.mdblist.com/user', {
        params: { apikey: key },
        timeout: 8000,
        validateStatus: (s: number) => s < 500,
      });
      const d = r.data || {};
      if (d.error) return res.json({ valid: false, error: 'Invalid MDBList key' });
      res.json({ valid: !!d.username || !!d.id, username: d.username || null, error: !d.username && !d.id ? 'Could not verify MDBList key' : undefined });
    } catch { res.json({ valid: false, error: 'Could not reach MDBList: try again' }); }
  });

  // ── SEO: sitemap.xml (instance file, lives in frontend/public) ──
  // Served from the frontend source tree when present on this instance (dev +
  // prod via deploy, which carries the whole tree). Self-hosted installs
  // without the file 404 cleanly instead of serving prod URLs.
  router.get('/sitemap.xml', (req: Request, res: Response) => {
    const page = path.join(ROOT_DIR, 'frontend', 'public', 'sitemap.xml');
    if (!fs.existsSync(page)) return res.status(404).type('text/plain').send('Not found');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(page);
  });

  // Setup edit pages (/:uuid): the React app. UUIDs are shaped, so this can
  // never swallow an addon protocol route — anything else falls through to
  // the addon handlers and the 404 below. Without a frontend build, unknown
  // ids fall through to the 404 as well.
  router.get('/:uuid', (req: Request, res: Response, next: NextFunction) => {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(req.params.uuid))) return next();
    setSelfhostAccessCookie(req, res);
    if (serveShell(res)) return;
    return next();
  });

  // ── Error pages ──────────────────────────────────────────
  // 404 catch-all for unmatched routes: but let addon/API routes that are
  // defined in app.ts after this router fall through (preview, catalogs).
  router.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    // /app/* deep links redirect to the root IA in app.ts (after the addon
    // routes and the /app asset mount), so they fall through here.
    if (req.path === '/app' || req.path.startsWith('/app/')) return next();
    // The addon's base manifest (no token) is registered after this router.
    if (req.path === '/manifest.json') return next();
    if (/^\/[^\/]+\/(?:i\/[a-z0-9-]+\/)?(preview|manifest|catalog|meta|stream|knaben|collections|nuvio-collections|custom-streams|pictorium|erdb|library)\b/.test(req.path)) return next();
    serveErrorPage(res, req, 404, 'Page Not Found', ERROR_DESCRIPTIONS[404]);
  });

  // Express error handler: catches thrown errors in async routes.
  // Over-limit bodies (entity.too.large) get a plain-English 413 instead of
  // the misleading generic 500 so the configure page can tell the user what
  // to trim. Failures are logged with status + size only, never body content.
  router.use((err: any, req: any, res: any, _next: any) => {
    const status = err && (err.status === 413 || err.type === 'entity.too.large') ? 413 : 500;
    const len = req.headers['content-length'] || '?';
    console.error(`[Web] ${req.method} ${req.path.replace(/^\/[^/]{16,}\//, '/[token]/')} → ${status}:`, err.message || err, `(body ${len}B)`);
    if (status === 413) {
      const wantsJson = (req.headers.accept || '').includes('application/json')
        || (req.originalUrl || '').startsWith('/api/');
      if (wantsJson) {
        return res.status(413).json({ error: 'Configuration too large to save. Try removing a pasted collections import or custom streams, then push again.' });
      }
      return serveErrorPage(res, req, 413, 'Configuration Too Large', 'That configuration was too large to save. Try removing a pasted collections import and pushing again.');
    }
    serveErrorPage(res, req, 500, 'Internal Server Error', ERROR_DESCRIPTIONS[500]);
  });

  return router;
}

// Where a token-scoped /:token/configure link lands. v5.5 setups are edited
// at their own UUID (password gate, tier surface); legacy self-contained
// tokens import through the setup flow; unresolvable tokens get null so the
// caller can 400 as before.
function configureRedirectTarget(config: unknown): string | null {
  if (!config || typeof config !== 'object') return null;
  const scope = (config as { __configScope?: unknown }).__configScope;
  if (scope && typeof scope === 'object') {
    const { type, uuid } = scope as { type?: unknown; uuid?: unknown };
    if (type === 'config' && typeof uuid === 'string' && uuid) return `/${uuid}`;
  }
  return '/configure';
}

export interface WebsiteRouterApi {
  (resolveConfig: any, options?: any): Router;
  configureRedirectTarget(config: unknown): string | null;
}

module.exports = Object.assign(createWebRoutes, { configureRedirectTarget }) satisfies WebsiteRouterApi;
