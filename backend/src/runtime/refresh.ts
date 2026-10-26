// @ts-nocheck
'use strict';
// Background refresh: the shared provider snapshot, the per-token library
// projection, and the registry that keeps opaque installs refreshing after a
// restart. Every route that warms a library goes through here, so the two
// minute loop stays the only place that scans a provider.
const cache = require('./cache.ts');
const crypto = require('node:crypto');
const providers = require('../providers/index.ts');
const libraryEngine = require('../library/engine.ts');
const { buildCatalog } = require('../catalog/builder.ts');
const { buildCollectionsCatalog, cacheCollections, getCollections } = require('../catalog/franchise-collections.ts');
const { decodeConfig } = require('../config/token.ts');
const { hashShort, posterFp, posterEnhance } = require('./cache-fingerprint.ts');
const { libraryCatalogTtl } = require('../library/cache-policy.ts');

// v5.5 removed the hosted account extension; guarded paths degrade to self-host.
const HOSTED = null;

const TTL_CATALOG = parseInt(process.env.CACHE_TTL_CATALOG) || 3600;  // default 1h
// Provider-backed library rows are refreshed in the background every two
// minutes. Keep the durable server cache long, but ask clients to check back
// on that cadence so newly completed downloads do not stay hidden for an hour.
// Owned library rows should revalidate quickly after an addon open has
// triggered a provider sync; longer client TTLs make completed additions look
// missing even after the index has caught up.
// The indexed library catalogue projection is cached for five minutes. Keep
// the client freshness hint aligned so a completed sync is not hidden behind
// a shorter, constantly-expiring HTTP cache.
const OWNED_CATALOG_CLIENT_TTL = libraryCatalogTtl();
// Stream URLs can be short-lived (TorBox requestdl in particular). Revalidate
// frequently so clients don't keep a stale direct URL after the provider has
// invalidated it. Operators can still override this explicitly.
const TTL_STREAM  = parseInt(process.env.CACHE_TTL_STREAM)  || 60;

const knownConfigs = new Map();
// Cap the map AND stop refreshing tokens that never build. Both used to be
// unbounded: every forged/junk token seen on any route was remembered forever,
// and the 2-minute loop then hammered TorBox/RD with doomed auth attempts for
// each one (slow memory leak + cheap amplification vector).
const KNOWN_CONFIGS_MAX = 500;
const knownConfigFailures = new Map(); // token → consecutive failure count
const catalogBuildInFlight = new Map(); // token → active full-library build
const ACCOUNT_REFRESH_REGISTRY_TTL = 30 * 24 * 60 * 60;
const ACCOUNT_REFRESH_REGISTRY_PREFIX = 'refresh:account-token:';
const providerRefreshSnapshots = new Map(); // provider-key hash → { at, downloads, error }
const providerRefreshInFlight = new Map();
function rememberConfig(token, config) {
  // A saved account setup can be edited while its token remains installed.
  // Always replace the in-memory snapshot so the next refresh uses the latest
  // resolved account config rather than an old copy from before that edit.
  const alreadyKnown = knownConfigs.has(token);
  if (alreadyKnown) knownConfigs.delete(token);
  while (knownConfigs.size >= KNOWN_CONFIGS_MAX) {
    // Insertion-order eviction: oldest-seen token goes first.
    const oldest = knownConfigs.keys().next().value;
    knownConfigs.delete(oldest);
    knownConfigFailures.delete(oldest);
  }
  knownConfigs.set(token, config);
  return !alreadyKnown;
}

function registerBackgroundRefresh(token, config) {
  // Index-first engine: remember the scope so the sync worker keeps its local
  // index warm. Cheap and synchronous; a no-op unless LIBRARY_ENGINE=indexed.
  libraryEngine.noteConfig(token, config);
  // When the indexed engine owns the library read path, do NOT also run the
  // legacy full provider scan + TMDB rebuild on every route. The worker syncs
  // the same provider snapshot into the index instead.
  if (libraryEngine.isIndexed()) return;
  // Opaque ids are already the account cache namespace. Persist only that
  // non-secret id, never a legacy config token (which embeds credentials), so
  // an active account install resumes its normal refresh loop after restart.
  if (HOSTED && !decodeConfig(token)) {
    cache.set(`${ACCOUNT_REFRESH_REGISTRY_PREFIX}${token}`, { active: true }, ACCOUNT_REFRESH_REGISTRY_TTL)
      .catch(() => {});
  }
  if (rememberConfig(token, config)) {
    buildAndCacheForConfig(token, config).catch(() => {});
  }
}

async function restoreAccountRefreshRegistry() {
  if (!HOSTED) return;
  const client = cache.getRedisClient();
  if (!client) return;
  let cursor = '0';
  let restored = 0;
  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', `${ACCOUNT_REFRESH_REGISTRY_PREFIX}*`, 'COUNT', 100);
    cursor = nextCursor;
    for (const key of keys.slice(0, KNOWN_CONFIGS_MAX - restored)) {
      const token = key.slice(ACCOUNT_REFRESH_REGISTRY_PREFIX.length);
      const config = await resolveConfig(token);
      if (!config) {
        await cache.del(key);
        continue;
      }
      rememberConfig(token, config);
      restored++;
    }
  } while (cursor !== '0' && restored < KNOWN_CONFIGS_MAX);
  if (restored) {
    console.log(`[Cache] Restored ${restored} active account refresh setup(s)`);
    // Do not leave restored account installs serving a pre-restart catalogue
    // for a whole polling interval.  The normal loop remains two minutes and
    // provider-key snapshots still coalesce sibling profiles, but one fresh
    // startup pass makes newly-added downloads visible as soon as the app is
    // back rather than after the first timer tick.
    if (!libraryEngine.isIndexed()) {
      await Promise.allSettled(
        [...knownConfigs.entries()].map(([token, config]) => buildAndCacheForConfig(token, config))
      );
    }
  }
}

const TYPES   = ['movie', 'series', 'anime'];
const REFRESH = 2 * 60 * 1000;
// Increment when matching/classification semantics change so durable Redis
// projections rebuild once even when the provider download list is unchanged.
const LIBRARY_PROJECTION_VERSION = 'v5';

// Background refresh is per provider-key set, not per installed token. One
// account may deliberately have several Nuvio profiles/tokens; scanning the
// same provider library for each token is wasteful and can provoke 429s. The
// first projection fetches fresh data, then every sibling projection reuses
// that exact snapshot for this refresh window while retaining its own output
// cache and artwork settings.
async function refreshDownloadsForUser(config, userKey) {
  const now = Date.now();
  // A limited TorBox source selection is a different (filtered) snapshot.
  const sourcesKey = providers.torboxSourcesKey(config);
  const snapshotKey = sourcesKey ? `${userKey}|${sourcesKey}` : userKey;
  // The snapshot map holds a full downloads array per provider-key set. Account
  // tokens that stop refreshing must not pin that memory forever, so prune
  // stale entries once the map grows.
  if (providerRefreshSnapshots.size > 500) {
    const cutoff = now - 30 * 60 * 1000;
    for (const [key, entry] of providerRefreshSnapshots) {
      if (!entry || !entry.at || entry.at < cutoff) providerRefreshSnapshots.delete(key);
    }
  }
  const recent = providerRefreshSnapshots.get(snapshotKey);
  if (recent && now - recent.at < REFRESH) {
    if (recent.error) throw recent.error;
    return recent.downloads;
  }
  const pending = providerRefreshInFlight.get(snapshotKey);
  if (pending) return pending;
  const work = providers.fetchDownloads(config, { useCache: false })
    .then(async (downloads) => {
      await providers.setCachedDownloads(config, downloads);
      providerRefreshSnapshots.set(snapshotKey, { at: Date.now(), downloads, error: null });
      return downloads;
    })
    .catch((err) => {
      providerRefreshSnapshots.set(snapshotKey, { at: Date.now(), downloads: null, error: err });
      throw err;
    })
    .finally(() => providerRefreshInFlight.delete(snapshotKey));
  providerRefreshInFlight.set(snapshotKey, work);
  return work;
}

// Fingerprint of a user's library. Includes updated_at AND the name so in-place
// edits (renames, file changes) also trigger a rebuild, not just add/remove -
// Real-Debrid items have no updated_at, so name is what catches renames there.
function hashDownloads(downloads) {
  // Change-detection fingerprint. Built as compact per-download lines rather
  // than a deep, key-sorted object graph: the old form recursively sorted every
  // object and stringified every file, which was the most CPU-heavy step in the
  // two-minute refresh (and ran again on catalog cache misses) for large
  // libraries. Fields are chosen so add/remove/rename, a new completed item, a
  // changed selected-file layout, or an updated state all change the hash.
  // Volatile progress/speed fields stay out.
  const lines = [];
  for (const d of downloads) {
    const files = Array.isArray(d.files) ? d.files
      : (d.files && typeof d.files === 'object' ? Object.values(d.files) : []);
    let fileSig = '';
    for (const file of files) {
      fileSig += `${file?.id ?? ''}\u0001${file?.name || file?.path || file?.filename || ''}\u0001${file?.size || file?.bytes || ''}\u0002`;
    }
    lines.push([
      d.source, d.id, d.name || d.filename,
      d.updated_at || d.created_at || d.last_state_change,
      d.size || d.bytes || d.total_size,
      d.file_count || d.fileCount || files.length,
      d.download_finished === true ? 'finished' : (d.download_state || d.status || ''),
      // NOTE: `total_downloaded` is deliberately EXCLUDED: it climbs on every
      // provider poll for seeding torrents and kept invalidating every catalog
      // projection (and re-pending the whole indexed library) on each refresh.
      d.hash, d.magnet, d.torrent_file, d.download_path,
      JSON.stringify(d.tags || ''), JSON.stringify(d.alternative_hashes || ''),
      fileSig,
    ].join('\u0001'));
  }
  lines.sort();
  return crypto.createHash('sha256').update(lines.join('\u0003')).digest('hex');
}

async function buildAndCacheForConfigInner(token, config) {
  // Merge server-side settings (incl. the libraryIdMode toggle) so the
  // background rebuild matches what the on-demand route would serve.
  config = await require('./configstore.ts').mergeStoredConfig(config);
  const { tmdbApiKey, sortBy = 'data_adicao', lang = 'en-US', rdCatalog = 'merge', erdbToken, rpdbKey, fanartKey, hideAnime, libraryIdMode } = config;
  if (!tmdbApiKey) return;

  const active = providers.activeProviders(config);
  const userKey = providers.getUserKey(config);
  if (!active.length) {
    // No usable provider keys: a junk/forged token. Drop it after a few
    // attempts instead of retrying forever every refresh cycle.
    const fails = (knownConfigFailures.get(token) || 0) + 1;
    knownConfigFailures.set(token, fails);
    if (fails >= 3) {
      knownConfigs.delete(token);
      knownConfigFailures.delete(token);
    }
    return;
  }
  knownConfigFailures.delete(token);

  console.log(`[Cache] Refresh for ...${token.slice(-8)} (${lang}) providers=${active.join(',')}`);
  try {
    // Always fetch FRESH for the background rebuild (it must detect library
    // changes) but seed the Redis downloads cache so the discovery stream path
    // can answer the owned-bridge without re-hitting TorBox.
    const downloads = await refreshDownloadsForUser(config, userKey);
    // Artwork is part of the generated catalogue response. Rebuild when the
    // user changes poster/rating providers even if their downloads did not,
    // otherwise a warm franchise cache can keep serving the old artwork until
    // the library itself changes.
    const newHash   = `${LIBRARY_PROJECTION_VERSION}:${hashDownloads(downloads)}:${posterFp(config)}:${libraryIdMode || 'torbox'}`;
    // Cache comparison must be projection-scoped. Two tokens can share a
    // provider library but choose different language/artwork/sort settings;
    // a single shared hash made them continually invalidate each other's rows.
    const projectionFp = hashShort(JSON.stringify({
      sortBy, lang, rdCatalog, poster: posterFp(config), libraryIdMode: libraryIdMode || 'torbox', hideAnime: !!hideAnime,
      torboxSources: providers.torboxSourcesKey(config),
    }));
    const hashKey   = cache.makeKey('dlhash', 'v2', userKey, projectionFp);
    const oldHash   = await cache.get(hashKey);

    if (oldHash === newHash) {
      console.log(`[Cache] Downloads unchanged, skip rebuild`);
      // A restart wipes the in-memory franchise projection while the Redis
      // hash survives, so "unchanged" would otherwise leave LeLibrary
      // Collections empty until the next library change. The fresh downloads
      // are already in hand here: rebuild just the collections once so the
      // projection recovers on its own. Catalog rows stay cached.
      if (getCollections(userKey, lang).length === 0) {
        try {
          const collMetas = await buildCollectionsCatalog(downloads, tmdbApiKey, lang, posterEnhance(config));
          cacheCollections(userKey, lang, collMetas);
          const collKey = cache.makeKey('cat', 'collections', 'collections', sortBy, '', '0', userKey, lang, posterFp(config));
          await cache.set(collKey, { metas: collMetas }, TTL_CATALOG);
          console.log(`[Cache] collections recovered after restart → ${collMetas.length} items`);
        } catch (err) {
          console.warn('[Cache] collections recovery failed:', err.message);
        }
      }
      // Keep long-TTL catalog cache warm so it doesn't expire and force a slow
      // rebuild, but do not SCAN the user's whole keyspace every 2 minutes: a
      // per-user marker limits the touch to at most once every 20 minutes.
      const touchMarkerKey = cache.makeKey('cattouch', userKey);
      const recentlyTouched = await cache.exists(touchMarkerKey).catch(() => false);
      if (!recentlyTouched) {
        await cache.touchPattern(`cat:*${userKey}*`, TTL_CATALOG);
        await cache.set(touchMarkerKey, 1, 20 * 60).catch(() => {});
      }
      await cache.expire(hashKey, 7200);
      return;
    }

    // Resilience: if the provider suddenly returns nothing but we previously had
    // content, don't wipe the cached catalogs. A transient provider blip (or a
    // silently-failing key) shouldn't blank someone's library for hours.
    if (downloads.length === 0 && oldHash) {
      console.log('[Cache] Downloads empty but we had content: keeping existing catalog');
      const touchMarkerKey = cache.makeKey('cattouch', userKey);
      const recentlyTouched = await cache.exists(touchMarkerKey).catch(() => false);
      if (!recentlyTouched) {
        await cache.touchPattern(`cat:*${userKey}*`, TTL_CATALOG);
        await cache.set(touchMarkerKey, 1, 20 * 60).catch(() => {});
      }
      await cache.expire(hashKey, 7200);
      return;
    }

    const sources = rdCatalog === 'separate'
      ? active.map(id => ({ key: providers.PROVIDER_META[id].cat, downloads: providers.downloadsFor(downloads, id) }))
      : [{ key: 'merged', downloads }];

    // Build every first page in memory before replacing anything. If a TMDB
    // or provider-dependent build fails, the previous complete projection is
    // left untouched. This work uses the one shared provider snapshot fetched
    // above; invalidating rendered pages never causes another TorBox request.
    const catalogPages = await Promise.all(sources.flatMap(({ key, downloads: dl }) =>
      TYPES.map(async type => {
        const metas    = await buildCatalog(dl, tmdbApiKey, type, sortBy, { skip: 0, search: '' }, lang, posterEnhance(config), { userKey, hideAnime, libraryIdMode, config, deferCacheInvalidation: true });
        const cacheKey = cache.makeKey('cat', key, type, sortBy, '', '0', userKey, lang, posterFp(config), libraryIdMode);
        console.log(`[Cache] ${key}:${type} → ${metas.length} items`);
        return { key: cacheKey, value: { metas }, ttl: TTL_CATALOG };
      })
    ));

    // Collections catalog: merged across all providers, additive.
    const collMetas = await buildCollectionsCatalog(downloads, tmdbApiKey, lang, posterEnhance(config));
    const collKey = cache.makeKey('cat', 'collections', 'collections', sortBy, '', '0', userKey, lang, posterFp(config));
    console.log(`[Cache] collections → ${collMetas.length} items`);

    // Pre-warm Trending / Popular so their first on-screen load is instant
    // (each row needs per-title IMDb lookups, which is slow on a cold build).
    // Uses buildDiscoveryCatalog so the cached rows carry this user's poster
    // providers and are keyed by the poster fingerprint.
    const { buildDiscoveryCatalog } = require('../catalog/discovery.ts');
    const discEnhance = posterEnhance(config);
    const discFp = posterFp(config);
    if (config.catalogTrending) {
      await Promise.allSettled([
        buildDiscoveryCatalog({ tmdbApiKey, kind: 'trending', apiType: 'movie', lang, userKey, enhance: discEnhance, posterFp: discFp }),
        buildDiscoveryCatalog({ tmdbApiKey, kind: 'trending', apiType: 'tv', lang, userKey, enhance: discEnhance, posterFp: discFp }),
      ]);
      console.log('[Cache] trending pre-warmed');
    }
    if (config.catalogPopular) {
      await Promise.allSettled([
        buildDiscoveryCatalog({ tmdbApiKey, kind: 'popular', apiType: 'movie', lang, userKey, enhance: discEnhance, posterFp: discFp }),
        buildDiscoveryCatalog({ tmdbApiKey, kind: 'popular', apiType: 'tv', lang, userKey, enhance: discEnhance, posterFp: discFp }),
      ]);
      console.log('[Cache] popular pre-warmed');
    }

    // A library reorder/removal can change every 50-item page even when all
    // titles were matched previously. Remove all of this user's old rendered
    // pages only now that the replacement first pages are ready, then restore
    // those first pages immediately. Later pages refill on demand from the
    // already-cached provider snapshot. No additional provider call is made.
    await cache.replacePattern(`cat:*${userKey}*`, [
      ...catalogPages,
      { key: collKey, value: { metas: collMetas }, ttl: TTL_CATALOG },
    ], TTL_CATALOG);
    cacheCollections(userKey, lang, collMetas);

    // Only update hash and invalidate caches after ALL catalogs built successfully
    await cache.set(hashKey, newHash, 7200);
    // Scope invalidation to THIS user's caches. Meta and stream keys embed the
    // user key hash, so a bare 'meta:*' / 'stream:*' wipe would evict every
    // other user's cached metas and streams on every library change.
    await cache.delPattern(`meta:*${userKey}*`);
    await cache.delPattern(`stream:*${userKey}*`);
    console.log('[Cache] Meta + stream caches invalidated after catalog rebuild');
  } catch (err) {
    console.error('[Cache] Error:', err.message);
  }
}

// A cold manifest, collection push and catalog request can arrive together.
// Coalesce the expensive provider/TMDB scan so an owned-only collection push
// waits for the same finished projection instead of racing a duplicate build.
function buildAndCacheForConfig(token, config) {
  const pending = catalogBuildInFlight.get(token);
  if (pending) return pending;
  const work = buildAndCacheForConfigInner(token, config)
    .finally(() => catalogBuildInFlight.delete(token));
  catalogBuildInFlight.set(token, work);
  return work;
}

// Wait at most `budgetMs` for a long-running build to settle, and never reject:
// the caller publishes whatever is ready while the build carries on in the
// background. Returns true when the work settled inside the budget (including a
// build that failed: it settled, the cache just gains nothing).
function settleWithin(work, budgetMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), budgetMs);
    // Never hold the process (or a test) open for the budget.
    if (typeof timer.unref === 'function') timer.unref();
    Promise.resolve(work).then(() => finish(true), () => finish(true));
  });
}

// Poll a cheap readiness check until it holds or the budget runs out. Used by
// request paths that need something a background worker produces (the owned
// collections projection) and must not wait for it indefinitely.
async function waitFor(predicate, budgetMs, stepMs = 500) {
  const deadline = Date.now() + Math.max(0, budgetMs);
  for (;;) {
    let ready = false;
    try { ready = !!predicate(); } catch { ready = false; }
    if (ready) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, stepMs);
      if (typeof timer.unref === 'function') timer.unref();
    });
  }
}

// Keep the refresh cadence genuinely close to REFRESH even when the server has
// seen many tokens. The previous sequential loop slept for two seconds after
// every token, so a busy hosted instance could take many minutes to reach an
// account Collection Wizard token. Downloads are already deduplicated by the
// provider-key snapshot above; bounded concurrency therefore preserves the
// anti-429 behaviour while letting My Movies/My Shows folder caches refresh.
let backgroundRefreshRunning = false;
const BACKGROUND_REFRESH_CONCURRENCY = 4;
setInterval(async () => {
  if (backgroundRefreshRunning) return;
  if (libraryEngine.isIndexed()) return; // index worker owns background work
  backgroundRefreshRunning = true;
  try {
    const entries = [...knownConfigs.entries()];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(BACKGROUND_REFRESH_CONCURRENCY, entries.length) }, async () => {
      while (cursor < entries.length) {
        const [token, config] = entries[cursor++];
        await buildAndCacheForConfig(token, config).catch(() => {});
      }
    });
    await Promise.all(workers);
  } finally {
    backgroundRefreshRunning = false;
  }
}, REFRESH).unref?.();

// Delay until startup/migrations have settled. This restores only opaque
// account ids, resolves their configs server-side, and resumes the same loop
// as an active normal Configure install without ever persisting credentials.
setTimeout(() => {
  restoreAccountRefreshRegistry().catch((err) => console.warn('[Cache] Account refresh restore failed:', err.message));
}, 5000).unref?.();

export interface RefreshApi {
  TTL_CATALOG: any;
  TTL_STREAM: any;
  OWNED_CATALOG_CLIENT_TTL: any;
  knownConfigs: any;
  KNOWN_CONFIGS_MAX: any;
  knownConfigFailures: any;
  catalogBuildInFlight: any;
  providerRefreshSnapshots: any;
  providerRefreshInFlight: any;
  rememberConfig: any;
  registerBackgroundRefresh: any;
  restoreAccountRefreshRegistry: any;
  refreshDownloadsForUser: any;
  hashDownloads: any;
  buildAndCacheForConfigInner: any;
  buildAndCacheForConfig: any;
  settleWithin: any;
  waitFor: any;
  LIBRARY_PROJECTION_VERSION: any;
}

module.exports = {
  TTL_CATALOG,
  TTL_STREAM,
  OWNED_CATALOG_CLIENT_TTL,
  knownConfigs,
  KNOWN_CONFIGS_MAX,
  knownConfigFailures,
  catalogBuildInFlight,
  providerRefreshSnapshots,
  providerRefreshInFlight,
  rememberConfig,
  registerBackgroundRefresh,
  restoreAccountRefreshRegistry,
  refreshDownloadsForUser,
  hashDownloads,
  buildAndCacheForConfigInner,
  buildAndCacheForConfig,
  settleWithin,
  waitFor,
  LIBRARY_PROJECTION_VERSION,
} satisfies RefreshApi;
