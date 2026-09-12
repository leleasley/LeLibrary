const axios = require('axios');
const crypto = require('crypto');

const TORBOX_BASE = 'https://api.torbox.app/v1/api';

// ── Rate limiting / circuit breaker ────────────────────────────────────
// TorBox documents per-key, per-endpoint budgets. Keep conservative account
// budgets plus a process-wide concurrency cap; playback has a separate gate.
const TB_RATE_LIMIT = Math.max(1, parseInt(process.env.TORBOX_RATE_LIMIT, 10) || 120);
const TB_RATE_WINDOW = 60_000;
const TB_MAX_CONCURRENT = Math.max(1, parseInt(process.env.TORBOX_MAX_CONCURRENT, 10) || 16);
const TB_429_DEFAULT_BACKOFF = 300_000;
// requestdl has its own, much lower limit. Keep this limiter per account: a
// 429 from one hosted user must never suppress another user's playback.
const TB_REQUESTDL_RATE = parseInt(process.env.TORBOX_REQUESTDL_RATE, 10) || 30; // per minute/account
const TB_REQUESTDL_BURST = Math.max(1, parseInt(process.env.TORBOX_REQUESTDL_BURST, 10) || 3);
const TB_REQUESTDL_MAX_CONCURRENT = Math.max(1, parseInt(process.env.TORBOX_REQUESTDL_MAX_CONCURRENT, 10) || 2);
const TB_REQUESTDL_MAX_ACCOUNTS = 1000;
const TB_REQUESTDL_COOLDOWN_PREFIX = 'provider-cooldown';

function createRequestDlLimiter({ ratePerMinute = TB_REQUESTDL_RATE, burst = TB_REQUESTDL_BURST, maxConcurrent = TB_REQUESTDL_MAX_CONCURRENT, now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const gates = new Map();
  const refillPerMs = ratePerMinute / TB_RATE_WINDOW;

  function getGate(identity) {
    const at = now();
    let gate = gates.get(identity);
    if (!gate) {
      // Bound account state in the long-running hosted process. The oldest
      // inactive entry is disposable because it only contains rate metadata.
      if (gates.size >= TB_REQUESTDL_MAX_ACCOUNTS) {
        let oldestKey = null;
        let oldestAt = Infinity;
        for (const [key, value] of gates) {
          if (value.inFlight === 0 && value.cooldownUntil <= at && at - value.lastRefill >= TB_RATE_WINDOW && value.lastUsed < oldestAt) { oldestAt = value.lastUsed; oldestKey = key; }
        }
        if (oldestKey) gates.delete(oldestKey);
      }
      gate = { tokens: burst, lastRefill: at, inFlight: 0, cooldownUntil: 0, lastUsed: at };
      gates.set(identity, gate);
    }
    const elapsed = Math.max(0, at - gate.lastRefill);
    gate.tokens = Math.min(burst, gate.tokens + elapsed * refillPerMs);
    gate.lastRefill = at;
    gate.lastUsed = at;
    return gate;
  }

  async function acquire(identity) {
    while (true) {
      const gate = getGate(identity);
      const at = now();
      // A TorBox 429 is a hard backoff, not a queue: Nuvio needs an immediate
      // empty response so it can retry later rather than holding the player
      // request open for minutes.
      if (at < gate.cooldownUntil) return false;
      if (at >= gate.cooldownUntil && gate.inFlight < maxConcurrent && gate.tokens >= 1) {
        gate.tokens -= 1;
        gate.inFlight += 1;
        return true;
      }
      const cooldownWait = Math.max(0, gate.cooldownUntil - at);
      const tokenWait = gate.tokens >= 1 ? 0 : Math.ceil((1 - gate.tokens) / refillPerMs);
      // Another request releases its concurrency slot shortly; polling keeps
      // the queue simple without retaining unresolved per-request callbacks.
      const concurrencyWait = gate.inFlight >= maxConcurrent ? 25 : 0;
      await sleep(Math.max(25, cooldownWait, tokenWait, concurrencyWait));
    }
  }

  function release(identity) {
    const gate = gates.get(identity);
    if (gate) { gate.inFlight = Math.max(0, gate.inFlight - 1); gate.lastUsed = now(); }
  }

  function cooldown(identity, durationMs) {
    const gate = getGate(identity);
    gate.cooldownUntil = Math.max(gate.cooldownUntil, now() + Math.max(0, durationMs));
  }

  function status(identity) {
    const gate = getGate(identity);
    return { inFlight: gate.inFlight, cooldownUntil: gate.cooldownUntil, tokens: gate.tokens };
  }

  return { acquire, release, cooldown, status };
}

function requestDlIdentity(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey || '')).digest('hex').slice(0, 16);
}

const requestDlLimiter = createRequestDlLimiter();
const requestDlCooldownChecks = new Map();
const requestDlCooldownLoads = new Map();

function requestDlCooldownKey(cache, identity) {
  return cache.makeKey(TB_REQUESTDL_COOLDOWN_PREFIX, 'torbox', identity);
}

function normalizePlaybackCooldown(cooldownUntil, now = Date.now()) {
  const retryAfterSec = Math.max(0, Math.ceil((Number(cooldownUntil) - now) / 1000));
  return retryAfterSec > 0
    ? { provider: 'torbox', rateLimited: true, retryAfterSec }
    : null;
}

// Restore the anonymous per-account cooldown from Redis before creating a new
// requestdl URL. This prevents a process restart from immediately hitting a
// provider that has already asked this account to back off. The cached value
// contains only an expiry timestamp under a non-reversible key hash.
async function getTorBoxPlaybackStatus(apiKey) {
  if (!apiKey) return null;
  const cache = require('./cache');
  const identity = requestDlIdentity(apiKey);
  const local = normalizePlaybackCooldown(requestDlLimiter.status(identity).cooldownUntil);
  if (local) return local;

  // A missing cooldown is the normal case. Remember that miss briefly and
  // coalesce the first Redis lookup so one playback screen does not add a
  // cache read for every candidate file.
  if (Date.now() - (requestDlCooldownChecks.get(identity) || 0) < 60_000) return null;
  let pending = requestDlCooldownLoads.get(identity);
  if (!pending) {
    pending = (async () => {
      const stored = await cache.get(requestDlCooldownKey(cache, identity));
      const restored = normalizePlaybackCooldown(stored?.cooldownUntil);
      if (restored) requestDlLimiter.cooldown(identity, restored.retryAfterSec * 1000);
      requestDlCooldownChecks.set(identity, Date.now());
      return restored;
    })();
    requestDlCooldownLoads.set(identity, pending);
  }
  try {
    return await pending;
  } finally {
    if (requestDlCooldownLoads.get(identity) === pending) requestDlCooldownLoads.delete(identity);
  }
}

// Concurrency gate: max TB_MAX_CONCURRENT in-flight requests
let tbInFlight = 0;
const tbQueue = [];

function tbConcurrencyWait() {
  return new Promise(resolve => {
    if (tbInFlight < TB_MAX_CONCURRENT) { tbInFlight++; resolve(); return; }
    tbQueue.push(resolve);
  });
}

function tbConcurrencyRelease() {
  tbInFlight = Math.max(0, tbInFlight - 1);
  if (tbQueue.length > 0) {
    tbInFlight++;
    tbQueue.shift()();
  }
}

// ── Core HTTP helper ───────────────────────────────────────────────────

function retryAfterMs(value, now = Date.now()) {
  const seconds = Number(value);
  if (value != null && Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) && date > now ? date - now : TB_429_DEFAULT_BACKOFF;
}

function createDataClient({ request = options => axios.request(options),
  limiter = createRequestDlLimiter({ ratePerMinute: TB_RATE_LIMIT, burst: 6, maxConcurrent: 4 }),
  enter = tbConcurrencyWait, leave = tbConcurrencyRelease } = {}) {
  return async function dataRequest(method, path, apiKey, params = {}, data) {
    if (!apiKey || apiKey.length < 10) return { error: 'API key invalid', status: 401 };
    const identity = `${requestDlIdentity(apiKey)}:${path}`;
    const queuedAt = Date.now();
    if (!await limiter.acquire(identity)) return { error: 'TorBox temporarily rate limited', status: 429 };
    await enter();
    const started = Date.now();
    let status = 0;
    try {
      // Recheck after waiting for the global concurrency gate.
      if (limiter.status(identity).cooldownUntil > Date.now()) {
        status = 429;
        return { error: 'TorBox temporarily rate limited', status };
      }
      const res = await request({ method, url: `${TORBOX_BASE}${path}`, data, params,
        headers: { Authorization: `Bearer ${apiKey}`, ...(params.bypass_cache ? { 'Cache-Control': 'no-cache, no-store, max-age=0', Pragma: 'no-cache' } : {}) },
        timeout: 45000, validateStatus: () => true });
      status = res.status;
      if (status === 429) limiter.cooldown(identity, retryAfterMs(res.headers?.['retry-after']));
      if (status < 200 || status >= 300 || res.data?.success === false || res.data?.error) {
        return { error: 'TorBox request failed', status };
      }
      return { data: res.data, status };
    } catch (err) {
      status = err.response?.status || 0;
      if (status === 429) limiter.cooldown(identity, retryAfterMs(err.response?.headers?.['retry-after']));
      return { error: 'TorBox request failed', status };
    } finally {
      leave();
      limiter.release(identity);
      if (process.env.PROVIDER_TIMINGS === 'true') console.log(`[TorBox timing] queueMs=${started - queuedAt} requestMs=${Date.now() - started} status=${status}`);
    }
  };
}

const dataRequest = createDataClient();
const torboxGet = (path, key, params) => dataRequest('GET', path, key, params);

// Fetch all pages from a paginated TorBox endpoint.  The API caps at 1000
// items per request; this loops until an empty page is returned.
async function torboxPaginate(path, apiKey, params = {}, limit = 1000, get = torboxGet) {
  let offset = 0;
  const all = [];
  while (true) {
    const result = await get(path, apiKey, { ...params, offset, limit });
    if (result.error) return result;
    const data = result.data?.data;
    if (!Array.isArray(data)) return { error: 'Invalid TorBox list response', status: 502 };
    all.push(...data);
    if (data.length < limit) break;
    offset += limit;
  }
  return { data: { data: all }, status: 200 };
}

async function fetchDownloadSources(apiKey, params = { bypass_cache: true }, {
  paginate = torboxPaginate, store = require('./cache'),
} = {}) {
  return require('./catalog-cache').flight(store, `tb-scan:${requestDlIdentity(apiKey)}`, async () => {
    const results = await Promise.all(['torrents', 'usenet', 'webdl'].map(async (endpoint) => {
      const key = store.makeKey('tb-source-v1', requestDlIdentity(apiKey), endpoint);
      const result = await paginate(`/${endpoint}/mylist`, apiKey, params);
      if (!result.error) {
        const rows = result.data.data;
        await store.set(key, rows, 7 * 24 * 3600);
        return rows.map(row => ({ ...row, source: endpoint === 'torrents' ? 'torrent' : endpoint }));
      }
      const status = result.status;
      if (status === 401 || status === 403) {
        await store.del(key);
        if (endpoint !== 'torrents') return [];
        throw new Error('TorBox authentication failed');
      }
      const previous = await store.get(key);
      if (Array.isArray(previous)) return previous.map(row => ({ ...row, source: endpoint === 'torrents' ? 'torrent' : endpoint }));
      throw new Error('TorBox library refresh unavailable');
    }));
    return results.flat();
  });
}

async function getTorBoxDownloads(apiKey) {
  const params = { bypass_cache: true };

  const items = await fetchDownloadSources(apiKey, params);

  // Log all unique fields across items to spot blocked/restricted indicators
  const allKeys = new Set();
  items.forEach(i => Object.keys(i).forEach(k => allKeys.add(k)));
  const knownStateKeys = ['id','name','hash','size','torrent_name','files','download_state','download_finished','download_present','seeders','leechers','ratio',' seeds','peers','progress','download_speed','upload_speed','eta','abort','active','last_state_change','created_at','updated_at','source'];
  const unknownKeys = [...allKeys].filter(k => !knownStateKeys.includes(k) && !k.startsWith('cached'));
  if (unknownKeys.length > 0 && items.length > 0) {
    console.log(`[TorBox] Download schema includes ${unknownKeys.length} extra field(s)`);
  }

  const completed = items.filter(i => {
    const state = (i.download_state || '').toLowerCase();
    return (
      state === 'completed'  ||
      state === 'seeding'    ||
      state === 'cached'     ||
      state === 'finalized'  ||
      i.download_finished === true ||
      i.download_present === true
    );
  });

  // Filter out torrents TorBox marks as errored/unavailable at CDN level
  const healthy = completed.filter(i => {
    if (i.error) {
      return false;
    }
    return true;
  });

  const blockedCount = completed.length - healthy.length;
  console.log(`[TorBox] Downloads: ${items.length} fetched → ${completed.length} available${blockedCount > 0 ? ` (${blockedCount} errored/blocked)` : ''}`);

  return healthy;
}

// Cache requestdl links per file so we don't re-request TorBox for the same
// file on every stream build. requestdl uses its own stricter 429 backoff so
// playback throttling cannot block catalogue/list requests.
const TBDL_TTL = 21600; // requestdl links are temporary URLs; safe to reuse for 6h
const requestDlInFlight = new Map();

function tbdHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function getTorBoxStreamLink(apiKey, source, itemId, fileId) {
  const cache = require('./cache');
  const ck = cache.makeKey('tbdl', tbdHash(apiKey), source, itemId, fileId);
  const cached = await cache.get(ck);
  if (cached) return cached;

  const existing = requestDlInFlight.get(ck);
  if (existing) return existing;
  const pending = requestTorBoxStreamLink(apiKey, source, itemId, fileId, cache, ck);
  requestDlInFlight.set(ck, pending);
  try {
    return await pending;
  } finally {
    if (requestDlInFlight.get(ck) === pending) requestDlInFlight.delete(ck);
  }
}

async function requestTorBoxStreamLink(apiKey, source, itemId, fileId, cache, ck) {

  const endpoint = source === 'torrent'
    ? `${TORBOX_BASE}/torrents/requestdl`
    : source === 'webdl'
    ? `${TORBOX_BASE}/webdl/requestdl`
    : `${TORBOX_BASE}/usenet/requestdl`;

  const params = source === 'torrent'
    ? { token: apiKey, torrent_id: itemId, file_id: fileId, zip_link: false }
    : source === 'webdl'
    ? { token: apiKey, web_id: itemId,    file_id: fileId, zip_link: false }
    : { token: apiKey, usenet_id: itemId,  file_id: fileId, zip_link: false };

  const limiterIdentity = requestDlIdentity(apiKey);
  await getTorBoxPlaybackStatus(apiKey);
  // Cache lookup deliberately happens before this queue: a six-hour cached
  // playback link is free and should never wait behind new link creation.
  const permitted = await requestDlLimiter.acquire(limiterIdentity);
  if (!permitted) {
    const { cooldownUntil } = requestDlLimiter.status(limiterIdentity);
    console.log(`[TorBox] requestdl skipped for this account (cooldown ${Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))}s)`);
    return null;
  }
  await tbConcurrencyWait();

  try {
    const headers = { Authorization: `Bearer ${apiKey}` };
    const res = await axios.get(endpoint, { headers, params, timeout: 30000 });
    const url = res.data?.success !== false && !res.data?.error && typeof res.data?.data === 'string' ? res.data.data : null;
    const respErr = res.data?.error;
    const respDetail = res.data?.detail;
    if (respErr || respDetail) {
      console.log('[TorBox] requestdl returned a provider hint');
    }
    if (url) await cache.set(ck, url, TBDL_TTL);
    return url;
  } catch (err) {
    const s = err.response?.status;
    if (s === 429) {
      const backoff = retryAfterMs(err.response?.headers?.['retry-after']);
      requestDlLimiter.cooldown(limiterIdentity, backoff);
      requestDlCooldownChecks.set(limiterIdentity, Date.now());
      const cooldownUntil = Date.now() + backoff;
      await cache.set(
        requestDlCooldownKey(cache, limiterIdentity),
        { cooldownUntil },
        Math.max(1, Math.ceil(backoff / 1000))
      );
      console.error(`[TorBox] requestdl 429: this account paused for ${Math.round(backoff / 1000)}s`);
    } else {
      console.error(`[TorBox] requestdl failed status=${s || 0}`);
    }
    if (s && s !== 429) await cache.del(ck);
    return null;
  } finally {
    tbConcurrencyRelease();
    requestDlLimiter.release(limiterIdentity);
  }
}

async function getTorBoxFiles(apiKey, source, itemId) {
  const family = source === 'torrent' ? 'torrents' : source === 'webdl' ? 'webdl' : 'usenet';
  const result = await torboxGet(`/${family}/mylist`, apiKey, { id: itemId, bypass_cache: false });
  if (result.error) return [];
  const data = result.data?.data;
  const item = Array.isArray(data) ? data[0] : data;
  return item?.files || [];
}

const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.ts', '.wmv', '.webm', '.m2ts', '.mpg', '.mpeg', '.flv', '.vob', '.divx'];

function isVideoFile(name = '') {
  return VIDEO_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));
}

// Junk files commonly bundled in torrents (samples, trailers, featurettes).
// Previous broad regex flagged any occurrence of "sample" bounded by delimiters
// anywhere in the path ("The.Sample.Movie.2024.1080p.mkv" was incorrectly junk).
// Now: only a Sample *folder* (/Sample/) or a sample/trailer suffix right before
// the video extension ("movie-sample.mkv", "Sample.mkv") counts as junk. This
// satisfies the "/Sample/" + "-sample.mkv" requirement without hiding a legit
// film literally titled "The Sample".
function isJunkVideo(name = '') {
  if (!name) return false;
  // Folder case: Sample/  Samples/ at any depth
  if (/[\/\\]samples?[\/\\]/i.test(name) || /^samples?[\/\\]/i.test(name)) return true;
  const lower = String(name).toLowerCase();
  const base = lower.split('/').pop().split('\\').pop();
  const ext = '(?:mkv|mp4|avi|mov|m4v|ts|wmv|webm|m2ts|mpg|mpeg|flv|vob|divx)';
  // Suffix case: sample/trailer/featurette directly before the extension
  // e.g. "movie-sample.mkv", "movie.sample.mkv", "Sample.mkv", "trailer2.mkv"
  if (new RegExp(`(^|[\\s._-])samples?\\d*\\.${ext}$`, 'i').test(base)) return true;
  if (new RegExp(`(^|[\\s._-])(?:trailer|featurette|behindthescenes|behind\\.the\\.scenes)s?\\d*\\.${ext}$`, 'i').test(base)) return true;
  return false;
}

module.exports = { getTorBoxDownloads, getTorBoxStreamLink, getTorBoxFiles, getTorBoxPlaybackStatus, isVideoFile, isJunkVideo, torboxRateStatus };

function torboxRateStatus() {
  return { inFlight: tbInFlight, queued: tbQueue.length, ratePerAccountEndpoint: TB_RATE_LIMIT };
}

// Exported only for deterministic unit tests; runtime callers use the module
// singleton above and never receive raw API-key material.
module.exports.__test = { createRequestDlLimiter, requestDlIdentity, normalizePlaybackCooldown, createDataClient, retryAfterMs, fetchDownloadSources, torboxPaginate };
