// @ts-nocheck
// Background synchronisation for the index-first engine. Fetches a provider
// snapshot (reusing the existing coalesced provider layer), reconciles it into
// the persistent local index, then runs metadata matching for new/changed rows.
const fs = require('fs');
const cache = require('../runtime/cache.ts');
const providers = require('../providers/index.ts');
const store = require('./store.ts');
const matcher = require('./matcher.ts');
const metrics = require('./metrics.ts');
const { buildRecord, sourceIdOf } = require('./diff.ts');

let fixtureCache = { path: null, mtimeMs: 0, items: [] };

function fixturePath() {
  return process.env.LIBRARY_SYNC_FIXTURE || null;
}

// Test hook: a JSON array of provider-shaped items on disk stands in for a live
// provider scan so the acceptance tests and benchmarks run without any key.
function loadFixture() {
  const file = fixturePath();
  if (!file) return null;
  const stat = fs.statSync(file);
  if (fixtureCache.path === file && fixtureCache.mtimeMs === stat.mtimeMs) return fixtureCache.items;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.items) ? parsed.items : []);
  fixtureCache = { path: file, mtimeMs: stat.mtimeMs, items };
  return items;
}

function recordsFromDownloads(downloads) {
  const records = [];
  for (const item of downloads) {
    if (!item || typeof item !== 'object') continue;
    const sourceId = sourceIdOf(item);
    if (!sourceId) continue;
    try { records.push(buildRecord(item, sourceId)); } catch { /* skip malformed */ }
  }
  return records;
}

async function fetchDownloads(scope) {
  const fixture = fixturePath() ? loadFixture() : null;
  if (fixture) return fixture;
  // A sync reconciles the persistent index, so it must never treat a cached
  // provider fallback as a fresh snapshot. Transient TorBox failures should
  // fail this sync and leave the last good index intact.
  return providers.fetchDownloads(scope.config, { useCache: false, requireFresh: true });
}

// Owned franchise collections ("LeLibrary Collections") from the library's
// matched films, so box-set films, hash-named downloads and owner fixes all
// count. They have no indexed read path of their own: keep the projection warm
// so catalog routes serve memory/Redis instead of rebuilding on a request.
// Fire-and-forget; at most every 5 minutes per library unless forced (a sync).
const FRANCHISE_REFRESH_MIN_MS = 5 * 60 * 1000;
function refreshFranchiseProjection(scope, { force = false } = {}) {
  try {
    if (!scope || !scope.config || !scope.config.tmdbApiKey) return;
    const now = Date.now();
    if (!force && scope.lastFranchiseRefreshAt && now - scope.lastFranchiseRefreshAt < FRANCHISE_REFRESH_MIN_MS) return;
    scope.lastFranchiseRefreshAt = now;
    const franchise = require('../catalog/franchise-collections.ts');
    // Lazy: routes/shared pulls the addon router chain.
    const { posterEnhance, posterFp } = require('../routes/shared.ts');
    store.matchedMovieFilms(scope.scopeId).then((films) => franchise.refreshCollectionsProjection({
      userKey: scope.scopeId, films, tmdbApiKey: scope.config.tmdbApiKey, lang: scope.lang || 'en-US',
      enhance: posterEnhance(scope.config), sortBy: scope.config.sortBy || 'data_adicao',
      posterFp: posterFp(scope.config),
    })).then((metas) => {
      // A new (or gone) franchise: update Nuvio's owned collection for the
      // setups that pushed it (setup/franchise-autopush.ts).
      if (Array.isArray(metas) && scope.setupUuids && scope.setupUuids.size) {
        return require('../setup/franchise-autopush.ts').noteProjection(scope.setupUuids, metas);
      }
      return null;
    }).catch(() => {});
  } catch { /* collections warm is best effort */ }
}

// Sync one scope: provider -> reconcile -> match. Safe to call concurrently;
// the engine coalesces per scope with an in-flight promise.
async function syncScope(scope, options = {}) {
  const { scopeId } = scope;
  const started = Date.now();
  await store.markScopeSyncing(scopeId);
  try {
    const providerStart = Date.now();
    const downloads = await fetchDownloads(scope);
    const providerMs = Date.now() - providerStart;
    // Seed the shared downloads cache so the discovery owned-bridge, franchise
    // collections and custom-stream paths keep working from the same snapshot
    // without their own provider scan.
    if (!fixturePath() && Array.isArray(downloads) && downloads.length) {
      providers.setCachedDownloads(scope.config, downloads).catch(() => {});
    }

    const records = recordsFromDownloads(downloads);
    const counts = await store.reconcile(scopeId, records, { keepProviders: (downloads && downloads.failedProviders) || [] });
    if (counts.changed > 0) {
      console.log(`[Library] reconcile changed fields: rows=${counts.changed} name=${counts.name_changed || 0} title=${counts.title_changed || 0} type=${counts.type_changed || 0} numbering=${counts.numbering_changed || 0} match-preserved=${counts.matchPreserved || 0}`);
    }

    const matchStats = await matcher.matchScope(scope, {
      batch: options.matchBatch,
      concurrency: options.matchConcurrency,
      budgetMs: options.matchBudgetMs,
    });

    const totals = await store.counts(scopeId);
    const durationMs = Date.now() - started;
    await store.markScopeResult(scopeId, {
      status: 'ok',
      durationMs,
      counts,
      totals: { ...totals, provider: scope.provider },
    });
    // Deleted downloads must drop out of detail pages too (same 24h-cache
    // staleness as new matches, mirrored here because the matcher only sees
    // matched rows, never removals).
    if ((counts.removed || 0) > 0) {
      await cache.delPattern(`meta:*${scopeId}*`).catch(() => {});
    }
    // Owned franchise collections ("LeLibrary Collections"): rebuild when the
    // library or its matches changed, or the projection is empty (restart).
    const changed = (counts.added || 0) + (counts.changed || 0) + (counts.removed || 0);
    if (changed > 0 || Number(matchStats.matched || 0) > 0
      || require('../catalog/franchise-collections.ts').getCollections(scopeId, scope.lang || 'en-US').length === 0) {
      refreshFranchiseProjection(scope, { force: true });
    }
    metrics.recordSync({
      scopeId, provider: scope.provider, durationMs, providerMs,
      scanned: counts.scanned, added: counts.added, changed: counts.changed,
      removed: counts.removed, unchanged: counts.unchanged,
      pending: matchStats.processed, matched: matchStats.matched, failed: matchStats.failed,
      candidateSearches: matchStats.candidateSearches,
      candidateSearchDedupeHits: matchStats.candidateSearchDedupeHits,
    });
    return { counts, matchStats, totals, durationMs, providerMs };
  } catch (err) {
    const durationMs = Date.now() - started;
    await store.markScopeResult(scopeId, {
      status: 'error', error: String(err.message || err).slice(0, 300), durationMs,
    }).catch(() => {});
    metrics.recordSync({ scopeId, provider: scope.provider, durationMs, error: err.message });
    throw err;
  }
}

export interface SyncApi {
  refreshFranchiseProjection: typeof refreshFranchiseProjection;
  syncScope: any;
  recordsFromDownloads: any;
  loadFixture: any;
  fixturePath: any;
}

module.exports = { syncScope, refreshFranchiseProjection, recordsFromDownloads, loadFixture, fixturePath } satisfies SyncApi;
