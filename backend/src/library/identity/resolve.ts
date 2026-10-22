// @ts-nocheck
// Canonical identity resolution for the indexed engine (background only).
//
// Strategy:
//   Movie : TMDB (already matched) + IMDb + TVDB derived from the local
//           Wikidata id-map. No extra API traffic.
//   TV    : TMDB + IMDb + TVDB (id-map first; TVDB API only when a key is
//           configured and the id is still missing). Optional TVDB aliases.
//   Anime : Kitsu is the primary identity/metadata source (search -> anime ->
//           external mappings, which carry AniList/MAL/TVDB/TMDB/IMDb/AniDB).
//           AniList and MAL (Jikan) enrich metadata and fill any missing ids.
//           If Kitsu has no confident hit, AniList is tried as a fallback.
//
// Every provider call is cached in Redis by providers.js, so re-resolving the
// same entity is free. The result is persisted once per canonical entity.
const idMap = require('../../media/id-map.ts');
const providers = require('./providers.ts');
const { isAnimeKeyword } = require('./anime-titles.ts');

const MATCH_THRESHOLD = 68;
const AMBIGUOUS_THRESHOLD = 45;
const ANIME_EPISODE_PAGES = Math.max(1, parseInt(process.env.ANIME_EPISODE_PAGES, 10) || 5);

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(value) {
  return normalize(value).split(' ').filter((t) => t.length > 1);
}

// 0-100 similarity that favours exact and containment, then token overlap.
function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.length >= 6 && nb.length >= 6 && (na.includes(nb) || nb.includes(na))) return 88;
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jac = inter / (ta.size + tb.size - inter);
  return Math.round(jac * 100);
}

function candidateTitleList(candidate) {
  if (!candidate) return [];
  const out = [];
  if (Array.isArray(candidate.titles)) out.push(...candidate.titles);
  else if (candidate.titles && typeof candidate.titles === 'object') out.push(...Object.values(candidate.titles));
  out.push(candidate.title, candidate.canonicalTitle);
  return out.filter(Boolean);
}

// Pick the best candidate across query titles, with a year nudge.
function bestMatch(candidates, queryTitles, year) {
  let best = null;
  for (const candidate of candidates || []) {
    if (!candidate) continue;
    let score = 0;
    for (const qt of queryTitles.filter(Boolean)) {
      for (const ct of candidateTitleList(candidate)) {
        score = Math.max(score, similarity(qt, ct));
      }
    }
    const cy = candidate.year || candidate.startYear || (candidate.startDate ? Number(String(candidate.startDate).slice(0, 4)) : null);
    if (year && cy) {
      const diff = Math.abs(Number(year) - Number(cy));
      if (diff === 0) score += 8;
      else if (diff <= 1) score += 4;
      else if (diff > 3) score -= 12;
    }
    const confidence = Math.max(0, Math.min(100, Math.round(score)));
    if (!best || confidence > best.confidence) best = { candidate, confidence };
  }
  return best;
}

function unique(list) {
  return [...new Set((list || []).map((v) => (v == null ? '' : String(v).trim())).filter(Boolean))];
}

function isAnimeCandidate(entity) {
  return entity.mediaType === 'anime' || isAnimeKeyword(entity.title);
}

async function animeEpisodes(kitsuId, ids) {
  const out = [];
  for (let page = 0; page < ANIME_EPISODE_PAGES; page++) {
    let data;
    try {
      data = await providers.kitsuAnimeEpisodes(kitsuId, page * 20);
    } catch { break; }
    const rows = data || [];
    for (const ep of rows) {
      if (!ep) continue;
      out.push({
        season: ep.seasonNumber ?? 1,
        episode: ep.relativeNumber ?? ep.number ?? null,
        absolute: ep.number ?? null,
        title: ep.canonicalTitle || null,
        airDate: ep.airdate || null,
        runtime: ep.length ?? null,
        overview: ep.synopsis || null,
        ids: { kitsu: ep.id, ...(ids.anilistId ? { anilist: ids.anilistId } : {}) },
      });
    }
    if (rows.length < 20) break;
  }
  return out.filter((e) => e.episode != null);
}

async function resolveAnime(entity, ids, meta) {
  // Kitsu primary. Long release titles ("... Beyond Journeys End") can defeat
  // Kitsu's text search, so retry with the leading words if the first pass is
  // not confident.
  let hit = bestMatch(await providers.kitsuSearch(entity.title, entity.year), [entity.title], entity.year);
  if (!hit || hit.confidence < MATCH_THRESHOLD) {
    const short = String(entity.title || '').split(/\s+/).slice(0, 3).join(' ');
    if (short && short.toLowerCase() !== String(entity.title || '').toLowerCase()) {
      const retry = bestMatch(await providers.kitsuSearch(short, entity.year), [entity.title], entity.year);
      if (retry && retry.confidence > (hit ? hit.confidence : 0)) hit = retry;
    }
  }
  let provider = 'kitsu';
  let confidence = hit ? hit.confidence : 0;
  let kitsuId = hit && hit.confidence >= MATCH_THRESHOLD ? hit.candidate.id : null;

  if (!kitsuId) {
    // AniList fallback.
    const ahit = bestMatch(await providers.anilistSearch(entity.title, entity.year), [entity.title], entity.year);
    if (!ahit || ahit.confidence < MATCH_THRESHOLD) return null;
    provider = 'anilist';
    confidence = ahit.confidence;
    const c = ahit.candidate;
    ids.anilistId = c.id || null;
    if (c.malId) ids.malId = c.malId;
    meta.canonicalTitle = c.title || null;
    meta.altTitles = unique(c.titles || []);
    meta.overview = c.overview || null;
    meta.poster = c.poster || null;
    meta.background = c.background || null;
    meta.genres = c.genres || [];
    meta.status = c.status || null;
    meta.episodeCount = c.episodes ?? null;
    meta.year = c.startYear || meta.year;
    if (!ids.imdbId && ids.tmdbId) ids.imdbId = idMap.tmdbToImdb('series', ids.tmdbId) || null;
    if (!ids.tvdbId && ids.imdbId) ids.tvdbId = idMap.imdbToTvdb(ids.imdbId, 'series') || null;
    return { provider, confidence, status: 'matched', reclassified: true };
  }

  const anime = (await providers.kitsuAnime(kitsuId).catch(() => null)) || {};
  const maps = (await providers.kitsuMappings(kitsuId).catch(() => null)) || {};
  ids.kitsuId = kitsuId;
  if (maps.anilist) ids.anilistId = maps.anilist;
  if (maps.mal) ids.malId = maps.mal;
  if (maps.tvdb) ids.tvdbId = maps.tvdb;
  if (maps.anidb) ids.anidbId = maps.anidb;
  if (maps.imdb) ids.imdbId = ids.imdbId || maps.imdb;
  if (maps.tmdb) ids.tmdbId = ids.tmdbId || Number(maps.tmdb);

  meta.canonicalTitle = anime.canonicalTitle || null;
  meta.altTitles = unique(anime.titlesList || []);
  meta.overview = anime.synopsis || null;
  meta.poster = anime.poster || null;
  meta.background = anime.background || null;
  meta.status = anime.status || null;
  meta.episodeCount = anime.episodeCount ?? null;
  if (anime.startDate) meta.year = Number(String(anime.startDate).slice(0, 4)) || meta.year;

  if (ids.anilistId) {
    try {
      const al = await providers.anilistById(ids.anilistId);
      if (al) {
        meta.altTitles = unique([...meta.altTitles, ...(al.titles || [])]);
        meta.overview = meta.overview || al.overview;
        meta.poster = meta.poster || al.poster;
        meta.background = meta.background || al.background;
        if (al.genres?.length) meta.genres = al.genres;
        if (!ids.malId && al.malId) ids.malId = al.malId;
      }
    } catch { /* optional */ }
  }
  if (ids.malId) {
    try {
      const mal = await providers.jikanById(ids.malId);
      if (mal) {
        meta.altTitles = unique([...meta.altTitles, ...(mal.titles || [])]);
        meta.overview = meta.overview || mal.overview;
        meta.poster = meta.poster || mal.poster;
      }
    } catch { /* optional */ }
  }

  // Fill cross-ids from the local map where providers did not supply them.
  if (!ids.imdbId && ids.tmdbId) ids.imdbId = idMap.tmdbToImdb('series', ids.tmdbId) || null;
  if (!ids.tvdbId && ids.imdbId) ids.tvdbId = idMap.imdbToTvdb(ids.imdbId, 'series') || null;
  if (!ids.tmdbId && ids.imdbId) {
    const m = idMap.imdbToTmdb(ids.imdbId);
    if (m && m.type === 'series') ids.tmdbId = m.tmdbId;
  }

  const episodes = await animeEpisodes(kitsuId, ids);
  return { provider, confidence, status: 'matched', reclassified: true, episodes };
}

// Resolve one canonical entity. Never throws; failures become status='failed'.
async function resolveEntity(entity) {
  let mediaType = entity.mediaType === 'anime' ? 'anime' : (entity.mediaType === 'movie' ? 'movie' : 'series');
  const ids = {
    tmdbId: entity.tmdbId || null, imdbId: entity.imdbId || null, tvdbId: null,
    kitsuId: null, anilistId: null, malId: null, anidbId: null,
  };
  const meta = {
    title: entity.title || null, canonicalTitle: null, altTitles: [], year: entity.year || null,
    poster: null, background: null, logo: null, genres: [], status: null, episodeCount: null, overview: null,
  };
  let episodes = [];
  let provider = 'wikidata';
  let confidence = ids.imdbId ? 90 : 70;
  let status = 'matched';
  let reclassified = false;

  try {
    if (!ids.imdbId && ids.tmdbId) ids.imdbId = idMap.tmdbToImdb(mediaType === 'movie' ? 'movie' : 'tv', ids.tmdbId) || null;
    if (!ids.tvdbId && ids.imdbId) ids.tvdbId = idMap.imdbToTvdb(ids.imdbId, mediaType === 'movie' ? 'movie' : 'tv') || null;

    // Only series/anime take the anime path. Anime movies stay movies (they
    // still gain IMDb/TVDB ids) so a keyword in a live-action title can never
    // move a film into the anime catalogue.
    if (mediaType !== 'movie' && isAnimeCandidate({ ...entity, mediaType })) {
      const anime = await resolveAnime({ ...entity, mediaType }, ids, meta);
      if (anime) {
        provider = anime.provider;
        confidence = anime.confidence;
        status = anime.status;
        reclassified = !!anime.reclassified;
        if (reclassified) mediaType = 'anime';
        if (anime.episodes) episodes = anime.episodes;
      } else {
        status = 'unmatched';
        confidence = 0;
      }
    } else if (mediaType !== 'movie') {
      // Normal TV: TVDB from the local map, or the TVDB API when configured and
      // still missing. No per-item live dependency in either case.
      const tvdbApiKey = entity.tvdbApiKey || '';
      if (!ids.tvdbId && providers.tvdbConfigured(tvdbApiKey)) {
        // A bad/expired user key must degrade to the Wikidata-derived ids, not
        // fail the entity.
        try {
          const hit = bestMatch(await providers.tvdbSearch(tvdbApiKey, entity.title), [entity.title], entity.year);
          if (hit && hit.confidence >= MATCH_THRESHOLD && hit.candidate.tvdbId) {
            ids.tvdbId = hit.candidate.tvdbId;
            provider = 'tvdb';
            confidence = Math.max(confidence, hit.confidence);
          }
        } catch { /* keep Wikidata ids */ }
      }
      const tvdbId = ids.tvdbId;
      if (tvdbId && providers.tvdbConfigured(tvdbApiKey)) {
        try {
          const ext = await providers.tvdbSeriesExtended(tvdbApiKey, tvdbId);
          if (ext) {
            meta.canonicalTitle = ext.title || null;
            meta.altTitles = unique([ext.title, ...(ext.aliases || [])]);
            meta.overview = ext.overview || null;
            meta.poster = ext.poster || null;
            if (ext.year) meta.year = ext.year;
            meta.status = ext.status || null;
            if (ext.genres?.length) meta.genres = ext.genres;
            provider = 'tvdb';
          }
        } catch { /* optional */ }
      }
      // TVDB episode identity (season/episode/title/air date), persisted locally
      // so episode pages never call TVDB again.
      if (tvdbId && providers.tvdbConfigured(tvdbApiKey) && ids.tvdbId) {
        try {
          const eps = await providers.tvdbSeriesEpisodes(tvdbApiKey, ids.tvdbId);
          if (Array.isArray(eps) && eps.length) episodes = eps;
        } catch { /* optional */ }
      }
    }
  } catch (err) {
    status = 'failed';
    return { ids, meta, episodes: [], mediaType, provider, status, confidence: 0, error: String(err.message || err).slice(0, 300) };
  }

  if (status === 'matched' && confidence < AMBIGUOUS_THRESHOLD) status = 'ambiguous';
  return { ids, meta, episodes, mediaType, provider, status, confidence, reclassified };
}

export interface ResolveApi {
  resolveEntity: any;
  isAnimeCandidate: any;
  similarity: any;
  bestMatch: any;
  normalize: any;
  MATCH_THRESHOLD: any;
  AMBIGUOUS_THRESHOLD: any;
}

module.exports = {
  resolveEntity,
  isAnimeCandidate,
  similarity,
  bestMatch,
  normalize,
  MATCH_THRESHOLD,
  AMBIGUOUS_THRESHOLD,
} satisfies ResolveApi;