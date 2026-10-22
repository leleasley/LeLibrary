// AIOStreams connector core.
//
// A user's fully configured AIOStreams install URL is secret material: it
// grants use of their personal AIOStreams setup. This module therefore never
// returns it, never logs it, and never uses it in a cache key. It only:
//
//   - validates a connector URL (HTTPS, no credentials, /manifest.json, public
//     host, no redirects),
//   - verifies the manifest advertises a compatible `stream` resource,
//   - fetches bounded streams for a public IMDb id with coalescing, a health
//     cooldown and a recursion fuse.
//
// It is deliberately UI-agnostic and storage-agnostic so the same core serves
// the current Configure pages and the future v5.5 setup tiers.
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const axios = require('axios');

const MAX_STREAMS = 200;
const MAX_BYTES = 4 * 1024 * 1024;
const COOLDOWN_MS = 5 * 60 * 1000;
const FAIL_THRESHOLD = 3;
const UA = 'LeLibrary/2.0 (+https://github.com/leleasley/LeLibrary)';

// Irreversible short id for a connector URL. Used in logs, cache keys and locks
// so the URL itself is never stored or emitted.
function connectorFingerprint(url: any) {
  return crypto.createHash('sha256').update(String(url || '')).digest('hex').slice(0, 16);
}

// Reject loopback, private, link-local, CGNAT, multicast and reserved ranges.
// Pure and unit tested; the DNS lookup that feeds it is separate.
function isBlockedIp(ip: any) {
  if (!net.isIP(ip)) return true;
  if (ip.includes(':')) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;
    if (low.startsWith('fc') || low.startsWith('fd')) return true; // unique local
    if (low.startsWith('fe80')) return true;                       // link local
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n: any) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

// Self-hosters can let their own addons live on the LAN (a StreamNZB box, a
// Tailscale address). Never set on the hosted site: off by default, so a
// shared instance can never be pointed at its own network.
function allowPrivateHosts(env: any = process.env) {
  return String(env.CUSTOM_ADDONS_ALLOW_PRIVATE || '').toLowerCase() === 'on';
}

// null when unusable, else a URL object. HTTPS only (plain HTTP only when
// private hosts are allowed), no credentials in the authority, and the path
// must end in /manifest.json. A pasted stremio:// install link or a base URL
// without /manifest.json is accepted and normalised.
function normalizeConnectorUrl(raw: any, { allowHttp = false } = {}) {
  let text = String(raw || '').trim();
  if (/^stremio:\/\//i.test(text)) text = text.replace(/^stremio:\/\//i, 'https://');
  let url;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) return null;
  if (url.username || url.password) return null;
  if (!/\/manifest\.json$/i.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/+$/, '')}/manifest.json`;
  url.hash = '';
  return url;
}

// Resolve once, refuse non-public answers, and return a lookup pinned to the
// checked address so the request cannot be re-resolved somewhere else
// (DNS rebinding). Null when the host is not allowed.
async function pinnedLookup(hostname: any, { allowPrivate = false } = {}) {
  if (!hostname) return null;
  const host = String(hostname).replace(/^\[|\]$/g, '');
  let records;
  try {
    records = net.isIP(host)
      ? [{ address: host, family: net.isIP(host) }]
      : await dns.lookup(host, { all: true, verbatim: true });
  } catch { return null; }
  if (!records.length) return null;
  if (!allowPrivate && records.some((a: any) => isBlockedIp(a.address))) return null;
  const { address, family } = records[0];
  return (_host: any, options: any, callback: any) => {
    if (options && options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

async function assertPublicHost(hostname: any) {
  return (await pinnedLookup(hostname)) !== null;
}

function safeHttpsUrl(value: any) {
  try { const u = new URL(String(value)); return u.protocol === 'https:'; } catch { return false; }
}
function safeStreamUrl(value: any) {
  try { const u = new URL(String(value)); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

// Verify a connector URL and return only safe display metadata plus the
// fingerprint. The URL is never returned to the caller for storage here.
async function verifyManifest(rawUrl: any, { timeoutMs = 8000, allowPrivate = allowPrivateHosts() } = {}) {
  const url = normalizeConnectorUrl(rawUrl, { allowHttp: allowPrivate });
  if (!url) return { ok: false, error: 'invalid_url' };
  const lookup = await pinnedLookup(url.hostname, { allowPrivate });
  if (!lookup) return { ok: false, error: 'blocked_host' };
  try {
    const res = await axios.get(url.toString(), {
      lookup,
      timeout: timeoutMs,
      maxContentLength: 512 * 1024,
      maxRedirects: 0,
      validateStatus: (s: any) => s < 500,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (res.status !== 200 || !res.data || typeof res.data !== 'object') return { ok: false, error: 'unreachable' };
    const manifest = res.data;
    const resources = Array.isArray(manifest.resources) ? manifest.resources : [];
    const hasStream = resources.some((r: any) => r === 'stream' || (r && r.name === 'stream'));
    if (!hasStream) return { ok: false, error: 'no_stream_resource' };
    return {
      ok: true,
      fingerprint: connectorFingerprint(rawUrl),
      name: String(manifest.name || 'AIOStreams').slice(0, 80),
      version: String(manifest.version || '').slice(0, 40),
      logo: safeHttpsUrl(manifest.logo) ? String(manifest.logo).slice(0, 500) : null,
    };
  } catch (err: any) {
    const code = err && (err.code || (err.response && err.response.status));
    if (err && err.code === 'ERR_FR_TOO_MANY_REDIRECTS') return { ok: false, error: 'redirect' };
    return { ok: false, error: code === 401 || code === 403 ? 'unauthorized' : 'unreachable' };
  }
}

// ── Runtime state (per process) ────────────────────────────────────────────
const health = new Map();     // fingerprint -> { fails, until }
const inFlight = new Map();   // fp|type|id -> promise
const loopFuse = new Set();   // userKeyHash|fp|type|id -> outbound call active

function isCoolingDown(fp: any) {
  const h = health.get(fp);
  return !!(h && h.until > Date.now());
}
function markSuccess(fp: any) { health.delete(fp); }
function markFailure(fp: any) {
  const h = health.get(fp) || { fails: 0, until: 0 };
  h.fails += 1;
  if (h.fails >= FAIL_THRESHOLD) { h.until = Date.now() + COOLDOWN_MS; h.fails = 0; }
  health.set(fp, h);
}

function loopKey(userKeyHash: any, fp: any, type: any, id: any) { return `${userKeyHash}|${fp}|${type}|${id}`; }
function loopActive(userKeyHash: any, fp: any, type: any, id: any) { return loopFuse.has(loopKey(userKeyHash, fp, type, id)); }

function safeLog(logger: any, fingerprint: any, outcome: any, durationMs: any, count: any) {
  if (typeof logger !== 'function') return;
  try { logger({ connector: fingerprint, outcome, durationMs: Math.round(durationMs), count: Number(count) || 0 }); } catch { /* never let logging break playback */ }
}

// Fetch streams for one public IMDb id. Never throws; failures return an empty
// list with a coarse reason. Recursion is skipped when an outbound AIOStreams
// call is already active for the same user/fingerprint/type/id, so a
// AIOStreams -> LeLibrary -> same AIOStreams loop cannot multiply requests.
async function fetchAioStreams({ url, type, id, timeoutMs = 6000, userKeyHash = 'anon', verify = true, logger, allowPrivate = allowPrivateHosts() }: any) {
  const normalized = normalizeConnectorUrl(url, { allowHttp: allowPrivate });
  if (!normalized) return { streams: [], skipped: 'invalid_url' };
  const fp = connectorFingerprint(url);
  if (isCoolingDown(fp)) return { streams: [], skipped: 'cooldown' };
  if (loopActive(userKeyHash, fp, type, id)) return { streams: [], skipped: 'recursion' };

  const flightKey = `${fp}|${type}|${id}`;
  const existing = inFlight.get(flightKey);
  if (existing) return existing;

  const pending = (async () => {
    const lookup = verify ? await pinnedLookup(normalized.hostname, { allowPrivate }) : undefined;
    if (verify && !lookup) {
      markFailure(fp);
      return { streams: [], skipped: 'blocked_host' };
    }
    const streamUrl = normalized.toString().replace(/\/manifest\.json$/i, `/stream/${type}/${encodeURIComponent(id)}.json`);
    const key = loopKey(userKeyHash, fp, type, id);
    loopFuse.add(key);
    const started = Date.now();
    try {
      const res = await axios.get(streamUrl, {
        ...(lookup ? { lookup } : {}),
        timeout: timeoutMs,
        maxContentLength: MAX_BYTES,
        maxRedirects: 0,
        validateStatus: (s: any) => s < 500,
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      if (res.status !== 200 || !res.data || !Array.isArray(res.data.streams)) {
        markFailure(fp);
        safeLog(logger, fp, 'bad_response', Date.now() - started, 0);
        return { streams: [], skipped: 'bad_response' };
      }
      const streams = [];
      for (const s of res.data.streams.slice(0, MAX_STREAMS)) {
        if (!s || typeof s !== 'object') continue;
        if (s.url && !safeStreamUrl(s.url)) continue;
        streams.push(s);
      }
      markSuccess(fp);
      safeLog(logger, fp, 'ok', Date.now() - started, streams.length);
      return { streams };
    } catch (err: any) {
      markFailure(fp);
      safeLog(logger, fp, 'error', Date.now() - started, 0);
      return { streams: [], skipped: 'error' };
    } finally {
      loopFuse.delete(key);
    }
  })().finally(() => inFlight.delete(flightKey));

  inFlight.set(flightKey, pending);
  return pending;
}

// Test/ops helpers.
function _reset() { health.clear(); inFlight.clear(); loopFuse.clear(); }

export interface AiostreamsApi {
  connectorFingerprint: any;
  isBlockedIp: any;
  normalizeConnectorUrl: any;
  assertPublicHost: any;
  pinnedLookup: any;
  allowPrivateHosts: any;
  verifyManifest: any;
  fetchAioStreams: any;
  isCoolingDown: any;
  markSuccess: any;
  markFailure: any;
  loopActive: any;
  MAX_STREAMS: any;
  _reset: any;
}

module.exports = {
  connectorFingerprint,
  isBlockedIp,
  normalizeConnectorUrl,
  assertPublicHost,
  pinnedLookup,
  allowPrivateHosts,
  verifyManifest,
  fetchAioStreams,
  isCoolingDown,
  markSuccess,
  markFailure,
  loopActive,
  MAX_STREAMS,
  _reset,
} satisfies AiostreamsApi;
