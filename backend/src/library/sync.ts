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
    const counts = await store.reconcile(scopeId, records);
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
    // LeLibrary franchise collections ("LeLibrary Collections" row) have no
    // indexed read path of their own: keep their projection warm from this
    // same snapshot so catalog routes serve memory/Redis instead of
    // live-rebuilding thousands of titles on a Stremio request (which times
    // out). Only when the library changed, or the projection is empty
    // (restart); fire-and-forget, never on the request path.
    try {
      const franchise = require('../catalog/franchise-collections.ts');
      const lang = scope.lang || 'en-US';
      const changed = (counts.added || 0) + (counts.changed || 0) + (counts.removed || 0);
      if (scope.config && scope.config.tmdbApiKey && (changed > 0 || franchise.getCollections(scopeId, lang).length === 0)) {
        // Lazy: routes/shared pulls the addon router chain; the engine already
        // uses this pattern to avoid a top-level cycle.
        const { posterEnhance, posterFp } = require('../routes/shared.ts');
        franchise.refreshCollectionsProjection({
          userKey: scopeId, downloads, tmdbApiKey: scope.config.tmdbApiKey, lang,
          enhance: posterEnhance(scope.config), sortBy: scope.config.sortBy || 'data_adicao',
          posterFp: posterFp(scope.config),
        }).catch(() => {});
      }
    } catch { /* collections warm is best effort */ }
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
  syncScope: any;
  recordsFromDownloads: any;
  loadFixture: any;
  fixturePath: any;
}

module.exports = { syncScope, recordsFromDownloads, loadFixture, fixturePath } satisfies SyncApi;
