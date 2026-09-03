const path = require('path');
const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const { decodeConfig } = require('../src/config/token');

const WEBSITE_DIR = path.resolve(__dirname);
const PUBLIC_DIR = path.join(WEBSITE_DIR, 'public');
const ROOT_DIR = path.resolve(__dirname, '..');
// Private V5 account area (gitignored). Absent on self-hosted installs.
const ACCOUNTS_WEB_DIR = path.join(ROOT_DIR, 'src', 'accounts', 'web');
const ACCOUNT_UI_PRESENT = fs.existsSync(ACCOUNTS_WEB_DIR);

// Simple in-memory rate limiter (per IP, website only: addon untouched)
const rateLimitBuckets = new Map();
function rateLimit({ windowMs = 60000, max = 30 } = {}) {
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    let bucket = rateLimitBuckets.get(ip);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      rateLimitBuckets.set(ip, bucket);
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
function scriptSafeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function serveErrorPage(res, req, code, title, desc) {
  const reqPath = req.originalUrl || req.path || '/';
  const wantsJson = (req.headers.accept || '').includes('application/json')
    || reqPath.startsWith('/api/')
    || reqPath.startsWith('/:token');
  if (wantsJson) {
    return res.status(code).json({ error: desc || title });
  }
  if (!ERROR_PAGE_HTML) {
    return res.status(code).send(code + ' ' + title);
  }
  const html = ERROR_PAGE_HTML
    .replace('</head>', `<script>window.__ERROR_CODE__=${code};window.__ERROR_TITLE__=${scriptSafeJson(title)};window.__ERROR_DESC__=${scriptSafeJson(desc || '')};window.__ERROR_PATH__=${scriptSafeJson(reqPath)};</script></head>`);
  res.status(code).send(html);
}

// All functional website routes (pages, proxies, verify, status, scrapers,
// clear-cache). Shared by the private website/index.js (serves the private
// landing page) and the public website/index.example.js (redirects / to the
// configure page) so self-hosters get the same API surface.
function createWebRoutes(resolveConfig, options = {}) {
  const router = express.Router();
  const hosted = options.hosted || null;
  const ACCOUNTS_AVAILABLE = !!hosted && ACCOUNT_UI_PRESENT;
  const SELFHOST_SECRET = String(process.env.SELFHOST_CONFIGS_SECRET || '');
  const SELFHOST_COOKIE = 'lelibrary_selfhost_access';
  const selfhostCookieValue = SELFHOST_SECRET
    ? crypto.createHmac('sha256', SELFHOST_SECRET).update('lelibrary-selfhost-configs').digest('hex')
    : '';
  function setSelfhostAccessCookie(req, res) {
    if (ACCOUNTS_AVAILABLE || !SELFHOST_SECRET) return;
    const secure = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SELFHOST_COOKIE}=${selfhostCookieValue}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict${secure}`);
  }
  router.use(express.json());
  router.use(express.urlencoded({ extended: true }));

  // Nuvio imports these once per profile. Image URLs must be absolute HTTPS
  // URLs because Nuvio fetches them from another device, not this browser.
  function publicBaseUrl(req) {
    const host = String(req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
    return `https://${host}`;
  }
  router.get('/api/nuvio-badges/lelibrary-premium.json', (req, res) => {
    const badges = require('../src/nuvio-badges');
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.json(badges.manifest(publicBaseUrl(req)));
  });
  router.get('/api/nuvio-badges/lelibrary-premium/:id.svg', (req, res) => {
    const svg = require('../src/nuvio-badges').badgeSvg(req.params.id);
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
        const svg = require('../src/nuvio-badges').badgeSvg(id);
        if (!svg) return res.status(404).type('text/plain').send('Unknown badge');
        png = await require('sharp')(Buffer.from(svg)).png().toBuffer();
        if (badgePngCache.size > 100) badgePngCache.clear();
        badgePngCache.set(id, png);
      }
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.type('image/png').send(png);
    } catch (err) {
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
  function isPublicIpAddress(address) {
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
  async function pinPublicLookup(target) {
    const hostname = target.hostname.replace(/^\[|\]$/g, '');
    const records = net.isIP(hostname)
      ? [{ address: hostname, family: net.isIP(hostname) }]
      : await dns.lookup(hostname, { all: true, verbatim: true });
    if (!records.length || records.some(({ address }) => !isPublicIpAddress(address))) {
      throw new Error('That URL resolves to a private or non-public network.');
    }
    const { address, family } = records[0];
    return (_hostname, _options, callback) => callback(null, address, family);
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
        validateStatus: (status) => status >= 200 && status < 300,
      });
      if (!response.data || typeof response.data !== 'object') throw new Error('The URL did not return a JSON object.');
      res.json(response.data);
    } catch (err) {
      res.status(err.message && err.message.includes('private') ? 400 : 502)
        .json({ error: `Could not fetch that JSON: ${err.response?.status || err.message}` });
    }
  });

  // Nuvio's public community catalogue is authenticated and does not expose
  // CORS to third-party sites. This deliberately narrow proxy accepts only a
  // caller's current Nuvio session, forwards only read-only community list or
  // detail requests, and never logs, stores or returns that session token.
  function nuvioCommunityToken(req) {
    const token = String(req.get('x-nuvio-access-token') || '').trim();
    return token.length >= 20 && token.length <= 8192 && !/[\r\n]/.test(token) ? token : '';
  }
  function nuvioCommunityError(res, err) {
    const status = Number(err.response?.status || 0);
    if (status === 401 || status === 403) return res.status(401).json({ error: 'Your Nuvio session has expired. Reconnect Nuvio and try again.' });
    return res.status(502).json({ error: 'Could not load Nuvio public collections right now.' });
  }
  function nuvioCommunityHeaders(token) {
    return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  }
  router.get('/api/nuvio-community/collections', rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
    const token = nuvioCommunityToken(req);
    if (!token) return res.status(401).json({ error: 'Connect Nuvio before browsing public collections.' });
    const sort = ['recent', 'popular', 'installed'].includes(String(req.query.sort)) ? String(req.query.sort) : 'popular';
    const type = ['all', 'pack', 'individual'].includes(String(req.query.type)) ? String(req.query.type) : 'all';
    const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 100);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 48);
    const search = String(req.query.search || '').trim().slice(0, 120);
    try {
      const axios = require('axios');
      const response = await axios.get('https://nuvio.tv/api/community-collections', {
        headers: nuvioCommunityHeaders(token),
        params: { sort, type, page, limit, ...(search ? { search } : {}) },
        timeout: 20000,
        maxContentLength: 5 * 1024 * 1024,
        validateStatus: status => status >= 200 && status < 300,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json(response.data);
    } catch (err) {
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
        maxContentLength: 5 * 1024 * 1024,
        validateStatus: status => status >= 200 && status < 300,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json(response.data);
    } catch (err) {
      nuvioCommunityError(res, err);
    }
  });

  // Curated Nuvio packs are consumed by the public Configure page, so this
  // route must live in the shared website router. Routes declared later in
  // app.js are unreachable after this router's 404 fallback runs.
  router.get('/api/curated-collections', (req, res) => {
    try {
      const curated = require('../src/curated-collections');
      const validation = curated.validateCuratedCollections();
      if (!validation.ok) return res.status(500).json({ error: 'Invalid curated collections', details: validation.errors });
      res.json({ collections: curated.listCuratedCollections(), ...validation });
    } catch (err) {
      res.status(500).json({ error: 'Could not load curated collections' });
    }
  });

  // Catalogue library metadata is also consumed by the public Configure page.
  // Keep it in this router so it runs before the website 404 fallback.
  router.get('/api/catalog-library', (req, res) => {
    try {
      const { listSources, validateSourceDefinitions } = require('../src/catalog-source-registry');
      const validation = validateSourceDefinitions();
      if (!validation.ok) return res.status(500).json({ error: 'Invalid catalogue source registry', details: validation.errors });
      res.json({ catalogs: listSources(), total: validation.total });
    } catch (err) {
      res.status(500).json({ error: 'Could not load catalogue library' });
    }
  });

  // Config-store routes must also live here: app.js mounts this router before
  // its addon routes, and the router has a 404 fallback at the end.
  router.post('/api/save-config', rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
    try {
      const config = req.body && req.body.config;
      if (!config || typeof config !== 'object') return res.status(400).json({ error: 'Missing config' });
      const providers = require('../src/providers');
      const tokenId = req.body && req.body.token;
      let configForStore = config;
      let ownershipVerified = false;
      if (typeof tokenId === 'string' && tokenId && tokenId.length <= 64 && !decodeConfig(tokenId) && hosted?.saveTokenConfig) {
        if (!(await hosted.ownsOpaqueToken(req, tokenId))) {
          return res.status(403).json({ error: 'Sign in to the account that owns this saved setup before changing it.' });
        }
        await hosted.saveTokenConfig(tokenId, config).catch((err) => console.error('[token] saveTokenConfig failed:', err.message));
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
        const turnstile = require('../src/turnstile');
        if (turnstile.turnstileConfigured()) {
          const verdict = await turnstile.verifyTurnstile(req.body && req.body['cf-turnstile-response'], {
            action: 'save-config',
            remoteip: req.ip,
          });
          if (!verdict.ok) return res.status(403).json({ error: 'Bot check failed. Reload the page and try again.' });
        }
      }
      const userKey = await require('../src/configstore').saveStreamSettings(configForStore);
      if (!userKey) return res.status(400).json({ error: 'Config has no usable API keys' });
      res.json({ ok: true, userKey });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/config/:token', rateLimit({ windowMs: 60000, max: 60 }), async (req, res) => {
    try {
      if (!decodeConfig(req.params.token) && (!hosted?.ownsOpaqueToken || !(await hosted.ownsOpaqueToken(req, req.params.token)))) {
        return res.status(403).json({ error: 'Sign in to the account that owns this saved setup before viewing it.' });
      }
      const config = await resolveConfig(req.params.token);
      if (!config) return res.status(400).json({ error: 'Invalid token' });
      const providers = require('../src/providers');
      const userKey = providers.getUserKey(config);
      const stored = userKey ? await require('../src/configstore').loadStreamSettings(config) : null;
      res.json(stored || null);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The provider status page is a PRIVATE file (website/status.html is gitignored,
  // only present on the hosted instance). Without it there is no status page to
  // serve, so self-hosters get no provider status checks at all: no background
  // 60s ping loop and no on-demand /api/status pings (the route returns a
  // placeholder). This keeps self-hosted instances from making pointless
  // outbound requests to every debrid provider every minute.
  const HAS_STATUS_PAGE = fs.existsSync(path.join(WEBSITE_DIR, 'status.html'));

  // ── Page routes (BEFORE static to avoid immutable caching) ──

  // Landing page (private file: only served when present)
  if (options.landing) {
    router.get('/', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(WEBSITE_DIR, 'landing.html'));
    });
  } else {
    router.get('/', (req, res) => {
      res.redirect('/configure');
    });
  }

  // Configure page
  router.get('/configure', async (req, res) => {
    // Convenience alias: /configure?token=<token> → /<token>/configure. The
    // configure route lives at /<token>/configure, but users who have copied a
    // manifest URL sometimes paste the token the wrong way round, so accept
    // both. Invalid/absent tokens fall through to the blank form.
    if (req.query.token && req.query.token !== 'configure') {
      const config = await resolveConfig(req.query.token);
      if (config) return res.redirect('/' + req.query.token + '/configure');
    }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    setSelfhostAccessCookie(req, res);
    // Flag whether the hosted account area exists so the page can hide
    // account-only nav/links on self-hosted installs.
    const html = fs.readFileSync(path.join(WEBSITE_DIR, 'configure.html'), 'utf8');
    const injected = html.replace(
      '</head>',
      `<script>window.__HOSTED__ = ${ACCOUNTS_AVAILABLE ? 'true' : 'false'};window.__TURNSTILE_SITE_KEY__ = ${scriptSafeJson(require('../src/turnstile').turnstileSiteKey())};</script></head>`
    );
    res.send(injected);
  });

  // Same convenience alias the other way round: /configure/<token> (the natural
  // guess for a user who has a token and is told "open the configure page").
  router.get('/configure/:token', async (req, res) => {
    if (!(await resolveConfig(req.params.token))) return res.status(400).send('Invalid token');
    res.redirect('/' + req.params.token + '/configure');
  });

  // ── V5 account area (private, gitignored: src/accounts/web) ──
  // All account pages live under src/accounts/. Self-hosters don't get the
  // folder, so every route here 404s or redirects cleanly for them.

  // Account dashboard (V5 sign-in + overview). Not signed in → show the sign-in
  // page (the dashboard itself is the login screen), never a raw 200 page.
  router.get('/account/login', async (req, res) => {
    if (!ACCOUNTS_AVAILABLE) return res.redirect('/configure');
    try {
      if (await hosted?.isSignedIn?.(req)) {
        const next = typeof req.query.next === 'string' && (req.query.next.startsWith('/account/') || req.query.next.startsWith('/accounts/') || req.query.next === '/configure') ? req.query.next : '/account';
        return res.redirect(302, next);
      }
    } catch {}
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(ACCOUNTS_WEB_DIR, 'account.html'));
  });

  router.get('/account', async (req, res) => {
    if (!ACCOUNTS_AVAILABLE) return res.redirect('/configure');
    try {
      if (!(await hosted?.isSignedIn?.(req))) return res.redirect(302, '/account/login');
    } catch { return res.redirect('/configure'); }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(ACCOUNTS_WEB_DIR, 'account.html'));
  });

  router.get('/account/tokens', async (req, res) => {
    if (!ACCOUNTS_AVAILABLE) return res.redirect('/configure');
    try {
      if (!(await hosted?.isSignedIn?.(req))) return res.redirect(302, '/account/login?next=' + encodeURIComponent('/account/tokens'));
    } catch { return res.redirect('/configure'); }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.sendFile(path.join(ACCOUNTS_WEB_DIR, 'tokens.html'));
  });

  // Account collections manager (V5 Collections / Home Rows). Requires sign-in:
  // not signed in → redirect to the account sign-in page.
  router.get('/account/collections', async (req, res) => {
    if (!ACCOUNTS_AVAILABLE) return res.redirect('/configure');
    try {
      const session = await hosted?.isSignedIn?.(req);
      if (!session) {
        return res.redirect(302, '/account/login?next=' + encodeURIComponent('/account/collections'));
      }
    } catch (err) {
      return res.redirect('/configure');
    }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(ACCOUNTS_WEB_DIR, 'collections.html'));
  });

  router.get('/account/collections/wizard', async (req, res) => {
    if (!ACCOUNTS_AVAILABLE) return res.redirect('/configure');
    try {
      const session = await hosted?.isSignedIn?.(req);
      if (!session) return res.redirect(302, '/account/login?next=' + encodeURIComponent('/account/collections/wizard'));
    } catch { return res.redirect('/configure'); }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(ACCOUNTS_WEB_DIR, 'wizard.html'));
  });

  // Premium wizard per-token — no password lock, owner-only (see plan)
  async function serveWizard(req, res) {
    const token = String(req.params.token || '');
    if (!ACCOUNTS_AVAILABLE) return res.redirect(302, `/${encodeURIComponent(token)}/configure`);
    if (decodeConfig(token)) return res.redirect(302, `/${encodeURIComponent(token)}/configure`);
    let signedIn = false;
    try { signedIn = !!(await hosted?.isSignedIn?.(req)); } catch {}
    if (!signedIn) {
      const next = `/accounts/collections/${encodeURIComponent(token)}/configure`;
      return res.redirect(302, `/account/login?next=${encodeURIComponent(next)}`);
    }
    if (!(await hosted?.ownsSavedCollectionSetup?.(req, token))) {
      return serveErrorPage(res, req, 403, 'Access restricted', 'This collection setup is not attached to one of your saved collection profiles.');
    }
    const config = await resolveConfig(token);
    if (!config) return res.status(400).send('Invalid token');
    // The wizard route belongs to profiles created in the Collections wizard.
    // A classic token opened here belongs on the classic account page.
    if (config.wizard !== true) {
      return res.redirect(302, `/accounts/${encodeURIComponent(token)}/configure`);
    }
    // Collection-wizard setups always own an isolated context.  Some early
    // setups predate the field in their persisted token config, and this page
    // is the browser's source of truth on first load, so make the migration
    // explicit here as well as in the opaque-token resolver.
    if (config.collection_setup === true && !config.importDraftProfileId) {
      config.importDraftProfileId = `setup-${token}`;
    }
    const html = fs.readFileSync(path.join(ACCOUNTS_WEB_DIR, 'wizard.html'), 'utf8');
    const safeJson = JSON.stringify(config).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
    const injected = html.replace('</head>', `<script>window.__WIZARD_TOKEN__=${JSON.stringify(token)}; window.__INITIAL_CONFIG__=${safeJson}; window.__HOSTED__ = ${ACCOUNTS_AVAILABLE ? 'true' : 'false'};</script></head>`);
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(injected);
  }
  router.get('/accounts/collections/:token/configure', serveWizard);
  router.get('/account/collections/:token/configure', (req, res) => res.redirect(302, `/accounts/collections/${encodeURIComponent(req.params.token)}/configure`));

  // Retired setup entry point kept as a compatibility redirect.
  router.get('/account/setup', async (req, res) => {
    res.redirect(302, '/account/collections');
  });

  // Account settings (keys, tokens, watchlists, connects). Requires sign-in:
  // not signed in → redirect to the account sign-in page.
  router.get('/account/settings', async (req, res) => {
    if (!ACCOUNTS_AVAILABLE) return res.redirect('/configure');
    try {
      const session = await hosted?.isSignedIn?.(req);
      if (!session) {
        return res.redirect(302, '/account/login?next=' + encodeURIComponent('/account/settings'));
      }
    } catch (err) {
      return res.redirect('/configure');
    }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(ACCOUNTS_WEB_DIR, 'account-settings.html'));
  });

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
  function selfhostAuthorized(req) {
    if (!SELFHOST_SECRET) return false;
    if (String(req.get('x-selfhost-secret') || '') === SELFHOST_SECRET) return true;
    const cookies = String(req.get('cookie') || '').split(';').map(v => v.trim());
    const cookie = cookies.find(v => v.startsWith(`${SELFHOST_COOKIE}=`));
    const value = cookie ? cookie.slice(SELFHOST_COOKIE.length + 1) : '';
    return value.length === selfhostCookieValue.length && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(selfhostCookieValue));
  }
  function redactConfig(config) {
    if (!config || typeof config !== 'object' || SELFHOST_SECRET) return config;
    const clean = { ...config };
    for (const k of KEY_FIELDS) delete clean[k];
    return clean;
  }
  const selfhostConfigs = () => require('../src/selfhost-configs');

  if (!ACCOUNTS_AVAILABLE) {
    router.get('/api/selfhost-configs', rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
      try {
        if (!selfhostAuthorized(req)) return res.status(401).json({ error: 'Invalid selfhost secret' });
        const rows = await selfhostConfigs().list();
        res.json({ configs: rows.map((r) => ({ ...r, config: redactConfig(r.config) })) });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    router.post('/api/selfhost-configs', rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
      if (!selfhostAuthorized(req)) return res.status(401).json({ error: 'Invalid selfhost secret' });
      const { label, config } = req.body || {};
      if (!config || typeof config !== 'object') return res.status(400).json({ error: 'Missing config' });
      try {
        const { id } = await selfhostConfigs().save({ label, config });
        res.json({ ok: true, id });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    router.delete('/api/selfhost-configs/:id', rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
      try {
        if (!selfhostAuthorized(req)) return res.status(401).json({ error: 'Invalid selfhost secret' });
        await selfhostConfigs().remove(req.params.id);
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  // Provider status page: PRIVATE page (website/status.html is gitignored, like
  // landing.html). Served only when the file exists on this instance; self-hosters
  // don't get the file, so the route redirects to the configure page instead of
  // 404ing (keeps the nav status pill pointing somewhere useful).
  router.get('/status', (req, res) => {
    const page = path.join(WEBSITE_DIR, 'status.html');
    if (!fs.existsSync(page)) return res.redirect('/configure');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(page);
  });

  // Privacy policy: PRIVATE page (website/privacy.html is gitignored, like
  // landing.html). Same pattern: served when present on this instance (the hosted
  // one), self-hosted installs redirect home instead of 404ing since they don't
  // ship the file.
  router.get('/privacy', (req, res) => {
    const page = path.join(WEBSITE_DIR, 'privacy.html');
    if (!fs.existsSync(page)) return res.redirect('/');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(page);
  });

  async function serveConfigure(req, res, accountToken, pageDir = WEBSITE_DIR) {
    const token = String(req.params.token || '');
    const config = await resolveConfig(token);
    if (!config) return res.status(400).send('Invalid token');
    setSelfhostAccessCookie(req, res);
    const html = fs.readFileSync(path.join(pageDir, accountToken ? 'account-configure.html' : 'configure.html'), 'utf8');
    let locked = false;
    try { locked = await hosted?.tokenLocked?.(token) || false; } catch { /* treat as unlocked */ }
    if (locked) {
      const injected = html.replace(
        '</head>',
        `<script>window.__HOSTED__ = ${ACCOUNTS_AVAILABLE ? 'true' : 'false'}; window.__ACCOUNT_TOKEN__ = ${accountToken ? 'true' : 'false'}; window.__TOKEN_LOCKED__ = true; window.__TOKEN_ID__ = ${JSON.stringify(token)};</script></head>`
      );
      res.setHeader('Cache-Control', 'no-cache');
      return res.send(injected);
    }
    const safeJson = JSON.stringify(config)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    const injected = html.replace(
      '</head>',
      `<script>window.__HOSTED__ = ${ACCOUNTS_AVAILABLE ? 'true' : 'false'}; window.__ACCOUNT_TOKEN__ = ${accountToken ? 'true' : 'false'}; window.__INITIAL_CONFIG__ = ${safeJson}${accountToken ? '' : `;window.__TURNSTILE_SITE_KEY__ = ${scriptSafeJson(require('../src/turnstile').turnstileSiteKey())}`};</script></head>`
    );
    res.setHeader('Cache-Control', 'no-cache');
    res.send(injected);
  }

  // Account-backed configuration has its own browser application. Keep the
  // addon engines and shared APIs below common, but never make an account UI
  // change by editing the legacy configure assets.
  const ACCOUNT_CONFIGURE_DIR = path.join(ROOT_DIR, 'src', 'accounts', 'configure');
  router.get('/accounts/configure/account-configure.css', (req, res) => {
    if (!fs.existsSync(path.join(ACCOUNT_CONFIGURE_DIR, 'account-configure.css'))) return res.sendStatus(404);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(ACCOUNT_CONFIGURE_DIR, 'account-configure.css'));
  });
  router.get('/accounts/configure/account-configure.js', (req, res) => {
    if (!fs.existsSync(path.join(ACCOUNT_CONFIGURE_DIR, 'account-configure.js'))) return res.sendStatus(404);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(ACCOUNT_CONFIGURE_DIR, 'account-configure.js'));
  });

  // Canonical account-backed Configure route. An opaque token is not a
  // shareable browser credential: a visitor must first sign in, then the
  // ownership check decides whether that account may edit it.
  router.get('/accounts/:token/configure', async (req, res) => {
    const token = String(req.params.token || '');
    if (!ACCOUNTS_AVAILABLE) return res.redirect(302, `/${encodeURIComponent(token)}/configure`);
    // A legacy self-contained token belongs on its original public route.
    if (decodeConfig(token)) return res.redirect(302, `/${encodeURIComponent(token)}/configure`);
    let signedIn = false;
    try { signedIn = !!(await hosted?.isSignedIn?.(req)); } catch { /* handled below */ }
    if (!signedIn) {
      const next = `/accounts/${encodeURIComponent(token)}/configure`;
      return res.redirect(302, `/account/login?next=${encodeURIComponent(next)}`);
    }
    if (!(await hosted?.ownsOpaqueToken?.(req, token))) {
      return serveErrorPage(res, req, 403, 'Access restricted', 'This saved setup belongs to a different LeLibrary account.');
    }
    const config = await resolveConfig(token);
    if (config?.collection_setup === true || config?.wizard === true) {
      return res.redirect(302, `/accounts/collections/${encodeURIComponent(token)}/configure`);
    }
    return serveConfigure(req, res, true, ACCOUNT_CONFIGURE_DIR);
  });

  // Configure with injected config (from Stremio addon)
  router.get('/:token/configure', async (req, res) => {
    // Legacy tokens are intentionally self-contained and remain usable from
    // the public configure flow. Opaque account tokens are different: their
    // editable setup belongs to one signed-in account, even when password
    // locking is enabled.
    const accountToken = ACCOUNTS_AVAILABLE && !decodeConfig(req.params.token);
    if (accountToken) {
      return res.redirect(302, `/accounts/${encodeURIComponent(req.params.token)}/configure`);
    }
    return serveConfigure(req, res, false);
  });

  // Wizard shared util — git-tracked, self-host safe (UMD)
  router.get('/wizard-shared.js', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.sendFile(path.join(ROOT_DIR, 'src', 'config', 'wizard-shared.js'));
  });

  // Static files from website/public (CSS, JS, images)
  router.use(express.static(PUBLIC_DIR, {
    maxAge: '30d',
    etag: true,
    immutable: true,
  }));

  // Private V5 account static assets (account.css/js + account pages). Served
  // from src/accounts/web/ so the gitignored folder stays out of the public repo.
  if (ACCOUNTS_AVAILABLE) {
    router.use(express.static(ACCOUNTS_WEB_DIR, {
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
    const userKey = require('../src/providers').getUserKey(config);
    if (!userKey) return res.status(400).json({ error: 'No API key configured' });
    try {
      const cache = require('../src/cache');
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
      require('../src/tmdb').clearCaches();
      res.json({ success: true, cleared: cleared + sharedCleared.reduce((sum, count) => sum + count, 0), message: 'Cache cleared! Refresh Stremio to see changes.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Provider status aggregator (public health checks, no user keys) ──
  // Fetches each debrid provider's public status so the status page, landing
  // page and My Library can show live uptime. A background loop re-pings every
  // 60s ("server-side ping"), so /api/status always returns fresh data without
  // a page view having to wait for live checks. Each check reports its own
  // round-trip latency (ms) for the status page.
  const STATUS_CHECKS = [
    {
      id: 'torbox',
      name: 'TorBox',
      url: 'https://status.torbox.app',
      async check(axios) {
        const t0 = Date.now();
        const r = await axios.get('https://status.torbox.app/index.json', { timeout: 8000 });
        const latency = Date.now() - t0;
        const state = r.data?.data?.attributes?.aggregate_state;
        if (state === 'operational') return { status: 'operational', detail: 'All systems operational', latency };
        if (state === 'major_outage') return { status: 'down', detail: 'Major outage reported', latency };
        return { status: 'degraded', detail: state ? state.replace(/_/g, ' ') : 'Status unknown', latency };
      },
    },
    {
      id: 'realdebrid',
      name: 'Real-Debrid',
      url: 'https://real-debrid.com',
      async check(axios) {
        const t0 = Date.now();
        await axios.get('https://api.real-debrid.com/rest/1.0/time', { timeout: 8000 });
        return { status: 'operational', detail: 'API responding normally', latency: Date.now() - t0 };
      },
    },
    {
      id: 'alldebrid',
      name: 'AllDebrid',
      url: 'https://alldebrid.com',
      async check(axios) {
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
      async check(axios) {
        const t0 = Date.now();
        await axios.get('https://premiumize.reamaze.com/status', { timeout: 8000, maxRedirects: 5 });
        return { status: 'operational', detail: 'Status page responding', latency: Date.now() - t0 };
      },
    },
  ];
  const STATUS_RANK = { operational: 0, degraded: 1, down: 2 };
  let statusCache = { at: 0, data: null };

  // Rolling uptime history (in-memory, one sample per background check).
  // Cleared on restart: the status page renders it as Uptime-Kuma-style cells.
  const HISTORY_WINDOW = 7 * 24 * 3600 * 1000; // keep 7 days of samples
  const statusHistory = new Map(); // providerId -> [{ t, status }]

  // Bucket the raw samples into Uptime-Kuma-style cells: each cell = one
  // individual 60s check beat (not an hourly/daily aggregate). This means
  // the cells update live every minute as new checks arrive.
  //   b24 = last 24 beats (~24 minutes of history)
  //   b7  = last  7 beats (~7 minutes of history)
  function aggregateHistory(history) {
    const out = { b24: [], b7: [], up24: null, up7: null };

    const last24 = history.slice(-24);
    last24.forEach(s => out.b24.push({ t: s.t, status: s.status }));

    const last7 = history.slice(-7);
    last7.forEach(s => out.b7.push({ t: s.t, status: s.status }));

    const pct = (slice) => {
      if (!slice.length) return null;
      return Math.round((slice.filter(s => s.status !== 'down').length / slice.length) * 100);
    };
    out.up24 = pct(last24);
    out.up7 = pct(last7);

    return out;
  }

  async function runStatusCheck() {
    try {
      const axios = require('axios');
      const settled = await Promise.allSettled(STATUS_CHECKS.map(p => p.check(axios)));

      const providers = STATUS_CHECKS.map((p, i) => {
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

      const overall = providers.reduce((worst, p) => {
        return (STATUS_RANK[p.status] ?? 1) > STATUS_RANK[worst] ? p.status : worst;
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
    } catch (err) {
      console.error(`[Status] background check failed: ${err.message}`);
    }
  }

  // Background "server-side ping": keep the cache warm every 60s. Only runs on
  // instances that have the private status page (HAS_STATUS_PAGE): self-hosters
  // never start it, so no background traffic to debrid providers.
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
  router.post('/api/verify/torbox', async (req, res) => {
    const key = (req.body && typeof req.body.key === 'string' ? req.body.key.trim() : '');
    if (!key) return res.json({ valid: false, error: 'Missing key' });
    try {
      const axios = require('axios');
      const r = await axios.get('https://api.torbox.app/v1/api/user/me', {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 8000,
        validateStatus: s => s < 500,
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
        validateStatus: s => s < 500,
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
      const { verifyAlldebridKey } = require('../src/providers/alldebrid');
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
      const { verifyPremiumizeKey } = require('../src/providers/premiumize');
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
        validateStatus: s => s < 500,
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

  // BetterPosters (btttr.cc) has no API key: this just confirms the service is
  // reachable so the configure page can surface it as available.
  router.post('/api/verify/betterposter', async (req, res) => {
    try {
      const axios = require('axios');
      const r = await axios.get('https://btttr.cc/poster/imdb/poster-default/tt0114709.jpg', {
        timeout: 8000,
        responseType: 'arraybuffer',
        validateStatus: s => s < 500,
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
        validateStatus: s => s < 500,
      });
      const d = r.data || {};
      if (d.error) return res.json({ valid: false, error: 'Invalid MDBList key' });
      res.json({ valid: !!d.username || !!d.id, username: d.username || null, error: !d.username && !d.id ? 'Could not verify MDBList key' : undefined });
    } catch { res.json({ valid: false, error: 'Could not reach MDBList: try again' }); }
  });

  // ── SEO: sitemap.xml (private static file, gitignored) ──
  // Served from website/sitemap.xml when present on this instance (dev +
  // prod via manual rsync, like landing.html/privacy.html). Self-hosted
  // installs without the file 404 cleanly instead of serving prod URLs.
  router.get('/sitemap.xml', (req, res) => {
    const page = path.join(WEBSITE_DIR, 'sitemap.xml');
    if (!fs.existsSync(page)) return res.status(404).type('text/plain').send('Not found');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(page);
  });

  // ── Error pages ──────────────────────────────────────────
  // 404 catch-all for unmatched routes: but let addon/API routes that are
  // defined in app.js after this router fall through (preview, catalogs).
  router.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    if (/^\/[^\/]+\/(preview|manifest|catalog|meta|stream|collections)\b/.test(req.path)) return next();
    serveErrorPage(res, req, 404, 'Page Not Found', ERROR_DESCRIPTIONS[404]);
  });

  // Express error handler: catches thrown errors in async routes
  router.use((err, req, res, _next) => {
    console.error(`[Web] ${req.method} ${req.originalUrl} error:`, err.message || err);
    serveErrorPage(res, req, 500, 'Internal Server Error', ERROR_DESCRIPTIONS[500]);
  });

  return router;
}

module.exports = createWebRoutes;
