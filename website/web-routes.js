const path = require('path');
const express = require('express');
const fs = require('fs');

const WEBSITE_DIR = path.resolve(__dirname);
const PUBLIC_DIR = path.join(WEBSITE_DIR, 'public');

// Simple in-memory rate limiter (per IP, website only — addon untouched)
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
// Cleanup stale buckets every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [ip, b] of rateLimitBuckets) { if (b.start < cutoff) rateLimitBuckets.delete(ip); }
}, 300000);

// All functional website routes (pages, proxies, verify, status, scrapers,
// clear-cache). Shared by the private website/index.js (serves the private
// landing page) and the public website/index.example.js (redirects / to the
// configure page) so self-hosters get the same API surface.
function createWebRoutes(decodeConfig, options = {}) {
  const router = express.Router();
  router.use(express.json());
  router.use(express.urlencoded({ extended: true }));

  // ── Page routes (BEFORE static to avoid immutable caching) ──

  // Landing page (private file — only served when present)
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
  router.get('/configure', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(WEBSITE_DIR, 'configure.html'));
  });

  // Library browser
  router.get('/my-library', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(PUBLIC_DIR, 'my-library', 'index.html'));
  });

  // Configure with injected config (from Stremio addon)
  router.get('/:token/configure', (req, res) => {
    const config = decodeConfig(req.params.token);
    if (!config) return res.status(400).send('Invalid token');

    const html = fs.readFileSync(path.join(WEBSITE_DIR, 'configure.html'), 'utf8');
    // Escape the injected JSON so a forged token's values can't break out of
    // the <script> block (config tokens are plain base64 with no signature).
    const safeJson = JSON.stringify(config)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    const injected = html.replace(
      '</head>',
      `<script>window.__INITIAL_CONFIG__ = ${safeJson}</script></head>`
    );
    res.setHeader('Cache-Control', 'no-cache');
    res.send(injected);
  });

  // Static files from website/public (CSS, JS, images)
  router.use(express.static(PUBLIC_DIR, {
    maxAge: '30d',
    etag: true,
    immutable: true,
    setHeaders: (res, filePath) => {
      // No cache for my-library assets (we iterate on these)
      if (filePath.includes('/my-library/css/') || filePath.includes('/my-library/js/')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));

  // ── Clear user cache endpoint (authenticated via config token) ──
  // POST only: a GET was triggerable by any <img>/link load. Scope is limited
  // to the requesting user's own cache keys (no global meta wipe).
  router.post('/api/clear-cache/:token', async (req, res) => {
    const config = decodeConfig(req.params.token);
    if (!config) return res.status(400).json({ error: 'Invalid token' });
    const userKey = require('../src/providers').getUserKey(config);
    if (!userKey) return res.status(400).json({ error: 'No API key configured' });
    try {
      const cache = require('../src/cache');
      const cleared = await cache.delPattern(`*${userKey}*`);
      require('../src/tmdb').clearCaches();
      res.json({ success: true, cleared, message: 'Cache cleared! Refresh Stremio to see changes.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Provider status aggregator (public health checks, no user keys) ──
  // Fetches each debrid provider's public status so the landing page and
  // My Library can show live uptime. Cached for 60s so page views don't
  // hammer the upstream status pages / APIs.
  const STATUS_CHECKS = [
    {
      id: 'torbox',
      name: 'TorBox',
      url: 'https://status.torbox.app',
      async check(axios) {
        const r = await axios.get('https://status.torbox.app/index.json', { timeout: 8000 });
        const state = r.data?.data?.attributes?.aggregate_state;
        if (state === 'operational') return { status: 'operational', detail: 'All systems operational' };
        if (state === 'major_outage') return { status: 'down', detail: 'Major outage reported' };
        return { status: 'degraded', detail: state ? state.replace(/_/g, ' ') : 'Status unknown' };
      },
    },
    {
      id: 'realdebrid',
      name: 'Real-Debrid',
      url: 'https://real-debrid.com',
      async check(axios) {
        await axios.get('https://api.real-debrid.com/rest/1.0/time', { timeout: 8000 });
        return { status: 'operational', detail: 'API responding normally' };
      },
    },
    {
      id: 'alldebrid',
      name: 'AllDebrid',
      url: 'https://alldebrid.com',
      async check(axios) {
        const r = await axios.get('https://api.alldebrid.com/v4/ping', { timeout: 8000 });
        if (r.data?.status === 'success' && r.data?.data?.ping === 'pong') {
          return { status: 'operational', detail: 'API responding normally' };
        }
        return { status: 'degraded', detail: 'Unexpected API response' };
      },
    },
    {
      id: 'premiumize',
      name: 'Premiumize',
      url: 'https://premiumize.reamaze.com/status',
      async check(axios) {
        await axios.get('https://premiumize.reamaze.com/status', { timeout: 8000, maxRedirects: 5 });
        return { status: 'operational', detail: 'Status page responding' };
      },
    },
  ];
  const STATUS_RANK = { operational: 0, degraded: 1, down: 2 };
  let statusCache = { at: 0, data: null };

  router.get('/api/status', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    if (statusCache.data && Date.now() - statusCache.at < 60000) return res.json(statusCache.data);

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

    const data = { updatedAt: Date.now(), overall, providers };
    statusCache = { at: Date.now(), data };
    res.json(data);
  });

  // ── TorBox API proxy (client-side library browser) ──
  router.use('/api/torbox', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);

    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    if (!apiKey) return res.status(401).json({ error: 'Missing API key' });

    // requestdl needs the API key as a `token` query param — inject it from the
    // auth header so the client never puts its key in the URL.
    let targetPath = req.url;
    if (/requestdl/.test(targetPath) && !/token=/.test(targetPath)) {
      targetPath += (targetPath.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(apiKey);
    }
    try {
      const axios = require('axios');
      const ct = String(req.headers['content-type'] || '');

      // Multipart (torrent file upload) — stream req body straight through
      if (ct.includes('multipart/form-data')) {
        const torboxRes = await axios({
          method: req.method,
          url: `https://api.torbox.app/v1/api${targetPath}`,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': ct },
          data: req,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 60000,
        });
        return res.json(torboxRes.data);
      }

      // Respect the Content-Type the client sent (TorBox has mixed requirements:
      // createtorrent wants form-urlencoded, controltorrent wants JSON)
      const isForm = ct.includes('application/x-www-form-urlencoded');
      const data = isForm
        ? (typeof req.body === 'object' && req.body ? new URLSearchParams(req.body).toString() : req.body)
        : req.body;
      const torboxRes = await axios({
        method: req.method,
        url: `https://api.torbox.app/v1/api${targetPath}`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': ct || 'application/json',
        },
        data,
        timeout: 60000,
      });
      res.json(torboxRes.data);
    } catch (err) {
      const status = err.response?.status || 500;
      res.status(status).json({ error: err.response?.data?.detail || err.message });
    }
  });

  // ── Real-Debrid API proxy (client-side library browser) ──
  router.use('/api/realdebrid', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);

    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    if (!apiKey) return res.status(401).json({ error: 'Missing API key' });

    const targetPath = req.url;
    try {
      const axios = require('axios');
      // Real-Debrid expects form-urlencoded bodies on POST/PUT
      const isForm = ['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && typeof req.body === 'object';
      const rdRes = await axios({
        method: req.method,
        url: `https://api.real-debrid.com/rest/1.0${targetPath}`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': isForm ? 'application/x-www-form-urlencoded' : 'application/json',
        },
        data: isForm ? new URLSearchParams(req.body).toString() : req.body,
        timeout: 30000,
      });
      res.json(rdRes.data);
    } catch (err) {
      const status = err.response?.status || 500;
      res.status(status).json({ error: err.response?.data?.error || err.message });
    }
  });

  // ── AllDebrid API proxy (client-side library browser) ──
  router.use('/api/alldebrid', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);

    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    if (!apiKey) return res.status(401).json({ error: 'Missing API key' });

    const targetPath = req.url;
    try {
      const axios = require('axios');
      // AllDebrid accepts form-urlencoded bodies on POST
      const isForm = ['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && typeof req.body === 'object';
      const adRes = await axios({
        method: req.method,
        url: `https://api.alldebrid.com/v4${targetPath}`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': isForm ? 'application/x-www-form-urlencoded' : 'application/json',
        },
        data: isForm ? new URLSearchParams(req.body).toString() : req.body,
        timeout: 30000,
      });
      res.json(adRes.data);
    } catch (err) {
      const status = err.response?.status || 500;
      res.status(status).json({ error: err.response?.data?.error?.message || err.response?.data?.error?.code || err.message });
    }
  });

  // ── Premiumize API proxy (client-side library browser) ──
  router.use('/api/premiumize', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);

    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    if (!apiKey) return res.status(401).json({ error: 'Missing API key' });

    const targetPath = req.url;
    try {
      const axios = require('axios');
      // Premiumize accepts form-urlencoded bodies on POST
      const isForm = ['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && typeof req.body === 'object';
      const pmRes = await axios({
        method: req.method,
        url: `https://www.premiumize.me/api${targetPath}`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': isForm ? 'application/x-www-form-urlencoded' : 'application/json',
        },
        data: isForm ? new URLSearchParams(req.body).toString() : req.body,
        timeout: 30000,
      });
      res.json(pmRes.data);
    } catch (err) {
      const status = err.response?.status || 500;
      res.status(status).json({ error: err.response?.data?.message || err.message });
    }
  });

  // ── Scraper proxies (public torrent search sources) ──
  const scraperLimiter = rateLimit({ windowMs: 60000, max: 30 });

  // APIBay (The Pirate Bay API)
  router.get('/api/scrape/apibay', scraperLimiter, async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const q = req.query.q;
    if (!q) return res.json([]);
    try {
      const axios = require('axios');
      const r = await axios.get(`https://apibay.org/q.php?q=${encodeURIComponent(q)}`, { timeout: 10000 });
      const data = Array.isArray(r.data) ? r.data : [];
      const results = data
        .filter(t => t.name && t.name !== 'No results returned')
        .map(t => ({
          title: t.name.trim(),
          size: parseInt(t.size) || 0,
          hash: (t.info_hash || '').toLowerCase(),
          seeds: parseInt(t.seeders) || 0,
          source: 'APIBay',
        }));
      res.json(results);
    } catch (err) {
      res.json([]);
    }
  });

  // TorrentGalaxy
  router.get('/api/scrape/tgx', scraperLimiter, async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const q = req.query.q;
    if (!q) return res.json([]);
    try {
      const axios = require('axios');
      const r = await axios.get(`https://tgx.rs/torrents.php?search=${encodeURIComponent(q)}`, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const html = r.data;
      const titles = [...html.matchAll(/<span src='torrent'><b>(.*?)<\/b><\/span>/gs)].map(m => m[1].trim());
      const hashes = [...html.matchAll(/magnet:\?xt=urn:btih:([A-Fa-f0-9]{40})/g)].map(m => m[1].toLowerCase());
      const sizes = [...html.matchAll(/<span class='badge badge-secondary txlight'[^>]*>([\d,.]+\s*[KMGT]B)<\/span>/gs)].map(m => {
        const [num, unit] = m[1].split(' ');
        const n = parseFloat(num.replace(/,/g, ''));
        if (unit === 'TB') return n * 1024 * 1024 * 1024;
        if (unit === 'GB') return n * 1024 * 1024;
        if (unit === 'MB') return n * 1024;
        return n;
      });
      const seeds = [...html.matchAll(/<span class='badge badge-secondary txlight'[^>]*>[\d,.]+\s*[KMGT]B<\/span>\s*<span[^>]*>[\d,.]+\s*[KMGT]B<\/span>\s*<span[^>]*>(\d+)<\/span>/gs)].map(m => parseInt(m[1]) || 0);
      const results = titles.map((title, i) => ({
        title,
        size: sizes[i] || 0,
        hash: hashes[i] || '',
        seeds: seeds[i] || 0,
        source: 'TorrentGalaxy',
      })).filter(t => t.hash);
      res.json(results);
    } catch (err) {
      res.json([]);
    }
  });

  // BTDigg (DHT search engine)
  router.get('/api/scrape/btdigg', scraperLimiter, async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const q = req.query.q;
    if (!q) return res.json([]);
    try {
      const axios = require('axios');
      const r = await axios.get(`https://btdig.com/search?q=${encodeURIComponent(q)}`, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const html = r.data;
      const items = [...html.matchAll(/<div[^>]*class="[^"]*torrent[^"]*"[^>]*>[\s\S]*?<a[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/div>/g)];
      const results = [];
      const titles = [...html.matchAll(/<div[^>]*class="[^"]*filename[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map(m => m[1].trim().replace(/<[^>]+>/g, ''));
      const hashes = [...html.matchAll(/magnet:\?xt=urn:btih:([A-Fa-f0-9]{32,40})/g)].map(m => m[1].toLowerCase());
      const sizeMatches = [...html.matchAll(/<span[^>]*class="[^"]*size[^"]*"[^>]*>([\s\S]*?)<\/span>/g)].map(m => m[1].trim());
      for (let i = 0; i < Math.min(titles.length, hashes.length); i++) {
        results.push({
          title: titles[i],
          size: 0,
          hash: hashes[i],
          seeds: 0,
          source: 'BTDigg',
        });
      }
      res.json(results);
    } catch (err) {
      res.json([]);
    }
  });

  // Rutor
  router.get('/api/scrape/rutor', scraperLimiter, async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const q = req.query.q;
    if (!q) return res.json([]);
    try {
      const axios = require('axios');
      const r = await axios.get(`http://rutor.info/search/${encodeURIComponent(q)}`, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const html = r.data;
      const titles = [...html.matchAll(/<a[^>]*href="\/torrent\/\d+"[^>]*>([\s\S]*?)<\/a>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
      const hashes = [...html.matchAll(/magnet:\?xt=urn:btih:([A-Fa-f0-9]{32,40})/g)].map(m => m[1].toLowerCase());
      const sizeMatches = [...html.matchAll(/<span[^>]*class="downmed"[^>]*>([\s\S]*?)<\/span>/g)].map(m => m[1].trim());
      const results = titles.map((title, i) => ({
        title,
        size: 0,
        hash: hashes[i] || '',
        seeds: 0,
        source: 'Rutor',
      })).filter(t => t.hash && t.title);
      res.json(results);
    } catch (err) {
      res.json([]);
    }
  });

  // ── API key verification proxies ──
  // Keys are sent in the request body (never the URL) so they can't leak into
  // server/access logs.
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
      res.json({ valid: false, error: 'Could not reach TorBox — try again' });
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
          ? 'Invalid or expired Real-Debrid API key — generate a new one at real-debrid.com/apitoken'
          : (r.data?.error || 'Invalid Real-Debrid API key');
        res.json({ valid: false, error: err });
      }
    } catch {
      res.json({ valid: false, error: 'Could not reach Real-Debrid — try again' });
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
      res.json({ valid: false, error: 'Could not reach AllDebrid — try again' });
    }
  });

  // Premiumize: /account/info for a valid key. First use from a new IP may
  // require device authorization — we surface { needPin, pin, deviceUrl } so
  // the configure page can walk the user through it.
  router.post('/api/verify/premiumize', async (req, res) => {
    const key = (req.body && typeof req.body.key === 'string' ? req.body.key.trim() : '');
    if (!key) return res.json({ valid: false, error: 'Missing key' });
    try {
      const { verifyPremiumizeKey } = require('../src/providers/premiumize');
      res.json(await verifyPremiumizeKey(key));
    } catch {
      res.json({ valid: false, error: 'Could not reach Premiumize — try again' });
    }
  });

  // TMDB: reject v4 Read Access Tokens (JWTs) with a clear message — v3 API
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
      const r = await axios.get(`https://easyratingsdb.com/${key}/poster/tt0133093.jpg`, {
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
      const r = await axios.get(`https://api.ratingposterdb.com/${key}/isValid`, { timeout: 5000 });
      res.json({ valid: r.data?.valid === true, error: r.data?.valid !== true ? 'Invalid key' : undefined });
    } catch { res.json({ valid: false, error: 'Verification failed' }); }
  });

  router.post('/api/verify/omdb', async (req, res) => {
    const key = req.body && typeof req.body.key === 'string' ? req.body.key : '';
    if (!key) return res.json({ valid: false, error: 'Missing key' });
    try {
      const axios = require('axios');
      const r = await axios.get(`https://www.omdbapi.com/?apikey=${key}&i=tt0133093&plot=short`, { timeout: 5000 });
      res.json({ valid: r.data?.Response !== 'False', error: r.data?.Error || 'Invalid key' });
    } catch { res.json({ valid: false, error: 'Verification failed' }); }
  });

  router.post('/api/verify/fanart', async (req, res) => {
    const key = req.body && typeof req.body.key === 'string' ? req.body.key : '';
    if (!key) return res.json({ valid: false, error: 'Missing key' });
    try {
      const axios = require('axios');
      const r = await axios.get(`https://webservice.fanart.tv/v3/movies/550?api_key=${key}`, { timeout: 5000 });
      res.json({ valid: r.status === 200 && r.data?.name != null, error: r.status !== 200 ? 'Invalid key' : undefined });
    } catch { res.json({ valid: false, error: 'Verification failed' }); }
  });

  // BetterPosters (btttr.cc) has no API key — this just confirms the service is
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
    } catch { res.json({ valid: false, error: 'Could not reach btttr.cc — try again' }); }
  });

  // ── TMDB API proxy (client-side poster fetching) ──
  router.get('/api/tmdb/*', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.sendStatus(200);

    const apiKey = req.headers['x-tmdb-key'] || req.query.api_key;
    if (!apiKey) return res.status(401).json({ error: 'Missing api_key (query param or x-tmdb-key header)' });

    const targetPath = req.params[0] + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '');
    try {
      const axios = require('axios');
      const tmdbUrl = new URL(`https://api.themoviedb.org/3/${targetPath}`);
      tmdbUrl.searchParams.set('api_key', apiKey);
      const tmdbRes = await axios.get(tmdbUrl.toString(), { timeout: 10000 });
      res.json(tmdbRes.data);
    } catch (err) {
      const status = err.response?.status || 500;
      res.status(status).json({ error: err.response?.data?.status_message || err.message });
    }
  });

  return router;
}

module.exports = createWebRoutes;
