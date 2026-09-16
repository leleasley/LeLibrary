// Background metadata matching for the index-first engine. Reuses the existing
// builder.matchItem pipeline (parser + scene/alias/AKA + match cache + ID map),
// but runs it off the request path and persists the result on the local item.
const builder = require('../builder');
const { getImdbId } = require('../tmdb');
const { offlineMatchFromItem } = require('./diff');
const store = require('./store');
const metrics = require('./metrics');
const { pLimit } = require('./util');

function offlineEnabled() {
  return process.env.LIBRARY_MATCH_OFFLINE === '1' || process.env.LIBRARY_MATCH_OFFLINE === 'true';
}

async function resolveImdb(tmdbApiKey, meta, existing) {
  if (existing) return existing;
  if (!meta || !meta.tmdbId) return null;
  if (offlineEnabled()) return null;
  try {
    return await getImdbId(tmdbApiKey, meta.type === 'movie' ? 'movie' : 'tv', meta.tmdbId) || null;
  } catch {
    return null;
  }
}

// Process up to `batch` pending items for a scope. Returns aggregate counts.
// Pending items are claimed atomically (FOR UPDATE SKIP LOCKED), so two workers
// or two overlapping syncs never match the same item twice.
async function matchScope(scope, { batch = 50, concurrency = 4, budgetMs = 0 } = {}) {
  const { scopeId, config, tmdbApiKey, lang } = scope;
  const started = Date.now();
  let processed = 0;
  let matched = 0;
  let failed = 0;

  for (;;) {
    if (budgetMs > 0 && Date.now() - started > budgetMs) break;
    const jobs = await store.claimMatchJobs(scopeId, batch);
    if (!jobs.length) break;
    await pLimit(jobs, concurrency, async (job) => {
      let meta = null;
      try {
        if (offlineEnabled()) meta = offlineMatchFromItem(job.raw);
        else {
          metrics.add('tmdbCalls');
          meta = await builder.matchItem(job.raw, tmdbApiKey, job.media_type || 'movie', lang, config);
        }
      } catch (err) {
        await store.saveMatch(job.id, { status: 'failed', error: String(err.message || err).slice(0, 300) });
        failed++;
        processed++;
        return;
      }
      if (meta && meta.tmdbId) {
        const { torboxItem, ...stored } = meta;
        const imdbId = await resolveImdb(tmdbApiKey, meta, meta.imdbId || null);
        await store.saveMatch(job.id, {
          status: 'matched',
          tmdbId: meta.tmdbId,
          imdbId,
          matchMeta: { ...stored, imdbId: imdbId || undefined, torboxItem: undefined },
        });
        matched++;
      } else {
        await store.saveMatch(job.id, { status: 'failed' });
        failed++;
      }
      processed++;
    });
  }

  metrics.time('matchMs', Date.now() - started);
  return { processed, matched, failed };
}

module.exports = { matchScope, offlineEnabled };
