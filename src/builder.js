const fs   = require('fs');
const axios = require('axios');
const { getTorBoxDownloads, getTorBoxStreamLink, getTorBoxFiles, isVideoFile, isJunkVideo } = require('./torbox');
const { getRealDebridDownloads, getRealDebridFiles, getRealDebridStreamLink } = require('./realdebrid');
const providers = require('./providers');
const cache = require('./cache');
const { searchMetadata, searchCandidates, getMetadata, findEpisodeByAirDate, getSeasonEpisodeCounts, getImdbId, getMovieReleaseInfo } = require('./tmdb');
const { guessMediaInfo } = require('./parser');
const NodeCache = require('node-cache');
// AIOStreams-compatible stream formatter engine (works in Node + browser).
const formatter = require('../website/public/formatter.js');

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

const matchCache = {
  async get(key) {
    const mem = memMatchCache.get(key);
    if (mem !== undefined) return mem;
    try {
      const redisKey = MATCH_REDIS_PREFIX + key;
      if (await cache.exists(redisKey)) {
        const val = await cache.get(redisKey);
        memMatchCache.set(key, val, MATCH_CACHE_TTL);
        return val;
      }
    } catch (err) { /* Redis blip: treat as miss */ }
    return undefined;
  },
  async set(key, value, ttl = MATCH_CACHE_TTL) {
    const toStore = stripTorboxItem(value);
    memMatchCache.set(key, toStore, ttl);
    try {
      await cache.set(MATCH_REDIS_PREFIX + key, toStore, ttl);
    } catch (err) { /* non-fatal: the in-memory copy still works */ }
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

function loadPersistentCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
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
    }
  } catch (e) { console.error('[Cache] Load error:', e.message); }
}

function savePersistentCache() {
  try {
    const data = {};
    for (const k of memMatchCache.keys()) {
      const v = memMatchCache.get(k);
      if (v !== undefined) data[k] = v;
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
  } catch (e) { console.error('[Cache] Save error:', e.message); }
}

loadPersistentCache();
setInterval(savePersistentCache, 60_000).unref?.();

const omdbCache    = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
// Per-user index: `${userKey}:series:12345` → [{item, season, episode}].
// Keyed by user so one user's downloads never leak into another user's
// seasons/episodes/streams.
const tmdbindex = new Map();

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
      episode: meta.episode,
      episodeEnd: meta.episodeEnd ?? null,
    };
    if (!tmdbindex.has(indexKey)) {
      tmdbindex.set(indexKey, [entry]);
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

async function getFanartArt(apiKey, tmdbId, type) {
  if (!apiKey || !tmdbId) return null;
  const endpoint = type === 'movie' ? `/movies/${tmdbId}` : `/tv/${tmdbId}`;
  const cacheKey = `fanart:${type}:${tmdbId}`;
  const cached = omdbCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const res = await axios.get(`https://webservice.fanart.tv/v3${endpoint}`, { params: { api_key: apiKey }, timeout: 8000 });
    const art = {
      poster: res.data.movieposter?.[0]?.url || res.data.tvposter?.[0]?.url || null,
      background: res.data.moviebackground?.[0]?.url || res.data.showbackground?.[0]?.url || null,
      logo: res.data.hdmovieclearart?.[0]?.url || res.data.hdtvlogo?.[0]?.url || null,
    };
    omdbCache.set(cacheKey, art);
    return art;
  } catch {
    omdbCache.set(cacheKey, null);
    return null;
  }
}

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

async function matchItem(item, tmdbApiKey, type, lang) {
  const name     = item.name || item.filename || '';
  if (isJunkVideo(name)) return null;
  const tmdbType = type === 'movie' ? 'movie' : 'series';
  const cacheKey = `match:${type}:${lang}:${name}`;

  const cached = await matchCache.get(cacheKey);
  // A cached null is a proven negative (stored with NULL_MATCH_TTL): honour it
  // instead of re-running the parse+search on every request. The entry expires
  // quickly so TMDB-side changes get picked up.
  if (cached === null) return null;
  if (cached !== undefined) {
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
    // Never reuse another user's torrent item: attach the caller's item.
    return { ...cached, torboxItem: item };
  }

  const info = guessMediaInfo(name);
  if (!info) { await matchCache.set(cacheKey, null, NULL_MATCH_TTL); return null; }

  // Simplified type validation
  if (type === 'movie' && info.isSeries) { await matchCache.set(cacheKey, null, NULL_MATCH_TTL); return null; }
  if (type === 'series' && (!info.isSeries || info.isAnime)) { await matchCache.set(cacheKey, null, NULL_MATCH_TTL); return null; }
  if (type === 'anime' && !info.isSeries) { await matchCache.set(cacheKey, null, NULL_MATCH_TTL); return null; }

  try {
    let season     = info.season;
    let episode    = info.episode;
    let episodeEnd = info.episodeEnd ?? null;

    let result;
    if (info.airDate || (info.airDates && info.airDates.length)) {
      const dates = (info.airDates && info.airDates.length) ? info.airDates : [info.airDate];
      const candidates = await searchCandidates(tmdbApiKey, info.title, 'tv', undefined, lang);
      const verified = [];
      for (const c of candidates) {
        for (const d of dates) {
          const resolved = await findEpisodeByAirDate(tmdbApiKey, c.id, d, lang);
          if (resolved) { verified.push({ result: c, resolved }); break; }
        }
      }
      if (verified.length > 0) {
        verified.sort((a, b) => (b.result.vote_count || 0) - (a.result.vote_count || 0));
        const pick = verified[0];
        result = pick.result;
        season = pick.resolved.season;
        episode = pick.resolved.episode;
        episodeEnd = null;
      } else {
        result = candidates[0] || null;
      }
    } else {
      // Year from filename helps disambiguate remakes/reboots with identical titles
      // (e.g. "Ann Droid" 2020 vs 2026, "Good Boy" 2025 vs 2026). For movies the
      // year is also sent to TMDB as a filter; for series we keep it local-only
      // (yearBonus in pickBestResult) so long-running shows like WWE Raw (1993)
      // with a 2026 episode date aren't filtered out at the API level.
      const yearParam = info.year;
      result = await searchMetadata(tmdbApiKey, info.title, tmdbType, yearParam, lang);
    }
    if (!result) { await matchCache.set(cacheKey, null, NULL_MATCH_TTL); return null; }

    const isAnime = isTmdbAnime(result);

    if (type === 'series' && (isAnime || info.isAnime)) {
      console.log(`[TMDB] "${info.title}" is anime: excluded from series`);
      await matchCache.set(cacheKey, null, NULL_MATCH_TTL);
      return null;
    }

    if (type === 'anime' && !isAnime && !info.isAnime) {
      await matchCache.set(cacheKey, null, NULL_MATCH_TTL);
      return null;
    }

    console.log(`[TMDB] "${info.title}" → "${result.title || result.name}" (${result.id}) anime=${isAnime}`);

    const stremioType = type === 'anime' ? 'series' : type;

    const meta = {
      id:                   `torbox:${stremioType}:${result.id}`,
      type:                 stremioType,
      name:                 result.title || result.name,
      poster:               result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : null,
      releaseInfo:          (result.release_date || result.first_air_date || '').split('-')[0],
      released:             result.release_date || result.first_air_date,
      tmdbId:               result.id,
      catalogType:          type,
      isJapaneseAnimation:  isAnime,
      torboxItem:           item,
      season,
      episode,
      episodeEnd,
    };

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

  const allRelevant = [];
  for (const item of downloads) {
    const name = item.name || item.filename || '';
    if (isJunkVideo(name)) continue;
    const info = guessMediaInfo(name);
    if (!info) continue;
    if (type === 'movie'  && (info.isSeries || info.isAnime))  continue;
    if (type === 'series' && (!info.isSeries || info.isAnime)) continue;
    if (type === 'anime'  && !info.isSeries)                   continue; // anime uses SxxExx or custom format
    // "Hide anime" must strip anime from the movie/series catalogs too,
    // not just remove the anime catalog from the manifest.
    if (hideAnime && type !== 'anime' && info.isAnime) continue;
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
    for (const { item, info } of allRelevant) {
      const name   = item.name || item.filename || '';
      const ck     = `match:${type}:${lang}:${name}`;
      // Treat null-cached (failed) entries as needing retry: only count
      // non-null cache hits as truly cached.  This prevents a transient TMDB
      // failure from locking an item out for the full 24h cache TTL.
      const cv = await matchCache.get(ck);
      if (cv !== undefined && cv !== null) cached.push({ item, info });
      else fresh.push({ item, info });
    }
    freshCount = fresh.length;
    console.log(`[Catalog] Progressive: ${cached.length} cached, ${fresh.length} to match in background`);
    // Only fast-return a partial when the majority is already matched.
    // A cold or near-cold cache (few cached) would return a near-empty page -
    // worse than blocking for the full build, so fall back to the full build.
    if (cached.length === 0 || cached.length < fresh.length) {
      tasks = allRelevant.map(({ item }) => () => matchItem(item, tmdbApiKey, type, lang));
    } else {
      tasks = cached.map(({ item }) => () => matchItem(item, tmdbApiKey, type, lang));
      if (fresh.length > 0) {
        completion = pLimit(fresh.map(({ item }) => () => matchItem(item, tmdbApiKey, type, lang)), BATCH_SIZE);
      }
    }
  } else {
    tasks = allRelevant.map(({ item }) => () => matchItem(item, tmdbApiKey, type, lang));
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
  if (freshMatchCount > 0 && userKey) {
    await cache.delPattern(`cat:*${userKey}*`).catch(() => {});
    await cache.delPattern(`meta:*${userKey}*`).catch(() => {});
    await cache.delPattern(`stream:*${userKey}*`).catch(() => {});
    console.log(`[Catalog] ${freshMatchCount} new match(es) → invalidated catalog/meta/stream caches for ${userKey}`);
  }
  // Progressive background matches complete after the response: invalidate once
  // they land too, so episodes matched off-page show up without a manual refresh.
  if (completion) {
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
    const entry    = { item: meta.torboxItem, season: meta.season, episode: meta.episode, episodeEnd: meta.episodeEnd ?? null };

    if (!tmdbindex.has(indexKey)) {
      tmdbindex.set(indexKey, [entry]);
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
    await pLimit(paginated.map(m => async () => {
      if (!m || !m.tmdbId) return;
      const apiType = m.catalogType === 'series' ? 'tv' : 'movie';
      const imdbId = await getImdbId(tmdbApiKey, apiType, m.tmdbId).catch(() => null);
      if (imdbId) m.id = imdbId; // plain tt{imdbId}, same shape as discovery rows
      else m._drop = true;
    }), 6);
  }

  const { erdbToken, rpdbKey } = enhance;
  if (erdbToken || rpdbKey) {
    for (const m of paginated) {
      const t = m.catalogType === 'series' ? 'tv' : 'movie';
      if (erdbToken && m.tmdbId) {
        m.poster = buildErdbUrl(erdbToken, 'poster', `tmdb:${t}:${m.tmdbId}`);
      } else if (rpdbKey && m.tmdbId) {
        m.poster = buildRpdbUrl(rpdbKey, 'tmdb', 'poster-default', `${t}-${m.tmdbId}`);
      }
    }
  }

  // Filter BEFORE destructuring: the map used to strip `_drop` from the row,
  // so `!m._drop` was always true and tt-mode rows without an IMDb id were
  // never dropped as documented.
  const output = paginated
    .filter(m => m.poster && !m._drop)
    .map(({ torboxItem, torboxItems, tmdbId, released, catalogType, isJapaneseAnimation, season, episode, _drop, _freshMatch, ...rest }) => rest);

  if (completion) return { metas: output, completion, _fresh: freshCount };
  return output;
}

async function buildMeta(tmdbId, type, tmdbApiKey, lang, config = {}, enhance = {}, userKey = '', filterOwnedEpisodes = true) {
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
  const [meta, downloads] = await Promise.all([
    getMetadata(tmdbApiKey, tmdbId, tmdbType, lang, { discovery: !filterOwnedEpisodes }),
    (needsOwnedPass && !existingEntries?.length) ? providers.fetchDownloads(config) : Promise.resolve([]),
  ]);

  if (!meta) return meta;

  try {
    if (!needsOwnedPass) {
      // Movies skip the episode-availability pass (nothing to filter), and
      // discovery (tt:) series keep their full TMDB episode list: but both
      // still fall through to the poster/rating enhancement below.
    } else {
    const availableEps = new Set();
    const indexEntries = [];

    // If tmdbindex already has entries for this title (populated by catalog), use directly
    if (existingEntries?.length > 0) {
      for (const { item, season, episode, episodeEnd } of existingEntries) {
        indexEntries.push({ item, season, episode, episodeEnd });
        if (episode != null && season != null) {
          const epFrom = parseInt(episode, 10);
          const epTo   = episodeEnd != null ? parseInt(episodeEnd, 10) : epFrom;
          for (let ep = epFrom; ep <= epTo; ep++) availableEps.add(`${season}:${ep}`);
        } else if (season != null) {
          availableEps.add(`season:${season}`);
        } else {
          availableEps.add('all');
        }
      }
    } else {
      // Index not populated: full match, but in parallel per unique title
      const titleCache = new Map();
      const toSearch   = [];

      for (const item of downloads) {
        const name = item.name || item.filename || '';
        const info = guessMediaInfo(name);
        if (!info || !info.isSeries) continue;

        let matched = false;
        let cachedMeta = null;

        for (const t of ['anime', 'series']) {
          for (const l of [lang, 'en-US', 'pt-BR']) {
            const c = await matchCache.get(`match:${t}:${l}:${name}`);
            if (c && String(c.tmdbId) === String(tmdbId)) {
              matched = true; cachedMeta = c; break;
            }
          }
          if (matched) break;
        }

        if (!matched) {
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
        const matched = cachedMeta != null
          || (info.airDate
            ? (titleCache.get(tk) || []).some(id => String(id) === String(tmdbId))
            : (tk && titleCache.get(tk) === String(tmdbId)));
        if (!matched) continue;

        let season     = cachedMeta?.season     ?? info.season;
        let episode    = cachedMeta?.episode    ?? info.episode;
        let episodeEnd = cachedMeta?.episodeEnd ?? info.episodeEnd;
        if ((info.airDate || (info.airDates && info.airDates.length)) && episode == null) {
          const dates = (info.airDates && info.airDates.length) ? info.airDates : [info.airDate];
          for (const d of dates) {
            const resolved = await findEpisodeByAirDate(tmdbApiKey, tmdbId, d, lang);
            if (resolved) { season = resolved.season; episode = resolved.episode; episodeEnd = null; break; }
          }
        }

        indexEntries.push({ item, season, episode, episodeEnd });

        if (episode != null && season != null) {
          const epFrom = parseInt(episode, 10);
          const epTo   = episodeEnd != null ? parseInt(episodeEnd, 10) : epFrom;
          for (let ep = epFrom; ep <= epTo; ep++) availableEps.add(`${season}:${ep}`);
        } else if (season != null) {
          availableEps.add(`season:${season}`);
        } else {
          availableEps.add('all');
        }
      }
    }

    if (indexEntries.length > 0) {
      tmdbindex.set(indexKey, indexEntries);
      console.log(`[Meta] Index updated: ${indexKey} → ${indexEntries.length} items`);
    }

    if (availableEps.size > 0) {
      const totalBefore = meta.videos?.length || 0;
      meta.videos = (meta.videos || []).filter(v =>
        availableEps.has(`${v.season}:${v.episode}`) ||
        availableEps.has(`season:${v.season}`) ||
        availableEps.has('all')
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
  const { erdbToken, rpdbKey, omdbKey, fanartKey, posterProvider, enhanceBackground, enhanceLogo } = enhance;
  const imdbId = meta.imdbId;

  if (erdbToken && imdbId) {
    meta.poster = buildErdbUrl(erdbToken, 'poster', imdbId);
    if (enhanceBackground) meta.background = buildErdbUrl(erdbToken, 'backdrop', imdbId);
    if (enhanceLogo) meta.logo = buildErdbUrl(erdbToken, 'logo', imdbId);
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

async function buildStreamsInner(config = {}, tmdbApiKey, type, tmdbId, season, episode, lang, customStreams, userKey = '', opts = {}) {
  // Miss cache is scoped per mode (bridge vs full) for the same reason as the
  // requestKey in buildStreams: a discovery-bridge miss must not blind the
  // library path, which would have run its own TMDB fallback.
  const streamMissKey = `${userKey}:${type}:${tmdbId}:${season ?? ''}:${episode ?? ''}:${opts.skipTmdbFallback ? 'bridge' : 'full'}`;
  if (streamMissCache.get(streamMissKey)) return [];
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
    const downloads = await providers.fetchDownloads(config);

    // Candidate namespaces are constrained by the requested type: TMDB movie
    // and TV ids are INDEPENDENT sequences, so scanning the movie bucket for
    // a series tmdbId pulled unrelated films in as "full pack" matches.
    // (series+anime stay merged deliberately: shows live in both buckets.)
    // All cache lookups for one file run in parallel, and files are processed
    // 20 at a time: the old triple-nested loop did up to 9 SEQUENTIAL gets
    // per download on every cold rebuild.
    const typeScanOrder   = type === 'movie' ? ['movie'] : (type === 'anime' ? ['anime', 'series'] : ['series', 'anime']);
    const langsToTry      = [...new Set([lang || 'en-US', 'en-US', 'pt-BR'])];
    const candidateKeysFor = (name) => typeScanOrder.flatMap(t => langsToTry.map(l => `match:${t}:${l}:${name}`));

    await pLimit((downloads || []).map(item => async () => {
      const name = item.name || item.filename || '';
      if (!name) return;
      const keys = candidateKeysFor(name);
      const vals = await Promise.all(keys.map(k => matchCache.get(k)));
      const hitIdx = vals.findIndex(c => c && String(c.tmdbId) === String(tmdbId));
      if (hitIdx >= 0) {
        const c = vals[hitIdx];
        entries.push({ item, season: c.season, episode: c.episode, episodeEnd: c.episodeEnd ?? null });
      }
    }), 20);

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
              entries.push({ item, season: resolved?.season ?? null, episode: resolved?.episode ?? null, episodeEnd: null });
            }
            return;
          }
          const yearParam2 = tmdbType === 'movie' ? info.year : undefined;
          const result = await searchMetadata(tmdbApiKey, info.title, tmdbType, yearParam2, lang);
          if (result && String(result.id) === String(tmdbId)) {
            entries.push({ item, season: info.season, episode: info.episode, episodeEnd: info.episodeEnd ?? null });
          }
        } catch {}
      });
      await pLimit(candidateTasks, 6);
    }

    if (entries.length > 0) {
      const saveKey = `${userKey}:${type === 'movie' ? 'movie' : 'series'}:${tmdbId}`;
      tmdbindex.set(saveKey, entries);
      console.log(`[Stream] Index saved: ${saveKey} → ${entries.length} items`);
    }
  }

  if (!entries || entries.length === 0) {
    console.log(`[Stream] No items found`);
    streamMissCache.set(streamMissKey, true);
    return [];
  }

  console.log(`[Stream] Filtering ${entries.length} items`);

  let filtered;
  if (type === 'series' || type === 'anime') {
    const strict = entries.filter(({ season: s, episode: e, episodeEnd: eEnd }) => {
      // If season doesn't match, reject
      if (season != null && season !== '' && s != null && String(s) !== String(season)) return false;
      
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
      const epOnly = (episode != null && episode !== '')
        ? entries.filter(({ episode: e, episodeEnd: eEnd }) => {
            if (e == null) return false;
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
        // Last resort: match by season only (never return every entry across
        // all seasons: that was serving the wrong seasons/episodes).
        filtered = season != null && season !== ''
          ? entries.filter(({ season: s }) => s != null && String(s) === String(season))
          : [];
        console.log(`[Stream] Fallback season-only: ${filtered.length} entries`);
      }

      // Anime absolute numbering: files like "One Piece - 101" parse as
      // { season: null, episode: 101 }, which matched NO filter above: an
      // owned anime episode ended up with zero streams. Map the requested
      // season/episode to a global episode number via TMDB's season sizes
      // and match absolute-numbered entries against it.
      if (filtered.length === 0 && type === 'anime' && season != null && season !== '' && episode != null && episode !== '') {
        try {
          const counts = await getSeasonEpisodeCounts(tmdbApiKey, tmdbId, lang || 'en-US');
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
    }
  } else {
    filtered = entries;
  }
  
  console.log(`[Stream] ${filtered.length} item(s) filtered | s=${season} e=${episode}`);

  const rawStreams = [];
  await Promise.all(filtered.map(async ({ item }) => {
    const getFiles = () => providers.getFiles(config, item);
    const getLink  = (fileId) => providers.getStreamLink(config, item, fileId);

    const files      = await getFiles();
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
        const fname = f.name || f.short_name || '';
        const info  = guessMediaInfo(fname);
        if (!info || info.episode == null) return false;
        const epReq  = parseInt(episode, 10);
        const epFrom = parseInt(info.episode, 10);
        const epTo   = (info.episodeEnd != null) ? parseInt(info.episodeEnd, 10) : epFrom;
        return epReq >= epFrom && epReq <= epTo;
      });
      if (byEp.length > 0) {
        targetFiles = byEp;
      } else {
        targetFiles = [];
        console.log(`[Stream] No file matches s=${season} e=${episode} → no streams`);
      }
    }

    const bingeKey = item.source + ':' + item.id;

    if (targetFiles.length > 0) {
      for (const file of targetFiles) {
        try {
          const url = await getLink(file.id);
          if (!url) continue;
          const fname = file.name || file.short_name || item.name || '';
          rawStreams.push({ url, fname, size: file.size || 0, source: item.source, bingeKey });
        } catch {}
      }
    } else if (videoFiles.length === 1 || (videoFiles.length === 0 && files.length === 0 && !isJunkVideo(item.name || ''))) {
      // Single-file torrent (or unparseable filenames): serve the whole item.
      // When the requested episode didn't match inside a multi-file torrent,
      // return nothing instead of playing the wrong file. Never fall back to
      // a Sample/trailer file (videoFiles was emptied above when only junk remained).
      try {
        const url = await getLink(0);
        if (url) rawStreams.push({ url, fname: item.name || '', size: item.size || 0, source: item.source, bingeKey });
      } catch {}
    } else {
      console.log(`[Stream] No matching file for s=${season} e=${episode}: skipping`);
    }
  }));

  const langCode = (lang || 'en-US').split('-')[0].toLowerCase();
  rawStreams.sort((a, b) => {
    const dl = langScore(b.fname, langCode) - langScore(a.fname, langCode);
    if (dl !== 0) return dl;
    const dq = qualityScore(b.fname) - qualityScore(a.fname);
    if (dq !== 0) return dq;
    return b.size - a.size;
  });

  const result = rawStreams.map(({ url, fname, size, source, bingeKey }) => {
    const behaviorHints = { notWebReady: false };
    // Subtitle addons hash-match on the bare filename, not the folder path
    const baseName = (fname || '').split('/').pop();
    if (baseName) behaviorHints.filename = baseName;
    if (bingeKey) behaviorHints.bingeGroup = bingeKey;
    return {
      url,
      name:        formatStreamName(fname, source, size, config, undefined, { library: true }),
      description: formatStreamDesc(fname, size, source, config, undefined, { library: true }),
      size,
      behaviorHints,
    };
  });

  if (customStreams && Array.isArray(customStreams)) {
    for (const cs of customStreams) {
      if (cs.type === type || cs.type === '*') {
        result.push({
          name: cs.name || 'Custom',
          url: cs.url,
          description: cs.description || `🎯 ${cs.name || 'Custom Stream'}`,
          behaviorHints: { notWebReady: true },
        });
      }
    }
  }

  return result;
}

// Fingerprint of the stream FORMAT settings (preset, custom templates and the
// notices toggle). Shared by app.js's meta-route prefetch AND the stream route
// so both compute identical cache keys: they used to drift (the prefetch left
// out streamNotices), which made the prefetch write entries the route could
// never hit whenever notices were configured.
function libraryStreamFmtFp(config = {}) {
  return ':' + hashShort(['notice-v3', config.streamPreset || '', config.streamNameTemplate || '', config.streamDescTemplate || '', config.streamNotices || ''].join('|'));
}

async function buildStreams(config = {}, tmdbApiKey, type, tmdbId, season, episode, lang, customStreams, userKey = '', opts = {}) {
  // Include skipTmdbFallback in the coalescing key: the discovery owned-bridge
  // calls buildStreams with it set, the library path does not. A shared key let
  // whichever request arrived first answer BOTH: bridge-limited results were
  // served to library requests (missing TMDB-fallback sources) and a bridge
  // "miss" planted a miss-cache entry that blanked the library path too.
  const requestKey = `${userKey}:${type}:${tmdbId}:${season ?? ''}:${episode ?? ''}:${lang || ''}:${opts.skipTmdbFallback ? 'bridge' : 'full'}`;
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
// Resolve the effective name/description templates for a config: the chosen
// preset from formatter.js, overridden by any custom templates.
function streamTemplates(config = {}) {
  const preset = (formatter.presets && formatter.presets[config.streamPreset]) || formatter.presets.lelibrary;
  return {
    name: config.streamNameTemplate || preset.name,
    description: config.streamDescTemplate || preset.description,
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
  const src = source;
  const isOwned = stream && stream._owned === true;
  return {
    ...stream,
    _sourceAddon: undefined,
    _sourceAddonId: undefined,
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

function makeNoticeRow(name, description) {
  // Nuvio filters stream DTOs with an empty URL before rendering them. A
  // harmless local 204 endpoint makes an informational row visible without
  // exposing a media source; the `_notice` marker still keeps it out of our
  // real-stream/cache accounting.
  const origin = String(process.env.BASE_URL || 'https://lelibrary.uk').replace(/\/+$/, '');
  return { name, description, url: `${origin}/stream-notice`, behaviorHints: { notWebReady: false }, _notice: true };
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
    return [makeNoticeRow(
      'ℹ️ No streams found',
      isMovie && notDigitalYet
        ? `This film has limited sources as it has not been released digitally yet.${digitalNote}`
        : 'LeLibrary and your stream addons found nothing for this title.'
    )];
  }
  if (isMovie && notDigitalYet) {
    return [
      makeNoticeRow('ℹ️ Digital release not found', `TMDB has no digital release listed for this film yet, so sources may be limited.${digitalNote}`),
      ...list,
    ];
  }
  return list;
}

module.exports = { buildCatalog, buildMeta, buildStreams, getRealDebridDownloads, getOmdbRatings, populateTmdbIndexFromMetas, formatStreamName, formatStreamDesc, reformatExternalStream, enhanceMeta, buildErdbUrl, buildRpdbUrl, buildBetterPosterUrl, getFanartArt, applyStreamNotices, streamNoticesEnabled, libraryStreamFmtFp };
