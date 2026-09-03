const express = require('express');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const cache   = require('./src/cache');
const providers = require('./src/providers');
const { buildCatalog, buildMeta, buildStreams, populateTmdbIndexFromMetas, applyStreamNotices, libraryStreamFmtFp } = require('./src/builder');
const { buildDiscoveryCatalog, buildDiscoveryMeta, buildDiscoveryStreams, discoveryStreamKeyParts } = require('./src/discovery');
const { buildCollectionsCatalog, cacheCollections, getCollectionMeta, getCollections, getCollectionForMovie } = require('./src/collections');
const { normaliseNuvioArtwork, absoluteLocalArtwork } = require('./src/collection-artwork');
const { compileCollectionPlan } = require('./src/collection-plan');
const { buildLibraryCollection, collectionCatalogMetas } = require('./src/nuvio-library-collections');
const { searchCatalog } = require('./src/search');
const { decodeConfig } = require('./src/config/token');

let createWebRoutes = null;
try {
  const webEntry = fs.existsSync(path.join(__dirname, 'website', 'index.js'))
    ? path.join(__dirname, 'website', 'index.js')
    : path.join(__dirname, 'website', 'index.example.js');
  createWebRoutes = require(webEntry);
} catch (err) {
  console.warn(`[website] Web routes unavailable (${err.message}): addon routes only`);
}

const ROOT_DIR = path.resolve(__dirname);

// Private addon identity (gitignored). When absent: self-hosted builds: the
// addon serves a generic manifest so self-hosters never expose the official
// id or the signed Stremio registry config.
let REGISTRY = null;
try { REGISTRY = require('./src/registry'); } catch (e) { /* self-hosted build */ }

const http  = require('http');
const https = require('https');

// Simple per-IP rate limiter for the config-store routes. (This is a tiny copy
// of the one in website/index.js so the addon core doesn't depend on the
// private website file to guard these endpoints.)
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
      return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
    }
    next();
  };
}
setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [ip, b] of rateLimitBuckets) { if (b.start < cutoff) rateLimitBuckets.delete(ip); }
}, 300000).unref?.();

// Reuse TCP/TLS connections to provider APIs (TorBox, Real-Debrid, TMDB).
// axios opens a brand-new connection per request by default and each TLS
// handshake can cost 100ms–1s depending on the provider: keep-alive makes the
// repeated calls (key verify, catalog/meta/stream builds, TMDB proxy) faster.
http.globalAgent.keepAlive  = true;
https.globalAgent.keepAlive = true;

const TTL_CATALOG = parseInt(process.env.CACHE_TTL_CATALOG) || 3600;  // default 1h
const TTL_STREAM  = parseInt(process.env.CACHE_TTL_STREAM)  || 600;  // default 10min

const knownConfigs = new Map();
// Cap the map AND stop refreshing tokens that never build. Both used to be
// unbounded: every forged/junk token seen on any route was remembered forever,
// and the 2-minute loop then hammered TorBox/RD with doomed auth attempts for
// each one (slow memory leak + cheap amplification vector).
const KNOWN_CONFIGS_MAX = 500;
const knownConfigFailures = new Map(); // token → consecutive failure count
const catalogBuildInFlight = new Map(); // token → active full-library build
const ACCOUNT_REFRESH_REGISTRY_TTL = 30 * 24 * 60 * 60;
const ACCOUNT_REFRESH_REGISTRY_PREFIX = 'refresh:account-token:';
const providerRefreshSnapshots = new Map(); // provider-key hash → { at, downloads, error }
const providerRefreshInFlight = new Map();
function rememberConfig(token, config) {
  // A saved account setup can be edited while its token remains installed.
  // Always replace the in-memory snapshot so the next refresh uses the latest
  // resolved account config rather than an old copy from before that edit.
  const alreadyKnown = knownConfigs.has(token);
  if (alreadyKnown) knownConfigs.delete(token);
  while (knownConfigs.size >= KNOWN_CONFIGS_MAX) {
    // Insertion-order eviction: oldest-seen token goes first.
    const oldest = knownConfigs.keys().next().value;
    knownConfigs.delete(oldest);
    knownConfigFailures.delete(oldest);
  }
  knownConfigs.set(token, config);
  return !alreadyKnown;
}

function registerBackgroundRefresh(token, config) {
  // Opaque ids are already the account cache namespace. Persist only that
  // non-secret id, never a legacy config token (which embeds credentials), so
  // an active account install resumes its normal refresh loop after restart.
  if (HOSTED && !decodeConfig(token)) {
    cache.set(`${ACCOUNT_REFRESH_REGISTRY_PREFIX}${token}`, { active: true }, ACCOUNT_REFRESH_REGISTRY_TTL)
      .catch(() => {});
  }
  if (rememberConfig(token, config)) {
    buildAndCacheForConfig(token, config).catch(() => {});
  }
}

async function restoreAccountRefreshRegistry() {
  if (!HOSTED) return;
  const client = cache.getRedisClient();
  if (!client) return;
  let cursor = '0';
  let restored = 0;
  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', `${ACCOUNT_REFRESH_REGISTRY_PREFIX}*`, 'COUNT', 100);
    cursor = nextCursor;
    for (const key of keys.slice(0, KNOWN_CONFIGS_MAX - restored)) {
      const token = key.slice(ACCOUNT_REFRESH_REGISTRY_PREFIX.length);
      const config = await resolveConfig(token);
      if (!config) {
        await cache.del(key);
        continue;
      }
      rememberConfig(token, config);
      restored++;
    }
  } while (cursor !== '0' && restored < KNOWN_CONFIGS_MAX);
  if (restored) {
    console.log(`[Cache] Restored ${restored} active account refresh setup(s)`);
    // Do not leave restored account installs serving a pre-restart catalogue
    // for a whole polling interval.  The normal loop remains two minutes and
    // provider-key snapshots still coalesce sibling profiles, but one fresh
    // startup pass makes newly-added downloads visible as soon as the app is
    // back rather than after the first timer tick.
    await Promise.allSettled(
      [...knownConfigs.entries()].map(([token, config]) => buildAndCacheForConfig(token, config))
    );
  }
}
// Coalesce cold public-ID stream requests in this process. Stremio/Nuvio can
// issue duplicate requests while opening a detail page; without this, each one
// fans out to every selected upstream before Redis has the first result.
const publicStreamInFlight = new Map();

// Add Stremio protocol cache hints (seconds) so clients reuse data while revalidating
function withCacheHints(obj, { cacheMaxAge = 60, staleRevalidate = 60, staleError = 1800 } = {}) {
  return { ...obj, cacheMaxAge, staleRevalidate, staleError };
}

function hashShort(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function publicStreamCacheKey({ config, type, id, userKey, externalAddons, customStreams }) {
  const addonFp = ':' + hashShort([
    ...(externalAddons || []).slice().sort(),
    JSON.stringify(customStreams || []),
  ].join('|'));
  return cache.makeKey('stream', type, id, '', '', userKey + addonFp + discoveryStreamKeyParts(config).fmtFp);
}

async function getPublicStreams({ config, tmdbApiKey, type, id, lang, customStreams, userKey, externalAddons }) {
  const discKey = publicStreamCacheKey({ config, type, id, userKey, externalAddons, customStreams });
  const cached = await cache.get(discKey);
  if (cached) return { result: cached, cacheHit: true };

  let pending = publicStreamInFlight.get(discKey);
  if (!pending) {
    pending = (async () => {
      const { streams, ownedCount, externalCount } = await buildDiscoveryStreams({
        config, tmdbApiKey, type, id, lang, customStreams, userKey, externalAddons,
      });
      const result = { streams };
      const hasRealStreams = streams.some(stream => !stream._notice);
      await cache.set(discKey, result, hasRealStreams ? TTL_STREAM : 60);
      console.log(`[Stream] ${id} → ${streams.length} streams (${ownedCount} owned, ${externalCount} external)`);
      return result;
    })();
    publicStreamInFlight.set(discKey, pending);
    pending.finally(() => publicStreamInFlight.delete(discKey)).catch(() => {});
  }
  return { result: await pending, cacheHit: false };
}

// Fingerprint of poster/rating config so caches are keyed per config, not shared
function posterFp(config) {
  const { erdbToken = '', rpdbKey = '', fanartKey = '', omdbKey = '', posterProvider = '', enhanceBackground = false, enhanceLogo = false } = config;
  return hashShort([posterProvider, erdbToken, rpdbKey, fanartKey, omdbKey, enhanceBackground ? 1 : 0, enhanceLogo ? 1 : 0].join('|'));
}

const app = express();
app.disable('x-powered-by');

// Express 4 does not forward rejected promises from async handlers to the
// error middleware: one thrown error inside an async route (DB blip, crafted
// config token, provider timeout) used to become an unhandled rejection and
// terminate the whole process. Wrap every handler registered on this app so
// rejections become next(err) instead. Error middleware (4 args) is untouched,
// and already-wrapped handlers are never double-wrapped.
for (const method of ['get', 'post', 'put', 'delete', 'patch', 'use', 'all']) {
  const original = app[method].bind(app);
  app[method] = function (...args) {
    return original(...args.map(fn => {
      if (typeof fn !== 'function' || fn.length === 4 || fn._asyncWrapped) return fn;
      const wrapped = (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
      wrapped._asyncWrapped = true;
      return wrapped;
    }));
  };
}

app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Never log query strings (they used to carry API keys) or base64 config
// tokens (which contain the keys): redact long base64url-looking segments.
function maskSensitivePath(p) {
  return p.split('/').map(seg => /^[A-Za-z0-9_-]{16,}$/.test(seg) ? '[token]' : seg).join('/');
}

app.use((req, res, next) => {
  const url = req.originalUrl || req.url;
  const isAsset = /\.(css|js|png|jpg|jpeg|svg|webp|ico|webmanifest|woff2?|ttf|map)(\?|$)/i.test(url) || url.startsWith('/img/');
  if (!isAsset) console.log(`[REQ] ${req.method} ${maskSensitivePath(req.path)}`);
  next();
});

// Security headers (accounts pages + API). Deliberately additive: the addon's
// catalog/meta/stream responses stay untouched.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Report CSP violations on browser documents while we tune the policy.
  // Addon JSON responses (including Nuvio/Stremio catalog, meta and stream
  // routes) are deliberately excluded and remain protocol-compatible.
  const requestPath = req.path || '';
  const browserPage = req.method === 'GET'
    && (req.headers.accept || '').includes('text/html')
    && (requestPath === '/' || requestPath === '/privacy' || requestPath === '/status'
      || requestPath === '/configure' || requestPath.startsWith('/account') || requestPath.startsWith('/accounts/'));
  if (browserPage) {
    res.setHeader('Content-Security-Policy-Report-Only', [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self' https://github.com https://accounts.google.com",
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://challenges.cloudflare.com https://api.nuvio.tv https://api.strem.io https://api.github.com https://raw.githubusercontent.com https://oauth2.googleapis.com https://openidconnect.googleapis.com",
      "frame-src 'self' https://challenges.cloudflare.com",
    ].join('; '));
  }
  next();
});

// ── V5 Accounts (OAuth sign-in, sessions, CSRF, profile, saved tokens) ──
// Lives in src/accounts/ (gitignored: private to the hosted instance; absent
// on self-hosted installs). Mounted before the website routes so
// /api/account/* and /api/oauth/* win. Safe when unconfigured: the addon keeps
// running in token-only mode.
let HOSTED = null;
try { HOSTED = require('./src/hosted'); } catch (e) { /* self-hosted: no hosted extension */ }
if (HOSTED) {
  app.use(HOSTED.createAccountsRouter());
  // Run the Postgres migrations lazily: never blocks startup, and if the DB
  // is down the app keeps working in legacy token-only mode.
  HOSTED.ensureMigrated();
  // Start 24-hour session cleanup interval.
  HOSTED.startSessionCleanup();
}

// Keep the container health endpoint ahead of the website router's final 404
// handler. This endpoint is public and contains no user configuration.
app.get('/health', async (req, res) => {
  // Keep Docker liveness independent of Redis statistics and upstream work.
  // A slow provider must never make the whole addon look dead.
  res.json({ status: 'ok', version: '5.0.0' });
});

// A deliberately empty URL used only to let Nuvio render informational stream
// rows. It is not media and returns no content if someone selects the notice.
app.get('/stream-notice', (req, res) => res.status(204).end());

// Proxy TMDB images to avoid CORS blocking (must be BEFORE web routes so the
// router's 404 catch-all does not intercept image requests)
const axiosImg = require('axios');
app.get('/img/tmdb/*', async (req, res) => {
  try {
    const tmdbPath = req.params[0];
    if (!/^(?:w\d+|original)\/[A-Za-z0-9_.-]+\.(?:jpe?g|png|webp)$/i.test(tmdbPath)) {
      return res.status(400).end();
    }
    const url = `https://image.tmdb.org/t/p/${tmdbPath}`;
    const resp = await axiosImg.get(url, {
      responseType: 'arraybuffer',
      maxContentLength: 10 * 1024 * 1024,
      maxBodyLength: 10 * 1024 * 1024,
      headers: { 'User-Agent': 'LeLibrary/2.0' },
      timeout: 10000,
    });
    res.setHeader('Content-Type', resp.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.send(Buffer.from(resp.data));
  } catch (err) {
    console.error('[IMG PROXY]', err.message);
    res.status(502).end();
  }
});

// ── Website routes (landing, configure, library, discover, proxies) ──
if (createWebRoutes) app.use(createWebRoutes(resolveConfig, { hosted: HOSTED }));

// ── Server-side config store (stream settings) ──
// Lives HERE (git-tracked, auto-deployed) rather than in the private
// website/index.js so the addon never depends on a manually-synced file for
// the custom formatter / stream addon settings to work. The configure page
// saves the heavy stream settings keyed by the user's stable hash; the addon
// merges them back on every stream/meta request.
app.post('/api/save-config', rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
  try {
    const config = req.body && req.body.config;
    if (!config || typeof config !== 'object') return res.status(400).json({ error: 'Missing config' });
    // For an opaque account token, persist the full (key-stripped) config so the
    // saved install URL picks up edits without re-pushing. Legacy base64 tokens
    // carry the config themselves: nothing to store.
    const tokenId = req.body && req.body.token;
    let configForStore = config;
    let ownershipVerified = false;
    if (typeof tokenId === 'string' && tokenId && tokenId.length <= 64 && !decodeConfig(tokenId)) {
      if (!HOSTED || !(await HOSTED.ownsOpaqueToken(req, tokenId))) {
        return res.status(403).json({ error: 'Sign in to the account that owns this saved setup before changing it.' });
      }
      if (HOSTED) await HOSTED.saveTokenConfig(tokenId, config).catch((err) => {
        console.error('[token] saveTokenConfig failed:', err.message);
      });
      configForStore = await resolveConfig(tokenId) || config;
      // Ownership just passed a session check: the account area's push and
      // install flows skip the bot gate below untouched.
      ownershipVerified = true;
    }
    // Turnstile bot gate (managed, invisible): mirrors the website router's
    // /api/save-config handler so both stay in agreement. Anonymous/legacy
    // saves require a fresh token once TURNSTILE_SECRET + TURNSTILE_HOSTNAMES
    // are set; unconfigured instances proceed exactly as before.
    if (!ownershipVerified) {
      const turnstile = require('./src/turnstile');
      if (turnstile.turnstileConfigured()) {
        const verdict = await turnstile.verifyTurnstile(req.body && req.body['cf-turnstile-response'], {
          action: 'save-config',
          remoteip: req.ip,
        });
        if (!verdict.ok) return res.status(403).json({ error: 'Bot check failed. Reload the page and try again.' });
      }
    }
    const userKey = await require('./src/configstore').saveStreamSettings(configForStore);
    if (!userKey) return res.status(400).json({ error: 'Config has no usable API keys' });
    // Keep Configure and account Configure on the one catalogue cache path.
    // An install explicitly waits for this work so its new Nuvio folders are
    // ready on first open. Ordinary background saves remain responsive.
    const warmer = require('./src/collection-cache-warm');
    const waitForWarm = req.body?.warmCollections === true;
    const warm = warmer.warmConfiguredLibraryCatalogs(configForStore);
    const warmResult = waitForWarm
      ? await warm
      : (warm.catch((err) => console.warn('[Collection cache] Background warm failed:', err.message)), null);
    res.json({ ok: true, userKey, ...(warmResult ? { collectionCache: warmResult } : {}) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Return the server-side stream settings for a token's user so the configure
// form can pre-fill them even when the token itself is missing them.
app.get('/api/config/:token', rateLimit({ windowMs: 60000, max: 60 }), async (req, res) => {
  if (!decodeConfig(req.params.token) && (!HOSTED || !(await HOSTED.ownsOpaqueToken(req, req.params.token)))) {
    return res.status(403).json({ error: 'Sign in to the account that owns this saved setup before viewing it.' });
  }
  const config = await resolveConfig(req.params.token);
  if (!config) return res.status(400).json({ error: 'Invalid token' });
  try {
    const userKey = providers.getUserKey(config);
    const stored = userKey ? await require('./src/configstore').loadStreamSettings(config) : null;
    res.json(stored || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Catalog library metadata (for the configure page picker) ──
// Exposes the 451 catalog definitions (id, name, type, group, icon) so the
// configure page can render the picker without shipping the whole table. No
// params (ids/keys) are exposed: just the display metadata.
app.get('/api/catalog-library', async (req, res) => {
  try {
    const { listSources, validateSourceDefinitions } = require('./src/catalog-source-registry');
    const validation = validateSourceDefinitions();
    if (!validation.ok) throw new Error(`Invalid catalog source registry: ${validation.errors.join('; ')}`);
    res.json({ catalogs: listSources(), total: validation.total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Curated one-click packs for the Collections Wizard. The source ids within
// each pack are validated by the server before being exposed to the UI.
app.get('/api/catalog-quick-picks', (req, res) => {
  const { listQuickPicks, validateQuickPicks } = require('./src/catalog-quick-picks');
  const validation = validateQuickPicks();
  if (!validation.ok) return res.status(500).json({ error: 'Invalid quick picks', details: validation.errors });
  res.json({ quickPicks: listQuickPicks(), total: validation.total });
});

// Shared Nuvio collection packs. Public because /configure is available to
// self-hosters; the private Account area consumes the same registry.
app.get('/api/curated-collections', (req, res) => {
  const curated = require('./src/curated-collections');
  const validation = curated.validateCuratedCollections();
  if (!validation.ok) return res.status(500).json({ error: 'Invalid curated collections', details: validation.errors });
  res.json({ collections: curated.listCuratedCollections({ hideAnime: req.query.hideAnime === 'true' }), ...validation });
});

// ── Addon core routes ───────────────────────────────────────────────

// The configure page encodes tokens with SHORT field names (see
// website/public/token-map.js) to keep the install URL small. Decode maps them
// back to the canonical names here so every downstream consumer reads full keys
//: old tokens that still use full names pass through unchanged.

// Resolve a token to a config. Legacy base64 tokens decode directly; opaque
// V5 token ids (random ids pointing at a saved account token) are looked up in
// Postgres, where the user's saved provider keys are folded back in. This keeps
// every install link working across the migration.
async function resolveConfig(token) {
  const legacy = decodeConfig(token);
  if (legacy) {
    Object.defineProperty(legacy, '__configScope', {
      value: { type: 'legacy' }, enumerable: false, configurable: true,
    });
    return legacy;
  }
  if (!token || typeof token !== 'string' || token.length > 64) return null;
  try {
    const config = await HOSTED?.resolveOpaqueToken?.(token) || null;
    if (config && typeof config === 'object') {
      Object.defineProperty(config, '__configScope', {
        value: { type: 'account', token }, enumerable: false, configurable: true,
      });
    }
    return config;
  } catch (err) {
    console.error('[token] opaque resolve failed:', err.message);
    return null;
  }
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function parseExtra(str) {
  const extra = {};
  if (!str || typeof str !== 'string' || str.length > 512) return extra;
  try {
    str.split('&').forEach(pair => {
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const key = safeDecode(pair.slice(0, eq));
        const val = safeDecode(pair.slice(eq + 1));
        if (key.length < 50 && val.length < 200) extra[key] = val;
      }
    });
  } catch { /* malformed input: ignore and return what we parsed */ }
  return extra;
}

const TYPES   = ['movie', 'series', 'anime'];
const REFRESH = 2 * 60 * 1000;

// Background refresh is per provider-key set, not per installed token. One
// account may deliberately have several Nuvio profiles/tokens; scanning the
// same provider library for each token is wasteful and can provoke 429s. The
// first projection fetches fresh data, then every sibling projection reuses
// that exact snapshot for this refresh window while retaining its own output
// cache and artwork settings.
async function refreshDownloadsForUser(config, userKey) {
  const now = Date.now();
  const recent = providerRefreshSnapshots.get(userKey);
  if (recent && now - recent.at < REFRESH) {
    if (recent.error) throw recent.error;
    return recent.downloads;
  }
  const pending = providerRefreshInFlight.get(userKey);
  if (pending) return pending;
  const work = providers.fetchDownloads(config, { useCache: false })
    .then(async (downloads) => {
      await providers.setCachedDownloads(config, downloads);
      providerRefreshSnapshots.set(userKey, { at: Date.now(), downloads, error: null });
      return downloads;
    })
    .catch((err) => {
      providerRefreshSnapshots.set(userKey, { at: Date.now(), downloads: null, error: err });
      throw err;
    })
    .finally(() => providerRefreshInFlight.delete(userKey));
  providerRefreshInFlight.set(userKey, work);
  return work;
}

// Fingerprint of a user's library. Includes updated_at AND the name so in-place
// edits (renames, file changes) also trigger a rebuild, not just add/remove -
// Real-Debrid items have no updated_at, so name is what catches renames there.
function hashDownloads(downloads) {
  const stableValue = (value) => {
    if (Array.isArray(value)) return value.map(stableValue).sort();
    if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stableValue(value[key]);
      return out;
    }, {});
    return value == null ? '' : value;
  };
  const fingerprint = downloads
    .map(d => {
      // A provider can add files to an existing completed download without
      // changing its name or creation time. Include stable structural fields
      // (never volatile progress/speed) so the shared two-minute refresh sees
      // that change and rebuilds the normal Redis catalogue caches.
      // TorBox's list response may represent files as either an array or a
      // keyed object. Keep its stable library identity fields too: adding a
      // completed torrent or changing its selected-file layout then changes
      // this fingerprint even when the list's updated_at is unchanged.
      const files = Array.isArray(d.files) ? d.files : (d.files && typeof d.files === 'object' ? Object.values(d.files) : []);
      return stableValue({
        source: d.source, id: d.id, name: d.name || d.filename,
        updated: d.updated_at || d.created_at || d.last_state_change,
        size: d.size || d.bytes || d.total_size,
        fileCount: d.file_count || d.fileCount || files.length,
        state: d.download_finished === true ? 'finished' : (d.download_state || d.status || ''),
        hash: d.hash, magnet: d.magnet, torrentFile: d.torrent_file,
        downloadPath: d.download_path, totalDownloaded: d.total_downloaded,
        tags: d.tags, alternateHashes: d.alternative_hashes,
        files: files.map(file => ({ id: file?.id, name: file?.name || file?.path || file?.filename, size: file?.size || file?.bytes, path: file?.path })),
      });
    })
    .map(item => JSON.stringify(item))
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(fingerprint).digest('hex');
}

async function buildAndCacheForConfigInner(token, config) {
  // Merge server-side settings (incl. the libraryIdMode toggle) so the
  // background rebuild matches what the on-demand route would serve.
  config = await require('./src/configstore').mergeStoredConfig(config);
  const { tmdbApiKey, sortBy = 'data_adicao', lang = 'en-US', rdCatalog = 'merge', erdbToken, rpdbKey, fanartKey, hideAnime, libraryIdMode } = config;
  if (!tmdbApiKey) return;

  const active = providers.activeProviders(config);
  const userKey = providers.getUserKey(config);
  if (!active.length) {
    // No usable provider keys: a junk/forged token. Drop it after a few
    // attempts instead of retrying forever every refresh cycle.
    const fails = (knownConfigFailures.get(token) || 0) + 1;
    knownConfigFailures.set(token, fails);
    if (fails >= 3) {
      knownConfigs.delete(token);
      knownConfigFailures.delete(token);
    }
    return;
  }
  knownConfigFailures.delete(token);

  console.log(`[Cache] Refresh for ...${token.slice(-8)} (${lang}) providers=${active.join(',')}`);
  try {
    // Always fetch FRESH for the background rebuild (it must detect library
    // changes) but seed the Redis downloads cache so the discovery stream path
    // can answer the owned-bridge without re-hitting TorBox.
    const downloads = await refreshDownloadsForUser(config, userKey);
    // Artwork is part of the generated catalogue response. Rebuild when the
    // user changes poster/rating providers even if their downloads did not,
    // otherwise a warm franchise cache can keep serving the old artwork until
    // the library itself changes.
    const newHash   = `${hashDownloads(downloads)}:${posterFp(config)}:${libraryIdMode || 'torbox'}`;
    // Cache comparison must be projection-scoped. Two tokens can share a
    // provider library but choose different language/artwork/sort settings;
    // a single shared hash made them continually invalidate each other's rows.
    const projectionFp = hashShort(JSON.stringify({
      sortBy, lang, rdCatalog, poster: posterFp(config), libraryIdMode: libraryIdMode || 'torbox', hideAnime: !!hideAnime,
    }));
    const hashKey   = cache.makeKey('dlhash', 'v2', userKey, projectionFp);
    const oldHash   = await cache.get(hashKey);

    if (oldHash === newHash) {
      console.log(`[Cache] Downloads unchanged, skip rebuild`);
      // Keep long-TTL catalog cache warm so it doesn't expire and force a slow rebuild
      await cache.touchPattern(`cat:*${userKey}*`, TTL_CATALOG);
      await cache.expire(hashKey, 7200);
      return;
    }

    // Resilience: if the provider suddenly returns nothing but we previously had
    // content, don't wipe the cached catalogs. A transient provider blip (or a
    // silently-failing key) shouldn't blank someone's library for hours.
    if (downloads.length === 0 && oldHash) {
      console.log('[Cache] Downloads empty but we had content: keeping existing catalog');
      await cache.touchPattern(`cat:*${userKey}*`, TTL_CATALOG);
      await cache.expire(hashKey, 7200);
      return;
    }

    const sources = rdCatalog === 'separate'
      ? active.map(id => ({ key: providers.PROVIDER_META[id].cat, downloads: providers.downloadsFor(downloads, id) }))
      : [{ key: 'merged', downloads }];

    await Promise.all(sources.flatMap(({ key, downloads: dl }) =>
      TYPES.map(async type => {
        const metas    = await buildCatalog(dl, tmdbApiKey, type, sortBy, { skip: 0, search: '' }, lang, { erdbToken, rpdbKey }, { userKey, hideAnime, libraryIdMode });
        const cacheKey = cache.makeKey('cat', key, type, sortBy, '', '0', userKey, lang, posterFp(config), libraryIdMode);
        await cache.set(cacheKey, { metas }, TTL_CATALOG);
        console.log(`[Cache] ${key}:${type} → ${metas.length} items`);
      })
    ));

    // Collections catalog: merged across all providers, additive.
    const collMetas = await buildCollectionsCatalog(downloads, tmdbApiKey, lang, { erdbToken, rpdbKey });
    cacheCollections(userKey, lang, collMetas);
    const collKey = cache.makeKey('cat', 'collections', 'collections', sortBy, '', '0', userKey, lang, posterFp(config));
    await cache.set(collKey, { metas: collMetas }, TTL_CATALOG);
    console.log(`[Cache] collections → ${collMetas.length} items`);

    // Pre-warm Trending / Popular so their first on-screen load is instant
    // (each row needs per-title IMDb lookups, which is slow on a cold build).
    // Uses buildDiscoveryCatalog so the cached rows carry this user's poster
    // providers and are keyed by the poster fingerprint.
    const { buildDiscoveryCatalog } = require('./src/discovery');
    const discEnhance = { erdbToken, rpdbKey, fanartKey, posterProvider: config.posterProvider };
    const discFp = posterFp(config);
    if (config.catalogTrending) {
      await Promise.allSettled([
        buildDiscoveryCatalog({ tmdbApiKey, kind: 'trending', apiType: 'movie', lang, userKey, enhance: discEnhance, posterFp: discFp }),
        buildDiscoveryCatalog({ tmdbApiKey, kind: 'trending', apiType: 'tv', lang, userKey, enhance: discEnhance, posterFp: discFp }),
      ]);
      console.log('[Cache] trending pre-warmed');
    }
    if (config.catalogPopular) {
      await Promise.allSettled([
        buildDiscoveryCatalog({ tmdbApiKey, kind: 'popular', apiType: 'movie', lang, userKey, enhance: discEnhance, posterFp: discFp }),
        buildDiscoveryCatalog({ tmdbApiKey, kind: 'popular', apiType: 'tv', lang, userKey, enhance: discEnhance, posterFp: discFp }),
      ]);
      console.log('[Cache] popular pre-warmed');
    }

    // Only update hash and invalidate caches after ALL catalogs built successfully
    await cache.set(hashKey, newHash, 7200);
    // Scope invalidation to THIS user's caches. Meta and stream keys embed the
    // user key hash, so a bare 'meta:*' / 'stream:*' wipe would evict every
    // other user's cached metas and streams on every library change.
    await cache.delPattern(`meta:*${userKey}*`);
    await cache.delPattern(`stream:*${userKey}*`);
    console.log('[Cache] Meta + stream caches invalidated after catalog rebuild');
  } catch (err) {
    console.error('[Cache] Error:', err.message);
  }
}

// A cold manifest, collection push and catalog request can arrive together.
// Coalesce the expensive provider/TMDB scan so an owned-only collection push
// waits for the same finished projection instead of racing a duplicate build.
function buildAndCacheForConfig(token, config) {
  const pending = catalogBuildInFlight.get(token);
  if (pending) return pending;
  const work = buildAndCacheForConfigInner(token, config)
    .finally(() => catalogBuildInFlight.delete(token));
  catalogBuildInFlight.set(token, work);
  return work;
}

// Keep the refresh cadence genuinely close to REFRESH even when the server has
// seen many tokens. The previous sequential loop slept for two seconds after
// every token, so a busy hosted instance could take many minutes to reach an
// account Collection Wizard token. Downloads are already deduplicated by the
// provider-key snapshot above; bounded concurrency therefore preserves the
// anti-429 behaviour while letting My Movies/My Shows folder caches refresh.
let backgroundRefreshRunning = false;
const BACKGROUND_REFRESH_CONCURRENCY = 4;
setInterval(async () => {
  if (backgroundRefreshRunning) return;
  backgroundRefreshRunning = true;
  try {
    const entries = [...knownConfigs.entries()];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(BACKGROUND_REFRESH_CONCURRENCY, entries.length) }, async () => {
      while (cursor < entries.length) {
        const [token, config] = entries[cursor++];
        await buildAndCacheForConfig(token, config).catch(() => {});
      }
    });
    await Promise.all(workers);
  } finally {
    backgroundRefreshRunning = false;
  }
}, REFRESH).unref?.();

// Delay until startup/migrations have settled. This restores only opaque
// account ids, resolves their configs server-side, and resumes the same loop
// as an active normal Configure install without ever persisting credentials.
setTimeout(() => {
  restoreAccountRefreshRegistry().catch((err) => console.warn('[Cache] Account refresh restore failed:', err.message));
}, 5000).unref?.();
function getLogoUrl(baseUrl) {
  return `${baseUrl}/LeLibrary.png?v=2`;
}

function getBaseManifest(baseUrl) {
  const manifest = {
    id: (REGISTRY && REGISTRY.addonId) || 'community.lelibrary.selfhosted',
    version: '5.0.0',
    name: (REGISTRY && REGISTRY.name) || 'LeLibrary (Self-Hosted)',
    description: (REGISTRY && REGISTRY.description) || 'Your movies, series & anime from every debrid provider, beautifully organized with TMDB artwork and ratings.',
    logo: getLogoUrl(baseUrl),
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series', 'anime'],
    idPrefixes: ['torbox:', 'tt', 'kitsu:'],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: true },
    configureUrl: `${baseUrl}/configure`,
  };
  if (REGISTRY && REGISTRY.stremioAddonsConfig) {
    manifest.stremioAddonsConfig = REGISTRY.stremioAddonsConfig;
  }
  return manifest;
}

function getConfiguredManifest(baseUrl, config = {}, { watchlist = [], collectionRefs = [], homeRows = [], importedTypes = [], token = '', integration = 'nuvio' } = {}) {
  const { rdCatalog = 'merge', catNameMovies, catNameSeries, catNameAnime, hideAnime } = config;
  const active  = providers.activeProviders(config);
  const separate = rdCatalog === 'separate';
  const selectedHomeCatalogs = new Set((Array.isArray(homeRows) ? homeRows : []).filter(row => row?.enabled !== false).map(row => row?.source?.id || row?.source?.catalogId).filter(Boolean));

  function catName(def, custom) { return custom || def; }
  // Per-catalogue names (Edit Catalogues), with the legacy single trendingName /
  // popularName still honoured so old configs keep working.
  const DISCOVERY = {
    trendingMovies:  catName('🔥 Trending Movies',  config.trendingMoviesName || config.trendingName),
    trendingSeries:  catName('🔥 Trending Series',  config.trendingSeriesName || config.trendingName),
    popularMovies:   catName('⭐ Popular Movies',   config.popularMoviesName  || config.popularName),
    popularSeries:   catName('⭐ Popular Series',   config.popularSeriesName  || config.popularName),
  };
  // Only the dedicated search catalogs advertise the `search` extra: Nuvio and
  // Stremio fire a search request at every catalog that declares it, so a
  // global search would otherwise fan out to every row (trending, library,
  // watchlists, collections). The handlers still accept `search=` in the URL
  // for backward compatibility with older clients.
  const CAT_EXTRA = [{ name: 'skip' }];

  const catalogs = [];
  const EMOJI = { torbox: '🎬', realdebrid: '🔴', alldebrid: '💠', premiumize: '🧲' };

  // ── Library rows (My Movies / My Series / My Anime) ──
  // buildLibrary('movies') adds just that catalogue type so each row can be
  // reordered or hidden independently in the Edit Catalogues tab.
  function buildLibrary(type) {
    const selected = type === 'movies'
      ? active.some((provider) => selectedHomeCatalogs.has(`${providers.PROVIDER_META[provider].cat}-movies`))
      : type === 'series'
        ? active.some((provider) => selectedHomeCatalogs.has(`${providers.PROVIDER_META[provider].cat}-series`))
        : active.some((provider) => selectedHomeCatalogs.has(`${providers.PROVIDER_META[provider].cat}-anime`));
    if (type === 'movies' && config.catalogMovies === false && !selected) return;
    if (type === 'series' && config.catalogSeries === false && !selected) return;
    if (type === 'anime' && config.catalogAnime === false && !selected) return;
    const pushLib = (prefix, id, name) => {
      const catalogId = `${prefix}-${id}`;
      const row = { id: catalogId, type: id === 'movies' ? 'movie' : 'series', name, extra: CAT_EXTRA };
      // Nuvio mobile also renders every manifest catalogue unless this is
      // explicit. The TV client honours pushed Home settings, which is why
      // the leak only appeared on mobile. A library row remains available to
      // native collection folders even when it is hidden from Home.
      if (integration === 'nuvio' && !selectedHomeCatalogs.has(catalogId)) row.showInHome = false;
      catalogs.push(row);
    };
    const groups = [];
    if (active.length === 1) {
      groups.push(providers.PROVIDER_META[active[0]].cat);
    } else if (active.length > 1 && !separate) {
      groups.push(active.includes('torbox') ? 'torbox' : providers.PROVIDER_META[active[0]].cat);
    } else if (active.length > 1) {
      groups.push(...active.map(id => providers.PROVIDER_META[id].cat));
    }
    for (const prefix of groups) {
      // In separate mode each provider gets its own row; tag the name so the
      // rows are distinguishable (e.g. "My Movies [TB]" vs "My Movies [AD]").
      const tag = separate && groups.length > 1 ? ` [${providers.PROVIDER_META[providers.providerByCat(prefix)].short}]` : '';
      if (type === 'movies') pushLib(prefix, 'movies', catName('🎬 My Movies', catNameMovies) + tag);
      else if (type === 'series') pushLib(prefix, 'series', catName('📺 My Series', catNameSeries) + tag);
      else if (type === 'anime' && !hideAnime) pushLib(prefix, 'anime', catName('🍥 LeLibrary Anime', catNameAnime) + tag);
    }
  }

  // ── "LeLibrary Collections" movie catalog (torbox-collections) ──
  // ONE catalog listing every owned franchise film as a plain movie. Both
  // platforms filter it through the `genre` extra (a franchise name): Nuvio
  // collection folders send genre in the catalog URL, and Stremio's Discover
  // shows a genre dropdown for catalogs that declare `options`. This replaces
  // the old one-catalog-per-franchise rows, which bloated the manifest to
  // ~38 catalogue entries. Hidden from Nuvio Home via `showInHome: false`;
  // Stremio ignores that field so the row still appears in Discover.
  function buildCollectionsRow() {
    if (config.catalogFranchises === false && !selectedHomeCatalogs.has('torbox-collections')) return;
    const userKey = providers.getUserKey(config);
    const collLang = config.lang || 'en-US';
    const colls = getCollections(userKey, collLang);
    const genres = colls.map(c => franchiseRowName(c.name)).filter(Boolean);
    // One declared catalogue backs every native Nuvio franchise folder. The
    // folder's genre is a stable `collection-<tmdbId>` filter, so this remains
    // debrid-owned-only without exposing one manifest catalogue per franchise.
    // A required search extra is Nuvio's supported way to keep a backing row
    // out of normal Home catalogue listings; folder requests still include the
    // genre filter and the handler does not require a search query.
    catalogs.push({
      id: 'torbox-collections',
      type: 'movie',
      name: config.collectionsName || 'LeLibrary Collections',
      showInHome: integration === 'nuvio' ? false : selectedHomeCatalogs.has('torbox-collections'),
      extra: integration === 'nuvio'
        ? [{ name: 'genre', isRequired: false, options: genres }, { name: 'search', isRequired: true }, { name: 'skip' }]
        : [{ name: 'genre', isRequired: false, options: genres }, { name: 'skip' }],
    });
  }

  function buildSearchRows() {
    const scope = ['combined', 'library', 'tmdb'].includes(config.searchScope) ? config.searchScope : 'combined';
    // One normal search surface can now include both TMDB and owned titles.
    // Keep the library-only routes distinct: they are useful for people who
    // deliberately never want public results in their search screen.
    if (scope !== 'library') {
      catalogs.push({ id: 'lelibrary-search-movies', type: 'movie', name: scope === 'combined' ? 'LeLibrary + My Movies' : 'LeLibrary', showInHome: false, extra: [{ name: 'search', isRequired: true }] });
      catalogs.push({ id: 'lelibrary-search-series', type: 'series', name: scope === 'combined' ? 'LeLibrary + My Shows' : 'LeLibrary', showInHome: false, extra: [{ name: 'search', isRequired: true }] });
    }
    if (scope === 'library') {
      // These are separate Search sections, so their labels must mirror the
      // labels the person chose for the matching Home rows, emojis included.
      catalogs.push({ id: 'lelibrary-search-my-movies', type: 'movie', name: catName('🎬 My Movies', catNameMovies), showInHome: false, extra: [{ name: 'search', isRequired: true }] });
      catalogs.push({ id: 'lelibrary-search-my-series', type: 'series', name: catName('📺 My Series', catNameSeries), showInHome: false, extra: [{ name: 'search', isRequired: true }] });
      catalogs.push({ id: 'lelibrary-search-collections', type: 'movie', name: config.collectionsName || 'LeLibrary Collections', showInHome: false, extra: [{ name: 'search', isRequired: true }] });
    }
  }

  // Imported collection folders can point at this small pair of catalogues
  // with their source encoded in the genre extra (for example
  // "tmdb-collection:10"). This avoids adding hundreds of rows to a manifest.
  function buildImportedSourceRows() {
    const hasImportedNativeSource = (Array.isArray(config.importedRows) ? config.importedRows : [])
      .some(source => (source.collections || []).some(collection => (collection.folders || []).some(folder =>
        (folder.catalogSources || []).some(ref => String(ref.addonId || '') === '__lelibrary__'))));
    const types = new Set(Array.isArray(importedTypes) ? importedTypes : []);
    if (hasImportedNativeSource) types.add('movie').add('series');
    if (types.has('movie')) catalogs.push({ id: 'lelibrary-import-movie', type: 'movie', name: 'LeLibrary Imported Movies', showInHome: false, extra: [{ name: 'genre', isRequired: false }, { name: 'skip' }] });
    if (types.has('series')) catalogs.push({ id: 'lelibrary-import-series', type: 'series', name: 'LeLibrary Imported Series', showInHome: false, extra: [{ name: 'genre', isRequired: false }, { name: 'skip' }] });
  }

  // ── Watchlist rows (Simkl / MDBList / Trakt): pure tt: ids ──
  // Added when the user has a watchlist connection (Simkl/Trakt OAuth stored
  // against their account) or a saved MDBList key. Rows carry tt: ids so
  // external stream addons answer them and Nuvio enriches them.
  function buildWatchlistRows() {
    const conns = Array.isArray(watchlist) ? watchlist : [];
    const mdblistOn = !!(config.mdblistKey);
    const names = config.watchlistNames && typeof config.watchlistNames === 'object' ? config.watchlistNames : {};
    const hidden = new Set(Array.isArray(config.watchlistHomeHidden) ? config.watchlistHomeHidden : []);
    const pushWatchlist = (id, type, fallbackName) => {
      const row = { id, type, name: names[id] || fallbackName, extra: CAT_EXTRA };
      if (hidden.has(id)) row.showInHome = false;
      catalogs.push(row);
    };
    for (const c of conns) {
      const type = c.type === 'movie' ? 'movie' : 'series';
      const id = `torbox-watchlist-${c.provider}-${type}`;
      pushWatchlist(id, type, c.name || `Watchlist (${c.provider})`);
    }
    if (mdblistOn) {
      pushWatchlist('torbox-watchlist-mdblist-movie', 'movie', '🎯 MDBList Watchlist');
      pushWatchlist('torbox-watchlist-mdblist-series', 'series', '📺 MDBList Watchlist');
    }
  }

  // ── Catalog library rows ──
  // Only the catalog ids the user enabled (config.libraryCatalogs) are listed -
  // the full 451-row library is far too big for one manifest. Each row serves
  // tt: ids so external stream addons + Nuvio enrichment work. Rows referenced
  // by the user's stored Nuvio collections are also advertised, so a folder
  // whose catalogSources point at `lib-{catalogId}` always resolves. Rows in
  // config.libHomeHidden get showInHome: false (they stay in Discover and in
  // Nuvio collection folders, but don't clutter Nuvio's Home).
  function buildLibraryRows() {
    const enabled = Array.isArray(config.libraryCatalogs) ? config.libraryCatalogs : [];
    const folderRefs = Array.isArray(collectionRefs) ? collectionRefs : [];
    const homeRefs = (Array.isArray(homeRows) ? homeRows : [])
      .map((row) => row?.source?.catalogId || row?.source?.id)
      .filter((catalogId) => typeof catalogId === 'string' && catalogId.startsWith('lib-'))
      .map((catalogId) => catalogId.slice(4));
    // Stremio has no native collection surface, so its curated packs must be
    // exposed as individual Discover catalogues. Nuvio folders instead use
    // the compact lelibrary-curated-{movie,series} routes below: advertising
    // every underlying source made a pack selection turn into 100+ addon
    // catalogues in Nuvio settings.
    const curatedRefs = require('./src/curated-collections').curatedSourceIds(config.nuvioCollectionPacks);
    const curatedRefSet = new Set(curatedRefs);
    const merged = [...enabled];
    for (const r of homeRefs) if (r && !merged.includes(r)) merged.push(r);
    const useCompactCuratedRoutes = integration === 'nuvio';
    if (integration === 'stremio') {
      for (const r of folderRefs) if (r && !merged.includes(r)) merged.push(r);
      for (const r of curatedRefs) if (r && !merged.includes(r)) merged.push(r);
    } else if (useCompactCuratedRoutes) {
      const defs = require('./src/catalogdefs').catalogs;
      const compactRefs = [...curatedRefs, ...folderRefs];
      const types = new Set(compactRefs.map((id) => defs[id]?.type === 'movie' ? 'movie' : defs[id] ? 'series' : null).filter(Boolean));
      for (const type of types) {
        catalogs.push({
          id: `lelibrary-curated-${type}`,
          type,
          // Nuvio appends the media type itself. Keep the shared compact
          // source name short so folder labels stay readable.
          name: 'LeLibrary',
          showInHome: false,
          extra: [{ name: 'genre', isRequired: false }, { name: 'skip' }],
        });
      }
    }
    if (!merged.length) return;
    const hidden = new Set(Array.isArray(config.libHomeHidden) ? config.libHomeHidden : []);
    const defs = require('./src/catalogdefs').catalogs;
    for (const cid of merged) {
      // A curated source lives only inside its native Nuvio folder. Older
      // saved configs may still contain the flattened lib-* selections, but
      // they must not revive as Home rows after the collection migration.
      if (useCompactCuratedRoutes && curatedRefSet.has(cid)) continue;
      const def = defs[cid];
      if (!def) continue;
      const row = {
        id: `lib-${cid}`,
        type: def.type === 'movie' ? 'movie' : 'series',
        name: def.name || cid,
        extra: CAT_EXTRA,
      };
      // Curated sources stay out of Nuvio Home by default. Explicit Home Row
      // selections must win over the collection-only default.
      if (hidden.has(cid) || (curatedRefSet.has(cid) && !enabled.includes(cid)) ||
        (integration === 'nuvio' && config.wizard === true && homeRefs.includes(cid) && !selectedHomeCatalogs.has(`lib-${cid}`))) row.showInHome = false;
      catalogs.push(row);
    }
  }

  // ── Assemble in the user's catalogue order ──
  // Search rows are pinned FIRST in the manifest: Nuvio renders search
  // sections in manifest catalogue order, so a global search should lead with
  // the real TMDB-wide search results rather than library rows. They are
  // excluded from Home/Discover (required search extra + showInHome: false),
  // so their position does not affect any other surface.
  if (config.searchEnabled !== false) buildSearchRows();
  const DEFAULT_ORDER = ['trendingMovies','trendingSeries','popularMovies','popularSeries','movies','series','anime','franchises','watchlist','library','imports'];
  const orderRaw = Array.isArray(config.catalogOrder) && config.catalogOrder.length
    ? config.catalogOrder.slice()
    : DEFAULT_ORDER.slice();
  const order = [...orderRaw];
  for (const k of DEFAULT_ORDER) {
    if (!order.includes(k)) order.push(k);
  }
  const seen = new Set();

  for (const key of order) {
    if (seen.has(key)) continue;
    seen.add(key);
    // Discovery rows tick individually (legacy catalogTrending/catalogPopular
    // enable both of that kind for older tokens).
    if (key === 'trendingMovies' && (config.catalogTrendingMovies || config.catalogTrending || selectedHomeCatalogs.has('torbox-trending-movies'))) {
      catalogs.push({ id: 'torbox-trending-movies', type: 'movie',  name: DISCOVERY.trendingMovies, extra: CAT_EXTRA });
    } else if (key === 'trendingSeries' && (config.catalogTrendingSeries || config.catalogTrending || selectedHomeCatalogs.has('torbox-trending-series'))) {
      catalogs.push({ id: 'torbox-trending-series', type: 'series', name: DISCOVERY.trendingSeries, extra: CAT_EXTRA });
    } else if (key === 'popularMovies' && (config.catalogPopularMovies || config.catalogPopular || selectedHomeCatalogs.has('torbox-popular-movies'))) {
      catalogs.push({ id: 'torbox-popular-movies', type: 'movie',  name: DISCOVERY.popularMovies, extra: CAT_EXTRA });
    } else if (key === 'popularSeries' && (config.catalogPopularSeries || config.catalogPopular || selectedHomeCatalogs.has('torbox-popular-series'))) {
      catalogs.push({ id: 'torbox-popular-series', type: 'series', name: DISCOVERY.popularSeries, extra: CAT_EXTRA });
    } else if (key === 'movies' || key === 'series' || key === 'anime') {
      buildLibrary(key);
    } else if (key === 'franchises') {
      buildCollectionsRow();
    } else if (key === 'watchlist') {
      buildWatchlistRows();
    } else if (key === 'library') {
      buildLibraryRows();
    } else if (key === 'imports') {
      buildImportedSourceRows();
    }
  }

  // Home rows may have a user-facing name separate from the source catalogue.
  // Apply only deliberate wizard edits, so existing manifest labels remain
  // untouched until someone chooses to personalise a row.
  const customHomeTitles = new Map((Array.isArray(homeRows) ? homeRows : [])
    .filter(row => row?.enabled !== false && row?.customTitle === true && typeof row?.title === 'string' && row.title.trim())
    .map(row => [row.source?.id || row.source?.catalogId, row.title.trim().slice(0, 80)]));
  for (const catalog of catalogs) {
    const title = customHomeTitles.get(catalog.id);
    if (title) catalog.name = title;
  }

  return {
    id: (REGISTRY && REGISTRY.addonId) || 'community.lelibrary.selfhosted',
    version: '5.0.0',
    name: (REGISTRY && REGISTRY.name) || 'LeLibrary (Self-Hosted)',
    description: (REGISTRY && REGISTRY.description) || 'Your movies, series & anime from every debrid provider, beautifully organized with TMDB artwork and ratings.',
    logo: getLogoUrl(baseUrl),
    resources: [
      'catalog',
      'meta',
      { name: 'stream', types: ['movie', 'series', 'anime'], idPrefixes: ['torbox:', 'tt', 'kitsu:'] },
    ],
    types: ['movie', 'series', 'anime'],
    idPrefixes: ['torbox:', 'tt', 'kitsu:'],
    catalogs,
    // Opaque tokens belong to an Account. Keep their Configure action on the
    // account-scoped route so a browser can sign in and verify ownership before
    // exposing saved setup data. Legacy self-contained tokens remain public.
    // Wizard-built tokens land on the premium wizard; others stay on the classic
    // account configure.
    configureUrl: `${baseUrl}${(() => {
      if (!HOSTED || decodeConfig(token)) return `/${token}/configure`;
      const isWizard = config && (config.wizard === true || !!config.wizard_profile_name);
      return isWizard ? `/accounts/collections/${token}/configure` : `/accounts/${token}/configure`;
    })()}`,
    behaviorHints: { configurable: true },
  };
}
app.post('/cache/clear', async (req, res) => {
  // Admin-only: requires CACHE_CLEAR_SECRET to be set. Disabled otherwise,
  // so no anonymous visitor can wipe the whole cache (a DoS primitive).
  const secret = process.env.CACHE_CLEAR_SECRET;
  if (!secret) return res.status(403).json({ success: false, error: 'Global cache clear is disabled. Set CACHE_CLEAR_SECRET to enable.' });
  if (req.headers['x-cache-secret'] !== secret) return res.status(403).json({ success: false, error: 'Invalid cache secret' });
  try {
    const deleted = await cache.delPattern('*');
    res.json({ success: true, deleted, message: 'Cache cleared successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/:token/cache/clear', async (req, res) => {
  const config = await resolveConfig(req.params.token);
  if (!config) return res.status(400).json({ error: 'Invalid token' });
  
  try {
    const userKey = providers.getUserKey(config);
    if (!userKey) return res.status(400).json({ error: 'No key configured' });
    
    const pattern = `*${userKey}*`;
    const deleted = await cache.delPattern(pattern);
    require('./src/tmdb').clearCaches();
    res.json({ success: true, deleted, message: 'User cache cleared' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/manifest.json', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json(getBaseManifest(req.protocol + '://' + req.get('host')));
});

app.get('/:token/manifest.json', async (req, res) => {
  const config = await resolveConfig(req.params.token);
  if (!config) return res.status(400).json({ error: 'Invalid token' });
  // Trigger a background build so catalogs are ready for the Nuvio collections
  // profile.
  if (!knownConfigs.has(req.params.token)) {
    rememberConfig(req.params.token, config);
    buildAndCacheForConfig(req.params.token, config).catch(() => {});
  }
  // Cold start: restore the cached collections before building the manifest so
  // the "LeLibrary Collections" row's genre options are populated immediately,
  // even though the background build may still be running.
  try {
    const userKey = providers.getUserKey(config);
    const lang = config.lang || 'en-US';
    if (getCollections(userKey, lang).length === 0) {
      const persistentKey = cache.makeKey('cat', 'collections', 'collections', config.sortBy || 'data_adicao', '', '0', userKey, lang, posterFp(config));
      const persistent = await cache.get(persistentKey);
      if (Array.isArray(persistent?.metas) && persistent.metas.length > 0) {
        cacheCollections(userKey, lang, persistent.metas);
        console.log(`[Collections] Manifest: restored ${persistent.metas.length} cached collections (${req.params.token})`);
      }
    }
  } catch (err) {
    console.warn(`[Collections] Manifest: cache restore failed: ${err.message}`);
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  // Resolve which watchlist services this token's owner has connected so the
  // manifest can advertise their catalogs. Legacy tokens have no connections.
  let watchlist = [];
  let collectionRefs = [];
  let homeRows = [];
  let importedTypes = [];
  const requestedIntegration = req.query.integration === 'stremio' ? 'stremio' : 'nuvio';
  try {
    if (!HOSTED) throw new Error('Hosted account extension unavailable');
    const profileId = typeof req.query.profile_id === 'string' ? req.query.profile_id : 'default';
    const simkl = await HOSTED.tokenWatchlistConn(req.params.token, 'simkl');
    if (simkl) watchlist.push({ provider: 'simkl', type: 'movie', name: '🎬 Simkl Watchlist' }, { provider: 'simkl', type: 'series', name: '📺 Simkl Watchlist' });
    const trakt = await HOSTED.tokenWatchlistConn(req.params.token, 'trakt');
    if (trakt) watchlist.push({ provider: 'trakt', type: 'movie', name: '🎬 Trakt Watchlist' }, { provider: 'trakt', type: 'series', name: '📺 Trakt Watchlist' });
    // Compile the saved wizard document once. The same plan is used by the
    // Nuvio push adapter, so a folder can never point at a catalogue which the
    // manifest forgot to advertise.
    const stored = await HOSTED.tokenCollectionConfig(req.params.token, { integration: requestedIntegration, profile_id: profileId });
    // A collection context belongs to one manifest token.  Without this guard
    // an ordinary account token inherited the Collections Wizard document for
    // the same account, then advertised its folders alongside its own rows.
    // Nuvio received a mixed setup (and could fetch hundreds of unintended
    // catalogues), rather than the setup the person actually pushed.
    const ownsStoredContext = stored && String(stored.manifest_token_id || '') === String(req.params.token);
    const plan = compileCollectionPlan({
      collections: ownsStoredContext ? stored.collections : [],
      homeRows: ownsStoredContext ? stored.home_rows : [],
      sources: ownsStoredContext ? stored.sources : [],
      manifestId: (REGISTRY && REGISTRY.addonId) || 'community.lelibrary.selfhosted',
      integration: requestedIntegration,
      hideAnime: config.hideAnime === true,
    });
    homeRows = plan.homeRows;
    collectionRefs = plan.folderLibraryIds;
    importedTypes = plan.importedTypes;
  } catch (err) {
    console.warn('[watchlist] manifest resolve failed:', err.message);
  }
  res.json(getConfiguredManifest(req.protocol + '://' + req.get('host'), config, { watchlist, collectionRefs, homeRows, importedTypes, token: req.params.token, integration: requestedIntegration }));
});

// Strip the "Collection" suffix for the per-franchise movie row names
// ("James Bond Collection" → "James Bond"). Also strips the common localized
// forms ("Coleção", "Colección", "Coleção Completa") so any pt-BR-cached
// names render cleanly too.
function franchiseRowName(name) {
  return String(name || '')
    .replace(/\s+(Collection|Cole(ç|c)ão|Colección|Colecion)\s*$/i, '')
    .trim() || name;
}

// ── Nuvio native Collections profile ─────────────────────────────
// One Nuvio collection with one folder per owned TMDB franchise. Each folder
// targets an undeclared, deterministic LeLibrary catalog (collection-{tmdbId})
// which NuvioTV resolves directly. The catalog is owned-only; TMDB is used
// solely to group the existing debrid items.
async function handleNuvioProfile(req, res) {
  const config = await resolveConfig(req.params.token);
  if (!config) return res.status(400).json({ error: 'Invalid token' });
  const { tmdbApiKey, lang = 'en-US' } = config;
  const active = providers.activeProviders(config);
  if (!tmdbApiKey || active.length === 0) return res.json([]);
  // Collection-wizard tokens can return their saved document below without
  // ever touching My Movies/My Shows. They still need to join the exact same
  // 2-minute provider refresh loop as a normal Configure install.
  registerBackgroundRefresh(req.params.token, config);

  const addonId = (REGISTRY && REGISTRY.addonId) || 'community.lelibrary.selfhosted';
  const artworkOrigin = `${req.protocol}://${req.get('host')}`;

  // Nuvio collection exports can contain first-class public TMDB and Trakt
  // sources. They are not addon catalogues: Nuvio resolves them itself. Keep
  // the exact source payload when pushing an imported collection so list IDs,
  // filters and sort order behave exactly like the original community pack.
  function nativeNuvioSources(folder) {
    if (!Array.isArray(folder?.sources)) return [];
    return folder.sources.filter((source) => {
      const provider = String(source?.provider || '').toLowerCase();
      if (provider === 'trakt') return Number.isFinite(Number(source.traktListId)) && Number(source.traktListId) > 0;
      if (provider !== 'tmdb') return false;
      const kind = String(source.tmdbSourceType || '').toUpperCase();
      return !!kind && (Number.isFinite(Number(source.tmdbId)) || kind === 'DISCOVER');
    }).map((source) => ({ ...source }));
  }

  function addonNuvioSources(folder) {
    if (!Array.isArray(folder?.sources)) return [];
    return folder.sources.filter((source) => (
      String(source?.provider || '').toLowerCase() === 'addon' &&
      source.addonId && source.type && source.catalogId
    )).map((source) => ({ ...source }));
  }

  const curatedModule = require('./src/curated-collections');
  const curatedSourceIds = curatedModule.curatedSourceIds(config.nuvioCollectionPacks);
  const curatedCatalogIds = new Set(curatedSourceIds.map((id) => `lib-${id}`));
  // Nuvio's addon-source schema has no `title` field. It displays `genre`
  // beneath the generic catalogue name, so send a readable label there while
  // resolving it back to the source id in the catalogue handler below.
  const curatedSourceLabels = new Map(curatedSourceIds.map((id) => [
    `lib-${id}`,
    curatedModule.curatedSourceDisplayName(`lib-${id}`, require('./src/catalogdefs').catalogs[id]?.type),
  ]));

  function renderCollections(collections) {
    // Curated folder sources are multiplexed through one hidden catalogue per
    // media type on Nuvio. The original lib-* id travels in `genre`, so the
    // catalogue handler can still use the exact same source definition. This
    // keeps native folders working without bloating Nuvio's addon settings.
    const renderCatalogSource = (source) => {
      const type = source.type === 'movie' ? 'movie' : 'series';
      const catalogId = String(source.catalogId || '');
      if (curatedCatalogIds.has(catalogId)) {
        return { addonId, catalogId: `lelibrary-curated-${type}`, type, genre: curatedSourceLabels.get(catalogId) || catalogId };
      }
      return { addonId: source.addonId === '__lelibrary__' ? addonId : (source.addonId || addonId), catalogId, type, genre: source.genre || '' };
    };
    return collections
      .filter(c => c && typeof c === 'object' && Array.isArray(c.folders))
      .map(c => ({
        focusGlowEnabled: c.focusGlowEnabled !== false,
        id: c.id || `collection-${Math.random().toString(36).slice(2, 8)}`,
        title: c.title || 'LeLibrary Collections',
        // Explicit false matters: Nuvio persists this independently from Home
        // order, so omitting it can leave an old true value in place.
        pinToTop: c.pinToTop === true,
        showAllTab: c.showAllTab !== false,
        viewMode: c.viewMode || 'TABBED_GRID',
        folders: c.folders.map((f, i) => {
          const sources = [...nativeNuvioSources(f), ...addonNuvioSources(f)];
          const folder = {
            id: f.id || `folder-${i}`,
            title: f.title || 'Collection',
            tileShape: f.tileShape || 'PORTRAIT',
            hideTitle: !!f.hideTitle,
            heroBackdropUrl: absoluteLocalArtwork(f.heroBackdropUrl, artworkOrigin),
            heroVideoUrl: absoluteLocalArtwork(f.heroVideoUrl, artworkOrigin),
            titleLogoUrl: absoluteLocalArtwork(f.titleLogoUrl, artworkOrigin),
            ...normaliseNuvioArtwork(f, artworkOrigin),
          };
          // `sources` is the current Nuvio model. `catalogSources` is emitted
          // only for legacy folder documents that do not already have sources.
          if (sources.length) folder.sources = sources;
          else folder.catalogSources = Array.isArray(f.catalogSources) && f.catalogSources.length
            ? f.catalogSources.map(renderCatalogSource)
            : [{ addonId, catalogId: 'torbox-collections', type: 'movie', genre: '' }];
          return folder;
        }),
      }));
  }

  // Configure packs are token-backed and work for self-hosters too. A pack is
  // opt-in, so it never changes an existing account collection document.
  const curated = require('./src/curated-collections').buildCuratedCollections(
    config.nuvioCollectionPacks,
    config.nuvioCollectionOverrides || {},
    { hideAnime: config.hideAnime === true }
  );
  // Imported Nuvio folders are token-backed just like curated packs. Native
  // TMDB/Trakt sources stay native; addon catalog sources stay as references.
  const importedSources = Array.isArray(config.importedRows) ? config.importedRows : [];
  const imported = importedSources
    .flatMap((source) => (Array.isArray(source?.collections) ? source.collections.map(collection => ({ ...collection, _importSourceId: source.id })) : []))
    .map((collection) => ({
      ...collection,
      id: String(collection.id || '').startsWith('collection-imported-')
        ? collection.id : `collection-imported-${String(collection.id || 'source').replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)}`,
      enabled: collection.enabled !== false,
      folders: (collection.folders || []).filter((folder) => {
        if (!folder || folder.enabled === false) return false;
        return nativeNuvioSources(folder).length > 0 ||
          (Array.isArray(folder.catalogSources) && folder.catalogSources.every(source => source && source.addonId));
      }),
    }))
    .filter(collection => collection.enabled && collection.folders.length > 0);
  const configuredOrder = Array.isArray(config.catalogOrder) ? config.catalogOrder : [];
  const importedOrder = new Map(configuredOrder.map((key, index) => [String(key), index]));
  imported.sort((a, b) => {
    const aKey = `importedCollection:${a._importSourceId}:${a.id.replace(/^collection-imported-/, '')}`;
    const bKey = `importedCollection:${b._importSourceId}:${b.id.replace(/^collection-imported-/, '')}`;
    return (importedOrder.get(aKey) ?? Number.MAX_SAFE_INTEGER) - (importedOrder.get(bKey) ?? Number.MAX_SAFE_INTEGER);
  });
  imported.forEach(collection => { delete collection._importSourceId; delete collection.enabled; });
  // If the token owner has a saved Collections config, render THAT structure
  // instead of the franchise default. Folders point at `lib-{catalogId}` rows
  // (or torbox-collections with a genre) and Nuvio resolves them against the
  // manifest. The catalog handler ignores the genre extra for lib- rows.
  let storedCollections = [];
  try {
    if (!HOSTED) throw new Error('Hosted account extension unavailable');
    const stored = await HOSTED.tokenCollectionConfig(req.params.token, {
      integration: req.query.integration === 'stremio' ? 'stremio' : 'nuvio',
      profile_id: typeof req.query.profile_id === 'string' ? req.query.profile_id : 'default',
    });
    // Do not leak a Collections Wizard document into a different account
    // token's legacy /collections.json export.  The token being installed is
    // the authority for this response; mixing the two was the source of the
    // duplicate native collections and mobile Nuvio crashes.
    if (stored && String(stored.manifest_token_id || '') === String(req.params.token) && Array.isArray(stored.collections)) {
      storedCollections = compileCollectionPlan({
        collections: stored.collections,
        homeRows: stored.home_rows,
        sources: stored.sources,
        manifestId: addonId,
        integration: req.query.integration === 'stremio' ? 'stremio' : 'nuvio',
        hideAnime: config.hideAnime === true,
      }).collections;
    }
  } catch (err) {
    console.warn('[Nuvio] stored collections render failed, falling back:', err.message);
  }

  // The Collections Wizard already persists its complete native-collection
  // document. Its token must export that document verbatim: adding legacy
  // packs or the provider-franchise fallback here creates a second, competing
  // collection tree for the very same Nuvio profile.
  if (config.collection_setup === true && storedCollections.length && req.query.owned_only !== '1') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(renderCollections(storedCollections));
  }

  if (config.catalogFranchises === false && req.query.owned_only !== '1') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(renderCollections([...curated, ...imported, ...storedCollections]));
  }

  // A saved account collection document may contain additional custom
  // collections, but it must not silently remove the live library-franchise
  // collection. Respect an explicitly saved replacement with the same id.
  if (storedCollections.some((collection) => collection?.id === 'collection-lelibrary-franchises')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(renderCollections([...curated, ...imported, ...storedCollections]));
  }

  const userKey = providers.getUserKey(config);
  const ownedOnly = req.query.owned_only === '1';
  if (!knownConfigs.has(req.params.token)) {
    rememberConfig(req.params.token, config);
    // A normal client request can populate a cold cache in the background.
    // The account push path must not: it needs the finished folder projection
    // before it writes Nuvio's static collection document.
    if (!ownedOnly) buildAndCacheForConfig(req.params.token, config).catch(() => {});
  }
  let metas = getCollections(userKey, lang);
  if (metas.length === 0) {
    // Do not make an install or a Nuvio sync wait while every owned title is
    // rematched into franchise folders after a restart. The normal catalog
    // build persists this exact payload in Redis, so restore it first just as
    // the manifest route does.
    try {
      const persistentKey = cache.makeKey('cat', 'collections', 'collections', config.sortBy || 'data_adicao', '', '0', userKey, lang, posterFp(config));
      const persistent = await cache.get(persistentKey);
      if (Array.isArray(persistent?.metas) && persistent.metas.length > 0) {
        metas = persistent.metas;
        cacheCollections(userKey, lang, metas);
      }
    } catch (err) {
      console.warn('[Nuvio] Collections cache restore failed:', err.message);
    }
  }
  if (metas.length === 0 && ownedOnly) {
    try {
      await buildAndCacheForConfig(req.params.token, config);
      metas = getCollections(userKey, lang);
    } catch (err) {
      console.warn('[Nuvio] Owned collection build failed:', err.message);
    }
  }
  if (metas.length === 0) {
    // A cold cache builds in the background. Returning the rest of the native
    // setup immediately keeps Nuvio responsive; the next push will include
    // the freshly built franchise folders.
    if (!knownConfigs.has(req.params.token)) rememberConfig(req.params.token, config);
    buildAndCacheForConfig(req.params.token, config).catch((err) => {
      console.warn('[Nuvio] Background collection build failed:', err.message);
    });
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(renderCollections([...curated, ...imported]));
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  const ownedLibraryCollection = buildLibraryCollection(metas, addonId, config);
  if (req.query.owned_only === '1') return res.json(renderCollections([ownedLibraryCollection]));
  res.json(renderCollections([...curated, ...imported, ...storedCollections, ownedLibraryCollection]));
}

app.get('/:token/collections.json', handleNuvioProfile);
app.get('/:token/nuvio-collections/manifest.json', handleNuvioProfile);
app.get('/:token/nuvio-collections.json', handleNuvioProfile);

// Native search normally queries TMDB. Add a small, targeted pass over the
// cached provider library so a user's own titles are discoverable too, without
// re-matching their entire library on every keystroke.
async function searchOwnedLibrary({ config, tmdbApiKey, type, query, sortBy, lang, enhance, userKey }) {
  const words = String(query || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(word => word.length > 1);
  if (!words.length) return [];
  try {
    const downloads = await providers.fetchDownloads(config);
    const candidates = downloads.filter((item) => {
      const name = String(item?.name || item?.filename || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '');
      return words.every(word => name.includes(word));
    });
    if (!candidates.length) return [];
    return buildCatalog(candidates, tmdbApiKey, type, sortBy, { search: query }, lang,
      { erdbToken: enhance.erdbToken, rpdbKey: enhance.rpdbKey },
      { userKey, hideAnime: config.hideAnime === true, libraryIdMode: config.libraryIdMode || 'torbox' });
  } catch (err) {
    console.warn('[Search] owned-library search failed:', err.message);
    return [];
  }
}

function mergeSearchResults(...groups) {
  const seen = new Set();
  const merged = [];
  for (const group of groups) {
    for (const row of (Array.isArray(group) ? group : [])) {
      if (!row) continue;
      // Library rows normally use torbox ids while TMDB uses IMDb ids. Match
      // on media type/title/year instead, keeping the owned copy first.
      const key = [row.type || '', String(row.name || '').toLowerCase().trim(), row.releaseInfo || row.year || ''].join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
      if (merged.length >= 50) return merged;
    }
  }
  return merged;
}

function searchCollectionFilms({ userKey, lang, query, libraryIdMode }) {
  const words = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 1);
  if (!words.length) return [];
  const rows = [];
  for (const collection of getCollections(userKey, lang)) {
    for (const video of (collection.videos || [])) {
      const title = String(video.title || '').toLowerCase();
      if (!words.every(word => title.includes(word))) continue;
      const tmdbId = video.tmdbId || Number(String(video.id || '').split(':').pop());
      rows.push({
        id: libraryIdMode === 'tt' && video.imdbId ? video.imdbId : `torbox:movie:${tmdbId}`,
        type: 'movie', name: video.title, tmdbId,
        poster: video.thumbnail ? video.thumbnail.replace('/w300', '/w500') : null,
        releaseInfo: String(video.released || '').slice(0, 4) || undefined,
        released: video.released || undefined,
      });
    }
  }
  return rows.filter(row => row.poster).slice(0, 50);
}

async function handleCatalog(req, res) {
  const config = await require('./src/configstore').mergeStoredConfig(await resolveConfig(req.params.token));
  if (!config) return res.json({ metas: [] });

  const { tmdbApiKey, sortBy = 'data_adicao', lang = 'en-US', rdCatalog = 'merge', erdbToken, rpdbKey, omdbKey, fanartKey, posterProvider, hideAnime, libraryIdMode } = config;
  const active = providers.activeProviders(config);
  if (!tmdbApiKey) return res.json({ metas: [] });

  // Compact `lelibrary-curated-*` and imported folder routes return early
  // below. Register before dispatch so account Collection Wizard installs keep
  // rebuilding My Movies/My Shows when the provider library changes.
  if (active.length) registerBackgroundRefresh(req.params.token, config);

  const catalogId = req.params.catalogId;

  const searchMatch = catalogId.match(/^lelibrary-search-(movies|series)$/);
  const ownedSearchMatch = catalogId.match(/^lelibrary-search-my-(movies|series)$/);
  if (searchMatch) {
    const extra = parseExtra(req.params.extra || '');
    const query = extra.search || '';
    const type = searchMatch[1] === 'movies' ? 'movie' : 'series';
    const enhance = { erdbToken, rpdbKey, omdbKey, fanartKey, posterProvider, enhanceBackground: config.enhanceBackground, enhanceLogo: config.enhanceLogo };
    const tmdbMetas = await searchCatalog({
      apiKey: tmdbApiKey, query, type, lang,
      enhance,
      enhanceFingerprint: posterFp(config),
    });
    const scope = ['combined', 'library', 'tmdb'].includes(config.searchScope) ? config.searchScope : 'combined';
    let metas = tmdbMetas;
    if (scope === 'combined') {
      const owned = await searchOwnedLibrary({
        config, tmdbApiKey, type, query, sortBy, lang,
        enhance: { erdbToken, rpdbKey }, userKey: providers.getUserKey(config),
      });
      const collectionFilms = type === 'movie'
        ? searchCollectionFilms({ userKey: providers.getUserKey(config), lang, query, libraryIdMode })
        : [];
      metas = mergeSearchResults(owned, collectionFilms, tmdbMetas);
    }
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return res.json(withCacheHints({ metas }, { cacheMaxAge: 60, staleRevalidate: 300, staleError: 1800 }));
  }
  if (ownedSearchMatch) {
    const extra = parseExtra(req.params.extra || '');
    const type = ownedSearchMatch[1] === 'movies' ? 'movie' : 'series';
    const metas = await searchOwnedLibrary({
      config, tmdbApiKey, type, query: extra.search || '', sortBy, lang,
      enhance: { erdbToken, rpdbKey }, userKey: providers.getUserKey(config),
    });
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return res.json(withCacheHints({ metas }, { cacheMaxAge: 60, staleRevalidate: 300, staleError: 1800 }));
  }
  if (catalogId === 'lelibrary-search-collections' && req.params.type === 'movie') {
    const extra = parseExtra(req.params.extra || '');
    const metas = searchCollectionFilms({ userKey: providers.getUserKey(config), lang, query: extra.search || '', libraryIdMode });
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return res.json(withCacheHints({ metas }, { cacheMaxAge: 60, staleRevalidate: 300, staleError: 1800 }));
  }

  const importedMatch = catalogId.match(/^lelibrary-import-(movie|series)(?:,(imp_[a-f0-9]{64}))?$/);
  if (importedMatch) {
    const extra = parseExtra(req.params.extra || '');
    const type = importedMatch[1] === 'movie' ? 'movie' : 'series';
    const skip = parseInt(extra.skip) || 0;
    const search = extra.search || '';
    let metas = [];
    if (importedMatch[2]) {
      // Only an opaque account token can resolve an imp_* definition. The
      // visible genre is deliberately ignored and remains presentation only.
      if (config.__configScope?.type !== 'account' || !HOSTED?.resolveImportedSource) return res.json({ metas: [] });
      const definition = await HOSTED.resolveImportedSource(req.params.token, importedMatch[2], type);
      if (!definition) return res.json({ metas: [] });
      try {
        metas = await require('./src/libcatalog').buildNormalizedImportedCatalog({
          definition, tmdbApiKey, lang, skip, search,
          enhance: { erdbToken, rpdbKey, fanartKey, posterProvider }, posterFp: posterFp(config),
        });
      } catch (error) {
        console.warn(`[Imported catalog] ${error.code || 'upstream_error'}`);
        const messages = {
          source_not_found: 'This public list or collection was deleted, made private, or is unavailable.',
          source_unavailable: 'This public source is no longer accessible.',
          provider_not_configured: 'This source provider is not configured on LeLibrary.',
          rate_limited: 'The source provider is temporarily rate limiting requests.',
          temporary_upstream_error: 'The source provider is temporarily unavailable.',
        };
        return res.json({ metas: [], sourceError: { code: error.code || 'upstream_error', message: messages[error.code] || 'This imported source is unavailable.' } });
      }
    } else {
      // Read-only compatibility for existing pre-normalization imports. New
      // imports never create these recipe strings.
      const ref = String(extra.genre || '');
      metas = await require('./src/libcatalog').buildImportedCatalog({ tmdbApiKey, ref, type, lang, userKey: providers.getUserKey(config), skip, search, enhance: { erdbToken, rpdbKey, fanartKey, posterProvider }, posterFp: posterFp(config), mdblistKey: config.mdblistKey });
    }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints({ metas }, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
  }

  // Curated Nuvio folders share one hidden catalogue per media type. Their
  // original lib-* source id is carried by the genre extra, avoiding a huge
  // manifest while retaining the normal catalogue implementation.
  const curatedMatch = catalogId.match(/^lelibrary-curated-(movie|series)(?:,(lib-[a-z0-9_]+))?$/);
  if (curatedMatch) {
    const extra = parseExtra(req.params.extra || '');
    const rawSource = curatedMatch[2] || String(extra.genre || '');
    const type = curatedMatch[1] === 'movie' ? 'movie' : 'series';
    const { curatedSourceIds, curatedSourceDisplayName } = require('./src/curated-collections');
    const { catalogs } = require('./src/catalogdefs');
    const configuredCuratedIds = curatedSourceIds(config.nuvioCollectionPacks);
    const libId = rawSource.startsWith('lib-')
      ? rawSource.slice(4)
      : configuredCuratedIds.find((id) => (
        (catalogs[id]?.type === 'movie' ? 'movie' : 'series') === type &&
        curatedSourceDisplayName(`lib-${id}`, catalogs[id]?.type) === rawSource
      ));
    const { getSourceDefinition } = require('./src/catalog-source-registry');
    const definition = getSourceDefinition(libId);
    if (!definition || (definition.type === 'movie' ? 'movie' : 'series') !== type) return res.json({ metas: [] });
    const skip = parseInt(extra.skip) || 0;
    const search = extra.search || '';
    const userKey = providers.getUserKey(config);
    const { buildLibraryCatalog } = require('./src/libcatalog');
    let metas = [];
    try {
      metas = await buildLibraryCatalog({ tmdbApiKey, catalogId: libId, lang, userKey, skip, search, enhance: { erdbToken, rpdbKey, fanartKey, posterProvider }, posterFp: posterFp(config), mdblistKey: config.mdblistKey });
    } catch (err) {
      console.error(`[Curated] ${libId} error:`, err.message);
    }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints({ metas }, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
  }

  // ── NuvioTV dynamic franchise MOVIE catalog (collection-{tmdbId}) ──
  // These IDs are deliberately not advertised in the manifest: NuvioTV can
  // resolve addon sources used only inside native folders. Keeping them hidden
  // prevents a large debrid library from becoming hundreds of Home rows.
  const dynamicCollectionMatch = catalogId.match(/^collection-(\d+)$/);
  if (dynamicCollectionMatch && req.params.type === 'movie') {
    const collectionId = dynamicCollectionMatch[1];
    const extra = parseExtra(req.params.extra || '');
    const skip = parseInt(extra.skip) || 0;
    const search = extra.search || '';
    const token = req.params.token;
    if (!knownConfigs.has(token)) {
      rememberConfig(token, config);
      buildAndCacheForConfig(token, config).catch(() => {});
    }
    const userKey = providers.getUserKey(config);
    let metas = getCollections(userKey, lang);
    if (metas.length === 0) {
      try {
        const persistentKey = cache.makeKey('cat', 'collections', 'collections', sortBy, '', '0', userKey, lang, posterFp(config));
        const persistent = await cache.get(persistentKey);
        if (Array.isArray(persistent?.metas) && persistent.metas.length > 0) {
          metas = persistent.metas;
          cacheCollections(userKey, lang, metas);
        }
        if (metas.length === 0) {
          const all = await providers.fetchDownloads(config);
          if (!Array.isArray(all) || all.length === 0) return res.json({ metas: [] });
          metas = await buildCollectionsCatalog(all, tmdbApiKey, lang, { erdbToken, rpdbKey });
          if (metas.length > 0) cacheCollections(userKey, lang, metas);
        }
      } catch (err) {
        console.error('[Collections] Dynamic movie catalog error:', err.message);
        return res.json({ metas: [] });
      }
    }
    const filmMetas = collectionCatalogMetas(metas, collectionId, libraryIdMode)
      .filter((film) => !search || (film.name || '').toLowerCase().includes(search.toLowerCase()));
    const paginated = filmMetas.slice(skip, skip + 50);
    console.log(`[Collections] Dynamic movie catalog ${collectionId} → ${paginated.length} films`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints({ metas: paginated }, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
  }

  // ── Legacy per-franchise MOVIE catalog (torbox-collection-{key}) ──
  // Kept for backward compat with folders/saga links pushed before the
  // single-catalog refactor; no longer advertised in the manifest. Lists one
  // franchise's owned films as plain movies. Clicking a film reuses the normal
  // torbox:movie meta + stream path.
  if (catalogId.startsWith('torbox-collection-')) {
    const key = catalogId.slice('torbox-collection-'.length);
    const extra  = parseExtra(req.params.extra || '');
    const skip   = parseInt(extra.skip) || 0;
    const search = extra.search || '';

    const token = req.params.token;
    if (!knownConfigs.has(token)) {
      rememberConfig(token, config);
      buildAndCacheForConfig(token, config).catch(() => {});
    }
    const userKey = providers.getUserKey(config);
    let metas = getCollections(userKey, lang);
    if (metas.length === 0) {
      try {
        // Prefer the persistent collections cache before rebuilding. A temporary
        // empty provider response must not erase a previously working franchise
        // folder and turn it into "No Items Found".
        const persistentKey = cache.makeKey('cat', 'collections', 'collections', sortBy, '', '0', userKey, lang, posterFp(config));
        const persistent = await cache.get(persistentKey);
        if (Array.isArray(persistent?.metas) && persistent.metas.length > 0) {
          metas = persistent.metas;
          cacheCollections(userKey, lang, metas);
        }
        if (metas.length > 0) {
          console.log(`[Collections] Film catalog: restored ${metas.length} cached collections (${key})`);
        } else {
          const all = await providers.fetchDownloads(config);
          // Do not replace an existing in-memory collection map with an empty
          // rebuild. The normal path already retains stale data on empty scans.
          if (!Array.isArray(all) || all.length === 0) {
            console.warn(`[Collections] Film catalog: provider returned no downloads (${key})`);
            return res.json({ metas: [] });
          }
          metas = await buildCollectionsCatalog(all, tmdbApiKey, lang, { erdbToken, rpdbKey });
          if (metas.length > 0) cacheCollections(userKey, lang, metas);
          console.log(`[Collections] Film catalog: rebuilt → ${metas.length} collections (${key})`);
        }
      } catch (err) {
        console.error('[Collections] Film catalog error:', err.message);
        return res.json({ metas: [] });
      }
    }
    const coll = metas.find(m => m.id.split(':')[2] === key);
    if (!coll) {
      console.warn(`[Collections] Film catalog: key "${key}" not found among ${metas.length} collections`);
      return res.json({ metas: [] });
    }

    const filmMetas = (coll.videos || [])
      .map(v => ({
        id: libraryIdMode === 'tt' && v.imdbId ? v.imdbId : `torbox:movie:${v.id.split(':').pop()}`,
        type: 'movie',
        name: v.title,
        poster: v.thumbnail ? v.thumbnail.replace('/w300', '/w500') : null,
        releaseInfo: (v.released || '').slice(0, 4) || undefined,
        released: v.released || undefined,
      }))
      .filter(f => f.poster)
      .filter(f => !search || (f.name || '').toLowerCase().includes(search.toLowerCase()));

    const paginated = filmMetas.slice(skip, skip + 50);
    console.log(`[Collections] Film catalog "${key}" → ${paginated.length} films`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints({ metas: paginated }, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
  }

  // ── Catalog library rows (lib-{catalogId} from catalogdefs.js) ──
  // Rows carry plain tt: ids; the handler (TMDB discover/keyword/company/etc.)
  // is looked up in catalogdefs. MDBList-backed rows need the user's mdblistKey.
  if (catalogId.startsWith('lib-')) {
    const libId = catalogId.slice(4);
    const extra = parseExtra(req.params.extra || '');
    const skip = parseInt(extra.skip) || 0;
    const search = extra.search || '';
    const userKey = providers.getUserKey(config);
    const { buildLibraryCatalog } = require('./src/libcatalog');
    let paginated = [];
    try {
      paginated = await buildLibraryCatalog({ tmdbApiKey, catalogId: libId, lang, userKey, skip, search, enhance: { erdbToken, rpdbKey, fanartKey, posterProvider }, posterFp: posterFp(config), mdblistKey: config.mdblistKey });
    } catch (err) {
      console.error(`[LibCat] ${libId} error:`, err.message);
    }
    console.log(`[LibCat] ${libId} → ${paginated.length} rows`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints({ metas: paginated }, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
  }

  // ── Watchlist catalogs (Simkl / MDBList / Trakt) ──
  // torbox-watchlist-{simkl,mdblist,trakt}-{movie,series}. Rows carry pure tt:
  // ids so external stream addons and Nuvio enrichment work. Handled before the
  // generic path (would otherwise look like a library catalog).
  const wlMatch = catalogId.match(/^torbox-watchlist-([a-z]+)-(movie|series)$/);
  if (wlMatch) {
    const wlProvider = wlMatch[1];
    const wlType = wlMatch[2];
    const extra = parseExtra(req.params.extra || '');
    const skip = parseInt(extra.skip) || 0;
    const search = extra.search || '';
    const userKey = providers.getUserKey(config);
    if (!HOSTED) return res.json({ metas: [] });
    let paginated = [];
    try {
      paginated = await HOSTED.buildWatchlistCatalog({ token: req.params.token, config, provider: wlProvider, type: wlType, lang, userKey, skip, search });
    } catch (err) {
      console.error(`[Watchlist] ${wlProvider} ${wlType} error:`, err.message);
    }
    console.log(`[Watchlist] ${wlProvider}:${wlType} → ${paginated.length} rows`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints({ metas: paginated }, { cacheMaxAge: 300, staleRevalidate: 300, staleError: 1800 }));
  }

  // ── Trending / Popular discovery catalogs ──
  // torbox-trending-{movies,series} / torbox-popular-{movies,series}. These
  // rows carry plain tt: (IMDb) meta ids so other stream addons contribute
  // streams. Handled BEFORE the generic path (which keys off -movies/-series
  // suffixes and would treat them as library catalogs).
  const discMatch = catalogId.match(/^torbox-(trending|popular)-(movies|series)$/);
  if (discMatch) {
    const kind     = discMatch[1];   // trending | popular
    const apiType  = discMatch[2] === 'movies' ? 'movie' : 'tv'; // TMDB's own names
    const extra    = parseExtra(req.params.extra || '');
    const skip     = parseInt(extra.skip) || 0;
    const search   = extra.search || '';
    const userKey  = providers.getUserKey(config);
    let paginated;
    try {
      paginated = await buildDiscoveryCatalog({ tmdbApiKey, kind, apiType, lang, userKey, skip, search, enhance: { erdbToken, rpdbKey, fanartKey, posterProvider }, posterFp: posterFp(config) });
    } catch (err) {
      console.error(`[Discovery] ${kind} ${apiType} error:`, err.message);
      return res.json({ metas: [] });
    }
    console.log(`[Discovery] ${kind} ${apiType} → ${paginated.length} metas (skip=${skip})`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints({ metas: paginated }, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
  }

  // ── "LeLibrary Collections" movie catalog (torbox-collections) ──
  // One catalog listing every owned franchise film as a plain movie. Filtered
  // by the `genre` extra (a franchise name), which Nuvio collection folders and
  // Stremio's Discover genre dropdown both send; `search` and `skip` work too.
  // Handled before the separate-mode provider check so it works for every user
  // regardless of provider mode.
  if (catalogId === 'torbox-collections' && req.params.type === 'movie') {
    const extra  = parseExtra(req.params.extra || '');
    const skip   = parseInt(extra.skip) || 0;
    const search = extra.search || '';
    const genre  = extra.genre || '';
    const collectionIdFilter = String(genre).match(/^collection-(\d+)$/)?.[1] || '';

    const token = req.params.token;
    if (!knownConfigs.has(token)) {
      rememberConfig(token, config);
      buildAndCacheForConfig(token, config).catch(() => {});
    }
    const userKey = providers.getUserKey(config);
    let metas = getCollections(userKey, lang);
    if (metas.length === 0) {
      try {
        // Prefer the persistent collections cache before rebuilding. A temporary
        // empty provider response must not erase a previously working row.
        const persistentKey = cache.makeKey('cat', 'collections', 'collections', sortBy, '', '0', userKey, lang, posterFp(config));
        const persistent = await cache.get(persistentKey);
        if (Array.isArray(persistent?.metas) && persistent.metas.length > 0) {
          metas = persistent.metas;
          cacheCollections(userKey, lang, metas);
        }
        if (metas.length === 0) {
          const all = await providers.fetchDownloads(config);
          if (!Array.isArray(all) || all.length === 0) {
            console.warn('[Collections] Movie catalog: provider returned no downloads');
            return res.json({ metas: [] });
          }
          metas = await buildCollectionsCatalog(all, tmdbApiKey, lang, { erdbToken, rpdbKey });
          if (metas.length > 0) cacheCollections(userKey, lang, metas);
        }
      } catch (err) {
        console.error('[Collections] Movie catalog error:', err.message);
        return res.json({ metas: [] });
      }
    }

    const filmMetas = [];
    for (const c of metas) {
      const fname = franchiseRowName(c.name);
      if (collectionIdFilter) {
        if (String(c.collectionId) !== collectionIdFilter) continue;
      } else if (genre && fname !== genre) continue;
      for (const v of (c.videos || [])) {
        filmMetas.push({
          id: libraryIdMode === 'tt' && v.imdbId ? v.imdbId : `torbox:movie:${v.id.split(':').pop()}`,
          type: 'movie',
          name: v.title,
          poster: v.thumbnail ? v.thumbnail.replace('/w300', '/w500') : null,
          releaseInfo: (v.released || '').slice(0, 4) || undefined,
          released: v.released || undefined,
        });
      }
    }
    const filtered = filmMetas
      .filter(f => f.poster)
      .filter(f => !search || (f.name || '').toLowerCase().includes(search.toLowerCase()));
    const paginated = filtered.slice(skip, skip + 50);
    console.log(`[Collections] Movie catalog "${genre || 'all'}" → ${paginated.length} films`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints({ metas: paginated }, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
  }

  // ── Legacy Collections series catalog (dead code, kept for backward compat) ──
  // Spans ALL providers, isolated to torbox:collection:* metas.
  if (catalogId.endsWith('-collections')) {
    const extra  = parseExtra(req.params.extra || '');
    const skip   = parseInt(extra.skip) || 0;
    const search = extra.search || '';

    const token = req.params.token;
    if (!knownConfigs.has(token)) {
      rememberConfig(token, config);
      buildAndCacheForConfig(token, config).catch(() => {});
    }
    const userKey = providers.getUserKey(config);
    const collKey = cache.makeKey('cat', 'collections', 'collections', sortBy, '', '0', userKey, lang, posterFp(config));
    let metas = null;
    const cached = await cache.get(collKey);
    if (cached) {
      metas = cached.metas;
      console.log(`[Collections] Cache hit → ${metas.length} items`);
    } else {
      try {
        const all = await providers.fetchDownloads(config);
        metas = await buildCollectionsCatalog(all, tmdbApiKey, lang, { erdbToken, rpdbKey });
        cacheCollections(userKey, lang, metas);
        await cache.set(collKey, { metas }, TTL_CATALOG);
        console.log(`[Collections] Built → ${metas.length} items`);
      } catch (err) {
        console.error('[Collections] Error:', err.message);
        return res.json({ metas: [] });
      }
    }
    if (search) metas = metas.filter(m => (m.name || '').toLowerCase().includes(search.toLowerCase()));
    const paginated = metas.slice(skip, skip + 50);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints({ metas: paginated }, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
  }

  const prefix    = catalogId.split('-')[0];
  const separate  = rdCatalog === 'separate';

  // Which provider(s) feed this catalog? In merge mode all active providers;
  // in separate mode only the provider owning the catalog id prefix.
  let catalogProviderId = null;
  if (separate) {
    catalogProviderId = providers.providerByCat(prefix);
    if (!catalogProviderId || !active.includes(catalogProviderId)) return res.json({ metas: [] });
  }

  let type;
  if (catalogId.endsWith('-anime'))   type = 'anime';
  else if (catalogId.endsWith('-movies')) type = 'movie';
  else type = 'series';

  const extra  = parseExtra(req.params.extra || '');
  const skip   = parseInt(extra.skip) || 0;
  const search = extra.search || '';

  console.log(`[Catalog] catalog=${catalogId} type=${type} skip=${skip} lang=${lang}`);

  const token = req.params.token;
  if (!knownConfigs.has(token)) {
    rememberConfig(token, config);
    buildAndCacheForConfig(token, config).catch(() => {});
  }

  const userKey  = providers.getUserKey(config);
  const catKey   = separate ? providers.PROVIDER_META[catalogProviderId].cat : 'merged';
  // hideAnime is part of the key: installs sharing provider keys but differing
  // in hide-anime used to serve each other's rows for the whole TTL.
  const cacheKey = cache.makeKey('cat', catKey, type, sortBy, search, skip.toString(), userKey, lang, posterFp(config), libraryIdMode, hideAnime ? 'noanime' : '');
  // Long-lived "last good" copy of this catalog page. The serve-stale branches
  // below used to re-read `cacheKey` itself: the exact key that just missed -
  // so the protection never fired. This snapshot is only written on success.
  const catlastKey = cache.makeKey('catlast', catKey, type, sortBy, skip.toString(), userKey, lang);
  const cached   = await cache.get(cacheKey);

  // A previous upstream throttle used to cache zero rows for a whole hour.
  // Treat empty pages as a recovery opportunity: a successful provider read
  // below replaces them, while a failed read falls back without extending the
  // poisoned cache.
  if (cached && Array.isArray(cached.metas) && cached.metas.length > 0) {
    console.log(`[Catalog] Cache hit → ${cached.metas.length} items`);
    populateTmdbIndexFromMetas(cached.metas, userKey);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints(cached, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
  }

  try {
    // In separate mode fetch only this provider's downloads; in merge mode all.
    const all   = await providers.fetchDownloads(config, { only: separate ? [catalogProviderId] : null });
    const downloads = separate ? providers.downloadsFor(all, catalogProviderId) : all;

    // Compute the same projection-scoped hash as the background refresh.
    // This keeps a direct Nuvio request from undoing another profile's cache
    // comparison when both use the same provider account.
    const projectionFp = hashShort(JSON.stringify({
      sortBy, lang, rdCatalog, poster: posterFp(config), libraryIdMode: libraryIdMode || 'torbox', hideAnime: !!hideAnime,
    }));
    const newHash = `${hashDownloads(downloads)}:${posterFp(config)}:${libraryIdMode || 'torbox'}`;
    const hashKey = cache.makeKey('dlhash', 'v2', userKey, projectionFp);
    const oldHash = await cache.get(hashKey);
    const hashChanged = oldHash !== newHash;

    // Resilience: a suddenly-empty provider response must not blank the cached
    // catalog. If we had content before and now get nothing, serve the last
    // good snapshot instead of rebuilding it empty.
    if (hashChanged && downloads.length === 0 && oldHash) {
      const stale = await cache.get(catlastKey).catch(() => null);
      if (stale) {
        console.log('[Catalog] Empty provider response: serving cached catalog instead of blanking');
        await cache.touchPattern(`cat:*${userKey}*`, TTL_CATALOG);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
        return res.json(withCacheHints(stale, { cacheMaxAge: 60, staleRevalidate: 60, staleError: 1800 }));
      }
    }

    // Progressive: return already-known items immediately, complete the rest in the background
    const built = await buildCatalog(downloads, tmdbApiKey, type, sortBy, { skip, search }, lang, { erdbToken, rpdbKey }, { progressive: true, userKey, hideAnime, libraryIdMode });
    const isPartial = !!built.completion;
    const metas     = built.metas || built;

    if (isPartial) {
      console.log(`[Catalog] Fast-returning ${metas.length} metas, completing ${built._fresh || 0} in background`);
      // Serve partial immediately (short cache so the client re-fetches once complete)
      await cache.set(cacheKey, { metas }, 10);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      res.json(withCacheHints({ metas }, { cacheMaxAge: 10, staleRevalidate: 10, staleError: 1800 }));
      // Finish matching + rebuild full catalog in the background
      built.completion.then(async () => {
        try {
          const full = await buildCatalog(downloads, tmdbApiKey, type, sortBy, { skip, search }, lang, { erdbToken, rpdbKey }, { userKey, hideAnime, libraryIdMode });
          const result = { metas: full };
          if (hashChanged) {
            await cache.set(hashKey, newHash, 7200);
            await cache.delPattern(`cat:*${userKey}*`);
          }
          await Promise.all([
            cache.set(cacheKey, result, TTL_CATALOG),
            cache.set(catlastKey, result, 7 * 86400), // last-good snapshot for outage fallback
          ]);
          console.log(`[Catalog] Progressive completion → ${full.length} metas cached`);
        } catch (err) {
          console.error('[Catalog] Progressive completion error:', err.message);
        }
      }).catch(() => {});
      return;
    }

    console.log(`[Catalog] Built → ${metas.length} metas`);

    if (hashChanged) {
      await cache.set(hashKey, newHash, 7200);
      await cache.delPattern(`cat:*${userKey}*`);
    }

    const result = { metas };
    await Promise.all([
      cache.set(cacheKey, result, TTL_CATALOG),
      metas.length > 0 ? cache.set(catlastKey, result, 7 * 86400) : Promise.resolve(),
    ]);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.json(withCacheHints(result, { cacheMaxAge: TTL_CATALOG, staleRevalidate: TTL_CATALOG, staleError: 1800 }));
  } catch (err) {
    console.error('[Catalog] Error:', err.message);
    // If we had a last-good snapshot, serve it as fallback instead of empty
    const stale = await cache.get(catlastKey).catch(() => null);
    if (stale) {
      console.log('[Catalog] Serving stale cache as fallback');
      return res.json(withCacheHints(stale, { cacheMaxAge: 60, staleRevalidate: 60, staleError: 1800 }));
    }
    res.json({ metas: [] });
  }
}

app.get('/:token/catalog/:type/:catalogId.json', handleCatalog);
app.get('/:token/catalog/:type/:catalogId/:extra.json', handleCatalog);

// ── Catalog preview (configure page) ────────────────────────────────────
// Renders a small poster grid of a user's catalog by running the REAL catalog
// pipeline (same handler, same cache, same gates) and truncating the result.
// This keeps the website preview in lockstep with what Stremio/Nuvio actually
// receive: no parallel TMDB re-implementation that could drift.
app.get('/:token/preview/:type/:catalogId.json', rateLimit({ windowMs: 60000, max: 40 }), async (req, res) => {
  try {
    const config = await require('./src/configstore').mergeStoredConfig(await resolveConfig(req.params.token));
    if (!config) return res.json({ metas: [], error: 'invalid_token' });
    const { tmdbApiKey } = config;
    const active = providers.activeProviders(config);
    if (!tmdbApiKey || active.length === 0) return res.json({ metas: [], error: 'missing_keys' });

    // Forward any genre/search/skip extras so collections and filters preview honestly.
    const extraStr = Object.entries(req.query || {})
      .filter(([k]) => /^(genre|search|skip|sort)$/.test(String(k)))
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');

    const captured = {};
    const fakeRes = { setHeader() {}, json(body) { captured.body = body; } };
    const fakeReq = { params: { token: req.params.token, type: req.params.type, catalogId: req.params.catalogId, extra: extraStr } };
    await handleCatalog(fakeReq, fakeRes);

    const metas = Array.isArray(captured.body && captured.body.metas) ? captured.body.metas : [];
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.json({ metas: metas.slice(0, 12), total: metas.length });
  } catch (err) {
    console.error('[Preview] error:', err.message);
    res.status(500).json({ error: 'preview_failed' });
  }
});

// POST preview: same pipeline but config comes in JSON body to avoid URL-length
// limits when the user has large imported collections (e.g. Kaptain 22-folder pack).
app.post('/api/preview', express.json({ limit: '2mb' }), rateLimit({ windowMs: 60000, max: 40 }), async (req, res) => {
  try {
    const body = req.body || {};
    let config = body.config;
    if ((!config || typeof config !== 'object') && body.token) {
      config = await require('./src/configstore').mergeStoredConfig(await resolveConfig(body.token));
    }
    if (!config || typeof config !== 'object') return res.status(400).json({ error: 'missing_config' });
    const type = String(body.type || '').trim();
    const catalogId = String(body.catalogId || '').trim();
    if (!type || !catalogId) return res.status(400).json({ error: 'missing_params' });
    const { tmdbApiKey } = config;
    const active = providers.activeProviders(config);
    if (!tmdbApiKey || active.length === 0) return res.json({ metas: [], error: 'missing_keys' });
    const extraStr = typeof body.extra === 'string' ? body.extra
      : Object.entries(body.extra || body.query || {}).filter(([k]) => /^(genre|search|skip|sort)$/.test(String(k))).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
    const tokenMap = require('./website/public/token-map.js');
    const token = tokenMap.encodeConfig(config);
    const captured = {};
    const fakeRes = { setHeader() {}, json(b) { captured.body = b; } };
    const fakeReq = { params: { token, type, catalogId, extra: extraStr } };
    await handleCatalog(fakeReq, fakeRes);
    const metas = Array.isArray(captured.body && captured.body.metas) ? captured.body.metas : [];
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.json({ metas: metas.slice(0, 12), total: metas.length });
  } catch (err) {
    console.error('[Preview POST] error:', err.message);
    res.status(500).json({ error: 'preview_failed' });
  }
});

// ─── META ─────────────────────────────────────────────────────────────────────
app.get('/:token/meta/:type/:id.json', async (req, res) => {
  const baseConfig = await resolveConfig(req.params.token);
  if (!baseConfig) return res.json({ meta: null });
  const config = await require('./src/configstore').mergeStoredConfig(baseConfig);

  const { tmdbApiKey, lang = 'en-US', erdbToken, rpdbKey, omdbKey, fanartKey, enhanceBackground, enhanceLogo, customStreams } = config;
  const active = providers.activeProviders(config);
  const { type, id } = req.params;
  if (!tmdbApiKey || active.length === 0) return res.json({ meta: null });

  console.log(`[Meta] Request: type=${type} id=${id}`);

  // Discovery rows (Trending/Popular) carry plain tt: (IMDb) ids so Nuvio and
  // Stremio route streams to every installed addon that claims the 'tt' prefix
  // (Torrentio, Comet, Meteor, MediaFusion). The meta itself is built from TMDB
  // and cached under the torbox: namespace, so for a tt: request we serve it
  // back with the plain tt: id in the response only. This keeps the detail page
  // requesting streams by the IMDb id; the cached copy keeps its torbox: id for
  // library/franchise rows, where only LeLibrary should answer.
  const ttId = id.startsWith('tt') ? id.split(':')[0] : null;

  // ── Collections meta (torbox:collection:*: additive, isolated) ──
  if (id.startsWith('torbox:collection:')) {
    const userKey = providers.getUserKey(config);
    const cacheKey = cache.makeKey('meta', 'coll', id, lang, userKey, posterFp(config));
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log(`[Collections] Meta cache hit: ${id}`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      return res.json(withCacheHints(cached, { cacheMaxAge: 86400, staleRevalidate: 86400, staleError: 604800 }));
    }
    if (!knownConfigs.has(req.params.token)) {
      rememberConfig(req.params.token, config);
      buildAndCacheForConfig(req.params.token, config).catch(() => {});
    }
    let meta = getCollectionMeta(userKey, lang, id.split(':')[2]);
    if (!meta) {
      console.log(`[Collections] Meta not in memory cache (${id}): building`);
      try {
        const all = await providers.fetchDownloads(config);
        const metas = await buildCollectionsCatalog(all, tmdbApiKey, lang, { erdbToken, rpdbKey });
        cacheCollections(userKey, lang, metas);
        meta = getCollectionMeta(userKey, lang, id.split(':')[2]);
        console.log(`[Collections] Meta rebuilt → ${meta ? 'found' : 'STILL NULL'} (${id})`);
      } catch (err) {
        console.error(`[Collections] Meta build error (${id}):`, err.message);
        return res.json({ meta: null });
      }
    }
    if (!meta) {
      console.warn(`[Collections] Meta null for ${id}: client will not find this collection`);
      return res.json({ meta: null });
    }
    const result = { meta };
    await cache.set(cacheKey, result, 86400);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints(result, { cacheMaxAge: 86400, staleRevalidate: 86400, staleError: 604800 }));
  }

  let tmdbId;
  if (id.startsWith('torbox:')) {
    tmdbId = id.split(':')[2];
  } else if (id.startsWith('tt')) {
    const { imdbToTmdbCached } = require('./src/tmdb');
    const mapped = await imdbToTmdbCached(tmdbApiKey, id.split(':')[0]);
    if (!mapped) return res.json({ meta: null });
    tmdbId = String(mapped.tmdbId);
  } else {
    return res.json({ meta: null });
  }

  const userKey = providers.getUserKey(config);
  // Discovery (tt:) metas are proxied from the TMDB metadata addon with the
  // response id rewritten to tt:,
  // so they must not collide with the owned-filtered library/franchise metas.
  const discovery = !!ttId;
  const cacheKey = cache.makeKey('meta', 'v3', `torbox:${type}:${tmdbId}`, discovery ? 'tt' : '', lang, userKey, posterFp(config));
  const cached   = await cache.get(cacheKey);

  if (cached) {
    console.log(`[Meta] Cache hit: ${id} → ${cached.meta?.videos?.length || 0} eps`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.json(withCacheHints(discovery ? { meta: { ...cached.meta, id: ttId } } : cached, { cacheMaxAge: 86400, staleRevalidate: 86400, staleError: 604800 }));
  }

  console.log(`[Meta] Building: ${id} (tmdbId=${tmdbId})`);
  try {
    const enhance = { erdbToken, rpdbKey, omdbKey, fanartKey, posterProvider: config.posterProvider, enhanceBackground, enhanceLogo };
    const meta   = discovery
      ? await buildDiscoveryMeta({ tmdbApiKey, tmdbId, type, lang, enhance, imdbId: ttId })
      : await buildMeta(tmdbId, type, tmdbApiKey, lang, config, enhance, userKey, !discovery);
    const result = { meta };

    // Resilience: don't cache hollow results for 24h. A series with zero
    // episodes (provider down/empty) or a meta that failed to build (TMDB
    // blip) gets a 5-minute TTL so it rebuilds once the source is reachable
    // again: otherwise a temporary outage empties detail pages for a day.
    const metaTtl = (!meta || (type !== 'movie' && (!meta.videos || meta.videos.length === 0))) ? 300 : 86400;

    await cache.set(cacheKey, result, metaTtl);

    // "More from this saga": for movies that belong to a built collection, add
    // a Stremio detail link that opens the franchise's movie catalog (plain
    // movies, never a series/season view), plus the raw TMDB collection id
    // (NuvioWeb reads it for its native Collection tab). Purely additive;
    // skipped when the saga isn't in the collections cache.
    //
    // Applied AFTER caching: the link embeds THIS request's manifest URL, which
    // contains this user's config token. Mutating before cache.set baked one
    // user's token into every other user's cached meta for the full TTL.
    if (meta && type === 'movie') {
      const saga = getCollectionForMovie(userKey, lang, tmdbId);
      if (saga) {
        const manifestUrl = `${req.protocol}://${req.get('host')}/${req.params.token}/manifest.json`;
        meta.links = [
          ...(meta.links || []).filter(l => l && l.category !== 'saga'),
          { name: `More from the ${saga.name} saga`, category: 'saga', url: `stremio:///discover/${encodeURIComponent(manifestUrl)}/movie/torbox-collections?genre=${encodeURIComponent(franchiseRowName(saga.name))}` },
        ];
        meta.collectionId = saga.collectionId;
        meta.belongs_to_collection = { id: saga.collectionId, name: saga.name };
      }
    }

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.json(withCacheHints(discovery ? { meta: { ...result.meta, id: ttId } } : result, { cacheMaxAge: metaTtl, staleRevalidate: metaTtl, staleError: 604800 }));

    // Playback links are deliberately created only by the stream route below.
    // Nuvio opens several metadata pages while browsing, and prefetching each
    // title's TorBox requestdl URL consumed its stricter quota before playback.
    // The tt: owned-copy bridge remains unchanged: its real stream request
    // still lists owned streams before configured external addons.
  } catch (err) {
    console.error('[Meta] Error:', err.message);
    res.json({ meta: null });
  }
});

app.get('/:token/stream/:type/:id.json', async (req, res) => {
  const baseConfig = await resolveConfig(req.params.token);
  if (!baseConfig) return res.json({ streams: [] });
  // Merge server-side stream settings (addons + format) stored in Redis by the
  // configure page: the token stays small and these survive reloads/device
  // switches. Falls back to the token's own fields when nothing is stored.
  const config = await require('./src/configstore').mergeStoredConfig(baseConfig);

  const { tmdbApiKey, lang = 'en-US', customStreams } = config;
  const active = providers.activeProviders(config);
  if (!tmdbApiKey || active.length === 0) return res.json({ streams: [] });

  const { type, id } = req.params;
  if (!id.startsWith('torbox:') && !id.startsWith('tt') && !id.startsWith('kitsu:')) {
    return res.json({ streams: [] });
  }

  // ── Public IMDb streams (tt: ids) ──
  // Every public `tt:` row uses the shared discovery bridge: Trending/Popular,
  // imported and created public rows, plus library/collections in Main Meta
  // mode. When the user OWNS the title, their library copy is listed first,
  // then selected external addon streams.
  const externalAddons = Array.isArray(config.streamAddons) ? config.streamAddons : [];
  const userKey        = providers.getUserKey(config);
  // Include the stream-format fingerprint so changing the preset/templates
  // invalidates cached streams instead of serving stale names for the TTL.
  // The stream-notices toggle joins both fingerprints so flipping it takes
  // effect immediately instead of serving stale notice rows.
  const fmtFp = libraryStreamFmtFp(config);
  let tmdbId, season, episode;
  let buildType = type;

  try {
    if (id.startsWith('torbox:collection:')) {
      // torbox:collection:{collId}:{movieId}: a movie inside a collection.
      // Resolve the owned movie's stream directly (the movie catalogs/index
      // already populate tmdbindex; buildStreams falls back if not).
      const parts = id.split(':');
      const movieId = parts[3];
      if (!movieId) return res.json({ streams: [] });
      buildType = 'movie';
      tmdbId  = movieId;
      season  = undefined;
      episode = undefined;
    } else if (id.startsWith('torbox:')) {
      const parts = id.split(':');
      tmdbId  = parts[2];
      season  = parts[3];
      episode = parts[4];
    } else if (id.startsWith('kitsu:')) {
      const parts = id.split(':');
      const kitsuId = parts[1];
      episode = parts[2];
      const axios = require('axios');
      const kitsuRes = await axios.get(`https://kitsu.io/api/edge/anime/${kitsuId}`, { timeout: 5000 });
      const title = kitsuRes.data?.data?.attributes?.canonicalTitle;
      if (!title) return res.json({ streams: [] });
      const { searchMetadata } = require('./src/tmdb');
      const search = await searchMetadata(tmdbApiKey, title, 'tv', undefined, lang);
      if (!search) return res.json({ streams: [] });
      tmdbId = search.id;
    }

    // ── tt: id + stream addons → owned copy first, then external addons ──
    if (id.startsWith('tt')) {
      const { result } = await getPublicStreams({
        config, tmdbApiKey, type, id, lang, customStreams, userKey, externalAddons,
      });
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      return res.json(withCacheHints(result, { cacheMaxAge: TTL_STREAM, staleRevalidate: TTL_STREAM, staleError: 604800 }));
    }

    // Include the stream-format fingerprint so changing the preset/templates
    // invalidates cached streams instead of serving stale names for the TTL.
    const streamCacheKey = cache.makeKey('stream', buildType, tmdbId, season || '', episode || '', userKey + fmtFp);
    const cachedStreams  = await cache.get(streamCacheKey);
    if (cachedStreams) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      return res.json(withCacheHints(cachedStreams, { cacheMaxAge: TTL_STREAM, staleRevalidate: TTL_STREAM, staleError: 604800 }));
    }

    const streams = await buildStreams(config, tmdbApiKey, buildType, tmdbId, season, episode, lang, customStreams, userKey);
    const noticed  = await applyStreamNotices(streams, { config, tmdbApiKey, tmdbId, type: buildType });

    const result  = { streams: noticed };
    // Don't cache hollow results for the full TTL: a provider blip (e.g. TorBox
    // rate-limiting requestdl) would otherwise blank streams for 10 minutes.
    // Notice-only results count as hollow (the fallback row isn't a stream).
    const hasRealStreams = noticed.some(s => !s._notice);
    const streamTtl = hasRealStreams ? TTL_STREAM : 60;
    await cache.set(streamCacheKey, result, streamTtl);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.json(withCacheHints(result, { cacheMaxAge: TTL_STREAM, staleRevalidate: TTL_STREAM, staleError: 604800 }));
  } catch (err) {
    console.error('[Stream] Error:', err.message);
    res.json({ streams: [] });
  }
});

// Terminal error handler. Async rejections land here via the auto-wrapper
// above; without it Express 4's default would leak a stack trace as HTML.
// JSON for API routes, plain text otherwise: never an internal message.
app.use((err, req, res, next) => {
  console.error(`[Error] ${req.method} ${maskSensitivePath(req.path)}: ${err.stack || err.message}`);
  if (res.headersSent) return;
  const wantsJson = req.path.endsWith('.json') || req.path.startsWith('/api/');
  res.status(500);
  if (wantsJson) res.json({ error: 'Internal error' });
  else res.type('text').send('Internal error');
});

module.exports = app;
