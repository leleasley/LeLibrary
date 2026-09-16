// Background synchronisation for the index-first engine. Fetches a provider
// snapshot (reusing the existing coalesced provider layer), reconciles it into
// the persistent local index, then runs metadata matching for new/changed rows.
const fs = require('fs');
const providers = require('../providers');
const store = require('./store');
const matcher = require('./matcher');
const metrics = require('./metrics');
const { buildRecord, sourceIdOf } = require('./diff');

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
  return providers.fetchDownloads(scope.config, { useCache: false });
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
    metrics.recordSync({
      scopeId, provider: scope.provider, durationMs, providerMs,
      scanned: counts.scanned, added: counts.added, changed: counts.changed,
      removed: counts.removed, unchanged: counts.unchanged,
      pending: matchStats.processed, matched: matchStats.matched, failed: matchStats.failed,
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

module.exports = { syncScope, recordsFromDownloads, loadFixture, fixturePath };
