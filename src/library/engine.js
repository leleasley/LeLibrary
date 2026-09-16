// Index-first library engine facade + in-process background worker.
//
// Responsibilities:
//   - remember which token/config scopes exist (from any addon request)
//   - run the sync worker that reconciles provider libraries into Postgres
//   - serve catalog and search reads straight from the local index
//   - seed the owned-episode index so meta/stream requests never scan providers
//
// The index is the default core: with DATABASE_URL configured the library read,
// write and matching paths all run through here. Without a database the addon
// automatically keeps using the legacy request-time path, and
// LIBRARY_ENGINE=legacy forces that path even when a database is present.
const db = require('./db');
const store = require('./store');
const catalog = require('./catalog');
const librarySearch = require('./search');
const { syncScope } = require('./sync');
const matcher = require('./matcher');
const metrics = require('./metrics');
const providers = require('../providers');
const builder = require('../builder');
const { decodeConfig } = require('../config/token');
const { pLimit, sleep } = require('./util');
const cache = require('../cache');
const axios = require('axios');
const { resolveEntity } = require('./identity/resolve');
const identityProviders = require('./identity/providers');
const { normalizeTitle } = require('./diff');
const pictoriumWarm = require('../pictorium-warm');

let HOSTED = null;
try { HOSTED = require('../hosted'); } catch { /* self-hosted */ }

const registry = new Map();
let workerTimer = null;
let drainTimer = null;
let enrichTimer = null;
let workerRunning = false;
let started = false;
let lastRunAt = null;
let lastRunMs = 0;

function mode() {
  return String(process.env.LIBRARY_ENGINE || 'indexed').trim().toLowerCase();
}

// The index is the default core. Any value other than "legacy"/"off" selects
// it, but only when a Postgres URL is present: without a database the addon
// keeps using the legacy request-time path instead of failing.
function isIndexed() {
  const m = mode();
  if (m === 'legacy' || m === 'off') return false;
  return db.enabled();
}

function intervalMs() {
  return Math.max(30, parseInt(process.env.LIBRARY_SYNC_INTERVAL, 10) || 120) * 1000;
}

function syncOptions() {
  return {
    matchBatch: parseInt(process.env.LIBRARY_MATCH_BATCH, 10) || 50,
    matchConcurrency: parseInt(process.env.LIBRARY_MATCH_CONCURRENCY, 10) || 4,
    matchBudgetMs: parseInt(process.env.LIBRARY_MATCH_BUDGET_MS, 10) || 30000,
  };
}

// Matching is drained on its own faster cadence, without a provider fetch, so a
// large first index finishes in minutes rather than one 30s window per sync.
function drainIntervalMs() {
  return Math.max(5, parseInt(process.env.LIBRARY_DRAIN_INTERVAL, 10) || 15) * 1000;
}

function enrichIntervalMs() {
  return Math.max(5, parseInt(process.env.LIBRARY_ENRICH_INTERVAL, 10) || 20) * 1000;
}

function enrichOptions() {
  return {
    claimBatch: parseInt(process.env.LIBRARY_ENRICH_BATCH, 10) || 300,
    concurrency: parseInt(process.env.LIBRARY_ENRICH_CONCURRENCY, 10) || 3,
    maxPerPass: parseInt(process.env.LIBRARY_ENRICH_MAX_ENTITIES, 10) || 60,
  };
}

function scopeRecordFromConfig(token, config) {
  const active = providers.activeProviders(config);
  if (!active.length) return null;
  const userKey = providers.getUserKey(config);
  if (!userKey) return null;
  const opaque = !decodeConfig(token);
  return {
    scopeId: userKey,
    token,
    config,
    userKey,
    provider: active.join(','),
    tmdbApiKey: config.tmdbApiKey,
    lang: config.lang || 'en-US',
    persistedToken: opaque ? token : null,
    lastSeen: Date.now(),
    lastSyncAt: 0,
    syncing: null,
    force: false,
  };
}

// Cheap, synchronous registration. Called from addon routes; never awaits the
// database on the request path.
function noteConfig(token, config) {
  if (!isIndexed() || !config || !token) return null;
  let rec;
  try { rec = scopeRecordFromConfig(token, config); } catch { return null; }
  if (!rec) return null;

  const existing = registry.get(rec.scopeId);
  if (existing) {
    existing.token = token;
    existing.config = config;
    existing.provider = rec.provider;
    existing.tmdbApiKey = rec.tmdbApiKey;
    existing.lang = rec.lang;
    if (rec.persistedToken) existing.persistedToken = rec.persistedToken;
    existing.lastSeen = Date.now();
    return existing;
  }

  registry.set(rec.scopeId, rec);
  // Persist the scope once so the worker can resume it after a restart. Only an
  // opaque account token is stored (never a legacy base64 token, which embeds
  // the user's keys).
  store.touchScope(rec.scopeId, { provider: rec.provider, configToken: rec.persistedToken })
    .catch(() => {});
  store.getIdentityVersion(rec.scopeId).then((v) => { rec.identityVersion = v; }).catch(() => {});
  // First sighting: start indexing immediately, in the background.
  runSync(rec).catch(() => {});
  return rec;
}

// Fetch the first page of the owned catalogues through the normal route so the
// real pipeline runs: this builds and caches the franchise collections (which
// the legacy 2-minute loop used to warm and is disabled while indexed) and
// enqueues Pictorium poster renders. Loopback only; failures are ignored.
// After each sync, refresh the projections Nuvio will ask for first: the owned
// catalogue pages, the franchise collection, the Trending/Popular rows when
// enabled, the first-page metas, and (throttled) the discovery stream menus.
// Everything runs in the background through the normal routes so it uses the
// real pipeline and caches. Failures are ignored.
const WARM_META_LIMIT = Math.max(0, parseInt(process.env.LIBRARY_WARM_META, 10) || 24);
const WARM_STREAM_LIMIT = Math.max(0, parseInt(process.env.LIBRARY_WARM_STREAMS, 10) || 6);
const WARM_META_INTERVAL = Math.max(60, parseInt(process.env.LIBRARY_WARM_META_INTERVAL, 10) || 600);
const WARM_STREAM_INTERVAL = Math.max(60, parseInt(process.env.LIBRARY_WARM_STREAM_INTERVAL, 10) || 900);

function warmOrigin() {
  return process.env.PICTORIUM_WARM_ORIGIN || `http://127.0.0.1:${process.env.PORT || 7860}`;
}

async function loopbackJson(rec, path, timeout = 60000) {
  try {
    const res = await axios.get(`${warmOrigin()}/${encodeURIComponent(rec.token)}${path}`, {
      timeout, validateStatus: () => true,
    });
    return res.data;
  } catch { return null; }
}

function warmEnabled(cfg, kind) {
  if (kind === 'trending') return !!(cfg.catalogTrending || cfg.catalogTrendingMovies || cfg.catalogTrendingSeries);
  if (kind === 'popular') return !!(cfg.catalogPopular || cfg.catalogPopularMovies || cfg.catalogPopularSeries);
  return true;
}

async function warmCatalogs(rec) {
  if (!rec || !rec.config || rec.warming) return;
  rec.warming = true;
  try {
  const cfg = rec.config;
  const maxPages = Math.max(1, parseInt(process.env.LIBRARY_WARM_MAX_PAGES, 10) || 40);
  const metaTargets = [];
  const streamTargets = [];

  // Owned catalogues: warm EVERY page (not just the first few) so every title's
  // Pictorium poster is rendered before the client asks. Each page fetch also
  // enqueues that page's posters. Stops as soon as a page is not full.
  const owned = [['movie', 'torbox-movies'], ['series', 'torbox-series'], ['series', 'torbox-anime']];
  for (const [type, id] of owned) {
    for (let i = 0; i < maxPages; i++) {
      const data = await loopbackJson(rec, `/catalog/${type}/${id}/skip=${i * 50}.json`);
      const metas = data && Array.isArray(data.metas) ? data.metas : null;
      if (!metas || metas.length === 0) break;
      if (i === 0) {
        for (const m of metas.slice(0, WARM_META_LIMIT)) {
          if (m && m.id) metaTargets.push({ type: m.type || type, id: m.id });
        }
      }
      if (metas.length < 50) break;
    }
  }
  // Franchise collection (posters + meta).
  await loopbackJson(rec, '/catalog/movie/torbox-collections/skip=0.json');

  // Discovery rows (only when enabled): first page feeds meta/stream warm.
  const discovery = [];
  if (warmEnabled(cfg, 'trending')) discovery.push(['movie', 'torbox-trending-movies'], ['series', 'torbox-trending-series']);
  if (warmEnabled(cfg, 'popular')) discovery.push(['movie', 'torbox-popular-movies'], ['series', 'torbox-popular-series']);
  for (const [type, id] of discovery) {
    const data = await loopbackJson(rec, `/catalog/${type}/${id}/skip=0.json`);
    const metas = data && Array.isArray(data.metas) ? data.metas : null;
    if (!metas) continue;
    for (const m of metas.slice(0, WARM_STREAM_LIMIT)) {
      if (m && m.id && String(m.id).startsWith('tt')) streamTargets.push({ type, id: m.id });
    }
  }

  const now = Date.now();
  if (metaTargets.length && WARM_META_LIMIT > 0 && now - (rec.lastMetaWarmAt || 0) > WARM_META_INTERVAL * 1000) {
    rec.lastMetaWarmAt = now;
    for (const m of metaTargets.slice(0, WARM_META_LIMIT * 2)) {
      await loopbackJson(rec, `/meta/${m.type}/${encodeURIComponent(m.id)}.json`, 30000);
    }
  }
  if (streamTargets.length && WARM_STREAM_LIMIT > 0 && now - (rec.lastStreamWarmAt || 0) > WARM_STREAM_INTERVAL * 1000) {
    rec.lastStreamWarmAt = now;
    for (const s of streamTargets.slice(0, WARM_STREAM_LIMIT * 2)) {
      await loopbackJson(rec, `/stream/${s.type}/${encodeURIComponent(s.id)}.json`, 30000);
    }
  }
  } finally {
    rec.warming = false;
  }
}

function runSync(rec) {
  if (!rec) return Promise.resolve(null);
  if (rec.syncing) return rec.syncing;
  const promise = (async () => {
    try {
      const result = await syncScope(rec, syncOptions());
      // After each sync, warm the first page of the owned catalogues so the
      // next Nuvio open already has rendered Pictorium posters on disk/Redis.
      warmCatalogs(rec).catch(() => {});
      return result;
    } finally {
      rec.syncing = null;
      rec.lastSyncAt = Date.now();
      rec.force = false;
    }
  })();
  rec.syncing = promise.catch((err) => {
    console.warn(`[Library] sync failed (${rec.scopeId}):`, err.message);
    return null;
  });
  return rec.syncing;
}

async function runOnce() {  if (workerRunning) return { skipped: true };
  workerRunning = true;
  const startedAt = Date.now();
  try {
    const records = [...registry.values()];
    await pLimit(records, 2, async (rec) => {
      if (rec.syncing) return;
      const due = !rec.lastSyncAt || (Date.now() - rec.lastSyncAt) >= intervalMs();
      if (!due && !rec.force) return;
      await runSync(rec);
    });
  } finally {
    workerRunning = false;
    lastRunAt = new Date().toISOString();
    lastRunMs = Date.now() - startedAt;
  }
  return { ran: true };
}

let draining = false;
let drainRuns = 0;
// Drain pending metadata matches for every scope, with no provider fetch. Runs
// more often than the sync loop so a cold 3k-item library converges quickly.
async function drainOnce() {
  if (draining) return { skipped: true };
  draining = true;
  const startedAt = Date.now();
  try {
    const records = [...registry.values()];
    const options = syncOptions();
    await pLimit(records, 2, async (rec) => {
      if (rec.syncing) return;
      const counts = await store.counts(rec.scopeId).catch(() => null);
      if (!counts || counts.pending_count === 0) return;
      await matcher.matchScope(rec, {
        batch: options.matchBatch,
        concurrency: options.matchConcurrency,
        budgetMs: options.matchBudgetMs,
      });
    });
    drainRuns++;
  } finally {
    draining = false;
  }
  return { drained: true, ms: Date.now() - startedAt };
}

let enriching = false;
let enrichRuns = 0;
function identityTitleOf(row) {
  const meta = row.match_meta && typeof row.match_meta === 'object' ? row.match_meta : null;
  return (meta && (meta.name || meta.title)) || row.name || '';
}
function identityYearOf(row) {
  const meta = row.match_meta && typeof row.match_meta === 'object' ? row.match_meta : null;
  if (!meta) return null;
  const y = meta.releaseInfo || (meta.released ? String(meta.released).slice(0, 4) : null);
  return y ? Number(y) || null : null;
}

// Resolve canonical identity + cross-provider ids + metadata + episodes for
// every matched entity, one entity at a time, entirely in the background. A
// series confirmed as anime is reclassified and the scope's identity version is
// bumped so catalog caches rebuild.
async function enrichOnce() {
  if (enriching) return { skipped: true };
  enriching = true;
  const startedAt = Date.now();
  try {
    // Recover any rows left 'resolving' by an earlier crash/restart. Single-
    // flight: no pass runs while this one is in progress.
    await store.resetStuckIdentities().catch(() => 0);
    const options = enrichOptions();
    const records = [...registry.values()];
    await pLimit(records, 2, async (rec) => {
      // Do not enrich a scope while its sync write pass is running: the two both
      // touch lib_items and used to contend into a query timeout.
      if (rec.syncing) return;
      const rows = await store.claimIdentityJobs(rec.scopeId, options.claimBatch).catch(() => []);
      if (!rows.length) return;
      const groups = new Map();
      for (const row of rows) {
        const mediaType = row.media_type || 'series';
        const entityKey = `${mediaType}:${row.tmdb_id}`;
        let g = groups.get(entityKey);
        if (!g) {
          g = { entityKey, mediaType, tmdbId: row.tmdb_id, imdbId: row.imdb_id || null, title: identityTitleOf(row), year: identityYearOf(row), itemIds: [] };
          groups.set(entityKey, g);
        }
        g.itemIds.push(row.id);
        if (!g.imdbId && row.imdb_id) g.imdbId = row.imdb_id;
      }
      // Process every claimed group: a claimed row must always reach a terminal
      // state, otherwise it can never be reclaimed.
      const list = [...groups.values()];
      let versionBumped = false;
      await pLimit(list, options.concurrency, async (g) => {
        let resolved;
        try {
          resolved = await resolveEntity({
            mediaType: g.mediaType, tmdbId: g.tmdbId, imdbId: g.imdbId,
            title: g.title, year: g.year,
            tvdbApiKey: rec.config && rec.config.tvdbApiKey ? rec.config.tvdbApiKey : '',
          });
        } catch (err) {
          resolved = { ids: {}, meta: {}, episodes: [], mediaType: g.mediaType, provider: null, status: 'failed', confidence: 0, error: String(err.message || err).slice(0, 300) };
        }
        try {
          await store.saveIdentity(g.entityKey, resolved);
          if (resolved.episodes && resolved.episodes.length) await store.replaceEpisodes(g.entityKey, resolved.episodes);
          const searchAlt = (resolved.meta?.altTitles || []).map((t) => normalizeTitle(t)).filter(Boolean).join(' ').slice(0, 2000);
          const itemStatus = resolved.status === 'failed' ? 'failed' : 'enriched';
          await store.linkItems(g.itemIds, { entityKey: g.entityKey, mediaType: resolved.mediaType || g.mediaType, searchAlt, status: itemStatus });
          if (resolved.mediaType && resolved.mediaType !== g.mediaType) versionBumped = true;
        } catch (err) {
          await store.markIdentityStatus(g.itemIds, 'failed', String(err.message || err).slice(0, 300)).catch(() => {});
        }
      });
      if (versionBumped) rec.identityVersion = await store.bumpIdentityVersion(rec.scopeId).catch(() => rec.identityVersion || 0);
      else if (rec.identityVersion == null) rec.identityVersion = await store.getIdentityVersion(rec.scopeId).catch(() => 0);
    });
    enrichRuns++;
  } finally {
    enriching = false;
  }
  return { enriched: true, ms: Date.now() - startedAt };
}

async function resumePersisted() {
  const scopes = await store.listScopes();
  let restored = 0;
  for (const row of scopes) {
    if (!row.config_token) continue;
    try {
      const config = HOSTED && HOSTED.resolveOpaqueToken
        ? await HOSTED.resolveOpaqueToken(row.config_token)
        : null;
      if (!config) continue;
      const rec = noteConfig(row.config_token, config);
      if (rec) {
        rec.lastSyncAt = row.last_sync_at ? new Date(row.last_sync_at).getTime() : 0;
        rec.identityVersion = row.identity_version || 0;
        restored++;
      }
    } catch { /* skip unresolvable scope */ }
  }
  return restored;
}

async function start() {
  if (started) return isIndexed();
  started = true;
  if (!isIndexed()) {
    console.log(`[Library] Indexed engine off, using legacy path (LIBRARY_ENGINE=${mode()}, database=${db.enabled() ? 'on' : 'off'})`);
    return false;
  }
  const ok = await db.ensureSchema();
  if (!ok) {
    console.error('[Library] Indexed engine unavailable: schema could not be created');
    return false;
  }
  const reset = await store.resetStuckMatches().catch(() => 0);
  const resetId = await store.resetStuckIdentities().catch(() => 0);
  const restored = await resumePersisted().catch((err) => {
    console.warn('[Library] resume failed:', err.message);
    return 0;
  });
  console.log(`[Library] Indexed engine started: interval=${intervalMs() / 1000}s, drain=${drainIntervalMs() / 1000}s, enrich=${enrichIntervalMs() / 1000}s, resumed=${restored}${reset ? `, requeued=${reset}` : ''}${resetId ? `, requeuedIds=${resetId}` : ''}`);
  workerTimer = setInterval(() => { runOnce().catch(() => {}); }, intervalMs());
  workerTimer.unref?.();
  drainTimer = setInterval(() => { drainOnce().catch(() => {}); }, drainIntervalMs());
  drainTimer.unref?.();
  enrichTimer = setInterval(() => { enrichOnce().catch(() => {}); }, enrichIntervalMs());
  enrichTimer.unref?.();
  setTimeout(() => { runOnce().catch(() => {}); }, 2000).unref?.();
  setTimeout(() => { drainOnce().catch(() => {}); }, 5000).unref?.();
  setTimeout(() => { enrichOnce().catch(() => {}); }, 8000).unref?.();
  return true;
}

function stop() {
  if (workerTimer) { clearInterval(workerTimer); workerTimer = null; }
  if (drainTimer) { clearInterval(drainTimer); drainTimer = null; }
  if (enrichTimer) { clearInterval(enrichTimer); enrichTimer = null; }
  started = false;
}

// ── Read facade ────────────────────────────────────────────────────────────

// Bounded first-load wait: when a scope has never been indexed, give the
// in-flight sync a short head start, then serve whatever local rows exist.
// Nuvio never waits on a full provider scan or a full TMDB match pass.
function firstWaitMs() {
  return Math.max(0, parseInt(process.env.LIBRARY_FIRST_WAIT_MS, 10) || 1500);
}

function catalogTtl() {
  return Math.max(10, parseInt(process.env.LIBRARY_CATALOG_TTL, 10) || 300);
}

// Kick off background Pictorium rendering for a page's posters so the grid
// does not make the client wait seconds per image. Paths only: the warmer calls
// back through the proxy, which owns caching and the provider key.
function warmCatalogPosters(config, metas) {
  if (!config || config.posterProvider !== 'pictorium' || !pictoriumWarm.enabled()) return;
  const paths = [];
  for (const m of metas || []) {
    if (!m || typeof m.poster !== 'string') continue;
    if (m.poster.startsWith('/')) { paths.push(m.poster); continue; }
    try { const u = new URL(m.poster); paths.push(u.pathname + u.search); } catch { /* ignore */ }
  }
  if (paths.length) pictoriumWarm.enqueue(paths);
}

// Coalesce identical concurrent catalog reads (a Nuvio burst on one page).
const catalogInFlight = new Map();

function catalogFingerprint({ userKey, type, sortBy, skip, libraryIdMode, provider, enhance }) {
  const raw = JSON.stringify({ userKey, type, sortBy, skip, libraryIdMode, provider, enhance });
  return require('crypto').createHash('sha1').update(raw).digest('hex');
}

async function buildCatalog({ token, config, type, sortBy = 'data_adicao', skip = 0, libraryIdMode, lang = 'en-US', enhance = {}, provider = null }) {
  const userKey = providers.getUserKey(config);
  noteConfig(token, config);
  const rec = registry.get(userKey);
  // `ready` is false until this scope has completed a sync. Callers use it to
  // fall back to the legacy path on a brand-new install instead of serving an
  // empty library while the first index is still building.
  const ready = !!rec?.lastSyncAt;
  const fingerprint = catalogFingerprint({ userKey, type, sortBy, skip, libraryIdMode, provider, enhance });
  // Result cache keyed by the scope's last sync time, so a completed sync
  // naturally produces a fresh key and stale pages expire on their own TTL.
  const resultKey = cache.makeKey('libcat', userKey, String(rec?.lastSyncAt || 0), String(rec?.identityVersion ?? 0), fingerprint);
  const cachedMetas = await cache.get(resultKey).catch(() => null);
  if (Array.isArray(cachedMetas)) {
    metrics.request('catalogIndexed');
    warmCatalogPosters(config, cachedMetas);
    return { metas: cachedMetas, syncing: !!rec?.syncing, indexed: true, cached: true, ready };
  }

  let pending = catalogInFlight.get(fingerprint);
  if (!pending) {
    pending = (async () => {
      let rows = await store.catalogRows(userKey, type, provider);
      if (!rows.length) {
        // Only a scope that has never completed a sync waits for one. Once it
        // has, an empty type (e.g. no anime in the library) returns instantly
        // instead of paying the first-load wait on every request.
        if (rec && !rec.lastSyncAt) {
          runSync(rec).catch(() => {});
          const wait = firstWaitMs();
          if (wait > 0) {
            await Promise.race([rec.syncing || Promise.resolve(), sleep(wait)]);
            rows = await store.catalogRows(userKey, type, provider);
          }
        }
        if (!rows.length) {
          metrics.request('catalogFallback');
          return { metas: [], syncing: !!rec?.syncing, indexed: true, ready };
        }
      }
      const metas = await catalog.buildFromRows(rows, {
        userKey, sortBy, skip, limit: 50, type, libraryIdMode,
        tmdbApiKey: config.tmdbApiKey, lang, enhance,
      });
      await cache.set(resultKey, metas, catalogTtl()).catch(() => {});
      metrics.request('catalogIndexed');
      warmCatalogPosters(config, metas);
      return { metas, syncing: !!rec?.syncing, indexed: true, ready };
    })().finally(() => catalogInFlight.delete(fingerprint));
    catalogInFlight.set(fingerprint, pending);
  }
  return pending;
}

async function search({ token, config, type, query, limit = 50, libraryIdMode, lang = 'en-US', enhance = {}, provider = null }) {
  const userKey = providers.getUserKey(config);
  noteConfig(token, config);
  return librarySearch.searchLibrary({
    scopeId: userKey, provider, type, query, limit, libraryIdMode,
    tmdbApiKey: config.tmdbApiKey, lang, enhance, userKey,
  });
}

// Populate the in-process owned-episode index from persisted rows so a meta or
// stream request for an owned title is answered without a provider scan.
async function hydrateOwnedIndex({ userKey, tmdbId }) {
  if (!isIndexed() || !userKey || !tmdbId) return 0;
  const rows = await store.tmdbItems(userKey, tmdbId).catch(() => []);
  if (!rows.length) return 0;
  const metas = rows.map((r) => catalog.rowToMeta(r)).filter(Boolean);
  builder.populateTmdbIndexFromMetas(metas, userKey);
  return metas.length;
}

function status() {
  return {
    enabled: isIndexed(),
    mode: mode(),
    database: db.enabled(),
    worker: {
      running: workerRunning,
      started,
      intervalMs: intervalMs(),
      drainIntervalMs: drainIntervalMs(),
      enrichIntervalMs: enrichIntervalMs(),
      drainRuns,
      enrichRuns,
      lastRunAt,
      lastRunMs,
      scopes: registry.size,
    },
    identityProviders: identityProviders.status(),
    pictoriumWarm: pictoriumWarm.stats(),
    metrics: metrics.snapshot(),
  };
}

async function scopeStatus(scopeId) {
  const row = await store.getScope(scopeId).catch(() => null);
  const rec = registry.get(scopeId);
  const identities = await store.identityCounts(scopeId).catch(() => null);
  const coverage = await store.identityCoverage(scopeId).catch(() => null);
  const mediaTypes = await store.mediaTypeCounts(scopeId).catch(() => null);
  return { ...(row || {}), syncing: !!rec?.syncing, registered: !!rec, identities, coverage, mediaTypes };
}

async function triggerSync(token, config) {
  noteConfig(token, config);
  const userKey = providers.getUserKey(config);
  const rec = registry.get(userKey);
  if (!rec) return null;
  rec.force = true;
  await runSync(rec);
  return scopeStatus(userKey);
}

module.exports = {
  isIndexed,
  mode,
  noteConfig,
  start,
  stop,
  runOnce,
  drainOnce,
  enrichOnce,
  buildCatalog,
  search,
  hydrateOwnedIndex,
  status,
  scopeStatus,
  triggerSync,
  _registry: registry,
};
