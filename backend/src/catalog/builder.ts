// @ts-nocheck
const fs   = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { getTorBoxDownloads, getTorBoxStreamLink, getTorBoxFiles, isVideoFile, isJunkVideo } = require('../providers/torbox.ts');
const { getRealDebridDownloads, getRealDebridFiles, getRealDebridStreamLink } = require('../providers/realdebrid.ts');
const providers = require('../providers/index.ts');
const cache = require('../runtime/cache.ts');
const { searchMetadata, searchCandidates, getMetadata, findEpisodeByAirDate, getSeasonEpisodeCounts, getImdbId, getImdbIds, getMovieReleaseInfo, titleScore, pickBestResult } = require('../media/tmdb.ts');
const { guessMediaInfo } = require('../media/parser.ts');
const { resolveMatch } = require('../matching/resolve.ts');
const { matchCustomStreams, customStreamsFingerprint } = require('../media/custom-streams.ts');
const NodeCache = require('node-cache');
// AIOStreams-compatible stream formatter engine (works in Node + browser).
const formatter = require('../streams/formatter.ts');

const CACHE_FILE = '/tmp/torbox-tmdb-cache.json';

function hashShort(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Name→TMDB match cache. The match itself is global (the same release name
// resolves to the same title whoever owns it), so it is shared across users
// with a fast in-memory copy backed by Redis. The old cache was in-memory only
// with a 5-minute TTL and a disk file under /tmp (wiped on every deploy): a
// cold cache made the stream rebuild path fall into the slow full-library TMDB
// search (10-15s: enough for STRMR to time out and show "no sources"), and
// made the discovery owned-bridge silently miss owned copies. Redis backing
// with a long TTL keeps matches across deploys and idle periods so the rebuild
// path answers from cache in milliseconds.
const MATCH_CACHE_TTL = 24 * 60 * 60; // 24h
const NULL_MATCH_TTL  = 5 * 60;        // 5 min: null (failed) matches retry quickly
const MATCH_REDIS_PREFIX = 'matchcache:';
const memMatchCache = new NodeCache({ stdTTL: MATCH_CACHE_TTL, checkperiod: 60 });
// Coalesce duplicate player requests and briefly remember a proven miss. This
// keeps one user's very large library from triggering a full re-scan for every
// Nuvio retry while an upstream provider is slow.
const streamBuildInFlight = new Map();
const streamMissCache = new NodeCache({ stdTTL: 45, checkperiod: 15 });
const MAX_OWNED_LINKS_PER_REQUEST = 8;
const MAX_OWNED_FILES_PER_ITEM = 3;

function matchCacheKey(type, lang, name, parsed = undefined) {
  const info = parsed === undefined ? guessMediaInfo(name) : parsed;
  const range = info?.seasonStart != null && info?.seasonEnd != null
    ? `:sr${info.seasonStart}-${info.seasonEnd}` : '';
  // Anime matches made before the absolute-episode count-context guard could
  // file plain series (e.g. multi-voiceover season packs) under the anime
  // bucket. The versioned namespace retires those poisoned entries; the old
  // keys expire untouched. Series/movie keys are unaffected (no cold rebuild).
  const namespacedType = type === 'anime' ? 'anime2' : type;
  return `match:${namespacedType}:${lang}:${name}${range}`;
}

// Strip per-user torrent items before anything is stored: the match result is
// shared across users, so no one user's download record should persist (it was
// never served back, but it bloated the cache and could leak an account's id
// into another user's Redis space). Every reader re-attaches the caller's own
// item, so dropping it here is safe.
function stripTorboxItem(value) {
  if (value && typeof value === 'object' && value.torboxItem) {
    const copy = { ...value };
    delete copy.torboxItem;
    return copy;
  }
  return value;
}

// Match writes are coalesced: a cold rebuild produces hundreds of fresh
// matches, and one SETEX per match was a per-item Redis round trip. Writes are
// mirrored to the in-memory cache immediately and flushed to Redis in one
// pipeline shortly after, so readers never wait on the network.
const pendingMatchWrites = new Map();
let matchWriteTimer = null;
let matchCacheDirty = false;
function flushMatchWrites() {
  matchWriteTimer = null;
  if (!pendingMatchWrites.size) return;
  const entries = [];
  for (const [key, { value, ttl }] of pendingMatchWrites) {
    entries.push({ key: MATCH_REDIS_PREFIX + key, value, ttl });
  }
  pendingMatchWrites.clear();
  const run = typeof cache.mset === 'function'
    ? cache.mset(entries)
    : Promise.all(entries.map((entry) => cache.set(entry.key, entry.value, entry.ttl)));
  return Promise.resolve(run).catch(() => {});
}
// Force any debounced match writes out to Redis. Called on shutdown so a
// redeploy does not drop matches that were queued moments before SIGTERM.
async function flushMatchCache() {
  if (matchWriteTimer) { clearTimeout(matchWriteTimer); matchWriteTimer = null; }
  await flushMatchWrites();
  await savePersistentCache().catch(() => {});
}

function queueMatchWrite(key, value, ttl) {
  pendingMatchWrites.set(key, { value, ttl });
  if (!matchWriteTimer) {
    matchWriteTimer = setTimeout(flushMatchWrites, 75);
    matchWriteTimer.unref?.();
  }
}

const matchCache = {
  async get(key) {
    const mem = memMatchCache.get(key);
    if (mem !== undefined) return mem;
    try {
      const redisKey = MATCH_REDIS_PREFIX + key;
      const hits = await cache.mget([redisKey]);
      if (hits.has(redisKey)) {
        const val = hits.get(redisKey);
        memMatchCache.set(key, val, MATCH_CACHE_TTL);
        return val;
      }
    } catch (err) { /* Redis blip: treat as miss */ }
    return undefined;
  },
  async getMany(keys) {
    const result = new Map();
    const missing = [];
    for (const key of keys) {
      const value = memMatchCache.get(key);
      if (value !== undefined) result.set(key, value);
      else missing.push(key);
    }
    if (!missing.length) return result;
    try {
      const redisKeys = missing.map(key => MATCH_REDIS_PREFIX + key);
      const hits = await cache.mget(redisKeys);
      missing.forEach((key, index) => {
        const redisKey = redisKeys[index];
        if (!hits.has(redisKey)) return;
        const value = hits.get(redisKey);
        memMatchCache.set(key, value, MATCH_CACHE_TTL);
        result.set(key, value);
      });
    } catch (err) { /* Redis blip: leave these as misses */ }
    return result;
  },
  async set(key, value, ttl = MATCH_CACHE_TTL) {
    const toStore = stripTorboxItem(value);
    memMatchCache.set(key, toStore, ttl);
    matchCacheDirty = true;
    queueMatchWrite(key, toStore, ttl);
    return true;
  },
  async has(key) {
    if (memMatchCache.has(key)) return true;
    try {
      return await cache.exists(MATCH_REDIS_PREFIX + key);
    } catch (err) {
      return false;
    }
  },
  // Synchronous view of the in-memory copy: only used by the disk
  // persistence below, which must not block its interval on Redis.
  keys() {
    return memMatchCache.keys();
  },
};

// Phase-2 seam for the single matching core: publish a background-resolved
// meta under the exact key request paths read, with the same write
// discipline (torboxItem stripped, failures cached briefly like NULLs).
// Request paths keep calling matchItem until Phase 3 rewires them.
function publishMatchEntry(type, lang, name, meta) {
  try {
    const key = matchCacheKey(type, lang, name);
    const value = meta ? stripTorboxItem(meta) : null;
    queueMatchWrite(key, value, meta ? MATCH_CACHE_TTL : NULL_MATCH_TTL);
  } catch { /* cache is best-effort */ }
  return null;
}

// Single source of truth for split-show data lives in matching/tables.ts.
// These names stay for the remaining table consumers (pack path, cold paths,
// stale-cache healing) and existing tests; the decision logic itself moved
// into the core resolver.
const { lookupSplitSeason, splitSeasons } = require('../matching/tables.ts');
const SPLIT_SHOW_SEASON_REMAP = splitSeasons();

// Forward remap: a (matchedShowId, filenameSeason) that really belongs to a
// split-off entry returns { tmdbId, season }, otherwise null. Pure function.
function remapSplitSeason(matchedId, season) {
  return lookupSplitSeason(matchedId, season);
}

// Canonical meta source for a core decision. The raw winning candidate is only
// correct when the core kept its id: split-season remaps (Kitchen Nightmares
// US S10 → revival entry 235884 S03) change the ENTRY, so building the meta
// from the pre-split candidate bakes the wrong tmdbId/title/artwork into the
// stored match while the season looks right - episodes then filter against an
// entry that never had them. Resolve the target's own object instead. Never
// throws: falls back to an id-overridden copy of the candidate.
async function canonicalSource(tmdbApiKey, resolved, lang) {
  const base = resolved.candidate || { id: resolved.tmdbId, title: resolved.title };
  if (!resolved.candidate || Number(resolved.candidate.id) === Number(resolved.tmdbId)) return base;
  try {
    return await resolveSplitTarget(tmdbApiKey, resolved.title, { tmdbId: resolved.tmdbId, season: resolved.season }, lang, resolved.candidate);
  } catch { return { ...resolved.candidate, id: resolved.tmdbId }; }
}

// Resolve the split target's own search-result object so catalog rows carry
// the right title/poster. Falls back to an id-overridden copy of the source
// result when the target isn't among the candidates (never throws).
async function resolveSplitTarget(tmdbApiKey, title, target, lang, fallbackResult) {
  try {
    const cands = await searchCandidates(tmdbApiKey, title, 'tv', undefined, lang || 'en-US');
    const hit = (cands || []).find(c => String(c.id) === String(target.tmdbId));
    if (hit) return hit;
  } catch {}
  return { ...(fallbackResult || {}), id: target.tmdbId };
}

// Bare-name series packs ("Kitchen.Nightmares": a 30GB torrent whose FILES
// are S01E01...) carry no season info in the outer name, so name matching
// rejects them and the whole pack stays invisible. The fallback below
// matches from the inner episode filenames instead: one provider file
// listing per new pack, then cached like any other match.
const PACK_NULL_TTL = 24 * 60 * 60; // file lists are immutable: no episodes inside stays negative
const PACK_OUTER_SCORE = 75; // outer title must strongly match before spending a file listing
const PACK_INNER_SCORE = 65; // inner-title match must be plausible, never a stretch
const packEpisodeProbeCache = new NodeCache({ stdTTL: PACK_NULL_TTL, checkperiod: 600, useClones: true });
const packEpisodeProbeInFlight = new Map();

// Pure aggregation over inner file names: null when nothing usable, else
// { title, year, season, episode, isAnime }. One distinct episode resolves
// exactly; one season resolves as a season pack (episode null); several
// seasons resolve as the whole show (season null → 'all').
// Pack file lists and torrent folder names frequently carry the season range or
// a "Complete"/"BoxSet" marker in the title portion ("The Sopranos S01-S06",
// "Gilmore Girls Complete S01-s07"). TMDB search then fails on the polluted
// title and the whole show silently drops out of the library, so strip those
// trailing markers before the title is used for matching.
function cleanPackTitle(title) {
  if (!title) return title;
  let out = String(title).trim();
  let prev;
  do {
    prev = out;
    out = out
      .replace(/[\s._-]+S\d{1,3}(?:[\s._-]*-[\s._-]*S?\d{1,3})?$/i, '')
      .replace(/[\s._-]+Season[\s._-]*\d{1,3}(?:[\s._-]*(?:-|to)[\s._-]*\d{1,3})?$/i, '')
      .replace(/[\s._-]+Complete$/i, '')
      .replace(/[\s._-]+Box[\s._-]*Set$/i, '')
      .trim();
  } while (out !== prev);
  return out || title;
}

function videoBaseName(value) {
  const parts = String(value || '').split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(value || '');
}

function summarizePackEpisodes(fileNames) {
  const counts = new Map();
  let best = null;
  for (const raw of fileNames || []) {
    if (typeof raw !== 'string' || !raw) continue;
    if (!isVideoFile(raw) || isJunkVideo(raw)) continue;
    // Debrid file names can include archive folders ("Season 08/Show S08E01.mkv").
    // The folder is organization metadata, not part of the title to search.
    const info = guessMediaInfo(videoBaseName(raw));
    if (!info || !info.isSeries || info.episode == null) continue;
    const cleanTitle = cleanPackTitle(info.title);
    const key = `${cleanTitle}|${info.year || ''}`;
    const entry = counts.get(key) || { title: cleanTitle, year: info.year ?? null, n: 0, pairs: new Set(), seasons: new Set(), isAnime: false };
    entry.n += 1;
    entry.isAnime ||= info.isAnime;
    entry.pairs.add(`${info.season ?? ''}:${info.episode}`);
    if (info.season != null) entry.seasons.add(info.season);
    counts.set(key, entry);
    if (!best || entry.n > best.n) best = entry;
  }
  if (!best || best.pairs.size === 0) return null;
  let season = null;
  let episode = null;
  if (best.pairs.size === 1) {
    const [s, e] = [...best.pairs][0].split(':');
    season = s === '' ? null : parseInt(s, 10);
    episode = parseInt(e, 10);
  } else if (best.seasons.size === 1) {
    season = [...best.seasons][0];
  }
  const orderedSeasons = [...best.seasons].sort((a, b) => a - b);
  return {
    title: best.title,
    year: best.year,
    season,
    seasonStart: orderedSeasons.length > 1 ? orderedSeasons[0] : null,
    seasonEnd: orderedSeasons.length > 1 ? orderedSeasons[orderedSeasons.length - 1] : null,
    episode,
    isAnime: best.isAnime,
  };
}

const SUSPICIOUS_PACK_MIN_BYTES = 40 * 1024 * 1024 * 1024;

// What a file inside a download says about its episode. TorBox names files
// with their folder in front ("Show.S02.2160p/Show.S02E01.2160p.mkv"), and the
// parser reads the folder's "S02" first and never sees "E01": every season
// pack then matched no episode. Read the file's own name first, and the full
// path only when that has no episode in it.
function episodeFileInfo(file) {
  const full = String(file?.name || file?.short_name || '');
  const own = String(file?.short_name || '').trim() || full.split(/[\\/]+/).filter(Boolean).pop() || full;
  const byName = own ? guessMediaInfo(own) : null;
  if (byName && byName.episode != null) return byName;
  return (full && full !== own ? guessMediaInfo(full) : null) || byName;
}

function embeddedItemFiles(item) {
  for (const key of ['files', 'file_list', 'innerFiles']) {
    const value = item?.[key];
    if (Array.isArray(value) && value.length) return value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const files = Object.values(value);
      if (files.length) return files;
    }
  }
  return [];
}

function shouldProbeEpisodeNamedPack(item, info) {
  if (!info?.isSeries || info.episode == null) return false;
  const embedded = embeddedItemFiles(item);
  const videoCount = embedded.filter(file => isVideoFile(file?.name || file?.short_name || '')).length;
  if (videoCount > 1) return true;
  const declaredCount = Number(item?.file_count ?? item?.fileCount ?? item?.files_count ?? item?.filesCount ?? 0);
  if (declaredCount > 1) return true;
  if (/box[ ._-]*set|complete|\bpack\b|➡/i.test(item?.name || item?.filename || '')) return true;
  return Number(item?.size || 0) >= SUSPICIOUS_PACK_MIN_BYTES;
}

function packAvailabilityDiffers(meta, info) {
  return (meta?.season ?? null) !== (info?.season ?? null)
    || (meta?.seasonStart ?? null) !== (info?.seasonStart ?? null)
    || (meta?.seasonEnd ?? null) !== (info?.seasonEnd ?? null)
    || (meta?.episode ?? null) !== (info?.episode ?? null)
    || (meta?.episodeEnd ?? null) !== (info?.episodeEnd ?? null);
}

// A bare torrent title can weak-match a movie even though its inner files are
// episodes (for example American Dad -> an unrelated similarly named film).
// Share and cache this bounded file inspection across the movie/series/anime
// builders so the guard never multiplies provider requests.
async function probePackEpisodes(item, config) {
  const embedded = embeddedItemFiles(item);
  const identity = [
    item?.source || '', item?.hash || `${providers.getUserKey(config)}:${item?.id || ''}`,
    item?.updated_at || item?.last_state_change || '', item?.file_count || item?.fileCount || embedded.length,
  ].join('|');
  const identityHash = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
  const durableKey = cache.makeKey('packprobe', 'v2', identityHash);
  if (packEpisodeProbeCache.has(identity)) return packEpisodeProbeCache.get(identity);
  if (packEpisodeProbeInFlight.has(identity)) return packEpisodeProbeInFlight.get(identity);
  const work = (async () => {
    try {
      const durable = await cache.get(durableKey);
      if (durable && typeof durable === 'object') {
        packEpisodeProbeCache.set(identity, durable, PACK_NULL_TTL);
        return durable;
      }
    } catch {}
    let files = embedded;
    if (!files.length) {
      try { files = await providers.getFiles(config, item); } catch { files = []; }
    }
    const result = {
      hadFiles: Array.isArray(files) && files.length > 0,
      summary: summarizePackEpisodes((files || []).map(file => file?.name || file?.short_name || '')),
    };
    packEpisodeProbeCache.set(identity, result, result.hadFiles ? PACK_NULL_TTL : NULL_MATCH_TTL);
    try { await cache.set(durableKey, result, result.hadFiles ? PACK_NULL_TTL : NULL_MATCH_TTL); } catch {}
    return result;
  })().finally(() => packEpisodeProbeInFlight.delete(identity));
  packEpisodeProbeInFlight.set(identity, work);
  return work;
}

async function isEpisodePackMisreadAsMovie(item, config, info, result) {
  if (!config || !info || info.isSeries || !result) return false;
  // Embedded files are free to inspect, and a truncated outer name like "Law"
  // can still be an exact title match for an obscure film while the files
  // inside are clearly a series pack. Check them before the exact-title
  // shortcut so such packs are rejected as movies and re-matched as series.
  const embedded = embeddedItemFiles(item)
    .map(file => file?.name || file?.short_name || '')
    .filter(name => isVideoFile(name) && !isJunkVideo(name));
  if (embedded.length >= 2 && summarizePackEpisodes(embedded)) return true;
  if (titleScore(info.title, result) >= 100) return false;
  const probe = await probePackEpisodes(item, config);
  return !!probe.summary;
}

// Shared match-result row (name path and pack path converge here).
function buildMatchMeta(result, type, item, season, episode, episodeEnd, seasonStart = null, seasonEnd = null) {
  const stremioType = type === 'anime' ? 'series' : type;
  return {
    id:                   `torbox:${stremioType}:${result.id}`,
    type:                 stremioType,
    name:                 result.title || result.name,
    poster:               result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : null,
    releaseInfo:          (result.release_date || result.first_air_date || '').split('-')[0],
    released:             result.release_date || result.first_air_date,
    tmdbId:               result.id,
    catalogType:          type,
    isJapaneseAnimation:  isTmdbAnime(result),
    torboxItem:           item,
    season,
    seasonStart,
    seasonEnd,
    episode,
    episodeEnd:           episodeEnd ?? null,
  };
}

// Bare-name pack fallback: resolve the SHOW from inner episode filenames.
// Owns its caching (success 24h, definitive negative 24h, listing failure
// 5min): callers must not re-cache on its behalf. Returns a complete match
// meta or null. Never throws.
async function tryMatchPackFiles(item, config, type, tmdbApiKey, lang, outerInfo, name, cacheKey) {
  const outerTitle = outerInfo?.title || null;
  const opaqueOuterTitle = /^[a-f0-9]{32,}$/i.test(String(outerTitle || '').trim());
  const inspectable = embeddedItemFiles(item)
    .map(file => file?.name || file?.short_name || '')
    .filter(n => isVideoFile(n) && !isJunkVideo(n)).length >= 1;
  // Gate on the outer title first (TMDB search is cache-backed): obvious
  // non-series items must not each cost a provider file listing. That listing
  // is free when the item already carries its files, so a truncated outer name
  // such as a torrent called "Law" still reaches the inner episode probe.
  if (outerTitle && !opaqueOuterTitle && !inspectable) {
    let pre = null;
    try {
      pre = await searchMetadata(tmdbApiKey, outerTitle, 'series', outerInfo?.year, lang);
    } catch { pre = null; }
    if (!pre || titleScore(outerTitle, pre) < PACK_OUTER_SCORE) {
      await matchCache.set(cacheKey, null, NULL_MATCH_TTL);
      return null;
    }
  }
  const probe = await probePackEpisodes(item, config);
  if (!probe.hadFiles) {
    await matchCache.set(cacheKey, null, NULL_MATCH_TTL);
    return null;
  }
  const summary = probe.summary;
  if (!summary) {
    await matchCache.set(cacheKey, null, PACK_NULL_TTL);
    return null;
  }
  const title = summary.title || outerTitle;
  if (!title) {
    await matchCache.set(cacheKey, null, PACK_NULL_TTL);
    return null;
  }
  let result = null;
  try {
    result = await searchMetadata(tmdbApiKey, title, 'series', summary.year ?? outerInfo?.year, lang);
  } catch { result = null; }
  if (!result || titleScore(title, result) < PACK_INNER_SCORE) {
    await matchCache.set(cacheKey, null, PACK_NULL_TTL);
    return null;
  }
  let season = summary.season;
  const episode = summary.episode;
  // Split-show seasons inside packs remap exactly like file-level matches.
  const split = remapSplitSeason(result.id, season);
  if (split) {
    result = await resolveSplitTarget(tmdbApiKey, title, split, lang, result);
    season = split.season;
  }
  const isAnime = isTmdbAnime(result);
  if (type === 'series' && (isAnime || summary.isAnime)) {
    await matchCache.set(cacheKey, null, PACK_NULL_TTL);
    return null;
  }
  if (type === 'anime' && !isAnime && !summary.isAnime) {
    await matchCache.set(cacheKey, null, PACK_NULL_TTL);
    return null;
  }
  console.log(`[TMDB] indexed pack matched via embedded video filenames`);
  const meta = buildMatchMeta(result, type, item, season, episode, null, summary.seasonStart, summary.seasonEnd);
  await matchCache.set(cacheKey, meta);
  return meta;
}

// Read off the event loop: the disk mirror can be multi-MB, and a synchronous
// read at startup delayed the server accepting connections. Redis is the
// authoritative copy, so loading this in the background is safe.
async function loadPersistentCache() {
  try {
    const data = JSON.parse(await fs.promises.readFile(CACHE_FILE, 'utf8'));
    let n = 0;
    for (const [k, v] of Object.entries(data)) {
      // Skip negative (null) entries: a null saved moments before its TTL
      // would otherwise resurrect as a long-lived "unmatchable" shadow.
      if (v === null || v === undefined) continue;
      // Short TTL for disk-loaded values: the disk file can be staler than
      // Redis (docker restart keeps /tmp), and without an expiry a stale
      // disk value used to beat the fresher Redis match for up to 24h.
      memMatchCache.set(k, stripTorboxItem(v), 6 * 60 * 60);
      n++;
    }
    console.log(`[Cache] Loaded ${n} entries from disk`);
  } catch (e) {
    if (e && e.code !== 'ENOENT') console.error('[Cache] Load error:', e.message);
  }
}

let persistentSaveRunning = false;
async function savePersistentCache() {
  if (!matchCacheDirty || persistentSaveRunning) return;
  persistentSaveRunning = true;
  matchCacheDirty = false;
  try {
    const data = {};
    for (const k of memMatchCache.keys()) {
      const v = memMatchCache.get(k);
      if (v !== undefined) data[k] = v;
    }
    // Write to a sibling temp file then rename so a concurrent reader never
    // sees a half-written cache, and never block the event loop with
    // writeFileSync on a large cache.
    const tmp = `${CACHE_FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(data));
    await fs.promises.rename(tmp, CACHE_FILE);
  } catch (e) {
    console.error('[Cache] Save error:', e.message);
  } finally {
    persistentSaveRunning = false;
  }
}

loadPersistentCache();
setInterval(savePersistentCache, 60_000).unref?.();

const omdbCache    = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
// Per-user index: `${userKey}:series:12345` → [{item, season, episode}].
// Keyed by user so one user's downloads never leak into another user's
// seasons/episodes/streams.
const tmdbindex = new Map();
// Keyed `${userKey}:${type}:${tmdbId}`. Bounded so a long-running server with
// many users cannot accumulate an owned-episode index forever; evicting one
// just re-matches that title (cheap: 24h match cache) on the next request.
const TMDB_INDEX_MAX_KEYS = Math.max(1000, parseInt(process.env.TMDB_INDEX_MAX, 10) || 20000);
function setTmdbIndex(key, entries) {
  tmdbindex.set(key, entries);
  while (tmdbindex.size > TMDB_INDEX_MAX_KEYS) {
    const oldest = tmdbindex.keys().next().value;
    if (oldest === undefined) break;
    tmdbindex.delete(oldest);
  }
}

// Limit concurrent TMDB API calls to avoid rate-limiting
async function pLimit(tasks, limit) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try { results[idx] = await tasks[idx](); }
      catch (err) { results[idx] = { error: err }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function populateTmdbIndexFromMetas(metas, userKey = '') {
  if (!Array.isArray(metas)) return;
  for (const meta of metas) {
    if (!meta?.torboxItem || !meta.tmdbId) continue;
    const indexKey = `${userKey}:${meta.type || 'movie'}:${meta.tmdbId}`;
    const entry = {
      item: meta.torboxItem,
      season: meta.season,
      seasonStart: meta.seasonStart ?? null,
      seasonEnd: meta.seasonEnd ?? null,
      episode: meta.episode,
      episodeEnd: meta.episodeEnd ?? null,
      episodeTitle: meta.episodeTitle ?? null,
      airDate: meta.airDate ?? null,
      airDates: Array.isArray(meta.airDates) ? meta.airDates : null,
    };
    if (!tmdbindex.has(indexKey)) {
      setTmdbIndex(indexKey, [entry]);
    } else {
      const existing = tmdbindex.get(indexKey);
      const already = existing.some(e => e.item.id === entry.item.id && e.item.source === entry.item.source);
      if (!already) existing.push(entry);
    }
  }
}

function buildErdbUrl(token, type, id) {
  if (!token || !type || !id) return null;
  return `https://easyratingsdb.com/${encodeURIComponent(token)}/${encodeURIComponent(type)}/${encodeURIComponent(id)}.jpg`;
}

// ERDB posters are composed on demand by an external service and can take
// 6-14s. When we know the request token and our own origin, route them through
// LeLibrary's cache instead (same idea as Pictorium): instant after the first
// render, and the client falls back to the TMDB poster while it warms.
function erdbProxyUrl(enhance, type, id, fallback) {
  const token = enhance && enhance.erdbToken;
  if (!token || !type || !id) return null;
  const pic = (enhance && enhance.pictorium) || {};
  const reqToken = pic.token;
  const origin = String(pic.origin || process.env.BASE_URL || '').replace(/\/+$/, '');
  if (reqToken && origin) {
    const q = fallback ? `?fallback=${encodeURIComponent(fallback)}` : '';
    return `${origin}/${encodeURIComponent(reqToken)}/erdb/${type}/${encodeURIComponent(id)}${q}`;
  }
  return buildErdbUrl(token, type, id);
}

function buildRpdbUrl(key, idType, posterType, mediaId) {
  if (!key || !mediaId) return null;
  return `https://api.ratingposterdb.com/${encodeURIComponent(key)}/${encodeURIComponent(idType)}/${encodeURIComponent(posterType)}/${encodeURIComponent(mediaId)}.jpg?fallback=true`;
}

// BetterPoster (btttr.cc) serves poster artwork keyed by the title's IMDb id,
// matching the format the BetterPosters addon uses (movie|tv/{imdb}/auto~gr).
// The id is a byproduct of TMDB's external_ids that getMetadata already
// fetches: it is never used for matching. Poster-only: no backdrops or logos.
function buildBetterPosterUrl(imdbId, type) {
  if (!imdbId) return null;
  const t = (type === 'series' || type === 'anime') ? 'tv' : 'movie';
  return `https://btttr.cc/poster/${t}/${String(imdbId).toLowerCase()}/auto~gr.png`;
}

// Pictorium posters are served through LeLibrary's own proxy so the user's
// TMDB key never leaves the server. The client only sees the token-scoped
// path plus the chosen studio options.
function buildPictoriumPosterUrl(enhance, { type, id, title, releaseDate, imdbId, fallback }) {
  const pic = enhance && enhance.pictorium;
  if (!pic || !pic.enabled || !pic.token || !id) return null;
  const pictorium = require('../runtime/pictorium.ts');
  const path = pictorium.proxyPath({
    token: pic.token,
    type,
    id,
    title,
    releaseDate,
    imdbId,
    options: pic.options,
    fallback: pictorium.safeFallback(fallback),
  });
  const origin = String(pic.origin || '').replace(/\/+$/, '');
  return `${origin}${path}`;
}

async function getOmdbRatings(apiKey, imdbId) {
  if (!apiKey || !imdbId) return null;
  const key = `omdb:${imdbId}`;
  const cached = omdbCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const res = await axios.get('https://www.omdbapi.com/', { params: { apikey: apiKey, i: imdbId, plot: 'short' }, timeout: 8000 });
    if (res.data?.Response === 'False') { omdbCache.set(key, null); return null; }
    const ratings = {
      imdbRating: res.data.imdbRating || null,
      rtRating: null,
      mcRating: null,
      awards: res.data.Awards || null,
      metascore: res.data.Metascore || null,
    };
    if (res.data.Ratings) {
      for (const r of res.data.Ratings) {
        if (r.Source === 'Rotten Tomatoes') ratings.rtRating = r.Value;
        if (r.Source === 'Metacritic') ratings.mcRating = r.Value;
      }
    }
    omdbCache.set(key, ratings);
    return ratings;
  } catch {
    omdbCache.set(key, null);
    return null;
  }
}

const { getFanartArt } = require('../runtime/artwork-cache.ts');

function isTmdbAnime(result) {
  return result && (result.isJapaneseAnimation === true);
}

// Parser-level anime detection for a filename (release groups, CJK, anime ep format)
function infoAnime(_meta, name) {
  try {
    return !!(name && guessMediaInfo(name)?.isAnime);
  } catch {
    return false;
  }
}

// Merge a pack probe summary back onto the parsed outer name. The outer name
// can declare a multi-episode range ("S01E03-04") that the inner file list does
// not repeat: providers often expose only one file, or a single combined file.
// When the probe lands on the same season, keep the declared range so the
// second episode is not dropped from availability or the stream index.
function mergePackEpisodeRange(parsed, summary) {
  let episode = summary?.episode ?? null;
  let episodeEnd = null;
  if (summary?.episode != null && parsed?.episode != null && parsed?.episodeEnd != null
      && (summary.season ?? parsed.season) === parsed.season) {
    episode = Math.min(parsed.episode, summary.episode);
    episodeEnd = Math.max(parsed.episodeEnd, summary.episode);
  }
  return { episode, episodeEnd };
}

// A season pack can be uploaded with a single-episode name (for example
// "Show.S08E07.2160p...mkv" that actually contains all of season 8). The
// embedded file list is always available for TorBox downloads, so widen such an
// entry to its whole season without any provider call. Only widen when the
// inner files hold several DISTINCT episodes of the same season: multiple
// releases of one episode, or a lone file, must stay as they are.
function embeddedPackEntry(entry, info) {
  if (!entry || entry.episode == null) return entry;
  const parsed = info || guessMediaInfo(entry.item?.name || entry.item?.filename || '');
  if (!parsed?.isSeries || parsed.episode == null) return entry;
  const embedded = Array.isArray(entry.item?.files)
    ? entry.item.files
    : (entry.item?.files && typeof entry.item.files === 'object' ? Object.values(entry.item.files) : []);
  if (embedded.length < 2) return entry;
  const videoNames = embedded
    .map(file => file?.name || file?.short_name || '')
    .filter(name => isVideoFile(name) && !isJunkVideo(name));
  if (videoNames.length < 2) return entry;
  const summary = summarizePackEpisodes(videoNames);
  // episode != null means one episode (possibly several files of it), not a pack.
  if (!summary || summary.episode != null) return entry;
  if (summary.season != null && parsed.season != null && summary.season !== parsed.season) return entry;
  return {
    ...entry,
    season: summary.season ?? entry.season,
    seasonStart: summary.seasonStart ?? null,
    seasonEnd: summary.seasonEnd ?? null,
    episode: null,
    episodeEnd: null,
  };
}

// Best-effort title of the requested episode from TMDB's cached metadata.
// Used only as a fallback when season/episode numbering disagrees between
// sources (TVDB vs TMDB, anime) but the release carries the episode title.
async function requestedEpisodeTitle(tmdbApiKey, tmdbId, season, episode, lang) {
  if (!tmdbApiKey || season == null || season === '' || episode == null || episode === '') return null;
  try {
    const meta = await getMetadata(tmdbApiKey, tmdbId, 'tv', lang || 'en-US');
    const video = (meta && Array.isArray(meta.videos) ? meta.videos : []).find(v =>
      String(v.season) === String(season) && String(v.episode) === String(episode));
    return video && video.title ? video.title : null;
  } catch { return null; }
}

function normalizeEpisodeTitle(value) {
  return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

// Conservative whole-phrase match so a shared common word cannot associate two
// different episodes.
function episodeTitleMatches(a, b) {
  const na = normalizeEpisodeTitle(a);
  const nb = normalizeEpisodeTitle(b);
  if (!na || !nb || na.length < 4 || nb.length < 4) return false;
  return na === nb || (na.length >= 6 && nb.length >= 6 && (na.includes(nb) || nb.includes(na)));
}

async function matchItem(item, tmdbApiKey, type, lang, config = null) {
  const name     = item.name || item.filename || '';
  if (isJunkVideo(name)) return null;
  const tmdbType = type === 'movie' ? 'movie' : 'series';
  const parsedForKey = guessMediaInfo(name);
  // Strip pack markers from the outer title too: a torrent named
  // "Game of Thrones Complete S01-S08" parses to a title TMDB cannot find, so
  // the show would drop out entirely without this.
  if (parsedForKey && parsedForKey.title) parsedForKey.title = cleanPackTitle(parsedForKey.title);
  const cacheKey = matchCacheKey(type, lang, name, parsedForKey);

  // Some renamed multi-season downloads still look like one episode on the
  // outside (for example "Show Name S03E05"). Inspect only downloads with
  // strong pack signals, preferring the already-embedded file list. The
  // privacy-safe summary is cached durably, so a provider lookup happens at
  // most once for the same immutable download rather than once per refresh.
  let effectiveInfo = parsedForKey;
  if (config && type !== 'movie' && shouldProbeEpisodeNamedPack(item, parsedForKey)) {
    const probe = await probePackEpisodes(item, config);
    if (probe.summary) {
      const range = mergePackEpisodeRange(parsedForKey, probe.summary);
      effectiveInfo = {
        ...parsedForKey,
        title: probe.summary.title || parsedForKey.title,
        year: probe.summary.year ?? parsedForKey.year,
        isAnime: probe.summary.isAnime || parsedForKey.isAnime,
        season: probe.summary.season,
        seasonStart: probe.summary.seasonStart,
        seasonEnd: probe.summary.seasonEnd,
        episode: range.episode,
        episodeEnd: range.episodeEnd,
      };
    }
  }

  const probedAvailabilityChanged = effectiveInfo !== parsedForKey && packAvailabilityDiffers(parsedForKey, effectiveInfo);
  let cached = await matchCache.get(cacheKey);
  // A cached null is a proven negative (stored with NULL_MATCH_TTL): honour it
  // instead of re-running the parse+search on every request. The entry expires
  // quickly so TMDB-side changes get picked up.
  if (cached === null && !probedAvailabilityChanged) return null;
  if (cached === null) cached = undefined;
  // Stale split-show matches (TVDB season numbering stored against the
  // pre-split entry, e.g. Kitchen Nightmares US S10 → 11294) predate the
  // remap below: fall through and re-match instead of reusing them, so they
  // self-heal without a global cache flush.
  const staleSplit = cached && remapSplitSeason(cached.tmdbId, cached.season);
  if (cached !== undefined && !staleSplit) {
    // Re-validate the anime guard on reuse: cached entries may predate the
    // anime filter (disk-persisted across versions) and could otherwise leak
    // anime into the series catalog.
    const cachedAnime = isTmdbAnime(cached);
    if (type === 'series' && (cachedAnime || infoAnime(cached, name))) {
      await matchCache.set(cacheKey, null, NULL_MATCH_TTL);
      return null;
    }
    if (type === 'anime' && !cachedAnime && !infoAnime(cached, name)) {
      await matchCache.set(cacheKey, null, NULL_MATCH_TTL);
      return null;
    }
    if (type === 'movie') {
      const cachedInfo = guessMediaInfo(name);
      if (await isEpisodePackMisreadAsMovie(item, config, cachedInfo, cached)) {
        await matchCache.set(cacheKey, null, PACK_NULL_TTL);
        return null;
      }
    }
    const availabilityChanged = effectiveInfo && packAvailabilityDiffers(cached, effectiveInfo);
    if (availabilityChanged) {
      cached = {
        ...cached,
        season: effectiveInfo.season,
        seasonStart: effectiveInfo.seasonStart ?? null,
        seasonEnd: effectiveInfo.seasonEnd ?? null,
        episode: effectiveInfo.episode,
        episodeEnd: effectiveInfo.episodeEnd ?? null,
      };
      await matchCache.set(cacheKey, cached);
    }
    // Never reuse another user's torrent item: attach the caller's item.
    return { ...cached, torboxItem: item, ...(availabilityChanged ? { _freshMatch: true } : {}) };
  }

  const info = effectiveInfo;
  // Unparseable outer name: only a pack-content peek can save it (series/
  // anime catalogs with provider config). The pack path owns its caching.
  if (!info) {
    if (type !== 'movie' && config) {
      const packMeta = await tryMatchPackFiles(item, config, type, tmdbApiKey, lang, null, name, cacheKey);
      if (packMeta) return { ...packMeta, _freshMatch: true };
      return null;
    }
    await matchCache.set(cacheKey, null, NULL_MATCH_TTL);
    return null;
  }

  // Simplified type validation (bare-name packs fall through to the inner-
  // filename peek instead of failing here).
  if (type === 'movie' && info.isSeries) { await matchCache.set(cacheKey, null, NULL_MATCH_TTL); return null; }
  if (type === 'series' && (!info.isSeries || info.isAnime)) {
    if (config) {
      const packMeta = await tryMatchPackFiles(item, config, type, tmdbApiKey, lang, info, name, cacheKey);
      if (packMeta) return { ...packMeta, _freshMatch: true };
      return null;
    }
    await matchCache.set(cacheKey, null, NULL_MATCH_TTL);
    return null;
  }
  if (type === 'anime' && !info.isSeries) {
    if (config) {
      const packMeta = await tryMatchPackFiles(item, config, type, tmdbApiKey, lang, info, name, cacheKey);
      if (packMeta) return { ...packMeta, _freshMatch: true };
      return null;
    }
    await matchCache.set(cacheKey, null, NULL_MATCH_TTL);
    return null;
  }

  try {
    // The single matching core decides; this function only builds + caches.
    // Deps preserve the old call semantics: searchMetadata's pick first
    // (keeps the year-retry behavior), then raw candidates so a missing
    // season can fall through. All TMDB calls stay cache-backed.
    const coreDeps = {
      parse: (n) => guessMediaInfo(n),
      search: async (query, queryType, year, l) => {
        const [best, cands] = await Promise.all([
          searchMetadata(tmdbApiKey, query, queryType, year, l).catch(() => null),
          searchCandidates(tmdbApiKey, query, queryType, year, l).catch(() => []),
        ]);
        const out = [];
        const seen = new Set();
        for (const cand of [best, ...(cands || [])]) {
          if (!cand || cand.id == null || seen.has(String(cand.id))) continue;
          seen.add(String(cand.id));
          out.push(cand);
        }
        return out;
      },
      pick: (query, cands, year) => pickBestResult(query, cands, year),
      seasonCounts: (id, l) => getSeasonEpisodeCounts(tmdbApiKey, id, l),
      isAnimeCandidate: (cand) => isTmdbAnime(cand),
      findEpisode: (id, date, l) => findEpisodeByAirDate(tmdbApiKey, id, date, l),
    };
    const resolved = await resolveMatch({ name, mediaType: type, lang }, coreDeps);
    if (!resolved.ok) { await matchCache.set(cacheKey, null, NULL_MATCH_TTL); return null; }
    // Canonical identity in hand: build from it, never re-derive. The source
    // object comes from canonicalSource (not the raw candidate): split-season
    // remaps change the ENTRY, and the pre-split candidate would bake the
    // wrong tmdbId/title/artwork into the stored match.
    const source = await canonicalSource(tmdbApiKey, resolved, lang);
    const season = resolved.season;
    const seasonStart = resolved.seasonStart;
    const seasonEnd = resolved.seasonEnd;
    const episode = resolved.episode;
    const episodeEnd = resolved.episodeEnd;

    if (type === 'movie' && await isEpisodePackMisreadAsMovie(item, config, info, source)) {
      await matchCache.set(cacheKey, null, PACK_NULL_TTL);
      return null;
    }

    const isAnime = isTmdbAnime(source);

    console.log(`[TMDB] "${info.title}" → "${resolved.title}" (${resolved.tmdbId}) anime=${isAnime}`);

    const meta = buildMatchMeta(source, type, item, season, episode, episodeEnd, seasonStart, seasonEnd);
    meta.episodeTitle = info.episodeTitle || null;
    // Persist air dates for date-based releases so later meta/stream reads can
    // match them to the TMDB episode date without re-parsing.
    meta.airDate = info.airDate || null;
    meta.airDates = (info.airDates && info.airDates.length) ? info.airDates : null;

    await matchCache.set(cacheKey, meta);
    // Tag freshly-computed matches (NOT stored in the cache value: the tag is
    // only on the returned object) so buildCatalog can detect that a new title
    // / episode just became matchable and invalidate that user's stale meta and
    // stream caches. Previously an episode added to TorBox stayed invisible
    // until a manual "refresh catalog" because the cached meta predated its match.
    return { ...meta, _freshMatch: true };
  } catch (err) {
    console.error(`[TMDB] Error "${name}": ${err.message}`);
    await matchCache.set(cacheKey, null, NULL_MATCH_TTL);
    return null;
  }
}

async function buildCatalog(downloads, tmdbApiKey, type, sortBy, extra, lang = 'en-US', enhance = {}, opts = {}) {
  const skip      = parseInt(extra?.skip) || 0;
  const search    = extra?.search?.toLowerCase();
  const PAGE_SIZE = 50;
  const { progressive = false } = opts;
  const userKey   = opts.userKey || '';
  const hideAnime = !!opts.hideAnime;
  // Provider config enables the bare-name pack fallback in matchItem (one
  // file listing per otherwise-unmatchable item). Without it the filters
  // below stay strict and behavior is unchanged.
  const packConfig = opts.config || null;

  const allRelevant = [];
  for (const item of downloads) {
    const name = item.name || item.filename || '';
    if (isJunkVideo(name)) continue;
    const info = guessMediaInfo(name);
    if (!info && !packConfig) continue;
    if (type === 'movie'  && (info?.isSeries || info?.isAnime))  continue;
    if (type === 'series' && (!info?.isSeries || info?.isAnime) && !packConfig) continue;
    if (type === 'anime'  && !info?.isSeries && !packConfig)                   continue; // anime uses SxxExx or custom format
    // "Hide anime" must strip anime from the movie/series catalogs too,
    // not just remove the anime catalog from the manifest.
    if (hideAnime && type !== 'anime' && info?.isAnime) continue;
    allRelevant.push({ item, info });
  }

  console.log(`[Catalog] type=${type} | raw=${downloads.length} → filtered=${allRelevant.length}${hideAnime ? ' (hideAnime)' : ''}`);

  // Progressive mode: split into already-matched (instant) vs new (background).
  // New items are still matched: just after responding, not blocking it.
  const BATCH_SIZE = 6;
  let tasks;
  let completion = null;

  let freshCount = 0;
  if (progressive) {
    const cached = [];
    const fresh  = [];
    const keyed = allRelevant.map(({ item, info }) => ({
      item, info,
      key: matchCacheKey(type, lang, item.name || item.filename || '', info),
    }));
    const cachedMatches = await matchCache.getMany(keyed.map(row => row.key));
    for (const { item, info, key: ck } of keyed) {
      // Treat null-cached (failed) entries as needing retry: only count
      // non-null cache hits as truly cached.  This prevents a transient TMDB
      // failure from locking an item out for the full 24h cache TTL.
      const cv = cachedMatches.has(ck) ? cachedMatches.get(ck) : undefined;
      if (cv !== undefined && cv !== null) cached.push({ item, info });
      else fresh.push({ item, info });
    }
    freshCount = fresh.length;
    console.log(`[Catalog] Progressive: ${cached.length} cached, ${fresh.length} to match in background`);
    // Only fast-return a partial when the majority is already matched.
    // A cold or near-cold cache (few cached) would return a near-empty page -
    // worse than blocking for the full build, so fall back to the full build.
    if (cached.length === 0 || cached.length < fresh.length) {
      tasks = allRelevant.map(({ item }) => () => matchItem(item, tmdbApiKey, type, lang, packConfig));
    } else {
      tasks = cached.map(({ item }) => () => matchItem(item, tmdbApiKey, type, lang, packConfig));
      if (fresh.length > 0) {
        completion = pLimit(fresh.map(({ item }) => () => matchItem(item, tmdbApiKey, type, lang, packConfig)), BATCH_SIZE);
      }
    }
  } else {
    // One Redis round trip for every candidate key before matching instead of
    // one per download inside matchItem. getMany seeds the in-memory match
    // cache, so each matchItem get() below is a local hit.
    const candidateKeys = allRelevant.map(({ item, info }) =>
      matchCacheKey(type, lang, item.name || item.filename || '', info));
    await matchCache.getMany(candidateKeys);
    tasks = allRelevant.map(({ item }) => () => matchItem(item, tmdbApiKey, type, lang, packConfig));
  }

  const rawResults = await pLimit(tasks, BATCH_SIZE);
  let results = rawResults.filter(r => r && !r.error);

  // When anime is hidden, drop TMDB-flagged anime from movie/series catalogs
  // (parser-level anime was already excluded above / in matchItem).
  if (hideAnime && type !== 'anime') {
    results = results.filter(r => !r.isJapaneseAnimation);
  }

  // New matches (a download that was previously unmatchable now resolves to a
  // title/episode) mean the user's rendered library pages are stale too.  It
  // is not enough to evict meta/stream responses: My Movies can otherwise
  // retain its already-rendered first page for an hour, leaving a newly matched
  // film invisible even though it is in the provider snapshot and franchise
  // builder.  Clear only this user's catalog projections; the caller that is
  // currently building immediately writes its fresh result back.
  const freshMatchCount = results.filter(r => r && r._freshMatch === true).length;
  if (freshMatchCount > 0 && userKey && !opts.deferCacheInvalidation) {
    await cache.delPattern(`cat:*${userKey}*`).catch(() => {});
    await cache.delPattern(`meta:*${userKey}*`).catch(() => {});
    await cache.delPattern(`stream:*${userKey}*`).catch(() => {});
    console.log(`[Catalog] ${freshMatchCount} new match(es) → invalidated catalog/meta/stream caches for ${userKey}`);
  }
  // Progressive background matches complete after the response: invalidate once
  // they land too, so episodes matched off-page show up without a manual refresh.
  if (completion && !opts.deferCacheInvalidation) {
    completion.then(completionResults => {
      const bgFresh = (completionResults || []).filter(r => r && r._freshMatch === true).length;
      if (bgFresh > 0 && userKey) {
        return Promise.all([
          cache.delPattern(`cat:*${userKey}*`).catch(() => {}),
          cache.delPattern(`meta:*${userKey}*`).catch(() => {}),
          cache.delPattern(`stream:*${userKey}*`).catch(() => {}),
        ]).then(() => {
          console.log(`[Catalog] ${bgFresh} new match(es) (background) → invalidated catalog/meta/stream caches for ${userKey}`);
        });
      }
      return Promise.resolve();
    }).catch(() => {});
  }

  const seen = new Map();
  for (const meta of results) {
    const indexKey = `${userKey}:${meta.type}:${meta.tmdbId}`;
    const entry    = { item: meta.torboxItem, season: meta.season, seasonStart: meta.seasonStart ?? null, seasonEnd: meta.seasonEnd ?? null, episode: meta.episode, episodeEnd: meta.episodeEnd ?? null, episodeTitle: meta.episodeTitle ?? null };

    if (!tmdbindex.has(indexKey)) {
      setTmdbIndex(indexKey, [entry]);
    } else {
      const existing = tmdbindex.get(indexKey);
      // Compare id AND source: TorBox and Real-Debrid both emit bare numeric
      // API ids, so an id-only check silently dropped one provider's copy of
      // the same title in merge mode.
      if (!existing.some(e => e.item.id === entry.item.id && e.item.source === entry.item.source)) existing.push(entry);
    }

    if (!seen.has(meta.id)) seen.set(meta.id, { ...meta, torboxItems: [entry] });
    else seen.get(meta.id).torboxItems.push(entry);
  }

  let metas = Array.from(seen.values());
  if (search) metas = metas.filter(m => m.name?.toLowerCase().includes(search));

  if (sortBy === 'data_lancamento') {
    metas.sort((a, b) => (b.released || '').localeCompare(a.released || ''));
  } else if (sortBy === 'titulo') {
    metas.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en-US'));
  } else {
    // "Recently added" sorts on the NEWEST file of each title: a merged
    // title's date used to freeze at whichever download was seen first.
    metas.sort((a, b) => {
      const latestDate = (items) => (items || []).reduce((acc, it) => {
        const d = it?.item?.created_at || '';
        return d > acc ? d : acc;
      }, '');
      return latestDate(b.torboxItems).localeCompare(latestDate(a.torboxItems));
    });
  }

  const paginated = metas.slice(skip, skip + PAGE_SIZE);
  console.log(`[Catalog] Returning ${paginated.length} items (skip=${skip}, total=${metas.length})`);

  // "Use Main Meta" mode (libraryIdMode === 'tt'): library rows carry plain
  // tt: (IMDb) ids so clients route them through the rich discovery meta path
  // (TMDB-built, like AIOStreams' metadata source) and external stream addons
  // answer them. Rows keep their tmdbId so the owned index, saga links and
  // poster providers keep working. Titles without an IMDb id are dropped (rare).
  // torbox: mode pays nothing extra.
  const ttMode = opts.libraryIdMode === 'tt';
  if (ttMode) {
    // Two batched lookups (movies, series) for the page instead of one GET per
    // title. Rows without an IMDb id are dropped. Anime rows are TV: TMDB
    // movie and TV ids are independent sequences, so looking an anime TV id
    // up in the movie namespace misses and the row was wrongly dropped.
    const isTvRow = (m) => m && (m.catalogType === 'series' || m.catalogType === 'anime');
    const movieIds = paginated.filter(m => m && m.tmdbId && !isTvRow(m)).map(m => m.tmdbId);
    const tvIds    = paginated.filter(m => m && m.tmdbId && isTvRow(m)).map(m => m.tmdbId);
    const [movieImdb, tvImdb] = await Promise.all([
      getImdbIds(tmdbApiKey, 'movie', movieIds).catch(() => new Map()),
      getImdbIds(tmdbApiKey, 'tv', tvIds).catch(() => new Map()),
    ]);
    for (const m of paginated) {
      if (!m || !m.tmdbId) continue;
      const imdbId = (isTvRow(m) ? tvImdb : movieImdb).get(m.tmdbId) || null;
      if (imdbId) m.id = imdbId; // plain tt{imdbId}, same shape as discovery rows
      else m._drop = true;
    }
  }

  // Poster precedence mirrors enhanceMeta/discovery: custom > pictorium >
  // erdb > rpdb > betterposter > fanart. Anime rows are TV for provider URL
  // purposes (TMDB TV ids in a 'movie' slot 404 and poison the grid).
  const { erdbToken, rpdbKey, fanartKey, posterProvider, customPosterTemplate } = enhance;
  const pictoriumOn = !!(enhance.pictorium && enhance.pictorium.enabled);
  if (erdbToken || rpdbKey || fanartKey || posterProvider === 'custom' || posterProvider === 'betterposter' || pictoriumOn) {
    const { normalizeImdbId } = require('../media/identity.ts');
    await Promise.all(paginated.map(async (m) => {
      const t = m.catalogType === 'movie' ? 'movie' : 'tv';
      const customPoster = posterProvider === 'custom'
        ? require('../media/poster-template.ts').resolve(customPosterTemplate, { ...m, type: m.catalogType })
        : null;
      if (customPoster) {
        m.poster = customPoster;
        m.posterShape = 'poster';
      } else if (posterProvider === 'custom') {
        return;
      } else if (pictoriumOn && m.tmdbId) {
        const url = buildPictoriumPosterUrl(enhance, { type: m.catalogType, id: m.tmdbId, title: m.name, releaseDate: m.released, imdbId: m.imdbId, fallback: m.poster });
        if (url) { m.poster = url; m.posterShape = 'poster'; }
      } else if (erdbToken && m.tmdbId) {
        m.poster = erdbProxyUrl(enhance, 'poster', `tmdb:${t}:${m.tmdbId}`, m.poster) || m.poster;
      } else if (rpdbKey && m.tmdbId) {
        m.poster = buildRpdbUrl(rpdbKey, 'tmdb', 'poster-default', `${t}-${m.tmdbId}`);
      } else if (posterProvider === 'betterposter' && m.tmdbId) {
        const imdbId = m.imdbId || normalizeImdbId(m.id);
        if (imdbId) { m.poster = buildBetterPosterUrl(imdbId, m.catalogType); m.posterShape = 'poster'; }
      } else if (fanartKey && m.tmdbId) {
        const art = await getFanartArt(fanartKey, m.tmdbId, t).catch(() => null);
        if (art && art.poster) m.poster = art.poster;
      }
    }));
  }

  // Filter BEFORE destructuring: the map used to strip `_drop` from the row,
  // so `!m._drop` was always true and tt-mode rows without an IMDb id were
  // never dropped as documented.
  const output = paginated
    .filter(m => m.poster && !m._drop)
    .map(({ torboxItem, torboxItems, tmdbId, released, catalogType, isJapaneseAnimation, season, seasonStart, seasonEnd, episode, _drop, _freshMatch, ...rest }) => rest);

  if (completion) return { metas: output, completion, _fresh: freshCount };
  return output;
}

function addOwnedEpisodeAvailability(available, entry = {}) {
  const { season, seasonStart, seasonEnd, episode, episodeEnd, airDate, airDates } = entry;
  const hasAir = !!(airDate || (Array.isArray(airDates) && airDates.length));
  if (seasonStart != null && seasonEnd != null) {
    const from = parseInt(seasonStart, 10);
    const to = parseInt(seasonEnd, 10);
    if (Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from) {
      for (let value = from; value <= to; value++) available.add(`season:${value}`);
      return;
    }
  }
  if (episode != null && season != null) {
    const epFrom = parseInt(episode, 10);
    const epTo = episodeEnd != null ? parseInt(episodeEnd, 10) : epFrom;
    for (let ep = epFrom; ep <= epTo; ep++) available.add(`${season}:${ep}`);
  } else if (season != null) {
    available.add(`season:${season}`);
  } else if (!hasAir) {
    // A release with no season, episode or air date is a whole-series pack.
    // Date-based releases are deliberately NOT treated as "all": their air
    // dates are matched against the TMDB episode dates instead.
    available.add('all');
  }
}

function ownedDateKey(value) {
  const s = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// Collect the air dates of date-based owned entries (a weekly show like WWE Raw
// has no season/episode in its filename). They are matched against
// meta.videos[].released locally, so no extra API call is ever made.
function addOwnedAirDates(dates, entry = {}) {
  if (entry.season != null || entry.episode != null || entry.seasonStart != null) return;
  const list = [];
  if (Array.isArray(entry.airDates)) list.push(...entry.airDates);
  if (entry.airDate) list.push(entry.airDate);
  for (const d of list) { const k = ownedDateKey(d); if (k) dates.add(k); }
}

async function buildMeta(tmdbId, type, tmdbApiKey, lang, config = {}, enhance = {}, userKey = '', filterOwnedEpisodes = true, trace = null) {
  const tmdbType = type === 'series' || type === 'anime' ? 'series' : 'movie';

  // Check if tmdbindex already has entries (per-user) before fetching downloads.
  // MERGE the series and anime buckets: a show can have episodes in both (e.g.
  // stale anime-classified matches for an animated series), and picking just the
  // first non-empty bucket dropped the other's seasons entirely.
  const indexKey = `${userKey}:${type}:${tmdbId}`;
  const _mergedIdx = [];
  const _seenIdx = new Set();
  for (const bucket of [
    tmdbindex.get(indexKey),
    tmdbindex.get(`${userKey}:series:${tmdbId}`),
    tmdbindex.get(`${userKey}:anime:${tmdbId}`),
  ]) {
    if (!Array.isArray(bucket)) continue;
    for (const e of bucket) {
      if (e && e.item && !_seenIdx.has(e.item.id)) { _seenIdx.add(e.item.id); _mergedIdx.push(e); }
    }
  }
  const existingEntries = _mergedIdx;

  // Discovery (tt:) requests skip the owned-episode pass entirely: they show
  // every TMDB episode so external stream addons can contribute, regardless of
  // what the user owns. Library/franchise series keep only owned episodes.
  const needsOwnedPass = filterOwnedEpisodes && tmdbType !== 'movie';

  // Fetch TMDB metadata; downloads only if needed.
  // One provider failing (expired key, API hiccup) must not empty the result.
  // Timed separately (Phase 0): series metas fetch downloads on a cold index.
  const timeMeta = async (name, fn) => {
    try {
      const { timeSpan } = require('../middleware/perf-timing.ts');
      return await timeSpan(trace, name, fn);
    } catch { return fn(); }
  };
  const [meta, downloads] = await Promise.all([
    timeMeta('meta:tmdb', () => getMetadata(tmdbApiKey, tmdbId, tmdbType, lang, { discovery: !filterOwnedEpisodes })),
    (needsOwnedPass && !existingEntries?.length) ? timeMeta('meta:downloads', () => providers.fetchDownloads(config)) : Promise.resolve([]),
  ]);

  if (!meta) return meta;

  try {
    if (!needsOwnedPass) {
      // Movies skip the episode-availability pass (nothing to filter), and
      // discovery (tt:) series keep their full TMDB episode list: but both
      // still fall through to the poster/rating enhancement below.
    } else {
    const availableEps = new Set();
    const availableDates = new Set();
    const indexEntries = [];

    // If tmdbindex already has entries for this title (populated by catalog), use directly
    if (existingEntries?.length > 0) {
      for (const { item, season, seasonStart, seasonEnd, episode, episodeEnd, airDate, airDates } of existingEntries) {
        const entry = embeddedPackEntry({ item, season, seasonStart, seasonEnd, episode, episodeEnd, airDate, airDates });
        indexEntries.push(entry);
        addOwnedEpisodeAvailability(availableEps, entry);
        addOwnedAirDates(availableDates, entry);
      }
    } else {
      // Index not populated: full match, but in parallel per unique title
      const titleCache = new Map();
      const toSearch   = [];

      const seriesCandidates = [];
      const candidateKeys = [];
      for (const item of downloads) {
        const name = item.name || item.filename || '';
        const info = guessMediaInfo(name);
        if (!info || !info.isSeries) continue;
        seriesCandidates.push({ item, info, name });
        for (const t of ['anime', 'series']) {
          for (const l of [lang, 'en-US', 'pt-BR']) candidateKeys.push(matchCacheKey(t, l, name, info));
        }
      }
      // One Redis round trip for all candidate keys instead of up to six
      // sequential awaits per download on a cold detail page.
      const candidateMatches = await matchCache.getMany(candidateKeys);

      for (const { item, info, name } of seriesCandidates) {
        let cachedMeta = null;
        for (const t of ['anime', 'series']) {
          for (const l of [lang, 'en-US', 'pt-BR']) {
            const c = candidateMatches.get(matchCacheKey(t, l, name, info));
            if (c && String(c.tmdbId) === String(tmdbId)) { cachedMeta = c; break; }
          }
          if (cachedMeta) break;
        }

        if (!cachedMeta) {
          // For series, skip year in the search key: the filename year is often
          // the episode date (e.g. "2026" from "S34E01 2026-08-03"), not the
          // show's first air year, and passing it filters out long-running shows.
          const tk = (info.airDate || info.isSeries) ? info.title : (info.title + '|' + (info.year || ''));
          toSearch.push({ item, info, tk, cachedMeta: null });
        } else {
          toSearch.push({ item, info, tk: null, cachedMeta });
        }
      }

      // Fetch unique titles on TMDB in parallel
      const uniqueTitles = [...new Set(toSearch.filter(x => x.tk).map(x => x.tk))];
      await Promise.all(uniqueTitles.map(async tk => {
        if (titleCache.has(tk)) return;
        const [title, year] = tk.split('|');
        try {
          if (year === undefined) {
            const cands = await searchCandidates(tmdbApiKey, title, 'tv', undefined, lang);
            titleCache.set(tk, cands.map(c => String(c.id)));
          } else {
            const r = await searchMetadata(tmdbApiKey, title, 'tv', year || undefined, lang);
            titleCache.set(tk, r ? String(r.id) : null);
          }
        } catch { titleCache.set(tk, null); }
      }));

      for (const { item, info, tk, cachedMeta } of toSearch) {
        // titleCache holds an id string (year-qualified search) or an id
        // array (series candidate search): accept either shape.
        const titleIds = titleCache.get(tk);
        const titleHit = Array.isArray(titleIds)
          ? titleIds.some(id => String(id) === String(tmdbId))
          : (tk && titleIds === String(tmdbId));
        // Split-show fallback (cold index): TVDB-numbered files for a show
        // TMDB split in two match the pre-split entry; remap them to the
        // requested split entry and season before the plain id check, so a
        // stale plain check can't accept them with the wrong season first.
        let splitSeason = null;
        if (!cachedMeta && !info.airDate && !(info.airDates && info.airDates.length)) {
          const ids = Array.isArray(titleIds) ? titleIds : (titleIds ? [titleIds] : []);
          for (const cid of ids) {
            const fwd = remapSplitSeason(cid, info.season);
            if (fwd && String(fwd.tmdbId) === String(tmdbId)) { splitSeason = fwd.season; break; }
          }
        }
        const matched = cachedMeta != null || splitSeason != null
          || (info.airDate
            ? (titleCache.get(tk) || []).some(id => String(id) === String(tmdbId))
            : titleHit);
        if (!matched) continue;

        let season     = cachedMeta?.season     ?? info.season;
        let seasonStart = cachedMeta?.seasonStart ?? info.seasonStart ?? null;
        let seasonEnd   = cachedMeta?.seasonEnd ?? info.seasonEnd ?? null;
        let episode    = cachedMeta?.episode    ?? info.episode;
        let episodeEnd = cachedMeta?.episodeEnd ?? info.episodeEnd;
        if (splitSeason != null) season = splitSeason;
        if ((info.airDate || (info.airDates && info.airDates.length)) && episode == null) {
          const dates = (info.airDates && info.airDates.length) ? info.airDates : [info.airDate];
          for (const d of dates) {
            const resolved = await findEpisodeByAirDate(tmdbApiKey, tmdbId, d, lang);
            if (resolved) { season = resolved.season; episode = resolved.episode; episodeEnd = null; break; }
          }
        }

        const entry = embeddedPackEntry({ item, season, seasonStart, seasonEnd, episode, episodeEnd, airDate: info.airDate, airDates: info.airDates });
        indexEntries.push(entry);
        addOwnedEpisodeAvailability(availableEps, entry);
        addOwnedAirDates(availableDates, entry);
      }
    }

    if (indexEntries.length > 0) {
      setTmdbIndex(indexKey, indexEntries);
      console.log(`[Meta] Index updated: ${indexKey} → ${indexEntries.length} items`);
    }

    if (availableEps.size > 0 || availableDates.size > 0) {
      const totalBefore = meta.videos?.length || 0;
      meta.videos = (meta.videos || []).filter(v =>
        availableEps.has(`${v.season}:${v.episode}`) ||
        availableEps.has(`season:${v.season}`) ||
        availableEps.has('all') ||
        (availableDates.size > 0 && v.released && availableDates.has(ownedDateKey(v.released)))
      );
      console.log(`[Meta] tmdbId=${tmdbId} → ${meta.videos.length}/${totalBefore} eps available`);
    } else {
      meta.videos = [];
      console.log(`[Meta] tmdbId=${tmdbId} → no episodes available`);
    }
    }
  } catch (e) {
    console.error('[Meta] Error filtering episodes:', e.message);
  }

  await enhanceMeta(meta, enhance);

  // Owned library / franchise metas (torbox:) keep the clickable cast (with
  // photos) so My Movies / My Shows show the actors, but stay otherwise
  // minimal: trailers and the network/production links are a Popular/Trending
  // (tt:) discovery feature, so only discovery metas carry them. This keeps
  // My Movies / My Shows / LeLibrary Collections items clean while the
  // IMDB-linked discovery rows stay rich and interactive.
  if (meta && filterOwnedEpisodes) {
    delete meta.trailerStreams;
    if (Array.isArray(meta.links)) {
      meta.links = meta.links.filter(l => l && l.category === 'imdb');
    }
  }

  return meta;
}

// Shared poster/rating enhancement for a TMDB meta (used by both the owned
// library builder and the discovery builder).
async function enhanceMeta(meta, enhance = {}) {
  if (!meta) return meta;
  const { erdbToken, rpdbKey, omdbKey, fanartKey, posterProvider, customPosterTemplate, enhanceBackground, enhanceLogo } = enhance;
  const imdbId = meta.imdbId;

  if (posterProvider === 'custom') {
    const customPoster = require('../media/poster-template.ts').resolve(customPosterTemplate, meta);
    if (customPoster) {
      meta.poster = customPoster;
      meta.posterShape = 'poster';
    }
  } else if (enhance.pictorium && enhance.pictorium.enabled) {
    const id = imdbId || meta.tmdbId;
    const url = buildPictoriumPosterUrl(enhance, {
      type: meta.type === 'movie' ? 'movie' : 'series',
      id,
      title: meta.name,
      releaseDate: meta.released,
      imdbId,
      fallback: meta.poster,
    });
    if (url) { meta.poster = url; meta.posterShape = 'poster'; }
  } else if (erdbToken && imdbId) {
    meta.poster = erdbProxyUrl(enhance, 'poster', imdbId, meta.poster) || meta.poster;
    if (enhanceBackground) meta.background = erdbProxyUrl(enhance, 'backdrop', imdbId, meta.background) || meta.background;
    if (enhanceLogo) meta.logo = erdbProxyUrl(enhance, 'logo', imdbId, meta.logo) || meta.logo;
  } else if (rpdbKey && imdbId) {
    meta.poster = buildRpdbUrl(rpdbKey, 'imdb', 'poster-default', imdbId);
    if (enhanceBackground) meta.background = buildRpdbUrl(rpdbKey, 'imdb', 'backdrop-default', imdbId);
    if (enhanceLogo) meta.logo = buildRpdbUrl(rpdbKey, 'imdb', 'logo-default', imdbId);
  } else if (posterProvider === 'betterposter' && imdbId) {
    meta.poster = buildBetterPosterUrl(imdbId, meta.type);
    meta.posterShape = 'poster';
  } else if (fanartKey && meta.tmdbId) {
    const tmdbType = meta.type === 'movie' ? 'movie' : 'tv';
    const art = await getFanartArt(fanartKey, meta.tmdbId, tmdbType).catch(() => null);
    if (art) {
      if (enhanceBackground && art.background) meta.background = art.background;
      if (enhanceLogo && art.logo) meta.logo = art.logo;
      if (!erdbToken && !rpdbKey && art.poster) meta.poster = art.poster;
    }
  }

  if (omdbKey && imdbId) {
    const ratings = await getOmdbRatings(omdbKey, imdbId).catch(() => null);
    if (ratings) {
      if (ratings.imdbRating) meta.imdbRating = ratings.imdbRating;
      if (!meta.app_extras) meta.app_extras = {};
      meta.app_extras.ratings = {};
      if (ratings.rtRating) meta.app_extras.ratings.rottenTomatoes = ratings.rtRating;
      if (ratings.mcRating) meta.app_extras.ratings.metacritic = ratings.mcRating;
      if (ratings.awards) meta.app_extras.awards = ratings.awards;
    }
  }
  return meta;
}

// Owned streams are "links on demand": the list carries a placeholder per file
// and the provider link is only requested when someone presses play
// (routes/stream.ts /:token/play/...). Lists open without waiting on the
// provider and never spend its link quota on streams nobody plays. The
// placeholder (no token, no origin) is what gets cached, so a cached list can
// be shared between setups on the same debrid key; each response fills in its
// own play address (routes/shared.ts materializePlayUrls).
const PLAY_PREFIX = 'lelibrary-play://';

function playRef(source, itemId, fileId, name = '') {
  const base = `${PLAY_PREFIX}${encodeURIComponent(String(source))}/${encodeURIComponent(String(itemId))}/${encodeURIComponent(String(fileId))}`;
  const file = String(name || '').split('/').pop().replace(/[^\w.\- ()[\]]+/g, '').slice(0, 120);
  return file ? `${base}/${encodeURIComponent(file)}` : base;
}

async function buildStreamsInner(config = {}, tmdbApiKey, type, tmdbId, season, episode, lang, customStreams, userKey = '', opts = {}) {
  const lazyLinks = opts.lazyLinks === true;
  // A play link needs the provider's own source and id; anything without them
  // (never expected from the index) falls back to an immediate link.
  const canPlayLater = (item) => lazyLinks && Boolean(item && item.source && item.id != null && item.id !== '');
  const trace = opts.trace;
  const time = async (name, fn) => {
    try {
      const { timeSpan } = require('../middleware/perf-timing.ts');
      return await timeSpan(trace, name, fn);
    } catch { return fn(); }
  };
  const customMatch = matchCustomStreams(customStreams, {
    type, imdbId: opts.imdbId, season, episode, config,
  });
  const customResults = customMatch.streams;
  const customFp = customStreamsFingerprint(customStreams);
  // Miss cache is scoped per mode (bridge vs full) for the same reason as the
  // requestKey in buildStreams: a discovery-bridge miss must not blind the
  // library path, which would have run its own TMDB fallback.
  const streamMissKey = `${userKey}:${type}:${tmdbId}:${season ?? ''}:${episode ?? ''}:${opts.skipTmdbFallback ? 'bridge' : 'full'}:${customFp}`;
  if (streamMissCache.get(streamMissKey)) return customResults;
  // Mapping-only configurations have no provider work to perform. Exact and
  // legacy global rows are still valid direct streams and return immediately.
  if (providers.activeProviders(config).length === 0 || (!tmdbApiKey && customResults.length > 0)) return customResults;
  // Try both indexes (series and anime) since ID is always torbox:series:X
  const possibleKeys = [
    `${userKey}:${type === 'anime' ? 'series' : type}:${tmdbId}`,
    `${userKey}:series:${tmdbId}`,
    `${userKey}:anime:${tmdbId}`
  ];
  
  let entries = null;
  let usedKey = null;

  // Merge all matching buckets (series + anime) rather than stopping at the
  // first non-empty one: a show split across both buckets lost the episodes
  // in the ignored bucket ("no sources" for seasons in the other type).
  const _streamSeen = new Set();
  for (const key of possibleKeys) {
    const found = tmdbindex.get(key);
    if (found && found.length > 0) {
      if (!usedKey) usedKey = key;
      for (const e of found) {
        if (e && e.item && !_streamSeen.has(e.item.id)) { _streamSeen.add(e.item.id); (entries = entries || []).push(e); }
      }
    }
  }

  console.log(`[Stream] Looking up tmdbId=${tmdbId} type=${type} | s=${season} e=${episode}`);
  console.log(`[Stream] Index found: ${usedKey || 'none'} (${entries?.length || 0} items)`);

  if (!entries || entries.length === 0) {
    console.log(`[Stream] Rebuilding index...`);
    entries = [];
    const downloads = await time('streams:downloads', () => providers.fetchDownloads(config));

    // Candidate namespaces are constrained by the requested type: TMDB movie
    // and TV ids are INDEPENDENT sequences, so scanning the movie bucket for
    // a series tmdbId pulled unrelated films in as "full pack" matches.
    // (series+anime stay merged deliberately: shows live in both buckets.)
    // All cache lookups for one file run in parallel, and files are processed
    // 20 at a time: the old triple-nested loop did up to 9 SEQUENTIAL gets
    // per download on every cold rebuild.
    const typeScanOrder   = type === 'movie' ? ['movie'] : (type === 'anime' ? ['anime', 'series'] : ['series', 'anime']);
    const langsToTry      = [...new Set([lang || 'en-US', 'en-US', 'pt-BR'])];
    const candidateKeysFor = (name) => {
      const info = guessMediaInfo(name);
      return typeScanOrder.flatMap(t => langsToTry.map(l => matchCacheKey(t, l, name, info)));
    };

    await time('streams:match-cache', () => pLimit((downloads || []).map(item => async () => {
      const name = item.name || item.filename || '';
      if (!name) return;
      const keys = candidateKeysFor(name);
      const vals = await Promise.all(keys.map(k => matchCache.get(k)));
      const hitIdx = vals.findIndex(c => c && String(c.tmdbId) === String(tmdbId));
      if (hitIdx >= 0) {
        const c = vals[hitIdx];
        const parsed = guessMediaInfo(name) || {};
        const range = mergePackEpisodeRange(parsed, { season: c.season, episode: c.episode, episodeEnd: c.episodeEnd });
        entries.push(embeddedPackEntry({ item, season: c.season, seasonStart: c.seasonStart ?? null, seasonEnd: c.seasonEnd ?? null, episode: range.episode, episodeEnd: range.episodeEnd, airDate: parsed.airDate, airDates: parsed.airDates }));
      }
    }), 20));

    if (entries.length === 0 && tmdbApiKey && !opts.skipTmdbFallback) {
      console.log(`[Stream] TMDB fallback...`);
      const tmdbType = type === 'movie' ? 'movie' : 'series';
      const candidates = (downloads || []).filter(item => {
        const name = item.name || item.filename || '';
        const info = guessMediaInfo(name);
        if (!info) return false;
        if (tmdbType === 'movie'  && info.isSeries)  return false;
        if (tmdbType === 'series' && !info.isSeries) return false;
        return true;
      });

      const candidateTasks = candidates.map(item => async () => {
        const name = item.name || item.filename || '';
        const info = guessMediaInfo(name);
        try {
          if (info.airDate || (info.airDates && info.airDates.length)) {
            const cands = await searchCandidates(tmdbApiKey, info.title, 'tv', undefined, lang);
            const hit = cands.find(c => String(c.id) === String(tmdbId));
            if (hit) {
              const dates = (info.airDates && info.airDates.length) ? info.airDates : [info.airDate];
              let resolved = null;
              for (const d of dates) {
                resolved = await findEpisodeByAirDate(tmdbApiKey, hit.id, d, lang);
                if (resolved) break;
              }
              entries.push({ item, season: resolved?.season ?? null, episode: resolved?.episode ?? null, episodeEnd: null, airDate: info.airDate, airDates: info.airDates });
            }
            return;
          }
          const yearParam2 = tmdbType === 'movie' ? info.year : undefined;
          const result = await searchMetadata(tmdbApiKey, info.title, tmdbType, yearParam2, lang);
          // Split-show fallback: TVDB-numbered files match the pre-split
          // entry; accept them for the split entry with the remapped season.
          const split2 = result ? remapSplitSeason(result.id, info.season) : null;
          const effId = split2 ? split2.tmdbId : result?.id;
          if (result && String(effId) === String(tmdbId)) {
            entries.push(embeddedPackEntry({ item, season: split2 ? split2.season : info.season, seasonStart: split2 ? null : (info.seasonStart ?? null), seasonEnd: split2 ? null : (info.seasonEnd ?? null), episode: info.episode, episodeEnd: info.episodeEnd ?? null, episodeTitle: info.episodeTitle || null, airDate: info.airDate, airDates: info.airDates }));
          }
        } catch {}
      });
      await time('streams:tmdb-fallback', () => pLimit(candidateTasks, 6));
    }

    if (entries.length > 0) {
      const saveKey = `${userKey}:${type === 'movie' ? 'movie' : 'series'}:${tmdbId}`;
      setTmdbIndex(saveKey, entries);
      console.log(`[Stream] Index saved: ${saveKey} → ${entries.length} items`);
    }
  }

  if (!entries || entries.length === 0) {
    console.log(`[Stream] No items found`);
    streamMissCache.set(streamMissKey, true);
    return customResults;
  }

  console.log(`[Stream] Filtering ${entries.length} items`);

  let filtered;
  // Date-based series (weekly shows such as WWE Raw) have owned files with no
  // season/episode. The requested episode's air date is the only reliable key,
  // and it is read from the (cached) TMDB meta so warm requests make no call.
  let requestedAirDate = null;
  if ((type === 'series' || type === 'anime') && season != null && season !== '' && episode != null && episode !== '' && tmdbApiKey) {
    try {
      const m = await time('streams:episode-meta', () => getMetadata(tmdbApiKey, tmdbId, 'series', lang || 'en-US'));
      const v = (m?.videos || []).find(x => String(x.season) === String(season) && String(x.episode) === String(episode));
      requestedAirDate = ownedDateKey(v && v.released);
    } catch { /* leave null: fall through to numbered matching */ }
  }
  if (type === 'series' || type === 'anime') {
    const strict = entries.filter(({ season: s, seasonStart: sFrom, seasonEnd: sTo, episode: e, episodeEnd: eEnd, airDate, airDates }) => {
      // If season doesn't match, reject
      if (season != null && season !== '' && s != null && String(s) !== String(season)) return false;
      if (season != null && season !== '' && sFrom != null && sTo != null) {
        const requestedSeason = parseInt(season, 10);
        if (requestedSeason < parseInt(sFrom, 10) || requestedSeason > parseInt(sTo, 10)) return false;
      }

      // Date-based owned file (no season/episode): accept only when its air
      // date is the requested episode's air date. Never as a wildcard.
      if (s == null && e == null && (airDate || (Array.isArray(airDates) && airDates.length))) {
        const dates = [];
        if (Array.isArray(airDates)) dates.push(...airDates);
        if (airDate) dates.push(airDate);
        return !!requestedAirDate && dates.some(d => ownedDateKey(d) === requestedAirDate);
      }

      // If item has no specific episode (full pack), accept by season
      if (e == null) return true;
      
      // If has episode, validate range
      if (episode != null && episode !== '') {
        const epReq  = parseInt(episode, 10);
        const epFrom = parseInt(e, 10);
        const epTo   = (eEnd != null) ? parseInt(eEnd, 10) : epFrom;
        if (epReq < epFrom || epReq > epTo) return false;
      }
      return true;
    });

    if (strict.length > 0) {
      filtered = strict;
      console.log(`[Stream] Strict filter: ${filtered.length} entries`);
    } else {
      // An episode the user does not own must return NOTHING, never another
      // episode. The old fallbacks broke that: "ep-only" ignored the season
      // (requesting S02E01 served the owned S01E01) and "season-only" returned
      // every other episode of that season. Only allow an entry whose season is
      // unknown (absolute-numbered files) or the same season, and only when its
      // episode number actually matches.
      const epOnly = (episode != null && episode !== '')
        ? entries.filter(({ season: s, episode: e, episodeEnd: eEnd }) => {
            if (e == null) return false;
            if (s != null && season != null && season !== '' && String(s) !== String(season)) return false;
            const epReq  = parseInt(episode, 10);
            const epFrom = parseInt(e, 10);
            const epTo   = (eEnd != null) ? parseInt(eEnd, 10) : epFrom;
            return epReq >= epFrom && epReq <= epTo;
          })
        : [];

      if (epOnly.length > 0) {
        filtered = epOnly;
        console.log(`[Stream] Fallback ep-only: ${filtered.length} entries`);
      } else {
        filtered = [];
        console.log('[Stream] No owned match for this episode');
      }

      // Anime absolute numbering: files like "One Piece - 101" parse as
      // { season: null, episode: 101 }, which matched NO filter above: an
      // owned anime episode ended up with zero streams. Map the requested
      // season/episode to a global episode number via TMDB's season sizes
      // and match absolute-numbered entries against it.
      if (filtered.length === 0 && type === 'anime' && season != null && season !== '' && episode != null && episode !== '') {
        try {
          const counts = await time('streams:episode-counts', () => getSeasonEpisodeCounts(tmdbApiKey, tmdbId, lang || 'en-US'));
          const before = Array.isArray(counts)
            ? counts.filter(c => c.season < Number(season)).reduce((a, c) => a + c.count, 0)
            : 0;
          const globalReq = before + parseInt(episode, 10);
          const absMatches = globalReq > 0 ? entries.filter(({ season: s, episode: e, episodeEnd: eEnd }) => {
            if (s != null || e == null) return false;
            const from = parseInt(e, 10);
            const to   = (eEnd != null) ? parseInt(eEnd, 10) : from;
            return globalReq >= from && globalReq <= to;
          }) : [];
          if (absMatches.length > 0) {
            filtered = absMatches;
            console.log(`[Stream] Fallback absolute-numbering: ${filtered.length} entries (global ep ${globalReq})`);
          }
        } catch { /* non-fatal: fall through with empty */ }
      }

      // Episode-title fallback: numbering can disagree between sources (TVDB vs
      // TMDB, anime renumbering) while the release still names the episode.
      // Only reached when every number-based filter found nothing.
      if (filtered.length === 0 && (type === 'series' || type === 'anime')) {
        const reqTitle = await time('streams:episode-title', () => requestedEpisodeTitle(tmdbApiKey, tmdbId, season, episode, lang));
        if (reqTitle) {
          const byTitle = entries.filter((e) => episodeTitleMatches(
            e.episodeTitle || (guessMediaInfo(e.item?.name || e.item?.filename || '')?.episodeTitle),
            reqTitle,
          ));
          if (byTitle.length > 0) {
            filtered = byTitle;
            console.log(`[Stream] Fallback episode-title: ${filtered.length} entries`);
          }
        }
      }
    }
  } else {
    filtered = entries;
  }
  
  console.log(`[Stream] ${filtered.length} item(s) filtered | s=${season} e=${episode}`);

  const rawStreams = [];
  const attemptedProviders = new Set();
  const successfulProviders = new Set();
  let remainingOwnedLinkBudget = MAX_OWNED_LINKS_PER_REQUEST;
  await time('streams:files-links', () => pLimit(filtered.map(({ item }) => async () => {
    const providerId = providers.providerBySource(item.source);
    const getFiles = () => providers.getFiles(config, item);
    const getLink  = (fileId) => providers.getStreamLink(config, item, fileId);

    // TorBox download snapshots already carry the exact file list the
    // per-item endpoint returns, so reuse it and skip a provider round trip
    // per matched copy. Other providers reshape their files, so they keep the
    // explicit call.
    // WebDAV items carry their files from the scan too.
    const embedded = providerId === 'torbox' || providerId === 'webdav' ? embeddedItemFiles(item) : [];
    const files = embedded.length ? embedded : await getFiles();
    let videoFiles = files.filter(f => isVideoFile(f.name || f.short_name));
    // Always drop Sample/trailer junk ("/Sample/" folder or "-sample.mkv" suffix).
    // The old path only dropped them when a real file remained, so a torrent
    // whose only video was a sample still produced a playable stream. Now a
    // sample-only torrent yields no streams (user request). Tiny helper files
    // (e.g. the ~1MB "ETRG.mp4") are still only dropped when a real feature
    // is present so legit short extras aren't hidden when they're all there is.
    const nonJunk = videoFiles.filter(f => !isJunkVideo(f.name || f.short_name));
    if (nonJunk.length > 0) {
      videoFiles = nonJunk;
    } else if (videoFiles.some(f => isJunkVideo(f.name || f.short_name))) {
      videoFiles = [];
    }
    const hasFeature = videoFiles.some(f => (f.size || 0) > 100 * 1024 * 1024);
    if (hasFeature) {
      const withoutTiny = videoFiles.filter(f => (f.size || 0) >= 20 * 1024 * 1024);
      if (withoutTiny.length > 0) videoFiles = withoutTiny;
    }

    let targetFiles = videoFiles;
    if ((type === 'series' || type === 'anime') && episode != null && episode !== '' && videoFiles.length > 1) {
      const byEp = videoFiles.filter(f => {
        const info  = episodeFileInfo(f);
        if (!info || info.episode == null) return false;
        if (season != null && season !== '' && info.season != null && String(info.season) !== String(season)) return false;
        const epReq  = parseInt(episode, 10);
        const epFrom = parseInt(info.episode, 10);
        const epTo   = (info.episodeEnd != null) ? parseInt(info.episodeEnd, 10) : epFrom;
        return epReq >= epFrom && epReq <= epTo;
      });
      if (byEp.length > 0) {
        targetFiles = byEp;
      } else {
        const reqTitle = await requestedEpisodeTitle(tmdbApiKey, tmdbId, season, episode, lang);
        const byTitle = reqTitle
          ? videoFiles.filter(f => episodeTitleMatches(episodeFileInfo(f)?.episodeTitle, reqTitle))
          : [];
        if (byTitle.length > 0) {
          targetFiles = byTitle;
          console.log(`[Stream] File fallback episode-title: ${byTitle.length} files`);
        } else {
          targetFiles = [];
          console.log(`[Stream] No file matches s=${season} e=${episode} → no streams`);
        }
      }
    }

    // Generating a provider URL is the scarce operation. Keep the best few
    // files from one download and enforce one shared budget across every
    // matched copy; external-addon streams are built elsewhere and unaffected.
    targetFiles = [...targetFiles].sort((a, b) => {
      const af = a.name || a.short_name || '';
      const bf = b.name || b.short_name || '';
      const langDelta = langScore(bf, (lang || 'en-US').split('-')[0].toLowerCase()) - langScore(af, (lang || 'en-US').split('-')[0].toLowerCase());
      if (langDelta !== 0) return langDelta;
      const qualityDelta = qualityScore(bf) - qualityScore(af);
      if (qualityDelta !== 0) return qualityDelta;
      return Number(b.size || 0) - Number(a.size || 0);
    }).slice(0, MAX_OWNED_FILES_PER_ITEM);

    const bingeKey = item.source + ':' + item.id;

    if (targetFiles.length > 0) {
      for (const file of targetFiles) {
        if (remainingOwnedLinkBudget <= 0) break;
        remainingOwnedLinkBudget -= 1;
        try {
          if (providerId) attemptedProviders.add(providerId);
          const fname = file.name || file.short_name || item.name || '';
          const lazy = canPlayLater(item) && file.id != null;
          const url = lazy ? playRef(item.source, item.id, file.id, fname) : await getLink(file.id);
          if (!url) continue;
          if (providerId && !lazy) successfulProviders.add(providerId);
          rawStreams.push({ url, fname, size: file.size || 0, source: item.source, bingeKey });
        } catch {}
      }
    } else if (videoFiles.length === 1 || (videoFiles.length === 0 && files.length === 0 && !isJunkVideo(item.name || ''))) {
      // Single-file torrent (or unparseable filenames): serve the whole item.
      // When the requested episode didn't match inside a multi-file torrent,
      // return nothing instead of playing the wrong file. Never fall back to
      // a Sample/trailer file (videoFiles was emptied above when only junk remained).
      try {
        if (remainingOwnedLinkBudget <= 0) return;
        remainingOwnedLinkBudget -= 1;
        if (providerId) attemptedProviders.add(providerId);
        const wholeId = wholeItemFileId(item);
        const lazy = canPlayLater(item) && wholeId != null;
        const url = lazy ? playRef(item.source, item.id, wholeId, item.name || '') : (item.source === 'webdav' ? null : await getLink(0));
        if (url) {
          if (providerId && !lazy) successfulProviders.add(providerId);
          rawStreams.push({ url, fname: item.name || '', size: item.size || 0, source: item.source, bingeKey });
        }
      } catch {}
    } else {
      console.log(`[Stream] No matching file for s=${season} e=${episode}: skipping`);
    }
  }), 8));

  const langCode = (lang || 'en-US').split('-')[0].toLowerCase();
  rawStreams.sort((a, b) => {
    const dl = langScore(b.fname, langCode) - langScore(a.fname, langCode);
    if (dl !== 0) return dl;
    const dq = qualityScore(b.fname) - qualityScore(a.fname);
    if (dq !== 0) return dq;
    return b.size - a.size;
  });

  const result = rawStreams.map(({ url, fname, size, source, bingeKey }) => {
    const behaviorHints = ownedStreamHints(fname, size, source, bingeKey);
    return {
      url,
      name:        formatStreamName(fname, source, size, config, undefined, { library: true }),
      description: formatStreamDesc(fname, size, source, config, undefined, { library: true }),
      size,
      behaviorHints,
    };
  });

  let rateLimitNotices = [];
  try {
    if (noticeKindEnabled(config, 'rateLimit')) {
      const limited = await time('streams:ratelimits', () => providers.getPlaybackRateLimits(config, [...attemptedProviders]));
      rateLimitNotices = limited
        .filter(status => !successfulProviders.has(status.provider))
        .map(makeProviderRateLimitNotice);
    }
  } catch { /* a notice lookup must never suppress playable streams */ }

  return [...rateLimitNotices, ...result, ...customMatch.exact, ...customMatch.global];
}

// Fingerprint of the stream FORMAT settings (preset, custom templates and the
// notices toggle). Shared by app.ts's meta-route prefetch AND the stream route
// so both compute identical cache keys: they used to drift (the prefetch left
// out streamNotices), which made the prefetch write entries the route could
// never hit whenever notices were configured.
function libraryStreamFmtFp(config = {}) {
  return ':' + hashShort(['notice-v4', 'play-v1', config.streamPreset || '', config.streamNameTemplate || '', config.streamDescTemplate || '', config.streamNotices || '', customStreamsFingerprint(config.customStreams)].join('|'));
}

// Player hints for one owned copy. Subtitle addons hash-match on the bare
// filename, not the folder path. WebDAV copies stream through this server
// (usually MKV over the LAN), so web players are told to skip them and the
// size helps the player and subtitle matching.
function ownedStreamHints(fname, size, source, bingeKey) {
  const behaviorHints: Record<string, any> = { notWebReady: source === 'webdav' };
  const baseName = (fname || '').split('/').pop();
  if (baseName) behaviorHints.filename = baseName;
  if (source === 'webdav' && Number(size) > 0) behaviorHints.videoSize = Number(size);
  if (bingeKey) behaviorHints.bingeGroup = bingeKey;
  return behaviorHints;
}

// File id for playing a whole item: providers take 0 ("the item itself"),
// WebDAV needs a real file (its first one), or nothing.
function wholeItemFileId(item) {
  if (item && item.source === 'webdav') {
    const first = Array.isArray(item.files) ? item.files[0] : null;
    return first && first.id ? first.id : null;
  }
  return 0;
}

async function buildStreams(config = {}, tmdbApiKey, type, tmdbId, season, episode, lang, customStreams, userKey = '', opts = {}) {
  // Include skipTmdbFallback in the coalescing key: the discovery owned-bridge
  // calls buildStreams with it set, the library path does not. A shared key let
  // whichever request arrived first answer BOTH: bridge-limited results were
  // served to library requests (missing TMDB-fallback sources) and a bridge
  // "miss" planted a miss-cache entry that blanked the library path too.
  const requestKey = `${userKey}:${type}:${tmdbId}:${season ?? ''}:${episode ?? ''}:${lang || ''}:${opts.skipTmdbFallback ? 'bridge' : 'full'}:${customStreamsFingerprint(customStreams)}:${opts.imdbId || ''}:${opts.lazyLinks ? 'lazy' : 'eager'}`;
  const existing = streamBuildInFlight.get(requestKey);
  if (existing) return existing;
  const pending = buildStreamsInner(config, tmdbApiKey, type, tmdbId, season, episode, lang, customStreams, userKey, opts);
  streamBuildInFlight.set(requestKey, pending);
  try { return await pending; } finally { streamBuildInFlight.delete(requestKey); }
}

function langScore(n = '', langCode = 'pt') {
  const u = n.toUpperCase();
  if (langCode === 'pt') {
    if (u.match(/\bDUAL\b|\bDUBLADO\b|\bNACIONAL\b/)) return 3;
    if (u.match(/\bPT.?BR\b|\bPT.?PT\b/))              return 2;
    if (u.match(/\bLEGENDADO\b|\bPLSUB\b/))            return 1;
  }
  if (langCode === 'en' && u.match(/\bENGLISH\b|\bENG\b/)) return 2;
  return 0;
}

function qualityScore(n = '') {
  const u = n.toUpperCase();
  if (u.match(/\b(2160P|4K|UHD)\b/)) return 4;
  if (u.match(/\b1080P\b/))           return 3;
  if (u.match(/\b720P\b/))            return 2;
  if (u.match(/\b480P\b/))            return 1;
  return 0;
}

// ── Unicode small caps ────────────────────────────────────────────────────
const SMALL_CAPS_MAP = {
  a:'ᴀ', b:'ʙ', c:'ᴄ', d:'ᴅ', e:'ᴇ', f:'ғ', g:'ɢ', h:'ʜ',
  i:'ɪ', j:'ᴊ', k:'ᴋ', l:'ʟ', m:'ᴍ', n:'ɴ', o:'ᴏ', p:'ᴘ',
  r:'ʀ', s:'s', t:'ᴛ', u:'ᴜ', v:'ᴠ', w:'ᴡ', y:'ʏ', z:'ᴢ',
};
function toSmallCaps(str = '') {
  return str.toLowerCase().split('').map(c => SMALL_CAPS_MAP[c] || c).join('');
}

// ── Brazilian release groups (flag 🇧🇷) ──────────────────────────────
const BR_GROUP_RE = /^(bioma|c76|franceira|sigla|sf|tossato|sh4down|7sprit7|pia|riper|tomtom|andrehsa|fly|cza)$/i;

// ── Extractors ────────────────────────────────────────────────────────────

function extractQuality(n = '') {
  const u = n.toUpperCase();
  if (u.match(/\b(2160P|4K|UHD)\b/)) return '4K';
  if (u.match(/\b1080P\b/))           return '1080p';
  if (u.match(/\b720P\b/))            return '720p';
  if (u.match(/\b576P\b/))            return '576p';
  if (u.match(/\b480P\b/))            return '480p';
  return '';
}

/** Returns array of visual tags in AIOStreams style (HDR10+, DV, 10bit…) */
function extractVisualTags(n = '') {
  const u = n.toUpperCase();
  const tags = [];
  if (u.match(/DOLBY.?VISION|\bDV\b/))    tags.push('⭐ ᴅᴠ');
  if (u.match(/HDR10(\+|PLUS)/))           tags.push('💫 ʜᴅʀ¹⁰⁺');
  else if (u.match(/\bHDR10\b/))           tags.push('🌟 ʜᴅʀ¹⁰');
  else if (u.match(/\bHDR\b/))             tags.push('🌟 ʜᴅʀ');
  if (u.match(/\b10.?BIT\b/))              tags.push('🎨 10ʙɪᴛ');
  return tags;
}

function extractCodec(n = '') {
  const u = n.toUpperCase();
  if (u.match(/\bH\.?265\b|\bHEVC\b|\bX265\b/)) return 'ʜᴇᴠᴄ';
  if (u.match(/\bH\.?264\b|\bAVC\b|\bX264\b/))  return 'ᴀᴠᴄ';
  if (u.match(/\bAV1\b/))                         return 'ᴀᴠ1';
  return '';
}

function extractSource(n = '') {
  const u = n.toUpperCase();
  if (u.match(/\bBLURAY\b|\bBLU.RAY\b|\bBDRIP\b/)) return 'BluRay';
  if (u.match(/\bWEB.DL\b|\bWEBDL\b/))              return 'WEB-DL';
  if (u.match(/\bWEBRIP\b|\bWEB.RIP\b/))            return 'WEBRip';
  if (u.match(/\bHDTV\b/))                           return 'HDTV';
  if (u.match(/\bDVDRIP\b/))                         return 'DVDRip';
  return '';
}

function extractAudio(n = '') {
  const u = n.toUpperCase();
  const parts = [];
  if      (u.match(/\bDUAL\b|\bDUBLADO\b/))      parts.push('Dublado');
  else if (u.match(/\bNACIONAL\b|\bPT.?BR\b/))    parts.push('PT-BR');
  else if (u.match(/\bPT.?PT\b/))                 parts.push('PT-PT');
  else if (u.match(/\bLEGENDADO\b/))              parts.push('Leg.');
  else if (u.match(/\bENG(LISH)?\b/))             parts.push('EN');
  // Audio codec: TrueHD + Atmos can coexist
  if (u.match(/\bTRUEHD\b/))                      parts.push('TrueHD');
  if (u.match(/\bATMOS\b/))                        parts.push('Atmos');
  else if (!u.match(/\bTRUEHD\b/)) {
    if      (u.match(/\bDTS.?HD\b/))              parts.push('DTS-HD');
    else if (u.match(/\bDTS\b/))                  parts.push('DTS');
    else if (u.match(/\bDDP?5\.?1\b|\bDD5\.?1\b/)) parts.push('DD5.1');
    else if (u.match(/\bAAC\b/))                  parts.push('AAC');
  }
  return parts.join(' · ');
}

function extractSubs(n = '') {
  const u = n.toUpperCase();
  if (u.match(/\bMULTI.?SUB\b/))                         return 'Multi';
  if (u.match(/\bPLSUB\b/))                              return 'PT';
  if (u.match(/\bLEGENDADO\b/) && !u.match(/\bDUAL\b/)) return 'PT-BR';
  return '';
}

function extractReleaseGroup(n = '') {
  const base = n.replace(/\.(mkv|mp4|avi|mov|ts|wmv|m4v|webm)$/i, '');
  const m = base.match(/-([A-Za-z0-9]{2,12})$/);
  return m ? m[1] : '';
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1024 / 1024 / 1024;
  return gb >= 1
    ? `${gb.toFixed(2)} ɢʙ`
    : `${(bytes / 1024 / 1024).toFixed(0)} ᴍʙ`;
}

// ── Main formatters ───────────────────────────────────────────────────────

/**
 * Stream title line (`name` field).
 * Format inspired by AIOStreams:
 *   Line 1 → provider + ⚡ cached indicator
 *   Line 2 → resolution · source
 *   Line 3 → visual tags (HDR / DV / 10bit): only if present
 */
// Resolve the effective name/description templates for a config. Saved
// templates only apply to the Custom style (or an old config with no known
// preset): a named preset always uses its own templates, so switching from
// Custom back to "LeLibrary" can never keep showing the old custom style.
function usesCustomTemplates(config = {}) {
  return config.streamPreset === 'custom' || !(formatter.presets && formatter.presets[config.streamPreset]);
}

function streamTemplates(config = {}) {
  const preset = (formatter.presets && formatter.presets[config.streamPreset]) || formatter.presets.lelibrary;
  const custom = usesCustomTemplates(config);
  return {
    name: (custom && config.streamNameTemplate) || preset.name,
    description: (custom && config.streamDescTemplate) || preset.description,
  };
}

function formatStreamName(filename = '', source = '', size, config = {}, addonName, opts = {}) {
  const t = streamTemplates(config);
  return formatter.formatStream(t.name, t.description, filename, source, size, { addonName, ...opts }).name;
}

/**
 * Detailed stream description (`description` field).
 * Format inspired by AIOStreams:
 *   Line 1 → size  codec
 *   Line 2 → audio  subtitles
 *   Line 3 → group (with 🇧🇷 if Brazilian group)
 *   Line 4 → filename in smallcaps
 */
function formatStreamDesc(filename = '', size, source, config = {}, addonName, opts = {}) {
  const t = streamTemplates(config);
  return formatter.formatStream(t.name, t.description, filename, source, size, { addonName, ...opts }).description;
}

// Reformat an external addon stream (Torrentio/Comet/Meteor/MediaFusion) with
// the user's chosen format preset, using the raw filename the addon provides.
// The source addon's name is shown in the badge/label (read from the stream's
// `_sourceAddon` tag) so the user can tell WHERE a stream came from while
// keeping the same chosen formatting. Streams without a usable filename are
// returned untouched (nothing to parse).
function reformatExternalStream(stream, source = 'torbox', config = {}) {
  const fn = stream && stream.behaviorHints && stream.behaviorHints.filename;
  if (!fn) return stream;
  const size = Number(stream.behaviorHints && stream.behaviorHints.videoSize) || 0;
  const addonName = (stream && stream._sourceAddon) || 'LeLibrary';
  // The badge reflects the user's DEBRID PROVIDER (`source`, e.g. "[TB]" for
  // TorBox), matching how owned streams are labelled: so every stream shows
  // the same [TB]/[RD]/[AD]/[PM] badge regardless of which addon supplied it.
  // The addon's NAME still appears next to it (e.g. "[TB] Comet").
  const src = stream?._debridProviderId || source;
  const isOwned = stream && stream._owned === true;
  return {
    ...stream,
    _sourceAddon: undefined,
    _sourceAddonId: undefined,
    _debridProviderId: undefined,
    name: formatStreamName(fn, src, size, config, addonName, { library: isOwned }),
    description: formatStreamDesc(fn, size, src, config, addonName, { library: isOwned }),
  };
}

// ── Stream notices ────────────────────────────────────────────────────────
// Non-clickable informational rows served through the normal stream list:
//   • "No streams available" fallback when nothing was found: clients
//     (Nuvio/Stremio) only show their own "tried addons, none returned"
//     error when EVERY addon returns an empty list, so always answering with
//     at least one row replaces that ugly failure with a friendly message.
//   • "Not released digitally yet" notice above the streams for films TMDB
//     marks as having no past digital release window (explains CAM-quality /
//     missing sources). Movies only: episodes don't have digital windows.
// Rows carry no url/infoHash/ytId so no client can try to play them, and
// autoplay skips them (Nuvio's isPlayable() requires a playable source).
// Toggle: config.streamNotices ('on' default when absent, 'off' disables).
const NOTICE_DAYS_UNTIL_STALE = 120; // theatrical releases older than this without a digital date are just old films, not unreleased

function streamNoticesEnabled(config = {}) {
  return config.streamNotices !== 'off';
}

// Per-type notice toggles. `streamNoticeTypes` is an optional array of enabled
// kinds ('none', 'rateLimit', 'digitalRelease'); absent/empty means all enabled
// (so existing configs keep working). The master streamNotices toggle still
// disables everything.
const NOTICE_KINDS = ['none', 'rateLimit', 'digitalRelease'];
function noticeKindEnabled(config = {}, kind) {
  if (!streamNoticesEnabled(config)) return false;
  const t = config.streamNoticeTypes;
  if (Array.isArray(t) && t.length) return t.includes(kind);
  if (typeof t === 'string' && t.trim()) return t.split(',').map(s => s.trim()).includes(kind);
  return true;
}

function makeNoticeRow(name, description) {
  // Nuvio filters stream DTOs with an empty URL before rendering them. A
  // harmless local 204 endpoint makes an informational row visible without
  // exposing a media source; the `_notice` marker still keeps it out of our
  // real-stream/cache accounting.
  const origin = String(process.env.BASE_URL || 'https://lelibrary.uk').replace(/\/+$/, '');
  return { name, description, url: `${origin}/stream-notice`, behaviorHints: { notWebReady: false }, _notice: true };
}

function makeProviderRateLimitNotice({ label = 'Debrid provider', retryAfterSec = 60 } = {}) {
  const minutes = Math.max(1, Math.ceil(Number(retryAfterSec || 0) / 60));
  return {
    ...makeNoticeRow(
      `⏳ ${label} is temporarily rate-limiting playback`,
      `Try again in approximately ${minutes} minute${minutes === 1 ? '' : 's'}.`
    ),
    _transientNotice: true,
  };
}

async function applyStreamNotices(streams, { config = {}, tmdbApiKey, tmdbId, type } = {}) {
  if (!streamNoticesEnabled(config)) return streams;
  const isMovie = type === 'movie';
  let digitalInfo = null;
  if (isMovie && tmdbApiKey && tmdbId) {
    try { digitalInfo = await getMovieReleaseInfo(tmdbApiKey, tmdbId); } catch {}
  }
  let notDigitalYet = false;
  let digitalNote = '';
  if (isMovie && digitalInfo) {
    const now = Date.now();
    const digitalTs = digitalInfo.digitalDate ? Date.parse(digitalInfo.digitalDate) : null;
    const theatricalTs = digitalInfo.releaseDate ? Date.parse(digitalInfo.releaseDate) : null;
    if (digitalTs !== null) {
      if (digitalTs > now) {
        notDigitalYet = true;
        digitalNote = ` Digital release: ${new Date(digitalTs).toISOString().slice(0, 10)}.`;
      }
    } else if (theatricalTs !== null && !Number.isNaN(theatricalTs)) {
      // No digital window on TMDB: future and recent theatrical releases are
      // both awaiting a digital date. Older titles are simply old films.
      const daysSince = (now - theatricalTs) / 86400000;
      if (daysSince < NOTICE_DAYS_UNTIL_STALE) {
        notDigitalYet = true;
      }
    }
  }

  const list = Array.isArray(streams) ? streams : [];
  if (list.length === 0) {
    // "No streams found" is the notice most people turn off.
    if (!noticeKindEnabled(config, 'none')) return [];
    return [makeNoticeRow(
      'ℹ️ No streams found',
      isMovie && notDigitalYet
        ? `This film has limited sources as it has not been released digitally yet.${digitalNote}`
        : 'LeLibrary and your stream addons found nothing for this title.'
    )];
  }
  if (isMovie && notDigitalYet && noticeKindEnabled(config, 'digitalRelease')) {
    return [
      makeNoticeRow('ℹ️ Digital release not found', `TMDB has no digital release listed for this film yet, so sources may be limited.${digitalNote}`),
      ...list,
    ];
  }
  return list;
}

export interface BuilderApi {
  ownedStreamHints: typeof ownedStreamHints;
  wholeItemFileId: typeof wholeItemFileId;
  buildCatalog: any;
  buildMeta: any;
  buildStreams: any;
  PLAY_PREFIX: any;
  playRef: any;
  getRealDebridDownloads: any;
  getOmdbRatings: any;
  populateTmdbIndexFromMetas: any;
  formatStreamName: any;
  formatStreamDesc: any;
  reformatExternalStream: any;
  enhanceMeta: any;
  buildErdbUrl: any;
  erdbProxyUrl: any;
  buildRpdbUrl: any;
  buildBetterPosterUrl: any;
  buildPictoriumPosterUrl: any;
  getFanartArt: any;
  applyStreamNotices: any;
  streamNoticesEnabled: any;
  noticeKindEnabled: any;
  NOTICE_KINDS: any;
  makeProviderRateLimitNotice: any;
  libraryStreamFmtFp: any;
  buildMatchMeta: any;
  publishMatchEntry: any;
  remapSplitSeason: any;
  resolveSplitTarget: any;
  canonicalSource: any;
  SPLIT_SHOW_SEASON_REMAP: any;
  summarizePackEpisodes: any;
  shouldProbeEpisodeNamedPack: any;
  addOwnedEpisodeAvailability: any;
  addOwnedAirDates: any;
  ownedDateKey: any;
  mergePackEpisodeRange: any;
  embeddedPackEntry: any;
  probePackEpisodes: any;
  isEpisodePackMisreadAsMovie: any;
  episodeTitleMatches: any;
  episodeFileInfo: any;
  flushMatchCache: any;
  matchItem: any;
}

module.exports = { PLAY_PREFIX, playRef, ownedStreamHints, wholeItemFileId, buildCatalog, buildMeta, buildStreams, getRealDebridDownloads, getOmdbRatings, populateTmdbIndexFromMetas, formatStreamName, formatStreamDesc, reformatExternalStream, enhanceMeta, buildErdbUrl, erdbProxyUrl, buildRpdbUrl, buildBetterPosterUrl, buildPictoriumPosterUrl, getFanartArt, applyStreamNotices, streamNoticesEnabled, noticeKindEnabled, NOTICE_KINDS, makeProviderRateLimitNotice, libraryStreamFmtFp, buildMatchMeta, publishMatchEntry, remapSplitSeason, resolveSplitTarget, canonicalSource, SPLIT_SHOW_SEASON_REMAP, summarizePackEpisodes, shouldProbeEpisodeNamedPack, addOwnedEpisodeAvailability, addOwnedAirDates, ownedDateKey, mergePackEpisodeRange, embeddedPackEntry, probePackEpisodes, isEpisodePackMisreadAsMovie, episodeTitleMatches, episodeFileInfo, flushMatchCache, matchItem } satisfies BuilderApi;
