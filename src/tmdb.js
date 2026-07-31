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
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
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

async function fetchSeasonVideos(auth, tmdbId, season, lang, fallbackPoster) {
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
          id:        `torbox:series:${tmdbId}:${season.season_number}:${ep.episode_number}`,
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

async function getMetadata(apiKey, tmdbId, type, lang = 'pt-BR') {
  const cacheKey = `meta:${type}:${tmdbId}:${lang}`;
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
    for (const s of rawSeasons) {
      episodeLists.push(await fetchSeasonVideos(auth, tmdbId, s, lang, poster));
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
    tmdbCache.set(cacheKey, result);
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

module.exports = { searchMetadata, searchCandidates, getMetadata, imdbToTmdb, findEpisodeByAirDate };
