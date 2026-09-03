// ── Shared collection catalogue cache warming ─────────────────
//
// Library and curated collection rows are always cached by libcatalog via
// src/cache.js (Redis with the in-process mirror). This module deliberately
// does not introduce an account-specific cache: it warms those exact runtime
// keys before a newly-pushed Nuvio folder is opened for the first time.

function normaliseLibraryId(value) {
  const id = String(value || '').trim();
  return id.startsWith('lib-') ? id.slice(4) : id;
}

function uniqueLibraryIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normaliseLibraryId)
    .filter((id) => /^[a-z0-9_]+$/i.test(id)))];
}

function configuredLibraryIds(config = {}) {
  const ids = [
    ...(Array.isArray(config.libraryCatalogs) ? config.libraryCatalogs : []),
  ];
  // A curated pack is just a collection of normal lib-* source ids. Include
  // them even though Nuvio accesses them through its compact folder routes.
  try {
    const { curatedSourceIds } = require('./curated-collections');
    ids.push(...curatedSourceIds(config.nuvioCollectionPacks));
  } catch {}
  return uniqueLibraryIds(ids);
}

async function runBounded(items, limit, task) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await task(item);
    }
  });
  await Promise.all(workers);
}

// Used after normal or account Configure saves. Calling buildLibraryCatalog is
// important: it writes exactly the same cat:lib3 Redis entries and 24-hour TTL
// that catalogue requests use. No credentials are copied into another store.
async function warmConfiguredLibraryCatalogs(config = {}, { limit = 3 } = {}) {
  const ids = configuredLibraryIds(config);
  if (!ids.length || !config.tmdbApiKey) return { requested: ids.length, warmed: 0, failed: 0 };
  const { getSourceDefinition } = require('./catalog-source-registry');
  const { buildLibraryCatalog } = require('./libcatalog');
  const providers = require('./providers');
  const enhance = {
    erdbToken: config.erdbToken,
    rpdbKey: config.rpdbKey,
    fanartKey: config.fanartKey,
    posterProvider: config.posterProvider,
  };
  const eligible = ids.filter((id) => !!getSourceDefinition(id));
  let warmed = 0;
  let failed = 0;
  await runBounded(eligible, limit, async (catalogId) => {
    try {
      await buildLibraryCatalog({
        tmdbApiKey: config.tmdbApiKey,
        catalogId,
        lang: config.lang || 'en-US',
        userKey: providers.getUserKey(config),
        enhance,
        mdblistKey: config.mdblistKey,
      });
      warmed++;
    } catch (err) {
      failed++;
      console.warn('[Collection cache] Could not warm', catalogId + ':', err.message);
    }
  });
  return { requested: eligible.length, warmed, failed };
}

// Used by account collection pushes, where the context document contains the
// source ids but config credentials remain safely server-side behind an opaque
// token. Requests re-enter the normal catalogue route, therefore share its
// Redis key, cache TTL and config resolution exactly.
async function warmTokenLibraryCatalogs({ origin, tokenId, libraryIds = [], request, limit = 3 } = {}) {
  const ids = uniqueLibraryIds(libraryIds);
  if (!origin || !tokenId || !ids.length || typeof request !== 'function') {
    return { requested: ids.length, warmed: 0, failed: 0 };
  }
  const { getSourceDefinition } = require('./catalog-source-registry');
  const eligible = ids.filter((id) => !!getSourceDefinition(id));
  let warmed = 0;
  let failed = 0;
  const base = String(origin).replace(/\/+$/, '');
  await runBounded(eligible, limit, async (catalogId) => {
    const type = getSourceDefinition(catalogId)?.type === 'movie' ? 'movie' : 'series';
    try {
      await request(`${base}/${encodeURIComponent(tokenId)}/catalog/${type}/lib-${encodeURIComponent(catalogId)}/skip=0.json`);
      warmed++;
    } catch (err) {
      failed++;
      console.warn('[Collection cache] Could not warm', catalogId + ':', err.message);
    }
  });
  return { requested: eligible.length, warmed, failed };
}

module.exports = {
  configuredLibraryIds,
  uniqueLibraryIds,
  warmConfiguredLibraryCatalogs,
  warmTokenLibraryCatalogs,
};
