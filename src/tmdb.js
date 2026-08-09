const axios = require('axios');
const NodeCache = require('node-cache');

const TMDB_BASE  = 'https://api.themoviedb.org/3';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p';

const tmdbCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600, useClones: false });

const tvDetailCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600, useClones: false });
const seasonCache   = new NodeCache({ stdTTL: 86400, checkperiod: 3600, useClones: false });

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
    });
    const d = res.data;
    if (d.movie_results?.length > 0) return { tmdbId: d.movie_results[0].id, type: 'movie' };
    if (d.tv_results?.length > 0)    return { tmdbId: d.tv_results[0].id,    type: 'series' };
    return null;
  } catch { return null; }
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

function pickBestResult(query, results) {
  let best = results[0];
  let bestScore = -1;
  for (const r of results) {
    const score = titleScore(query, r);
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

async function searchMetadata(apiKey, query, type, year, lang = 'pt-BR') {
  const cacheKey = `search:${type}:${lang}:${query}:${year || ''}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const endpoint = type === 'movie' ? '/search/movie' : '/search/tv';
  const auth   = tmdbAuth(apiKey);
  const region = lang.split('-')[1] || 'BR';
  const params = { ...auth.params, query, language: lang, region, page: 1 };
  if (year) params.year = year;

  const res = await axios.get(`${TMDB_BASE}${endpoint}`, { headers: auth.headers, params });
  const results = res.data?.results || [];
  let result = results.length > 0 ? pickBestResult(query, results) : null;

  if (result && titleScore(query, result) < 90 && lang.split('-')[0] !== 'en') {
    const enParams = { ...auth.params, query, language: 'en-US', page: 1 };
    if (year) enParams.year = year;
    try {
      const enRes = await axios.get(`${TMDB_BASE}${endpoint}`, { headers: auth.headers, params: enParams });
      const enBest = (enRes.data?.results || []).length > 0 ? pickBestResult(query, enRes.data.results) : null;
      if (enBest && titleScore(query, enBest) > titleScore(query, result)) result = enBest;
    } catch {}
  }

  if (!result) { tmdbCache.set(cacheKey, null); return null; }

  result.isJapaneseAnimation =
    result.original_language === 'ja' &&
    (result.genre_ids || []).includes(16);

  tmdbCache.set(cacheKey, result);
  return result;
}

async function searchCandidates(apiKey, query, type, year, lang = 'pt-BR') {
  const cacheKey = `cand:${type}:${lang}:${query}:${year || ''}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const endpoint = type === 'movie' ? '/search/movie' : '/search/tv';
  const auth   = tmdbAuth(apiKey);
  const region = lang.split('-')[1] || 'BR';
  const params = { ...auth.params, query, language: lang, region, page: 1 };
  if (year) params.year = year;

  const res = await axios.get(`${TMDB_BASE}${endpoint}`, { headers: auth.headers, params });
  const results = res.data?.results || [];
  for (const r of results) {
    r.isJapaneseAnimation = r.original_language === 'ja' && (r.genre_ids || []).includes(16);
  }
  const ranked = results
    .map(r => ({ r, score: titleScore(query, r) }))
    .sort((a, b) => b.score - a.score || (b.r.vote_count || 0) - (a.r.vote_count || 0))
    .slice(0, 5)
    .map(x => x.r);
  tmdbCache.set(cacheKey, ranked);
  return ranked;
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
  console.error(`[TMDB] Season ${season.season_number} fetch failed for ${tmdbId} — omitting episodes`);
  return [];
}

async function getMetadata(apiKey, tmdbId, type, lang = 'pt-BR', opts = {}) {
  const discovery = !!(opts && opts.discovery);
  const cacheKey = `meta:${type}:${tmdbId}:${lang}:${discovery ? 'disc' : 'lib'}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const endpoint = type === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const auth = tmdbAuth(apiKey);
  const baseParams = { ...auth.params, language: lang };

  const [detailRes, creditsRes, externalRes] = await Promise.allSettled([
    axios.get(`${TMDB_BASE}${endpoint}`, { headers: auth.headers, params: { ...baseParams, append_to_response: 'videos,images' }, timeout: 10000 }),
    axios.get(`${TMDB_BASE}${endpoint}/credits`, { headers: auth.headers, params: baseParams, timeout: 8000 }),
    axios.get(`${TMDB_BASE}${endpoint}/external_ids`, { headers: auth.headers, params: auth.params, timeout: 8000 }),
  ]);

  const detail   = detailRes.status   === 'fulfilled' ? detailRes.value.data   : null;
  const credits  = creditsRes.status  === 'fulfilled' ? creditsRes.value.data  : null;
  const external = externalRes.status === 'fulfilled' ? externalRes.value.data : null;
  if (!detail) return null;

  const imdbId    = external?.imdb_id || null;
  const cast      = (credits?.cast || []).slice(0, 8).map(c => c.name);
  const directors = type === 'movie'
    ? (credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name)
    : (detail.created_by || []).map(c => c.name);

  // Nuvio cast with photos
  const appExtras = {};
  const richCast = (credits?.cast || []).slice(0, 50).map(c => ({
    id: c.id,
    name: c.name,
    character: c.character || '',
    photo: c.profile_path ? `${TMDB_IMAGE}/w185${c.profile_path}` : null,
  }));
  if (richCast.length > 0) appExtras.cast = richCast;

  let poster     = detail.poster_path   ? `${TMDB_IMAGE}/w500${detail.poster_path}`    : null;
  let background = detail.backdrop_path ? `${TMDB_IMAGE}/w1280${detail.backdrop_path}` : null;
  const langCode = lang.split('-')[0];
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
    const episodeLists = [];
    // Discovery (tt:) metas carry tt:-based episode ids so the player routes
    // every episode to the external stream addons; owned metas keep torbox:
    // episode ids (isolated, LeLibrary-only streams).
    const epIdBase = (discovery && imdbId) ? imdbId : `torbox:series:${tmdbId}`;
    for (const s of rawSeasons) {
      episodeLists.push(await fetchSeasonVideos(auth, tmdbId, s, lang, poster, epIdBase));
    }
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
    // A transient season-fetch failure (rate limit, TMDB hiccup) can leave
    // videos empty. Don't cache that for 24h and show a hollow detail page all
    // day — retry in 5 minutes instead.
    if (rawSeasons.length > 0 && videos.length === 0) {
      tmdbCache.set(cacheKey, result, 300);
    } else {
      tmdbCache.set(cacheKey, result);
    }
    return result;
  }
}

// Resolves { season, episode } for a date-based episode (weekly shows like WWE Raw)
async function findEpisodeByAirDate(apiKey, tmdbId, airDate, lang = 'pt-BR') {
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

    tmdbCache.set(cacheKey, null);
    return null;
  } catch {
    tmdbCache.set(cacheKey, null);
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
// carry plain `tt:` (IMDb) ids — never torbox: ids. The list endpoints don't
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
      type: apiType === 'movie' ? 'movie' : 'series',
      name,
      poster: item.poster_path ? `${TMDB_IMAGE}/w500${item.poster_path}` : null,
      background: item.backdrop_path ? `${TMDB_IMAGE}/w1280${item.backdrop_path}` : null,
      releaseInfo: date.slice(0, 4) || undefined,
      released: date ? new Date(date).toISOString() : undefined,
      year: date.slice(0, 4) || undefined,
      description: item.overview || undefined,
    });
  }
  return metas;
}

// TMDB trending (window = 'day' | 'week'). apiType = 'movie' | 'tv'.
// Cached 24h. Defaults to 1 page (20 titles) — plenty for a home row, and each
// title needs an external_ids call, so more pages means a much slower first load.
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

// TMDB popular. apiType = 'movie' | 'tv'. Cached 24h. 1 page (~20 titles).
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

module.exports = { searchMetadata, searchCandidates, getMetadata, imdbToTmdb, findEpisodeByAirDate, titleScore, clearCaches, getTrending, getPopular };
