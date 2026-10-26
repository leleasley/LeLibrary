// @ts-nocheck
const rawAxios = require('axios');
const https = require('https');
const http = require('http');
const { AsyncLocalStorage } = require('node:async_hooks');
const metrics = require('../library/metrics.ts');

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16, keepAliveMsecs: 30000 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16, keepAliveMsecs: 30000 });

const axios = rawAxios.create({
  httpAgent,
  httpsAgent,
});
const matchRequestContext = new AsyncLocalStorage();
axios.interceptors.request.use((config) => {
  let url = String(config.url || '');
  try { url = new URL(url, config.baseURL || TMDB_BASE).hostname; } catch { url = ''; }
  if (url === 'api.themoviedb.org') {
    metrics.add('tmdbHttpRequests');
    const context = matchRequestContext.getStore();
    if (context) context.requests++;
  }
  return config;
});

async function withMatchRequestCounter(fn) {
  const context = { requests: 0 };
  const value = await matchRequestContext.run(context, fn);
  return { value, requests: context.requests };
}
const NodeCache = require('node-cache');
const sharedCache = require('../runtime/cache.ts');
const idMap = require('./id-map.ts');
const titleAliases = require('./title-aliases.ts');
const sceneMap = require('./scene-mapping.ts');

// Canonical title used for a TMDB search. Short-form aliases (e.g. "Raw" ->
// "WWE Raw") and, for release-name matching, the auto-updating Sonarr scene
// mappings turn a release name into the title TMDB actually indexes. Both are
// TV-oriented datasets, so they are never applied to movie searches ("Raw" is
// also a real film). Returns the input unchanged when nothing maps.
function canonicalSearchTitle(title, useScene = false, mediaType = 'tv') {
  if (!title) return title;
  const alias = titleAliases.resolveAlias(title, mediaType);
  if (alias) return alias;
  // Scene mappings come from Sonarr (TV only), so they never apply to movies.
  if (useScene && mediaType !== 'movie') {
    const scene = sceneMap.searchTitleFor(title);
    if (scene) return scene;
  }
  return title;
}

const TMDB_BASE  = 'https://api.themoviedb.org/3';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p';
const TMDB_ADDON_BASE = 'https://tmdb.elfhosted.com';

// useClones:true is REQUIRED on these caches: getMetadata() returns cached
// metas to every user sharing the language, and callers (buildMeta's episode
// filtering, enhanceMeta's poster overrides, saga-link rewriting) mutate the
// result. With shared references one user's mutations bled into everyone
// else's responses for the full 24h TTL.
const tmdbCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600, useClones: true });

const tvDetailCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600, useClones: true });
const seasonCache   = new NodeCache({ stdTTL: 86400, checkperiod: 3600, useClones: true });

// Public TMDB search/discover responses are identical for every user (an API
// key only authenticates), so they are safe to share. Keep them in the
// in-memory cache for hot reads and mirror them into Redis so search stays warm
// across restarts and worker processes. The `{ v }` wrapper lets a cached null
// stay distinguishable from a miss.
// v2: searches no longer send a region (see searchCandidatesUncached).
const SEARCH_REDIS_PREFIX = 'tmdbsearch:v2:';

// Coalesce identical concurrent TMDB requests (e.g. several users opening the
// same brand-new title before its search result is cached). Only search calls
// are coalesced: getMetadata results are mutated per request by the caller, so
// sharing one object there would be unsafe.
const tmdbInFlight = new Map();
function coalesceTmdb(key, fn) {
  const existing = tmdbInFlight.get(key);
  if (existing) return existing;
  const work = Promise.resolve().then(fn).finally(() => tmdbInFlight.delete(key));
  tmdbInFlight.set(key, work);
  return work;
}
async function durableSearchGet(memKey, suffix) {
  const mem = tmdbCache.get(memKey);
  if (mem !== undefined) return mem;
  try {
    const hit = await sharedCache.get(SEARCH_REDIS_PREFIX + suffix);
    if (hit && typeof hit === 'object' && Object.prototype.hasOwnProperty.call(hit, 'v')) {
      tmdbCache.set(memKey, hit.v, hit.ttl || 21600);
      return hit.v;
    }
  } catch { /* treat as miss */ }
  return undefined;
}
function durableSearchSet(memKey, suffix, value, ttl) {
  tmdbCache.set(memKey, value, ttl);
  sharedCache.set(SEARCH_REDIS_PREFIX + suffix, { v: value, ttl }, ttl).catch(() => {});
}

function tmdbAuth(apiKey) {
  if (!apiKey) return { headers: {}, params: {} };
  // TMDB agora aceita apenas Bearer token ou api_key v3
  // Se começa com 'eyJ' é JWT Bearer, senão é api_key v3
  if (apiKey.startsWith('eyJ')) {
    return { headers: { Authorization: `Bearer ${apiKey}` }, params: {} };
  }
  // API key v3 vai como parâmetro
  return { headers: {}, params: { api_key: apiKey } };
}

// Converte IMDB ID → { tmdbId, type }
async function imdbToTmdb(apiKey, imdbId) {
  const auth = tmdbAuth(apiKey);
  try {
    const res = await axios.get(`${TMDB_BASE}/find/${imdbId}`, {
      headers: auth.headers,
      params: { ...auth.params, external_source: 'imdb_id' },
      timeout: 8000,
    });
    const d = res.data;
    if (d.movie_results?.length > 0) return { tmdbId: d.movie_results[0].id, type: 'movie' };
    if (d.tv_results?.length > 0)    return { tmdbId: d.tv_results[0].id,    type: 'series' };
    return null;
  } catch { return null; }
}

// IMDb→TMDB mapping is global (identical for every user): cache it in Redis
// for 30 days so tt: meta/stream requests never pay a Find API call per hit.
const IMDB2TMDB_TTL = 60 * 60 * 24 * 30;
async function imdbToTmdbCached(apiKey, imdbId) {
  const cache = require('../runtime/cache.ts');
  const key = cache.makeKey('imdb2tmdb', imdbId);
  const hit = await cache.get(key);
  if (hit) return hit;
  // Local Wikidata mapping avoids the TMDB Find call for known titles. Not
  // persisted: the in-memory map refreshes daily and the API result above is
  // the durable authority.
  const local = idMap.imdbToTmdb(imdbId);
  if (local) return local;
  const mapped = await imdbToTmdb(apiKey, imdbId);
  if (mapped) await cache.set(key, mapped, IMDB2TMDB_TTL);
  return mapped;
}

// Find API result item for an IMDb id (search-row shape: title/name, poster,
// overview, release date). Used for direct "ttXXXX" search queries.
async function findByImdbId(apiKey, imdbId) {
  const cacheKey = `finditem:${imdbId}`;
  const cached = await durableSearchGet(cacheKey, `find:${imdbId}`);
  if (cached !== undefined) return cached;
  const auth = tmdbAuth(apiKey);
  try {
    const res = await axios.get(`${TMDB_BASE}/find/${imdbId}`, {
      headers: auth.headers,
      params: { ...auth.params, external_source: 'imdb_id' },
      timeout: 8000,
    });
    const d = res.data;
    const item = d.movie_results?.[0] || d.tv_results?.[0] || null;
    durableSearchSet(cacheKey, `find:${imdbId}`, item, 86400);
    return item;
  } catch { tmdbCache.set(cacheKey, null, 600); return null; }
}

// Score one candidate name against the query. "&" is treated as "and" so
// "Law & Order" is an exact match for a filename "Law And Order" instead of
// falling to weak token overlap (where a different show whose title merely
// contains the query, e.g. "In the Name of Law and Order", could outrank it).
function nameMatchScore(query, raw) {
  const norm = s => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  const qn = norm(query);
  const nn = norm(raw);
  if (!qn || !nn) return 0;
  if (nn === qn) return 100;
  if (nn.startsWith(qn)) return 85;
  if (qn.startsWith(nn)) return 75;
  if (nn.includes(qn)) return 65;
  if (qn.includes(nn)) return 55;
  const qt = String(query).toLowerCase().split(/\W+/).filter(Boolean);
  const nt = String(raw).toLowerCase().split(/\W+/).filter(Boolean);
  const overlap = qt.filter(t => nt.includes(t)).length;
  return overlap ? 30 * (overlap / qt.length) : 0;
}

function titleScore(query, result) {
  let best = 0;
  const primary = [result.name, result.original_name, result.title, result.original_title].filter(Boolean);
  for (const raw of primary) {
    const s = nameMatchScore(query, raw);
    if (s > best) best = s;
  }
  // Alternative titles (AKAs) count too, but are capped below an exact
  // primary-title match so an alias can never outrank the canonical title on
  // a tie. `alternativeTitles` is only present when enrichAlternativeTitles
  // attached it for a weak candidate pool.
  if (Array.isArray(result.alternativeTitles)) {
    for (const raw of result.alternativeTitles) {
      const s = Math.min(nameMatchScore(query, raw), 95);
      if (s > best) best = s;
    }
  }
  return best;
}

function yearBonus(requestedYear, result) {
  if (!requestedYear) return 0;
  const d = result.release_date || result.first_air_date || '';
  const y = parseInt(String(d).slice(0, 4), 10);
  if (!y) return 0;
  const diff = Math.abs(y - requestedYear);
  if (diff === 0) return 60;
  if (diff === 1) return 10;
  if (diff === 2) return -20;
  return -40;
}

function resultYear(result) {
  const d = result.release_date || result.first_air_date || '';
  const y = parseInt(String(d).slice(0, 4), 10);
  return Number.isFinite(y) ? y : 0;
}

// Exact-title test used for tiering. `titleScore` returns 100 only for an exact
// match on a PRIMARY title; an exact match on an alternative title is capped at
// 95 ("an alias can never outrank the canonical title on a tie"), which left
// those candidates outside the exact tier entirely. That is wrong for tiering:
// TMDB frequently titles a show differently from its release name and carries
// the release name as an AKA ("Raw" carries "WWE Raw"), so a genuinely exact
// match was treated as a mere partial match and could lose the tier to a prefix
// spin-off once yearBonus was added. The numeric score is untouched; only the
// tier gate learns about exact alternative titles.
function isExactTitleMatch(query, result) {
  if (titleScore(query, result) === 100) return true;
  if (!Array.isArray(result.alternativeTitles)) return false;
  const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  const qn = norm(query);
  if (!qn) return false;
  return result.alternativeTitles.some((raw) => norm(raw) === qn);
}

function pickBestResult(query, results, year) {
  const y = year ? parseInt(year, 10) : 0;
  // Exact title + plausible year outranks any partial-title match. TMDB
  // routinely dates a film a year off the filename (festival premiere vs
  // wide release), and the year bonus then lets a same-year short or
  // prefix-title steal the match: an "Old Ways 2020" file went to the Apex
  // short (TMDB 1637948) instead of the 2021-dated horror feature, and an
  // "Influencer 2023" file went to the "Influencer Life" short instead of
  // the feature. Within the exact tier the usual score (year, then votes)
  // still orders entries, so remakes and weekly-show variants are unaffected.
  const scored = results.map(r => ({ r, exact: isExactTitleMatch(query, r)
    && (!y || resultYear(r) === 0 || Math.abs(resultYear(r) - y) <= 1) }));
  // An exact title always outranks a partial one, even when the year does not
  // line up. Otherwise a year bonus can lift a spin-off whose name merely
  // starts with the query ("Stranger Things: Tales from '85" over the 2016
  // show) above the real exact-title entry. Plausible-year exact titles stay
  // the first tier; when none exist, any exact title wins over partials.
  const plausibleExact = scored.filter(s => s.exact);
  const exactTier = scored.filter(s => isExactTitleMatch(query, s.r));
  const pool = plausibleExact.length ? plausibleExact : (exactTier.length ? exactTier : scored);
  let best = pool[0].r;
  let bestScore = titleScore(query, best) + yearBonus(y, best);
  let bestVotes = best.vote_count || 0;
  for (let i = 1; i < pool.length; i++) {
    const r = pool[i].r;
    const score = titleScore(query, r) + yearBonus(y, r);
    const votes = r.vote_count || 0;
    if (score > bestScore || (score === bestScore && votes > bestVotes)) {
      best = r;
      bestScore = score;
      bestVotes = votes;
    } else if (score >= 55 && votes > bestVotes * 10 && score >= bestScore - 30) {
      best = r;
      bestScore = score;
      bestVotes = votes;
    }
  }
  return best;
}

// Alternative (AKA) titles for a TMDB title, cached 30 days. Global public
// data, shared across users and persisted in Redis, so the extra API call is
// paid once per title. Handles movies and series.
async function getAlternativeTitles(apiKey, apiType, tmdbId) {
  const altType = apiType === 'movie' ? 'movie' : 'tv';
  const memKey = `alt:${altType}:${tmdbId}`;
  const mem = tmdbCache.get(memKey);
  if (mem !== undefined) return mem;
  const redisKey = sharedCache.makeKey('alttitles', 'v1', altType, tmdbId);
  try {
    const persisted = await sharedCache.get(redisKey);
    if (Array.isArray(persisted)) { tmdbCache.set(memKey, persisted, 7 * 24 * 60 * 60); return persisted; }
  } catch { /* fall through to API */ }
  try {
    const auth = tmdbAuth(apiKey);
    const res = await axios.get(`${TMDB_BASE}/${altType}/${tmdbId}/alternative_titles`, {
      headers: auth.headers,
      params: { ...auth.params },
      timeout: 5000,
    });
    const raw = altType === 'movie' ? (res.data?.titles || []) : (res.data?.results || []);
    const list = raw.map(t => t && (t.title || t.name)).filter(Boolean).slice(0, 30);
    tmdbCache.set(memKey, list, 30 * 24 * 60 * 60);
    sharedCache.set(redisKey, list, 30 * 24 * 60 * 60).catch(() => {});
    return list;
  } catch {
    tmdbCache.set(memKey, [], 3600);
    return [];
  }
}

// Attach alternative titles to the strongest few candidates so a release named
// with an AKA can still match. Only called when no candidate is already an
// exact primary-title match, which keeps these extra calls off the common path.
async function enrichAlternativeTitles(apiKey, apiType, query, results) {
  if (!Array.isArray(results) || !results.length) return results;
  let bestPrimary = 0;
  for (const r of results) { const s = titleScore(query, r); if (s > bestPrimary) bestPrimary = s; }
  if (bestPrimary === 100) return results;
  const ranked = results.slice().sort((a, b) => titleScore(query, b) - titleScore(query, a)).slice(0, 6);
  await pLimit(ranked.map(r => async () => {
    if (!r || r.id == null || Array.isArray(r.alternativeTitles)) return;
    const alts = await getAlternativeTitles(apiKey, apiType, r.id).catch(() => []);
    if (alts.length) r.alternativeTitles = alts;
  }), 6);
  return results;
}

async function searchMetadata(apiKey, query, type, year, lang = 'en-US') {
  query = canonicalSearchTitle(query, true, type);
  const cacheKey = `search2:${type}:${lang}:${query}:${year || ''}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached !== undefined) return cached;
  return coalesceTmdb(`sm:${cacheKey}`, () => searchMetadataUncached(apiKey, query, type, year, lang, cacheKey));
}

async function searchMetadataUncached(apiKey, query, type, year, lang, cacheKey) {
  const endpoint = type === 'movie' ? '/search/movie' : '/search/tv';
  const auth   = tmdbAuth(apiKey);
  // No region: with one, TMDB filters the year and dates every result by that
  // country's release, so Soul (2020) came back as 2024 and a correct file
  // year hid the film. The film's own (primary) date is what file names carry.
  const params = { ...auth.params, query, language: lang, page: 1 };
  if (year && type === 'movie') params.year = year;

  const res = await axios.get(`${TMDB_BASE}${endpoint}`, { headers: auth.headers, params, timeout: 8000 });
  const results = res.data?.results || [];
  await enrichAlternativeTitles(apiKey, type === 'movie' ? 'movie' : 'tv', query, results);
  let result = results.length > 0 ? pickBestResult(query, results, year) : null;

  if (result && year && type === 'movie' && titleScore(query, result) < 100) {
    // The year filter above can hide the right title entirely when TMDB
    // dates it a year off the filename (festival premiere vs wide release):
    // the pick then goes to the best of a bad pool. Retry unfiltered, merge
    // both pools, and re-pick so an exact title can still win it back.
    try {
      const noYearParams = { ...auth.params, query, language: lang, page: 1 };
      const noYearRes = await axios.get(`${TMDB_BASE}${endpoint}`, { headers: auth.headers, params: noYearParams, timeout: 8000 });
      const noYearResults = noYearRes.data?.results || [];
      if (noYearResults.length > 0) {
        const seen = new Set(results.map(r => r.id));
        result = pickBestResult(query, results.concat(noYearResults.filter(r => !seen.has(r.id))), year);
      }
    } catch {}
  }

  if (result && titleScore(query, result) + yearBonus(parseInt(year, 10) || 0, result) < 90 && lang.split('-')[0] !== 'en') {
    const enParams = { ...auth.params, query, language: 'en-US', page: 1 };
    if (year && type === 'movie') enParams.year = year;
    try {
      const enRes = await axios.get(`${TMDB_BASE}${endpoint}`, { headers: auth.headers, params: enParams, timeout: 8000 });
      const enBest = (enRes.data?.results || []).length > 0 ? pickBestResult(query, enRes.data.results, year) : null;
      if (enBest && (titleScore(query, enBest) + yearBonus(parseInt(year, 10) || 0, enBest)) > (titleScore(query, result) + yearBonus(parseInt(year, 10) || 0, result))) result = enBest;
    } catch {}
  }

  if (!result && year) {
    // Year mismatch (torrent says 2025, TMDB says 2026 for "Aitch: Don't Be Afraid" etc)
    // Fall back to year-agnostic search so the title still resolves.
    try {
      const noYearParams = { ...auth.params, query, language: lang, page: 1 };
      const noYearRes = await axios.get(`${TMDB_BASE}${endpoint}`, { headers: auth.headers, params: noYearParams, timeout: 8000 });
      const noYearResults = noYearRes.data?.results || [];
      if (noYearResults.length > 0) result = pickBestResult(query, noYearResults, year);
    } catch {}
  }

  if (!result) { tmdbCache.set(cacheKey, null); return null; }

  result.isJapaneseAnimation =
    result.original_language === 'ja' &&
    (result.genre_ids || []).includes(16);

  tmdbCache.set(cacheKey, result);
  return result;
}

async function searchCandidates(apiKey, query, type, year, lang = 'en-US', limit = 5) {
  query = canonicalSearchTitle(query, false, type);
  const cacheKey = `cand2:${type}:${lang}:${query}:${year || ''}:${limit}`;
  const cached = await durableSearchGet(cacheKey, cacheKey);
  if (cached !== undefined) return cached;
  return coalesceTmdb(`sc:${cacheKey}`, () => searchCandidatesUncached(apiKey, query, type, year, lang, limit, cacheKey));
}

async function searchCandidatesUncached(apiKey, query, type, year, lang, limit, cacheKey) {
  const endpoint = type === 'movie' ? '/search/movie' : '/search/tv';
  const auth   = tmdbAuth(apiKey);
  // No region, for the same reason as searchMetadataUncached.
  const params = { ...auth.params, query, language: lang, page: 1 };
  if (year && type === 'movie') params.year = year;

  // One retry: a transient slow/rate-limited TMDB response used to throw and
  // fail the entire interactive search, which left Nuvio with no TMDB rows.
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await axios.get(`${TMDB_BASE}${endpoint}`, { headers: auth.headers, params, timeout: attempt === 0 ? 8000 : 6000 });
      break;
    } catch (err) {
      if (attempt >= 1) throw err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const results = res.data?.results || [];
  for (const r of results) {
    r.isJapaneseAnimation = r.original_language === 'ja' && (r.genre_ids || []).includes(16);
  }
  await enrichAlternativeTitles(apiKey, type, query, results);
  const yy = year ? parseInt(year, 10) : 0;
  const ranked = results
    .map(r => ({ r, score: titleScore(query, r) + yearBonus(yy, r) }))
    .sort((a, b) => b.score - a.score || (b.r.vote_count || 0) - (a.r.vote_count || 0))
    .slice(0, limit)
    .map(x => x.r);
  durableSearchSet(cacheKey, cacheKey, ranked, 21600);
  return ranked;
}

// Person search (used as a weak-title-search fallback): resolve the best
// Acting person for the query, then return their movie/tv credits.
async function searchPersonCredits(apiKey, query, type, lang = 'en-US') {
  const auth = tmdbAuth(apiKey);
  const apiType = type === 'series' ? 'tv' : 'movie';
  const personKey = `person:${lang}:${String(query).toLowerCase()}`;
  let personId = await durableSearchGet(personKey, personKey);
  if (personId === undefined) {
    personId = null;
    try {
      const res = await axios.get(`${TMDB_BASE}/search/person`, {
        headers: auth.headers,
        params: { ...auth.params, query, language: lang, page: 1 },
        timeout: 8000,
      });
      const person = (res.data?.results || []).find(p => p.known_for_department === 'Acting');
      personId = person ? person.id : null;
    } catch { personId = null; }
    durableSearchSet(personKey, personKey, personId, 86400);
  }
  if (!personId) return null;
  const creditsKey = `personcred:${apiType}:${personId}:${lang}`;
  const cached = await durableSearchGet(creditsKey, creditsKey);
  if (cached !== undefined) return { personId, results: cached };
  try {
    const res = await axios.get(`${TMDB_BASE}/person/${personId}/${apiType}_credits`, {
      headers: auth.headers,
      params: { ...auth.params, language: lang },
      timeout: 8000,
    });
    const cast = Array.isArray(res.data?.cast) ? res.data.cast : [];
    const seen = new Set();
    const deduped = cast.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; })
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    durableSearchSet(creditsKey, creditsKey, deduped, 86400);
    return { personId, results: deduped };
  } catch { return null; }
}

// Discover-by-genre rows for genre queries (e.g. "action" → with_genres=28).
// TMDB returns them sorted by relevance/popularity, which is what we want here.
async function discoverByGenre(apiKey, genreId, type, lang = 'en-US') {
  const apiType = type === 'series' ? 'tv' : 'movie';
  const cacheKey = `discgenre:${apiType}:${genreId}:${lang}`;
  const cached = await durableSearchGet(cacheKey, cacheKey);
  if (cached !== undefined) return cached;
  try {
    const auth = tmdbAuth(apiKey);
    const res = await axios.get(`${TMDB_BASE}/discover/${apiType}`, {
      headers: auth.headers,
      params: { ...auth.params, language: lang, with_genres: genreId, sort_by: 'popularity.desc', page: 1 },
      timeout: 8000,
    });
    const results = res.data?.results || [];
    durableSearchSet(cacheKey, cacheKey, results, 21600);
    return results;
  } catch { tmdbCache.set(cacheKey, [], 600); return []; }
}

async function fetchSeasonVideos(auth, tmdbId, season, lang, fallbackPoster, idBase) {
  const seasonKey = sharedCache.makeKey('tmdbseason:v1', tmdbId, season.season_number, lang);
  const lastGoodKey = sharedCache.makeKey('tmdbseason-lkg:v1', tmdbId, season.season_number, lang);
  let seasonData = await sharedCache.get(seasonKey);
  const lastGood = seasonData || await sharedCache.get(lastGoodKey);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (!seasonData) {
        const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}/season/${season.season_number}`, {
          headers: auth.headers,
          params: { ...auth.params, language: lang },
          timeout: 8000,
        });
        seasonData = res.data || {};
        await Promise.all([
          sharedCache.set(seasonKey, seasonData, 24 * 60 * 60),
          sharedCache.set(lastGoodKey, seasonData, 30 * 24 * 60 * 60),
        ]);
      }
      const eps = seasonData.episodes || [];
      return eps.map(ep => {
        const rawName = ep.name || '';
        let title;
        if (rawName && !new RegExp(`^episode\\s+${ep.episode_number}\\b`, 'i').test(rawName)) {
          title = `Episode ${ep.episode_number}: ${rawName}`;
        } else {
          title = rawName || `Episode ${ep.episode_number}`;
        }
        return {
          id:        `${idBase}:${season.season_number}:${ep.episode_number}`,
          title,
          season:    season.season_number,
          episode:   ep.episode_number,
          overview:  ep.overview || '',
          thumbnail: ep.still_path
            ? `${TMDB_IMAGE}/w300${ep.still_path}`
            : (season.poster_path ? `${TMDB_IMAGE}/w300${season.poster_path}` : fallbackPoster),
          released:  ep.air_date ? new Date(ep.air_date).toISOString() : undefined,
          rating:    ep.vote_average?.toFixed(1),
        };
      });
    } catch (err) {
      if (attempt === 0) await new Promise(r => setTimeout(r, 600));
    }
  }
  if (lastGood) {
    seasonData = lastGood;
    const eps = seasonData.episodes || [];
    return eps.map(ep => ({
      id: `${idBase}:${season.season_number}:${ep.episode_number}`,
      title: ep.name && !new RegExp(`^episode\\s+${ep.episode_number}\\b`, 'i').test(ep.name)
        ? `Episode ${ep.episode_number}: ${ep.name}` : (ep.name || `Episode ${ep.episode_number}`),
      season: season.season_number,
      episode: ep.episode_number,
      overview: ep.overview || '',
      thumbnail: ep.still_path ? `${TMDB_IMAGE}/w300${ep.still_path}` : (season.poster_path ? `${TMDB_IMAGE}/w300${season.poster_path}` : fallbackPoster),
      released: ep.air_date ? new Date(ep.air_date).toISOString() : undefined,
      rating: ep.vote_average?.toFixed(1),
    }));
  }
  console.error(`[TMDB] Season ${season.season_number} fetch failed for ${tmdbId}: omitting episodes`);
  throw new Error(`TMDB season ${season.season_number} unavailable`);
}

async function getMetadata(apiKey, tmdbId, type, lang = 'en-US', opts = {}) {
  const discovery = !!(opts && opts.discovery);
  const cacheKey = `meta2:${type}:${tmdbId}:${lang}:${discovery ? 'disc' : 'lib'}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const endpoint = type === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const auth = tmdbAuth(apiKey);
  const baseParams = { ...auth.params, language: lang };

  let detail = null;
  try {
    // TMDB supports comma-separated append_to_response. Keeping these fields
    // on one request removes three round trips from every cold detail page.
    const appended = type === 'movie' ? 'videos,images,credits,external_ids,release_dates' : 'videos,images,credits,external_ids,content_ratings';
    const response = await axios.get(`${TMDB_BASE}${endpoint}`, {
      headers: auth.headers,
      params: { ...baseParams, append_to_response: appended },
      timeout: 10000,
    });
    detail = response.data;
  } catch { /* handled by the null return below */ }
  if (!detail) return null;

  const credits = detail.credits || null;
  const external = detail.external_ids || null;
  const extra = type === 'movie' ? detail.release_dates : detail.content_ratings;

  const imdbId    = external?.imdb_id || null;
  const cast      = (credits?.cast || []).slice(0, 8).map(c => c.name);
  const directors = type === 'movie'
    ? (credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name)
    : (detail.created_by || []).map(c => c.name);

  // Nuvio app_extras: cast/directors/writers with photos, plus release dates
  // and certification used by imported catalogue definitions.
  const person = c => ({
    id: c.id,
    name: c.name,
    character: c.character || c.job || '',
    photo: c.profile_path ? `${TMDB_IMAGE}/w185${c.profile_path}` : null,
  });
  const appExtras = {};
  const richCast = (credits?.cast || []).slice(0, 50).map(person);
  if (richCast.length > 0) appExtras.cast = richCast;
  const richDirectors = type === 'movie'
    ? (credits?.crew || []).filter(c => c.job === 'Director').map(person)
    : (detail.created_by || []).map(person);
  if (richDirectors.length > 0) appExtras.directors = richDirectors.slice(0, 20);
  if (type === 'movie') {
    const writerJobs = new Set(['Writer', 'Screenplay', 'Screenwriter', 'Story', 'Teleplay', 'Novel', 'Book', 'Original Story', 'Original Screenplay']);
    const richWriters = (credits?.crew || []).filter(c => writerJobs.has(c.job)).map(person);
    if (richWriters.length > 0) appExtras.writers = richWriters.slice(0, 20);
  }
  const langCode = lang.split('-')[0];
  if (type === 'movie' && extra?.results && extra.results.length > 0) {
    appExtras.releaseDates = extra; // TMDB release_dates envelope matches Nuvio's shape
    const us = extra.results.find(r => r.iso_3166_1 === 'US') || extra.results.find(r => r.iso_3166_1 === langCode.toUpperCase()) || extra.results[0];
    const cert = (us?.release_dates || []).find(d => d.certification && d.type === 3)
      || (us?.release_dates || []).find(d => d.certification);
    if (cert && cert.certification) appExtras.certification = cert.certification;
  } else if (type !== 'movie' && Array.isArray(extra?.results) && extra.results.length > 0) {
    const us = extra.results.find(r => r.iso_3166_1 === 'US') || extra.results.find(r => r.iso_3166_1 === langCode.toUpperCase()) || extra.results[0];
    if (us && us.rating) appExtras.certification = us.rating;
  }

  let poster     = detail.poster_path   ? `${TMDB_IMAGE}/w500${detail.poster_path}`    : null;
  let background = detail.backdrop_path ? `${TMDB_IMAGE}/w1280${detail.backdrop_path}` : null;
  const lp = detail.images?.posters?.find(p => p.iso_639_1 === langCode);
  if (lp) poster = `${TMDB_IMAGE}/w500${lp.file_path}`;

  const genres  = (detail.genres || []).map(g => g.name);
  const vids    = detail.videos?.results || [];
  const trailer = vids.find(v => v.type === 'Trailer' && v.site === 'YouTube' && v.iso_639_1 === langCode)
               || vids.find(v => v.type === 'Trailer' && v.site === 'YouTube');

  if (type === 'movie') {
    const links = imdbId ? [{ name: 'IMDB', category: 'imdb', url: `https://www.imdb.com/title/${imdbId}` }] : [];
    for (const n of (detail.networks || []).slice(0, 3)) links.push({ name: n.name, category: 'network', url: `https://www.themoviedb.org/movie/${tmdbId}` });
    for (const c of (detail.production_companies || []).slice(0, 3)) links.push({ name: c.name, category: 'production', url: `https://www.themoviedb.org/movie/${tmdbId}` });

    const result = {
      id: `torbox:movie:${tmdbId}`, tmdbId, imdbId,
      type: 'movie',
      name: detail.title || detail.original_title,
      year: detail.release_date?.split('-')[0],
      poster, background,
      posterShape: 'poster',
      description: detail.overview,
      runtime: detail.runtime ? `${detail.runtime} min` : undefined,
      genres, cast, director: directors,
      trailerStreams: trailer ? [{ title: 'Trailer', ytId: trailer.key }] : [],
      releaseInfo: detail.release_date?.split('-')[0],
      released: detail.release_date ? new Date(detail.release_date).toISOString() : undefined,
      imdbRating: detail.vote_average?.toFixed(1),
      links,
      app_extras: Object.keys(appExtras).length > 0 ? appExtras : undefined,
    };
    tmdbCache.set(cacheKey, result);
    return result;
  } else {
    // Season 0 is TMDB's Specials season. Include it when populated so owned
    // S00 packs appear alongside normal seasons instead of being discarded.
    const rawSeasons = (detail.seasons || []).filter(s => s.season_number >= 0 && (s.episode_count || 0) > 0);
    // Discovery (tt:) metas carry tt:-based episode ids so the player routes
    // every episode to the external stream addons; owned metas keep torbox:
    // episode ids (isolated, LeLibrary-only streams).
    const epIdBase = (discovery && imdbId) ? imdbId : `torbox:series:${tmdbId}`;
    // Season fetches are independent: parallelise. A 35-season show (WWE Raw)
    // used to serialise 35 round-trips before the meta could be cached. A
    // failed season yields [] instead of failing the whole meta, and the
    // failure count shortens the cache TTL below.
    let seasonFailures = 0;
    const episodeLists = await pLimit(rawSeasons.map(s => async () => {
      try { return await fetchSeasonVideos(auth, tmdbId, s, lang, poster, epIdBase); }
      catch { seasonFailures++; return []; }
    }), 4);
    const videos = episodeLists.flat();

    const links = imdbId ? [{ name: 'IMDB', category: 'imdb', url: `https://www.imdb.com/title/${imdbId}` }] : [];
    for (const n of (detail.networks || []).slice(0, 3)) links.push({ name: n.name, category: 'network', url: `https://www.themoviedb.org/tv/${tmdbId}` });
    for (const c of (detail.production_companies || []).slice(0, 3)) links.push({ name: c.name, category: 'production', url: `https://www.themoviedb.org/tv/${tmdbId}` });

    const result = {
      id: `torbox:series:${tmdbId}`, tmdbId, imdbId,
      type: 'series',
      name: detail.name || detail.original_name,
      year: detail.first_air_date?.split('-')[0],
      poster, background,
      posterShape: 'poster',
      description: detail.overview,
      genres, cast, director: directors,
      trailerStreams: trailer ? [{ title: 'Trailer', ytId: trailer.key }] : [],
      releaseInfo: detail.first_air_date?.split('-')[0],
      released: detail.first_air_date ? new Date(detail.first_air_date).toISOString() : undefined,
      imdbRating: detail.vote_average?.toFixed(1),
      videos,
      links,
      app_extras: Object.keys(appExtras).length > 0 ? appExtras : undefined,
      status: detail.status,
    };
    // A transient season-fetch failure (rate limit, TMDB hiccup) must not be
    // cached for 24h: a fully-empty result OR a partially-missing season gets
    // a 5-minute retry instead of a hollow detail page all day.
    if ((rawSeasons.length > 0 && videos.length === 0) || seasonFailures > 0) {
      tmdbCache.set(cacheKey, result, 300);
    } else {
      tmdbCache.set(cacheKey, result);
    }
    return result;
  }
}

// Resolves { season, episode } for a date-based episode (weekly shows like WWE Raw)
// ── Digital release detection (movies) ────────────────────────────────────
// One TMDB call (movie detail + append_to_response=release_dates) gives both
// the theatrical release date and the earliest "Digital" release window
// (release window type 4). Used by the stream notices: films without a
// digital release yet get an informational row above their streams.
// Cached 24h: release windows rarely change.
// TMDB release-date types: 4 is Digital, 5 is Physical. Using 5 here made
// recently released films look as though their digital release was missing.
const DIGITAL_WINDOW_TYPE = 4;
async function getMovieReleaseInfo(apiKey, tmdbId) {
  if (!apiKey || !tmdbId) return null;
  const cache = require('../runtime/cache.ts');
  // v2 invalidates the cache entries built while physical releases were
  // mistakenly treated as digital releases.
  const key = cache.makeKey('reldates2', String(tmdbId));
  const hit = await cache.get(key);
  if (hit !== null && hit !== undefined) return hit;
  let info = null;
  try {
    const auth = tmdbAuth(apiKey);
    const res = await axios.get(`${TMDB_BASE}/movie/${tmdbId}`, {
      headers: auth.headers,
      params: { ...auth.params, append_to_response: 'release_dates' },
      timeout: 8000,
    });
    const d = res.data;
    let digitalDate = null;
    for (const country of d.release_dates?.results || []) {
      for (const rd of country.release_dates || []) {
        if (rd.type === DIGITAL_WINDOW_TYPE && rd.release_date) {
          const ts = Date.parse(rd.release_date);
          if (!Number.isNaN(ts) && (digitalDate === null || ts < Date.parse(digitalDate))) {
            digitalDate = rd.release_date;
          }
        }
      }
    }
    info = { releaseDate: d.release_date || null, digitalDate };
  } catch { info = null; }
  await cache.set(key, info, 24 * 60 * 60);
  return info;
}

async function findEpisodeByAirDate(apiKey, tmdbId, airDate, lang = 'en-US') {
  const cacheKey = `epdate:${tmdbId}:${airDate}:${lang}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const auth = tmdbAuth(apiKey);
    let seasons = tvDetailCache.get(`tv:${tmdbId}:${lang}`);
    if (!seasons) {
      const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}`, {
        headers: auth.headers,
        params: { ...auth.params, language: lang },
        timeout: 8000,
      });
      seasons = (res.data?.seasons || []).filter(s => s.season_number >= 0 && (s.episode_count || 0) > 0);
      tvDetailCache.set(`tv:${tmdbId}:${lang}`, seasons);
    }
    if (seasons.length === 0) { tmdbCache.set(cacheKey, null); return null; }

    const target = Date.parse(airDate + 'T00:00:00Z');
    const dated = seasons.filter(s => s.air_date).sort((a, b) => b.air_date.localeCompare(a.air_date));
    const candidates = [];
    const past = dated.filter(s => Date.parse(s.air_date + 'T00:00:00Z') <= target);
    if (past.length > 0) candidates.push(past[0]);
    else if (dated.length > 0) candidates.push(dated[dated.length - 1]);
    const next = [...dated].reverse().find(s => Date.parse(s.air_date + 'T00:00:00Z') > target);
    if (next) candidates.push(next);
    for (const s of seasons.filter(x => !x.air_date)) {
      if (candidates.length >= 3) break;
      candidates.push(s);
    }

    const seen = new Set();
    for (const s of candidates) {
      if (seen.has(s.season_number)) continue;
      seen.add(s.season_number);
      let eps = seasonCache.get(`eps:${tmdbId}:${s.season_number}:${lang}`);
      if (!eps) {
        const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}/season/${s.season_number}`, {
          headers: auth.headers,
          params: { ...auth.params, language: lang },
          timeout: 8000,
        });
        eps = res.data?.episodes || [];
        seasonCache.set(`eps:${tmdbId}:${s.season_number}:${lang}`, eps);
      }
      const ep = eps.find(e => e.air_date === airDate);
      if (ep) {
        const result = { season: ep.season_number, episode: ep.episode_number };
        tmdbCache.set(cacheKey, result);
        return result;
      }
    }

    // Negative result: TMDB may simply not have synced this airing yet (weekly
    // shows). A full-day lockout used to keep the episode unresolvable even
    // after TMDB caught up: retry in 10 minutes instead.
    tmdbCache.set(cacheKey, null, 600);
    return null;
  } catch {
    tmdbCache.set(cacheKey, null, 600);
    return null;
  }
}

// Season sizes for absolute-number resolution (anime packs like
// "One Piece - 101"). Reuses the cached TV detail (which includes
// episode_count per season).
async function getSeasonEpisodeCounts(apiKey, tmdbId, lang = 'en-US') {
  try {
    const auth = tmdbAuth(apiKey);
    let seasons = tvDetailCache.get(`tv:${tmdbId}:${lang}`);
    if (!seasons) {
      const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}`, {
        headers: auth.headers,
        params: { ...auth.params, language: lang },
        timeout: 8000,
      });
      seasons = (res.data?.seasons || []).filter(s => s.season_number > 0);
      tvDetailCache.set(`tv:${tmdbId}:${lang}`, seasons);
    }
    return seasons.map(s => ({ season: s.season_number, count: s.episode_count || 0 }));
  } catch {
    return null;
  }
}

async function getSeriesSeasons(apiKey, tmdbId, lang = 'en-US') {
  const cacheKey = `tv-picker:${tmdbId}:${lang}`;
  const cached = tvDetailCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const auth = tmdbAuth(apiKey);
    const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}`, {
      headers: auth.headers,
      params: { ...auth.params, language: lang },
      timeout: 8000,
    });
    const seasons = (res.data?.seasons || []).map((season) => ({
      season: Number(season.season_number),
      count: Number(season.episode_count) || 0,
      name: season.name || (Number(season.season_number) === 0 ? 'Specials' : `Season ${season.season_number}`),
    })).filter((season) => Number.isInteger(season.season) && season.season >= 0);
    if (seasons.length) {
      tvDetailCache.set(cacheKey, seasons);
      return seasons;
    }
  } catch {}

  const videos = await getSeriesPickerFallback(tmdbId);
  const seasons = seriesSeasonsFromVideos(videos);
  if (seasons.length) tvDetailCache.set(cacheKey, seasons);
  return seasons;
}

// Lightweight season picker data for Configure. Unlike getMetadata(), this
// fetches only the season the person selected instead of expanding every
// season of a long-running show such as WWE or Doctor Who.
async function getSeasonEpisodes(apiKey, tmdbId, seasonNumber, lang = 'en-US') {
  const season = Number(seasonNumber);
  if (!Number.isInteger(season) || season < 0) return [];
  const cacheKey = `season-picker:${tmdbId}:${season}:${lang}`;
  const cached = seasonCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const auth = tmdbAuth(apiKey);
    const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}/season/${season}`, {
      headers: auth.headers,
      params: { ...auth.params, language: lang },
      timeout: 8000,
    });
    const episodes = (res.data?.episodes || []).map((episode) => ({
      season: Number(episode.season_number),
      episode: Number(episode.episode_number),
      name: episode.name || `Episode ${episode.episode_number}`,
      released: episode.air_date || null,
    })).filter((episode) => Number.isInteger(episode.episode) && episode.episode >= 1);
    if (episodes.length) {
      seasonCache.set(cacheKey, episodes);
      return episodes;
    }
  } catch {}

  const videos = await getSeriesPickerFallback(tmdbId);
  const episodes = seasonEpisodesFromVideos(videos, season);
  if (episodes.length) seasonCache.set(cacheKey, episodes);
  return episodes;
}

function seriesSeasonsFromVideos(videos) {
  const episodesBySeason = new Map();
  for (const video of Array.isArray(videos) ? videos : []) {
    const season = Number(video?.season);
    const episode = Number(video?.episode ?? video?.number);
    if (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode < 1) continue;
    if (!episodesBySeason.has(season)) episodesBySeason.set(season, new Set());
    episodesBySeason.get(season).add(episode);
  }
  return [...episodesBySeason.entries()].sort((a, b) => a[0] - b[0]).map(([season, episodes]) => ({
    season,
    count: episodes.size,
    name: season === 0 ? 'Specials' : `Season ${season}`,
  }));
}

function seasonEpisodesFromVideos(videos, seasonNumber) {
  const season = Number(seasonNumber);
  if (!Number.isInteger(season) || season < 0) return [];
  const seen = new Set();
  return (Array.isArray(videos) ? videos : []).map((video) => ({
    season: Number(video?.season),
    episode: Number(video?.episode ?? video?.number),
    name: video?.name || video?.title || '',
    released: video?.released || video?.firstAired || null,
  })).filter((episode) => episode.season === season
    && Number.isInteger(episode.episode) && episode.episode >= 1
    && !seen.has(episode.episode) && seen.add(episode.episode))
    .sort((a, b) => a.episode - b.episode);
}

async function getSeriesPickerFallback(tmdbId) {
  const numericId = Number(tmdbId);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) return [];
  const cacheKey = `series-picker-fallback:${numericId}`;
  const cached = seasonCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const res = await axios.get(`${TMDB_ADDON_BASE}/meta/series/tmdb%3A${numericId}.json`, { timeout: 12000 });
    const videos = Array.isArray(res.data?.meta?.videos) ? res.data.meta.videos : [];
    if (videos.length) seasonCache.set(cacheKey, videos);
    return videos;
  } catch {
    return [];
  }
}

function clearCaches() {
  tmdbCache.flushAll();
  tvDetailCache.flushAll();
  seasonCache.flushAll();
}

// ── Discovery lists (Trending / Popular) ──────────────────────────
// These rows are meant to be shared with other stream addons, so their metas
// carry plain `tt:` (IMDb) ids: never torbox: ids. The list endpoints don't
// return imdb_id, so each title needs a lightweight /{type}/{id}/external_ids
// call (batched, cached 24h).
function pLimit(tasks, limit = 6) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try { results[idx] = await tasks[idx](); }
      catch (err) { results[idx] = { error: err }; }
    }
  }
  return Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker)).then(() => results);
}

async function fetchDiscoveryList(apiKey, endpoint, lang, page = 1) {
  const auth = tmdbAuth(apiKey);
  const res = await axios.get(`${TMDB_BASE}${endpoint}`, {
    headers: auth.headers,
    params: { ...auth.params, language: lang, page },
    timeout: 10000,
  });
  return res.data?.results || [];
}

async function getImdbId(apiKey, apiType, tmdbId) {
  const cacheKey = `imdb:${apiType}:${tmdbId}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const persistentKey = sharedCache.makeKey('tmdb2imdb:v1', apiType, tmdbId);
  const persistent = await sharedCache.get(persistentKey);
  if (persistent && Object.prototype.hasOwnProperty.call(persistent, 'imdbId')) {
    tmdbCache.set(cacheKey, persistent.imdbId, persistent.imdbId ? 86400 : 21600);
    return persistent.imdbId;
  }
  // Local Wikidata mapping: a free first answer before the TMDB external_ids
  // call. Redis (API-derived) above stays authoritative; a miss here still
  // falls through to TMDB. Not written back to Redis so the in-memory map
  // stays the single source and refreshes daily.
  const local = idMap.tmdbToImdb(apiType, tmdbId);
  if (local) {
    tmdbCache.set(cacheKey, local, 21600);
    return local;
  }
  try {
    const auth = tmdbAuth(apiKey);
    const res = await axios.get(`${TMDB_BASE}/${apiType}/${tmdbId}/external_ids`, {
      headers: auth.headers,
      params: { ...auth.params },
      timeout: 5000,
    });
    const imdbId = res.data?.imdb_id || null;
    const ttl = imdbId ? 30 * 24 * 60 * 60 : 6 * 60 * 60;
    tmdbCache.set(cacheKey, imdbId, ttl);
    await sharedCache.set(persistentKey, { imdbId }, ttl);
    return imdbId;
  } catch {
    tmdbCache.set(cacheKey, null, 600);
    return null;
  }
}

// Batch variant of getImdbId: one Redis MGET for every persistent key, then a
// bounded parallel fill for whatever is still missing. Collapses N per-title
// round trips into one for a whole catalog row.
async function getImdbIds(apiKey, apiType, ids) {
  const out = new Map();
  const missing = [];
  for (const id of ids) {
    const cached = tmdbCache.get(`imdb:${apiType}:${id}`);
    if (cached !== undefined) out.set(id, cached);
    else missing.push(id);
  }
  if (!missing.length) return out;
  const persistentKeys = missing.map((id) => sharedCache.makeKey('tmdb2imdb:v1', apiType, id));
  let hits = new Map();
  try { hits = await sharedCache.mget(persistentKeys); } catch { /* treat as miss */ }
  const stillMissing = [];
  missing.forEach((id, index) => {
    const entry = hits.get(persistentKeys[index]);
    if (entry && Object.prototype.hasOwnProperty.call(entry, 'imdbId')) {
      tmdbCache.set(`imdb:${apiType}:${id}`, entry.imdbId, entry.imdbId ? 86400 : 21600);
      out.set(id, entry.imdbId);
    } else {
      stillMissing.push(id);
    }
  });
  await pLimit(stillMissing.map((id) => async () => {
    out.set(id, await getImdbId(apiKey, apiType, id));
  }), 10);
  return out;
}

// Build a discovery catalog row set ({ id: tt..., type, name, poster, ... })
// from a TMDB list, resolving each item's IMDb id. Skips items with no IMDb id.
// apiType is 'movie' | 'tv' (TMDB's own type names for /trending & /popular).
// TMDB's own anime signal: Japanese original language plus the Animation
// genre (16). Same rule the matcher stores for library rows. Used to tag rows
// so "Hide anime" can drop them; the tag never reaches a client.
function isTmdbAnimeItem(item) {
  if (!item || item.original_language !== 'ja') return false;
  if (Array.isArray(item.genre_ids)) return item.genre_ids.includes(16);
  return Array.isArray(item.genres) && item.genres.some((genre) => genre && genre.id === 16);
}

async function buildDiscoveryMetas(apiKey, items, lang, apiType) {
  const imdbIds = await getImdbIds(apiKey, apiType, items.map((item) => item.id));
  const metas = [];
  for (const item of items) {
    const imdbId = imdbIds.get(item.id);
    if (!imdbId) continue;
    const name = item.title || item.name || item.original_title || item.original_name || '';
    const date = item.release_date || item.first_air_date || '';
    metas.push({
      id: imdbId, // plain tt: id so other stream addons answer this row
      tmdbId: item.id, // tmdb-keyed providers (fanart) need this on the row
      type: apiType === 'movie' ? 'movie' : 'series',
      name,
      poster: item.poster_path ? `${TMDB_IMAGE}/w342${item.poster_path}` : null,
      background: item.backdrop_path ? `${TMDB_IMAGE}/w1280${item.backdrop_path}` : null,
      posterShape: 'poster',
      releaseInfo: date.slice(0, 4) || undefined,
      released: date ? new Date(date).toISOString() : undefined,
      year: date.slice(0, 4) || undefined,
      description: item.overview || undefined,
      ...(isTmdbAnimeItem(item) ? { _anime: true } : {}),
    });
  }
  return metas;
}

// TMDB trending (window = 'day' | 'week'). apiType = 'movie' | 'tv'.
// Cached 24h. Discovery requests DISCOVERY_PAGES pages (3 = ~60 titles);
// each title needs an external_ids call, so more pages means a slower first
// load (paid once, then cached for a day).
async function getTrending(apiKey, apiType, lang = 'en-US', window = 'week', pages = 1) {
  const cacheKey = `disc2:trending:${apiType}:${lang}:${window}:${pages}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const all = [];
    for (let p = 1; p <= pages; p++) {
      const items = await fetchDiscoveryList(apiKey, `/trending/${apiType}/${window}`, lang, p);
      all.push(...items);
      if (items.length < 20) break;
    }
    const metas = await buildDiscoveryMetas(apiKey, all, lang, apiType);
    tmdbCache.set(cacheKey, metas);
    return metas;
  } catch (err) {
    console.error('[TMDB] Trending error:', err.message);
    tmdbCache.set(cacheKey, []);
    return [];
  }
}

// TMDB popular. apiType = 'movie' | 'tv'. Cached 24h. Discovery requests
// DISCOVERY_PAGES pages (~60 titles).
async function getPopular(apiKey, apiType, lang = 'en-US', pages = 1) {
  const cacheKey = `disc2:popular:${apiType}:${lang}:${pages}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const all = [];
    for (let p = 1; p <= pages; p++) {
      const items = await fetchDiscoveryList(apiKey, `/${apiType}/popular`, lang, p);
      all.push(...items);
      if (items.length < 20) break;
    }
    const metas = await buildDiscoveryMetas(apiKey, all, lang, apiType);
    tmdbCache.set(cacheKey, metas);
    return metas;
  } catch (err) {
    console.error('[TMDB] Popular error:', err.message);
    tmdbCache.set(cacheKey, []);
    return [];
  }
}

export interface TmdbApi {
  withMatchRequestCounter: any;
  searchMetadata: any;
  searchCandidates: any;
  searchPersonCredits: any;
  discoverByGenre: any;
  findByImdbId: any;
  getMetadata: any;
  imdbToTmdb: any;
  imdbToTmdbCached: any;
  findEpisodeByAirDate: any;
  getSeasonEpisodeCounts: any;
  getSeriesSeasons: any;
  getSeasonEpisodes: any;
  seriesSeasonsFromVideos: any;
  seasonEpisodesFromVideos: any;
  titleScore: any;
  pickBestResult: any;
  clearCaches: any;
  getTrending: any;
  getPopular: any;
  getImdbId: any;
  getImdbIds: any;
  getMovieReleaseInfo: any;
  isTmdbAnimeItem: any;
}

module.exports = { withMatchRequestCounter, searchMetadata, searchCandidates, searchPersonCredits, discoverByGenre, findByImdbId, getMetadata, imdbToTmdb, imdbToTmdbCached, findEpisodeByAirDate, getSeasonEpisodeCounts, getSeriesSeasons, getSeasonEpisodes, seriesSeasonsFromVideos, seasonEpisodesFromVideos, titleScore, pickBestResult, clearCaches, getTrending, getPopular, getImdbId, getImdbIds, getMovieReleaseInfo, isTmdbAnimeItem } satisfies TmdbApi;
