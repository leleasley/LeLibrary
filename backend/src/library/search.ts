// @ts-nocheck
// Local library search: Postgres text/prefix search over the synced index, with
// a result cache and in-flight coalescing so identical concurrent queries do
// the work once.
const cache = require('../runtime/cache.ts');
const store = require('./store.ts');
const catalog = require('./catalog.ts');
const metrics = require('./metrics.ts');

const SEARCH_TTL = parseInt(process.env.LIBRARY_SEARCH_TTL, 10) || 300;
const inFlight = new Map();

async function searchLibrary({
  scopeId, provider = null, type, query, limit = 50, libraryIdMode, tmdbApiKey,
  lang, enhance, userKey, enhanceFingerprint = '',
}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  // Poster providers are baked into the cached rows: without the fingerprint
  // a provider switch keeps serving the previous artwork for the TTL.
  const cacheKey = cache.makeKey(
    'libsearch', scopeId, type, lang || 'en-US', String(limit), libraryIdMode || 'torbox',
    provider || 'all', enhanceFingerprint || '', q.toLowerCase(),
  );

  const cached = await cache.get(cacheKey);
  if (Array.isArray(cached)) {
    metrics.request('searchIndexed');
    return cached;
  }

  let pending = inFlight.get(cacheKey);
  if (!pending) {
    const started = Date.now();
    pending = (async () => {
      const rows = await store.searchRows(scopeId, type, q, limit, provider);
      const metas = await catalog.buildFromRows(rows, {
        userKey, sortBy: 'relevance', skip: 0, limit, type, libraryIdMode,
        tmdbApiKey, lang, enhance, paginate: false,
      });
      await cache.set(cacheKey, metas, SEARCH_TTL);
      metrics.time('searchMs', Date.now() - started);
      return metas;
    })().finally(() => inFlight.delete(cacheKey));
    inFlight.set(cacheKey, pending);
  }
  metrics.request('searchIndexed');
  return pending;
}

export interface SearchApi {
  searchLibrary: any;
}

module.exports = { searchLibrary } satisfies SearchApi;