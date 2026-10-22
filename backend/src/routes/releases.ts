// @ts-nocheck
// Hosted-only Releases API. Every route is guarded by releasesEnabled(): when
// the shared server-side TMDB key is absent (self-hosted) the whole namespace
// returns 404, exactly like the page route.
//
// Browse and day-view handlers call Postgres only. Detail and the lazy
// per-season episode route may fetch TMDB; they are not browse/day paths.
// Dependencies are injectable (store / TMDB client / cache / enabled flag) so
// route tests exercise shapes, validation and rate limiting with no database
// and no network.
import type { Express, Router } from 'express';

const express = require('express');
const crypto = require('crypto');
const hosted = require('../platform/hosted.ts');
const { rateLimit } = require('../middleware/rate-limit.ts');
const { releasesSettings } = require('../releases/config.ts');
const validate = require('../releases/validate.ts');
const status = require('../releases/status.ts');
const { movieGenreNames, tvGenreNames } = require('../releases/genres.ts');
const { isGenericEpisodeName } = require('../releases/episode-label.ts');
// The day view's grouping, facets and Notable rule live in one module so the
// single-day route and the week strip can never drift apart.
const { posterUrl, groupDayRows, dayFacets, filterDayShows, sortDayShows } = require('../releases/day.ts');
const { pLimit } = require('../library/util.ts');

const SHOW_TYPES = ['Scripted', 'Reality', 'Talk Show', 'News', 'Documentary', 'Miniseries', 'Video', 'Soap'];

// The week strip asks for one row per day; the span is capped so a single
// request can never turn into an unbounded scan.
const MAX_WEEK_DAYS = 14;
const MAX_WEEK_ROWS = 8000;

export interface ReleasesRouteDeps {
  store?: any;
  getClient?: () => any;
  cache?: any;
  releasesEnabled?: () => boolean;
}

export interface ReleasesRoutesApi {
  createReleasesRouter: (deps?: ReleasesRouteDeps) => Router;
  mountReleasesRoutes: (app: Express) => void;
}

function todayIso(): string {
  return validate.toIsoDate(new Date());
}

function backdropUrl(path: unknown): string | null {
  return typeof path === 'string' && path ? `https://image.tmdb.org/t/p/w780${path}` : null;
}

function seasonPosterUrl(path: unknown): string | null {
  return typeof path === 'string' && path ? `https://image.tmdb.org/t/p/w185${path}` : null;
}

function sendError(res: any, code: number, error: string): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(code).json({ error });
}

function yearOf(date: string | null): number | null {
  if (typeof date !== 'string' || date.length < 4) return null;
  const year = Number(date.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

function newRequestId(): string {
  return crypto.randomBytes(5).toString('hex');
}

// Structured error log: request id + stage + status/code only. Never the query
// text and never a key.
function logError(requestId: string, stage: string, error: any): void {
  const status = Number(error && (error.status || error.response?.status)) || undefined;
  const code = (error && (error.code || error.cause?.code)) || undefined;
  console.error(`[Releases] req=${requestId} stage=${stage} status=${status || '-'} code=${code || '-'}: ${String(error && error.message || error).slice(0, 200)}`);
}

function movieResult(row: any, today: string) {
  return {
    type: 'movie',
    id: row.tmdb_id,
    title: row.title,
    overview: row.overview || null,
    poster: posterUrl(row.poster_path),
    backdrop: backdropUrl(row.backdrop_path),
    genres: Array.isArray(row.genres) ? row.genres : [],
    year: yearOf(row.release_date || row.digital_date),
    status: status.deriveMovieStatus({
      digital: row.digital_date,
      theatrical: row.theatrical_date,
      physical: row.physical_date,
    }, today),
    date: row.digital_date || row.release_date || null,
    releaseDate: row.release_date || null,
    digitalDate: row.digital_date || null,
    theatricalDate: row.theatrical_date || null,
    physicalDate: row.physical_date || null,
    firstAirDate: null,
    nextEpisode: null,
    enriched: true,
  };
}

// Search baseline straight from the payload (release_date / first_air_date), so
// every result has a date and status before any enrichment.
function baselineFromTmdbItem(item: any, today: string) {
  if (item.media_type === 'tv') {
    const first = typeof item.first_air_date === 'string' && item.first_air_date ? item.first_air_date : null;
    return {
      type: 'tv',
      id: item.id,
      title: String(item.name || item.original_name || ''),
      poster: posterUrl(item.poster_path),
      backdrop: backdropUrl(item.backdrop_path),
      genres: tvGenreNames(item.genre_ids),
      year: yearOf(first),
      status: status.deriveStatusFromDate(first, today),
      date: first,
      releaseDate: null,
      digitalDate: null,
      theatricalDate: null,
      physicalDate: null,
      firstAirDate: first,
      nextEpisode: null,
      enriched: false,
    };
  }
  const release = typeof item.release_date === 'string' && item.release_date ? item.release_date : null;
  return {
    type: 'movie',
    id: item.id,
    title: String(item.title || item.original_title || ''),
    poster: posterUrl(item.poster_path),
    backdrop: backdropUrl(item.backdrop_path),
    genres: movieGenreNames(item.genre_ids),
    year: yearOf(release),
    status: status.deriveStatusFromDate(release, today),
    date: release,
    releaseDate: release,
    digitalDate: null,
    theatricalDate: null,
    physicalDate: null,
    firstAirDate: null,
    nextEpisode: null,
    enriched: false,
  };
}

function localRowToResult(row: any, today: string) {
  if (row.kind === 'movie') {
    const dates = { digital: row.digital_date, theatrical: row.theatrical_date, physical: row.physical_date };
    return {
      type: 'movie',
      id: row.tmdb_id,
      title: row.title,
      poster: posterUrl(row.poster_path),
      backdrop: null,
      genres: [],
      year: yearOf(row.release_date || row.digital_date),
      status: row.digital_date
        ? status.deriveMovieStatus(dates, today)
        : status.deriveStatusFromDate(row.release_date, today),
      date: row.digital_date || row.release_date || null,
      releaseDate: row.release_date || null,
      digitalDate: row.digital_date || null,
      theatricalDate: row.theatrical_date || null,
      physicalDate: row.physical_date || null,
      firstAirDate: null,
      nextEpisode: null,
      enriched: !!(row.digital_date || row.theatrical_date || row.physical_date),
    };
  }
  const date = row.next_episode_air_date || row.first_air_date || null;
  return {
    type: 'tv',
    id: row.tmdb_id,
    title: row.title,
    poster: posterUrl(row.poster_path),
    backdrop: null,
    genres: [],
    year: yearOf(row.first_air_date),
    status: status.deriveStatusFromDate(date, today),
    date,
    releaseDate: null,
    digitalDate: null,
    theatricalDate: null,
    physicalDate: null,
    firstAirDate: row.first_air_date || null,
    nextEpisode: row.next_episode_air_date
      ? { airDate: row.next_episode_air_date, season: null, episode: null, name: null }
      : null,
    enriched: !!row.next_episode_air_date,
  };
}

function episodeOut(row: any, today: string) {
  return {
    id: row.tmdb_id,
    season: row.season,
    episode: row.episode,
    name: isGenericEpisodeName(row.name) ? null : row.name,
    airDate: row.air_date || null,
    runtime: typeof row.runtime === 'number' ? row.runtime : null,
    status: status.deriveStatusFromDate(row.air_date || null, today),
    badges: {
      seriesPremiere: !!row.is_series_premiere,
      seasonPremiere: !!row.is_season_premiere,
      finale: !!row.is_finale,
    },
  };
}

function seasonEpisodesFromPayload(payload: any, showId: number, show: any) {
  const showEnded = /^(ended|canceled|cancelled)$/i.test(String(show && show.status || ''));
  const last = show && show.last_episode_season !== null && show.last_episode_season !== undefined
    ? { season: show.last_episode_season, episode: show.last_episode_number }
    : null;
  const rows = [];
  for (const episode of Array.isArray(payload && payload.episodes) ? payload.episodes : []) {
    if (!episode || typeof episode.episode_number !== 'number') continue;
    const seasonNo = typeof episode.season_number === 'number' ? episode.season_number : 0;
    const isLastOfSeries = !!(last && last.season === seasonNo && last.episode === episode.episode_number);
    const badges = status.deriveEpisodeBadges({
      season: seasonNo,
      episode: episode.episode_number,
      isLastEpisodeOfSeries: isLastOfSeries,
      showEnded,
    });
    rows.push({
      tmdbId: typeof episode.id === 'number' ? episode.id : -1,
      showTmdbId: showId,
      season: seasonNo,
      episode: episode.episode_number,
      name: typeof episode.name === 'string' ? episode.name : null,
      airDate: typeof episode.air_date === 'string' && episode.air_date ? episode.air_date.slice(0, 10) : null,
      runtime: typeof episode.runtime === 'number' ? episode.runtime : null,
      seriesPremiere: badges.seriesPremiere,
      seasonPremiere: badges.seasonPremiere,
      finale: badges.finale,
    });
  }
  return rows.filter((row) => row.tmdbId > 0);
}

function createReleasesRouter(deps: ReleasesRouteDeps = {}): Router {
  const store = deps.store || require('../releases/store.ts');
  const getClient = deps.getClient || require('../releases/client.ts').getClient;
  const cache = deps.cache || require('../runtime/cache.ts');
  const enabled = deps.releasesEnabled || hosted.releasesEnabled;

  async function enrichMovieSearch(api: any, item: any, baseline: any, region: string, today: string) {
    const dates = status.pickRegionDates((await api.movieReleaseDates(item.id)).results, region);
    await store.upsertMovie({
      tmdbId: item.id,
      region,
      title: baseline.title,
      overview: item.overview || null,
      posterPath: item.poster_path || null,
      backdropPath: item.backdrop_path || null,
      genres: movieGenreNames(item.genre_ids),
      popularity: typeof item.popularity === 'number' ? item.popularity : null,
      voteAverage: typeof item.vote_average === 'number' ? item.vote_average : null,
      releaseDate: baseline.releaseDate,
      digital: dates.digital,
      theatrical: dates.theatrical,
      physical: dates.physical,
    });
    return {
      ...baseline,
      status: status.deriveMovieStatus(dates, today),
      date: dates.digital || baseline.releaseDate,
      digitalDate: dates.digital,
      theatricalDate: dates.theatrical,
      physicalDate: dates.physical,
      enriched: true,
    };
  }

  async function enrichTvSearch(api: any, item: any, baseline: any, today: string) {
    const detail = await api.tvDetail(item.id);
    const next = status.pickNextEpisode(detail);
    const last = detail && detail.last_episode_to_air;
    const lastAirDate = last && typeof last.air_date === 'string' ? last.air_date.slice(0, 10) : null;
    const runTimes = Array.isArray(detail && detail.episode_run_time)
      ? detail.episode_run_time.filter((value: any) => typeof value === 'number' && value > 0)
      : [];
    await store.upsertShow({
      tmdbId: item.id,
      name: baseline.title,
      overview: item.overview || null,
      posterPath: item.poster_path || null,
      backdropPath: item.backdrop_path || null,
      genres: tvGenreNames(item.genre_ids),
      originalLanguage: typeof item.original_language === 'string' ? item.original_language : null,
      originCountry: Array.isArray(item.origin_country) ? item.origin_country.filter((c: any) => typeof c === 'string') : [],
      firstAirDate: baseline.firstAirDate,
      popularity: typeof item.popularity === 'number' ? item.popularity : null,
      voteAverage: typeof item.vote_average === 'number' ? item.vote_average : null,
      episodeRunTime: runTimes.length ? runTimes[0] : null,
    });
    await store.updateShowDetail({
      tmdbId: item.id,
      status: typeof detail.status === 'string' ? detail.status : null,
      numberOfSeasons: typeof detail.number_of_seasons === 'number' ? detail.number_of_seasons : null,
      nextEpisodeAirDate: next ? next.airDate : null,
      nextEpisodeSeason: next ? next.season : null,
      nextEpisodeNumber: next ? next.episode : null,
      lastEpisodeAirDate: lastAirDate,
      lastEpisodeSeason: last && typeof last.season_number === 'number' ? last.season_number : null,
      lastEpisodeNumber: last && typeof last.episode_number === 'number' ? last.episode_number : null,
      episodeRunTime: runTimes.length ? runTimes[0] : null,
      genres: Array.isArray(detail.genres)
        ? detail.genres.map((genre: any) => (genre && typeof genre.name === 'string' ? genre.name : null)).filter(Boolean)
        : [],
      networks: Array.isArray(detail.networks)
        ? detail.networks.map((network: any) => (network && typeof network.name === 'string' ? network.name : null)).filter(Boolean)
        : [],
      showType: typeof detail.type === 'string' ? detail.type : null,
    });
    const date = next ? next.airDate : baseline.firstAirDate;
    return {
      ...baseline,
      status: status.deriveTvStatus(next ? next.airDate : null, lastAirDate, today),
      date,
      nextEpisode: next,
      enriched: true,
    };
  }

  async function upstreamSearch(requestId: string, query: string, region: string, settings: any) {
    const api = getClient();
    const data = await api.searchMulti(query, 1);
    const raw = Array.isArray(data && data.results) ? data.results : [];
    const items = raw
      .filter((item: any) => item && (item.media_type === 'movie' || item.media_type === 'tv'))
      .slice(0, settings.searchDetails);
    const today = todayIso();
    // Per-item isolation: a failed enrichment keeps the baseline result.
    return Promise.all(items.map(async (item: any) => {
      const baseline = baselineFromTmdbItem(item, today);
      try {
        return item.media_type === 'movie'
          ? await enrichMovieSearch(api, item, baseline, region, today)
          : await enrichTvSearch(api, item, baseline, today);
      } catch (err) {
        logError(requestId, 'enrichment', err);
        return baseline;
      }
    }));
  }

  const searchInFlight = new Map();
  const router: Router = express.Router();
  const browseLimit = rateLimit({ windowMs: 60000, max: 60 });
  const searchLimit = rateLimit({ windowMs: 60000, max: 20 });

  // Single hosted gate for the whole namespace. Unset key -> 404 everywhere.
  router.use('/api/releases', (req: any, res: any, next: any) => {
    if (!enabled()) return sendError(res, 404, 'Not found');
    next();
  });

  // Window/region metadata so the browser can bound its date pickers to what
  // the background sync actually caches. No TMDB call, no user data.
  router.get('/api/releases/config', (req: any, res: any) => {
    const settings = releasesSettings();
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      regions: settings.regions,
      windowPastDays: settings.windowPastDays,
      windowFutureDays: settings.windowFutureDays,
      maxRangeDays: settings.maxRangeDays,
    });
  });

  router.get('/api/releases/movies', browseLimit, async (req: any, res: any) => {
    const settings = releasesSettings();
    const region = validate.normalizeRegion(req.query.region || settings.regions[0], settings.regions);
    if (!region) return sendError(res, 400, 'Unknown region');
    const today = todayIso();
    const from = req.query.from ? String(req.query.from) : today;
    const to = req.query.to ? String(req.query.to) : validate.addDays(today, settings.windowFutureDays);
    if (!validate.isIsoDate(from) || !validate.isIsoDate(to)) return sendError(res, 400, 'from and to must be YYYY-MM-DD');
    const span = validate.daysBetween(from, to);
    if (span < 0) return sendError(res, 400, 'from must be on or before to');
    if (span > settings.maxRangeDays) return sendError(res, 400, `range must be at most ${settings.maxRangeDays} days`);
    const paging = validate.parsePage(req.query.page, 24, settings.maxPage);
    if (paging.error) return sendError(res, 400, paging.error);
    try {
      const [rows, total] = await Promise.all([
        store.listMovies({ region, from, to, limit: paging.pageSize, offset: paging.offset }),
        store.countMovies({ region, from, to }),
      ]);
      res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=3600');
      res.json({
        region, from, to,
        page: paging.page, pageSize: paging.pageSize,
        count: rows.length, total,
        results: rows.map((row: any) => movieResult(row, today)),
      });
    } catch (err) {
      logError(newRequestId(), 'movies', err);
      sendError(res, 503, 'Releases cache unavailable');
    }
  });

  router.get('/api/releases/tv/day', browseLimit, async (req: any, res: any) => {
    const settings = releasesSettings();
    const region = validate.normalizeRegion(req.query.region || settings.regions[0], settings.regions);
    if (!region) return sendError(res, 400, 'Unknown region');
    const date = req.query.date ? String(req.query.date) : todayIso();
    if (!validate.isIsoDate(date)) return sendError(res, 400, 'date must be YYYY-MM-DD');
    const sortRaw = req.query.sort === undefined || req.query.sort === '' ? 'popularity' : String(req.query.sort);
    if (sortRaw !== 'popularity' && sortRaw !== 'name') return sendError(res, 400, 'sort must be popularity or name');
    let language = null;
    if (req.query.language !== undefined && String(req.query.language).trim() !== '') {
      language = String(req.query.language).trim().toLowerCase();
      if (!/^[a-z]{2}$/.test(language)) return sendError(res, 400, 'language must be a two-letter code');
    }
    let types = [];
    if (req.query.type !== undefined && String(req.query.type).trim() !== '') {
      types = String(req.query.type).split(',').map((value) => value.trim()).filter(Boolean);
      const invalid = types.find((value) => !SHOW_TYPES.includes(value));
      if (invalid) return sendError(res, 400, `unknown type: ${invalid}`);
    }
    const notable = req.query.notable === undefined
      ? true
      : !(String(req.query.notable) === 'false' || String(req.query.notable) === '0');
    try {
      // The whole day is loaded so facets and the filtered/total counts are
      // exact. A single day is small (tens of shows); still bounded.
      const rows = await store.listDay({ date, limit: 2000, offset: 0 });
      const all = groupDayRows(rows);
      const facets = dayFacets(all);
      const shows = sortDayShows(
        filterDayShows(all, { language, types, notable, minPopularity: settings.notableMinPopularity }),
        sortRaw,
      );
      res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=3600');
      res.json({
        region, date, sort: sortRaw, notable, language, types,
        total: shows.length,
        totalAll: all.length,
        facets,
        shows,
      });
    } catch (err) {
      logError(newRequestId(), 'tv-day', err);
      sendError(res, 503, 'Releases cache unavailable');
    }
  });

  // One row per day for the strip above the day view: how many shows air, and
  // how many of them carry a premiere or finale. Counts use the same filters as
  // the list beside them, so the numbers always match what is on screen.
  router.get('/api/releases/tv/week', browseLimit, async (req: any, res: any) => {
    const settings = releasesSettings();
    const region = validate.normalizeRegion(req.query.region || settings.regions[0], settings.regions);
    if (!region) return sendError(res, 400, 'Unknown region');
    const from = req.query.from ? String(req.query.from) : '';
    if (!validate.isIsoDate(from)) return sendError(res, 400, 'from must be YYYY-MM-DD');
    const daysRaw = req.query.days === undefined || String(req.query.days).trim() === ''
      ? 7
      : Number(req.query.days);
    if (!Number.isInteger(daysRaw) || daysRaw < 1 || daysRaw > MAX_WEEK_DAYS) {
      return sendError(res, 400, `days must be between 1 and ${MAX_WEEK_DAYS}`);
    }
    let language = null;
    if (req.query.language !== undefined && String(req.query.language).trim() !== '') {
      language = String(req.query.language).trim().toLowerCase();
      if (!/^[a-z]{2}$/.test(language)) return sendError(res, 400, 'language must be a two-letter code');
    }
    let types = [];
    if (req.query.type !== undefined && String(req.query.type).trim() !== '') {
      types = String(req.query.type).split(',').map((value: string) => value.trim()).filter(Boolean);
      const invalid = types.find((value: string) => !SHOW_TYPES.includes(value));
      if (invalid) return sendError(res, 400, `unknown type: ${invalid}`);
    }
    const notable = req.query.notable === undefined
      ? true
      : !(String(req.query.notable) === 'false' || String(req.query.notable) === '0');
    const to = validate.addDays(from, daysRaw - 1);
    try {
      const rows = await store.listRange({ from, to, limit: MAX_WEEK_ROWS });
      const byDate = new Map<string, any[]>();
      for (const row of rows) {
        const list = byDate.get(row.air_date);
        if (list) list.push(row);
        else byDate.set(row.air_date, [row]);
      }
      const days = [];
      for (let offset = 0; offset < daysRaw; offset++) {
        const date = validate.addDays(from, offset);
        const dayRows = byDate.get(date) || [];
        const all = groupDayRows(dayRows);
        const shows = filterDayShows(all, { language, types, notable, minPopularity: settings.notableMinPopularity });
        days.push({
          date,
          total: shows.length,
          totalAll: all.length,
          premieres: shows.filter((show: any) => show.premiereDay).length,
        });
      }
      res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=3600');
      res.json({ region, from, to, notable, language, types, days });
    } catch (err) {
      logError(newRequestId(), 'tv-week', err);
      sendError(res, 503, 'Releases cache unavailable');
    }
  });

  router.get('/api/releases/title/:type/:tmdbId', browseLimit, async (req: any, res: any) => {
    const settings = releasesSettings();
    const type = String(req.params.type || '');
    if (type !== 'movie' && type !== 'tv') return sendError(res, 400, 'type must be movie or tv');
    const tmdbId = Number(req.params.tmdbId);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) return sendError(res, 400, 'tmdbId must be a positive integer');
    const region = validate.normalizeRegion(req.query.region || settings.regions[0], settings.regions);
    if (!region) return sendError(res, 400, 'Unknown region');
    const today = todayIso();
    try {
      if (type === 'movie') {
        let row = (await store.getMovie(tmdbId, region)) || (await store.getMovieAnyRegion(tmdbId));
        if (!row) return sendError(res, 404, 'Not found');
        // Lazily fill genres/backdrop for a sparse row (e.g. an old search hit
        // outside the sync window). Detail paths may fetch; browse/day do not.
        if ((!Array.isArray(row.genres) || row.genres.length === 0) || !row.backdrop_path) {
          try {
            const meta = await getClient().movieDetail(tmdbId);
            const metaGenres = Array.isArray(meta && meta.genres)
              ? meta.genres.map((genre: any) => (genre && typeof genre.name === 'string' ? genre.name : null)).filter(Boolean)
              : [];
            const genres = metaGenres.length ? metaGenres : movieGenreNames(meta && meta.genre_ids);
            const backdropPath = meta && meta.backdrop_path ? meta.backdrop_path : null;
            if (genres.length || backdropPath) {
              const targetRegion = row.region || region;
              await store.updateMovieMeta({ tmdbId, region: targetRegion, genres, backdropPath }).catch(() => {});
              row = { ...row, genres: genres.length ? genres : row.genres, backdrop_path: backdropPath || row.backdrop_path };
            }
          } catch (err) {
            logError(newRequestId(), 'movie-detail', err);
          }
        }
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.json({ ...movieResult(row, today), region });
      }
      const show = await store.getShow(tmdbId);
      if (!show) return sendError(res, 404, 'Not found');
      const seasons = await store.listSeasons(tmdbId);
      const next = show.next_episode_air_date
        ? {
          airDate: show.next_episode_air_date,
          season: show.next_episode_season,
          episode: show.next_episode_number,
          name: null,
        }
        : null;
      const last = show.last_episode_air_date
        ? {
          airDate: show.last_episode_air_date,
          season: show.last_episode_season,
          episode: show.last_episode_number,
          name: null,
        }
        : null;
      const date = (next && next.airDate) || (last && last.airDate) || show.first_air_date || null;
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.json({
        type: 'tv',
        id: show.tmdb_id,
        title: show.name,
        overview: show.overview || null,
        poster: posterUrl(show.poster_path),
        backdrop: backdropUrl(show.backdrop_path),
        genres: Array.isArray(show.genres) ? show.genres : [],
        year: yearOf(show.first_air_date),
        status: status.deriveTvStatus(next ? next.airDate : null, last ? last.airDate : null, today),
        date,
        releaseDate: null,
        digitalDate: null,
        theatricalDate: null,
        physicalDate: null,
        firstAirDate: show.first_air_date || null,
        nextEpisode: next,
        lastEpisode: last,
        showStatus: show.status || null,
        showType: show.show_type || null,
        language: show.original_language || null,
        networks: Array.isArray(show.networks) ? show.networks : [],
        numberOfSeasons: show.number_of_seasons ?? null,
        episodeRunTime: show.episode_run_time ?? null,
        seasons: seasons.map((season: any) => ({
          season: season.season_number,
          name: season.name || null,
          airDate: season.air_date || null,
          episodeCount: season.episode_count ?? null,
          poster: season.poster_path ? seasonPosterUrl(season.poster_path) : seasonPosterUrl(show.poster_path),
          overview: season.overview || null,
          isSpecials: !!season.is_specials,
          episodesFetched: !!season.episodes_fetched,
        })).sort((a: any, b: any) => (Number(a.isSpecials) - Number(b.isSpecials)) || (a.season - b.season)),
        region,
      });
    } catch (err) {
      logError(newRequestId(), 'title', err);
      sendError(res, 503, 'Releases cache unavailable');
    }
  });

  // Lazy per-season episodes: SQL first, TMDB on a cold/stale cache. A failure
  // here affects only this season, never the title page.
  router.get('/api/releases/title/tv/:tmdbId/season/:season', browseLimit, async (req: any, res: any) => {
    const settings = releasesSettings();
    const tmdbId = Number(req.params.tmdbId);
    const seasonNumber = Number(req.params.season);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) return sendError(res, 400, 'tmdbId must be a positive integer');
    if (!Number.isInteger(seasonNumber) || seasonNumber < 0) return sendError(res, 400, 'season must be a non-negative integer');
    const requestId = newRequestId();
    const today = todayIso();
    try {
      const show = await store.getShow(tmdbId);
      if (!show) return sendError(res, 404, 'Not found');
      let episodes = await store.listSeasonEpisodes(tmdbId, seasonNumber);
      const fetchedAt = await store.seasonEpisodesFetchedAt(tmdbId, seasonNumber);
      const fresh = fetchedAt && (Date.now() - Date.parse(fetchedAt) < settings.detailTtlMs);
      if (fresh) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.json({ showId: tmdbId, season: seasonNumber, count: episodes.length, fetched: true, episodes: episodes.map((row: any) => episodeOut(row, today)) });
      }
      try {
        const payload = await getClient().tvSeason(tmdbId, seasonNumber);
        const rows = seasonEpisodesFromPayload(payload, tmdbId, show);
        if (rows.length) await store.upsertEpisodes(rows);
        await store.markSeasonEpisodesFetched(tmdbId, seasonNumber);
        episodes = await store.listSeasonEpisodes(tmdbId, seasonNumber);
        res.setHeader('Cache-Control', 'public, max-age=600');
        return res.json({ showId: tmdbId, season: seasonNumber, count: episodes.length, fetched: true, episodes: episodes.map((row: any) => episodeOut(row, today)) });
      } catch (err) {
        logError(requestId, 'season', err);
        // Serve stale cached episodes if we have any; otherwise a clear,
        // season-scoped error the UI can retry.
        if (episodes.length) {
          res.setHeader('Cache-Control', 'public, max-age=300');
          return res.json({ showId: tmdbId, season: seasonNumber, count: episodes.length, fetched: false, stale: true, error: 'stale', episodes: episodes.map((row: any) => episodeOut(row, today)) });
        }
        return sendError(res, 502, 'Season unavailable right now');
      }
    } catch (err) {
      logError(requestId, 'season-db', err);
      sendError(res, 503, 'Releases cache unavailable');
    }
  });

  router.get('/api/releases/search', searchLimit, async (req: any, res: any) => {
    const settings = releasesSettings();
    const requestId = newRequestId();
    const region = validate.normalizeRegion(req.query.region || settings.regions[0], settings.regions);
    if (!region) return sendError(res, 400, 'Unknown region');
    const query = validate.normalizeQuery(req.query.q);
    if (!query) return sendError(res, 400, 'q must be between 2 and 100 characters');
    const today = todayIso();
    const key = `relsearch:${region}:${validate.normalizeSearchKey(query)}`;
    try {
      const cached = await cache.get(key).catch(() => null);
      if (Array.isArray(cached)) {
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.json({ query, region, source: 'cache', results: cached });
      }
      // Local Postgres first: instant and free.
      const localRows = await store.localSearch({ query, limit: 10 }).catch((err: any) => {
        logError(requestId, 'local', err);
        return [];
      });
      if (localRows.length) {
        const results = localRows.map((row: any) => localRowToResult(row, today));
        await cache.set(key, results, settings.searchTtlSeconds).catch(() => {});
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.json({ query, region, source: 'local', results });
      }
      // Coalesce concurrent identical upstream lookups. The in-flight promise
      // never rejects and is never cached as a failure: it resolves to an
      // outcome the callers interpret, and is cleared on settle so the next
      // request retries.
      let pending = searchInFlight.get(key);
      if (!pending) {
        pending = upstreamSearch(requestId, query, region, settings)
          .then((results: any) => ({ ok: true, results }))
          .catch((err: any) => {
            logError(requestId, 'upstream', err);
            return { ok: false, status: Number(err && (err.status || err.response?.status)) || 502 };
          })
          .finally(() => searchInFlight.delete(key));
        searchInFlight.set(key, pending);
      }
      const outcome = await pending;
      if (!outcome.ok) {
        return sendError(res, 502, 'Search is unavailable right now. Try again in a moment.');
      }
      await cache.set(key, outcome.results, settings.searchTtlSeconds).catch(() => {});
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.json({ query, region, source: 'tmdb', results: outcome.results });
    } catch (err) {
      logError(requestId, 'search', err);
      sendError(res, 502, 'Search is unavailable right now. Try again in a moment.');
    }
  });

  return router;
}

function mountReleasesRoutes(app: Express): void {
  app.use(createReleasesRouter());
}

module.exports = { createReleasesRouter, mountReleasesRoutes } satisfies ReleasesRoutesApi;
