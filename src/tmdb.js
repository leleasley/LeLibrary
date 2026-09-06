const axios = require('axios');
const NodeCache = require('node-cache');

const TMDB_BASE  = 'https://api.themoviedb.org/3';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p';

// useClones:true is REQUIRED on these caches: getMetadata() returns cached
// metas to every user sharing the language, and callers (buildMeta's episode
// filtering, enhanceMeta's poster overrides, saga-link rewriting) mutate the
// result. With shared references one user's mutations bled into everyone
// else's responses for the full 24h TTL.
const tmdbCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600, useClones: true });

const tvDetailCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600, useClones: true });
const seasonCache   = new NodeCache({ stdTTL: 86400, checkperiod: 3600, useClones: true });

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
  const cache = require('./cache');
  const key = cache.makeKey('imdb2tmdb', imdbId);
  const hit = await cache.get(key);
  if (hit) return hit;
  const mapped = await imdbToTmdb(apiKey, imdbId);
  if (mapped) await cache.set(key, mapped, IMDB2TMDB_TTL);
  return mapped;
}

// Find API result item for an IMDb id (search-row shape: title/name, poster,
// overview, release date). Used for direct "ttXXXX" search queries.
async function findByImdbId(apiKey, imdbId) {
  const cacheKey = `finditem:${imdbId}`;
  const cached = tmdbCache.get(cacheKey);
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
    tmdbCache.set(cacheKey, item, 86400);
    return item;
  } catch { tmdbCache.set(cacheKey, null, 600); return null; }
}

function titleScore(query, result) {
  // Treat "&" as "and" so "Law & Order" is an exact match for a filename
  // "Law And Order" instead of falling to weak token overlap (where a
  // different show whose title merely contains the query, e.g. "In the Name
  // of Law and Order", could outrank it).
  const norm = s => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  const qn = norm(query);
  if (!qn) return 0;
  const names = [result.name, result.original_name, result.title, result.original_title].filter(Boolean);
  let best = 0;
  for (const raw of names) {
    const nn = norm(raw);
    if (!nn) continue;
    let s;
    if (nn === qn) s = 100;
    else if (nn.startsWith(qn)) s = 85;
    else if (qn.startsWith(nn)) s = 75;
    else if (nn.includes(qn)) s = 65;
    else if (qn.includes(nn)) s = 55;
    else {
      const qt = String(query).toLowerCase().split(/\W+/).filter(Boolean);
      const nt = String(raw).toLowerCase().split(/\W+/).filter(Boolean);
      const overlap = qt.filter(t => nt.includes(t)).length;
      s = overlap ? 30 * (overlap / qt.length) : 0;
    }
    if (s > best) best = s;
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
  const scored = results.map(r => ({ r, exact: titleScore(query, r) === 100
    && (!y || resultYear(r) === 0 || Math.abs(resultYear(r) - y) <= 1) }));
  const pool = scored.some(s => s.exact) ? scored.filter(s => s.exact) : scored;
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

async function searchMetadata(apiKey, query, type, year, lang = 'en-US') {
  const cacheKey = `search:${type}:${lang}:${query}:${year || ''}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const endpoint = type === 'movie' ? '/search/movie' : '/search/tv';
  const auth   = tmdbAuth(apiKey);
  const region = lang.split('-')[1] || 'BR';
  const params = { ...auth.params, query, language: lang, region, page: 1 };
  if (year && type === 'movie') params.year = year;

  const res = await axios.get(`${TMDB_BASE}${endpoint}`, { headers: auth.headers, params, timeout: 8000 });
  const results = res.data?.results || [];
  let result = results.length > 0 ? pickBestResult(query, results, year) : null;

  if (result && year && type === 'movie' && titleScore(query, result) < 100) {
    // The year filter above can hide the right title entirely when TMDB
    // dates it a year off the filename (festival premiere vs wide release):
    // the pick then goes to the best of a bad pool. Retry unfiltered, merge
    // both pools, and re-pick so an exact title can still win it back.
    try {
      const noYearParams = { ...auth.params, query, language: lang, region, page: 1 };
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
      const noYearParams = { ...auth.params, query, language: lang, region, page: 1 };
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
  const cacheKey = `cand:${type}:${lang}:${query}:${year || ''}:${limit}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const endpoint = type === 'movie' ? '/search/movie' : '/search/tv';
  const auth   = tmdbAuth(apiKey);
  const region = lang.split('-')[1] || 'BR';
  const params = { ...auth.params, query, language: lang, region, page: 1 };
  if (year && type === 'movie') params.year = year;

  const res = await axios.get(`${TMDB_BASE}${endpoint}`, { headers: auth.headers, params, timeout: 8000 });
  const results = res.data?.results || [];
  for (const r of results) {
    r.isJapaneseAnimation = r.original_language === 'ja' && (r.genre_ids || []).includes(16);
  }
  const yy = year ? parseInt(year, 10) : 0;
  const ranked = results
    .map(r => ({ r, score: titleScore(query, r) + yearBonus(yy, r) }))
    .sort((a, b) => b.score - a.score || (b.r.vote_count || 0) - (a.r.vote_count || 0))
    .slice(0, limit)
    .map(x => x.r);
  tmdbCache.set(cacheKey, ranked);
  return ranked;
}

// Person search (used as a weak-title-search fallback): resolve the best
// Acting person for the query, then return their movie/tv credits.
async function searchPersonCredits(apiKey, query, type, lang = 'en-US') {
  const auth = tmdbAuth(apiKey);
  const apiType = type === 'series' ? 'tv' : 'movie';
  const personKey = `person:${lang}:${String(query).toLowerCase()}`;
  let personId = tmdbCache.get(personKey);
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
    tmdbCache.set(personKey, personId, 86400);
  }
  if (!personId) return null;
  const creditsKey = `personcred:${apiType}:${personId}:${lang}`;
  const cached = tmdbCache.get(creditsKey);
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
    tmdbCache.set(creditsKey, deduped, 86400);
    return { personId, results: deduped };
  } catch { return null; }
}

// Discover-by-genre rows for genre queries (e.g. "action" → with_genres=28).
// TMDB returns them sorted by relevance/popularity, which is what we want here.
async function discoverByGenre(apiKey, genreId, type, lang = 'en-US') {
  const apiType = type === 'series' ? 'tv' : 'movie';
  const cacheKey = `discgenre:${apiType}:${genreId}:${lang}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const auth = tmdbAuth(apiKey);
    const res = await axios.get(`${TMDB_BASE}/discover/${apiType}`, {
      headers: auth.headers,
      params: { ...auth.params, language: lang, with_genres: genreId, sort_by: 'popularity.desc', page: 1 },
      timeout: 8000,
    });
    const results = res.data?.results || [];
    tmdbCache.set(cacheKey, results, 21600);
    return results;
  } catch { tmdbCache.set(cacheKey, [], 600); return []; }
}

async function fetchSeasonVideos(auth, tmdbId, season, lang, fallbackPoster, idBase) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}/season/${season.season_number}`, {
        headers: auth.headers,
        params: { ...auth.params, language: lang },
        timeout: 8000,
      });
      const eps = res.data?.episodes || [];
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
  console.error(`[TMDB] Season ${season.season_number} fetch failed for ${tmdbId}: omitting episodes`);
  return [];
}

async function getMetadata(apiKey, tmdbId, type, lang = 'en-US', opts = {}) {
  const discovery = !!(opts && opts.discovery);
  const cacheKey = `meta2:${type}:${tmdbId}:${lang}:${discovery ? 'disc' : 'lib'}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const endpoint = type === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const auth = tmdbAuth(apiKey);
  const baseParams = { ...auth.params, language: lang };

  const [detailRes, creditsRes, externalRes, extraRes] = await Promise.allSettled([
    axios.get(`${TMDB_BASE}${endpoint}`, { headers: auth.headers, params: { ...baseParams, append_to_response: 'videos,images' }, timeout: 10000 }),
    axios.get(`${TMDB_BASE}${endpoint}/credits`, { headers: auth.headers, params: baseParams, timeout: 8000 }),
    axios.get(`${TMDB_BASE}${endpoint}/external_ids`, { headers: auth.headers, params: auth.params, timeout: 8000 }),
    // Movies: per-country release dates (certifications included). Series:
    // per-country content ratings. Both feed the app_extras block below.
    type === 'movie'
      ? axios.get(`${TMDB_BASE}/movie/${tmdbId}/release_dates`, { headers: auth.headers, params: auth.params, timeout: 8000 })
      : axios.get(`${TMDB_BASE}/tv/${tmdbId}/content_ratings`, { headers: auth.headers, params: auth.params, timeout: 8000 }),
  ]);

  const detail   = detailRes.status   === 'fulfilled' ? detailRes.value.data   : null;
  const credits  = creditsRes.status  === 'fulfilled' ? creditsRes.value.data  : null;
  const external = externalRes.status === 'fulfilled' ? externalRes.value.data : null;
  const extra    = extraRes.status    === 'fulfilled' ? extraRes.value.data    : null;
  if (!detail) return null;

  const imdbId    = external?.imdb_id || null;
  const cast      = (credits?.cast || []).slice(0, 8).map(c => c.name);
  const directors = type === 'movie'
    ? (credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name)
    : (detail.created_by || []).map(c => c.name);

  // Nuvio app_extras: cast/directors/writers with photos, plus release dates
  // and certification: the same block AIOMetadata serves.
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
    const rawSeasons = (detail.seasons || []).filter(s => s.season_number > 0);
    // Discovery (tt:) metas carry tt:-based episode ids so the player routes
    // every episode to the external stream addons; owned metas keep torbox:
    // episode ids (isolated, LeLibrary-only streams).
    const epIdBase = (discovery && imdbId) ? imdbId : `torbox:series:${tmdbId}`;
    // Season fetches are independent: parallelise. A 35-season show (WWE Raw)
    // used to serialise 35 round-trips before the meta could be cached. A
    // failed season yields [] instead of failing the whole meta, and the
    // failure count shortens the cache TTL below.
    let seasonFailures = 0;
    const episodeLists = await Promise.all(
      rawSeasons.map(s => fetchSeasonVideos(auth, tmdbId, s, lang, poster, epIdBase).catch(() => { seasonFailures++; return []; }))
    );
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
  const cache = require('./cache');
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
      seasons = (res.data?.seasons || []).filter(s => s.season_number > 0);
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
  try {
    const auth = tmdbAuth(apiKey);
    const res = await axios.get(`${TMDB_BASE}/${apiType}/${tmdbId}/external_ids`, {
      headers: auth.headers,
      params: { ...auth.params },
      timeout: 8000,
    });
    const imdbId = res.data?.imdb_id || null;
    tmdbCache.set(cacheKey, imdbId);
    return imdbId;
  } catch {
    tmdbCache.set(cacheKey, null);
    return null;
  }
}

// Build a discovery catalog row set ({ id: tt..., type, name, poster, ... })
// from a TMDB list, resolving each item's IMDb id. Skips items with no IMDb id.
// apiType is 'movie' | 'tv' (TMDB's own type names for /trending & /popular).
async function buildDiscoveryMetas(apiKey, items, lang, apiType) {
  const enriched = await pLimit(items.map(item => async () => {
    const imdbId = await getImdbId(apiKey, apiType, item.id);
    return { item, imdbId };
  }), 6);
  const metas = [];
  for (const { item, imdbId } of enriched) {
    if (!imdbId) continue;
    const name = item.title || item.name || item.original_title || item.original_name || '';
    const date = item.release_date || item.first_air_date || '';
    metas.push({
      id: imdbId, // plain tt: id so other stream addons answer this row
      tmdbId: item.id, // tmdb-keyed providers (fanart) need this on the row
      type: apiType === 'movie' ? 'movie' : 'series',
      name,
      poster: item.poster_path ? `${TMDB_IMAGE}/w500${item.poster_path}` : null,
      background: item.backdrop_path ? `${TMDB_IMAGE}/w1280${item.backdrop_path}` : null,
      posterShape: 'poster',
      releaseInfo: date.slice(0, 4) || undefined,
      released: date ? new Date(date).toISOString() : undefined,
      year: date.slice(0, 4) || undefined,
      description: item.overview || undefined,
    });
  }
  return metas;
}

// TMDB trending (window = 'day' | 'week'). apiType = 'movie' | 'tv'.
// Cached 24h. Discovery requests DISCOVERY_PAGES pages (3 = ~60 titles);
// each title needs an external_ids call, so more pages means a slower first
// load (paid once, then cached for a day).
async function getTrending(apiKey, apiType, lang = 'en-US', window = 'week', pages = 1) {
  const cacheKey = `disc:trending:${apiType}:${lang}:${window}:${pages}`;
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
  const cacheKey = `disc:popular:${apiType}:${lang}:${pages}`;
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

module.exports = { searchMetadata, searchCandidates, searchPersonCredits, discoverByGenre, findByImdbId, getMetadata, imdbToTmdb, imdbToTmdbCached, findEpisodeByAirDate, getSeasonEpisodeCounts, titleScore, pickBestResult, clearCaches, getTrending, getPopular, getImdbId, getMovieReleaseInfo };
