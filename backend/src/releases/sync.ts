// @ts-nocheck
// Background sync for the hosted Releases feature.
//
// Timer-driven, overlap-guarded, Postgres-backed. Browse and day-view reads
// never call TMDB; only this engine does. Every run refreshes the rolling
// window (and a narrower "near" slice more often), fetches per-title detail
// only when stale, and deletes rows that have not been refreshed within the
// configured stale window.
const { releasesEnabled } = require('../platform/hosted.ts');
const { releasesSettings } = require('./config.ts');
const { getClient } = require('./client.ts');
const store = require('./store.ts');
const { dateWindow, toIsoDate, addDays } = require('./validate.ts');
const { pickRegionDates, deriveEpisodeBadges } = require('./status.ts');
const { movieGenreNames, tvGenreNames } = require('./genres.ts');
const { pLimit } = require('../library/util.ts');

let running = false;
let started = false;
let timers = [];
let lastRunAt = null;
let lastRunMs = 0;
let lastError = null;
let lastCounts = { movies: 0, shows: 0, episodes: 0, details: 0, cleaned: 0 };

function todayIso() {
  return toIsoDate(new Date());
}

function endedShow(status) {
  const value = String(status || '').toLowerCase();
  return value === 'ended' || value === 'canceled' || value === 'cancelled';
}

function movieRowFromResult(result, region) {
  return {
    tmdbId: Number(result.id),
    region,
    title: String(result.title || result.original_title || ''),
    overview: result.overview || null,
    posterPath: result.poster_path || null,
    backdropPath: result.backdrop_path || null,
    genres: movieGenreNames(result.genre_ids),
    popularity: typeof result.popularity === 'number' ? result.popularity : null,
    voteAverage: typeof result.vote_average === 'number' ? result.vote_average : null,
    releaseDate: typeof result.release_date === 'string' && result.release_date ? result.release_date : null,
    // The digital date is only known from /movie/{id}/release_dates; never
    // guess it from the discover row's primary release_date.
    digital: null,
    theatrical: null,
    physical: null,
  };
}

function showRowFromResult(result) {
  return {
    tmdbId: Number(result.id),
    name: String(result.name || result.original_name || ''),
    overview: result.overview || null,
    posterPath: result.poster_path || null,
    backdropPath: result.backdrop_path || null,
    genres: tvGenreNames(result.genre_ids),
    originalLanguage: typeof result.original_language === 'string' ? result.original_language : null,
    originCountry: Array.isArray(result.origin_country) ? result.origin_country.filter((c) => typeof c === 'string') : [],
    firstAirDate: typeof result.first_air_date === 'string' && result.first_air_date ? result.first_air_date : null,
    popularity: typeof result.popularity === 'number' ? result.popularity : null,
    voteAverage: typeof result.vote_average === 'number' ? result.vote_average : null,
  };
}

async function discoverMovies(region, from, to, settings) {
  const api = getClient();
  // Walk the window in slices so a wide window is not cut off by the per-slice
  // page cap. Scanning one page-limited range sorted ascending would only ever
  // cache the earliest releases.
  let cursor = from;
  while (cursor <= to) {
    const sliceEnd = addDays(cursor, settings.sliceDays - 1) > to ? to : addDays(cursor, settings.sliceDays - 1);
    for (let page = 1; page <= settings.maxPages; page++) {
      let data;
      try {
        data = await api.discoverMovies({ region, from: cursor, to: sliceEnd, page });
      } catch (err) {
        lastError = err.message;
        break;
      }
      const results = Array.isArray(data && data.results) ? data.results : [];
      for (const result of results) {
        if (!result || !result.id) continue;
        await store.upsertMovie(movieRowFromResult(result, region)).catch(() => {});
        lastCounts.movies++;
      }
      const totalPages = Number(data && data.total_pages) || 1;
      if (page >= totalPages || results.length === 0) break;
    }
    cursor = addDays(sliceEnd, 1);
  }
}

async function refreshMovieDetails(regions, settings) {
  const windowDays = settings.windowPastDays + settings.windowFutureDays;
  const slices = Math.max(1, Math.ceil(windowDays / settings.sliceDays));
  const pending = await store.movieRegionsNeedingDetail({
    regions,
    ttlSeconds: Math.round(settings.detailTtlMs / 1000),
    limit: settings.maxPages * 20 * slices,
  }).catch(() => []);
  if (!pending.length) return;
  const api = getClient();
  await pLimit(pending, settings.concurrency, async (row) => {
    try {
      const data = await api.movieReleaseDates(row.tmdb_id);
      const dates = pickRegionDates(data && data.results, row.region);
      await store.updateMovieDetail({
        tmdbId: row.tmdb_id,
        region: row.region,
        digital: dates.digital,
        theatrical: dates.theatrical,
        physical: dates.physical,
      });
      lastCounts.details++;
    } catch (err) {
      lastError = err.message;
    }
  });
}

async function discoverShows(from, to, settings) {
  // TV air dates are global on TMDB, so this runs once rather than per region.
  const api = getClient();
  const ids = new Set();
  const collect = (results) => {
    for (const result of results || []) {
      if (!result || !result.id) continue;
      ids.add(Number(result.id));
    }
  };
  // Slice the premiere window the same way as movies so a wide range is not
  // truncated by the page cap.
  let cursor = from;
  while (cursor <= to) {
    const sliceEnd = addDays(cursor, settings.sliceDays - 1) > to ? to : addDays(cursor, settings.sliceDays - 1);
    for (let page = 1; page <= settings.maxPages; page++) {
      let data;
      try { data = await api.discoverTv({ from: cursor, to: sliceEnd, page }); } catch (err) { lastError = err.message; break; }
      const results = Array.isArray(data && data.results) ? data.results : [];
      for (const result of results) {
        if (!result || !result.id) continue;
        await store.upsertShow(showRowFromResult(result)).catch(() => {});
        lastCounts.shows++;
      }
      collect(results);
      if (page >= (Number(data && data.total_pages) || 1) || results.length === 0) break;
    }
    cursor = addDays(sliceEnd, 1);
  }
  for (const [fn, label] of [[api.airingToday, 'airing_today'], [api.onTheAir, 'on_the_air']]) {
    for (let page = 1; page <= settings.maxPages; page++) {
      let data;
      try { data = await fn.call(api, { page }); } catch (err) { lastError = err.message; break; }
      const results = Array.isArray(data && data.results) ? data.results : [];
      for (const result of results) {
        if (!result || !result.id) continue;
        await store.upsertShow(showRowFromResult(result)).catch(() => {});
        lastCounts.shows++;
      }
      collect(results);
      if (page >= (Number(data && data.total_pages) || 1) || results.length === 0) break;
    }
  }
  return [...ids];
}

async function refreshShowDetails(candidateIds, settings) {
  // Refresh any show whose detail is stale (not just the ones re-discovered in
  // this run), so a show already in the cache still gets its full season list
  // on the normal cadence. Bounded per run; converges over successive runs.
  const stale = await store.showsNeedingDetail({
    ttlSeconds: Math.round(settings.detailTtlMs / 1000),
    limit: settings.maxTvDetails,
  }).catch(() => []);
  const ids = [...new Set([...candidateIds, ...stale])].slice(0, settings.maxTvDetails);
  if (!ids.length) return;
  const api = getClient();
  const windowFrom = addDays(todayIso(), -settings.windowPastDays);
  const windowTo = addDays(todayIso(), settings.windowFutureDays);
  await pLimit(ids, settings.concurrency, async (id) => {
    try {
      const detail = await api.tvDetail(id);
      if (!detail) return;
      const next = detail.next_episode_to_air || null;
      const last = detail.last_episode_to_air || null;
      const runTimes = Array.isArray(detail.episode_run_time)
        ? detail.episode_run_time.filter((value) => typeof value === 'number' && value > 0)
        : [];
      const genreNames = Array.isArray(detail.genres)
        ? detail.genres.map((genre) => (genre && typeof genre.name === 'string' ? genre.name : null)).filter(Boolean)
        : [];
      const networkNames = Array.isArray(detail.networks)
        ? detail.networks.map((network) => (network && typeof network.name === 'string' ? network.name : null)).filter(Boolean)
        : [];
      await store.updateShowDetail({
        tmdbId: id,
        status: typeof detail.status === 'string' ? detail.status : null,
        numberOfSeasons: typeof detail.number_of_seasons === 'number' ? detail.number_of_seasons : null,
        nextEpisodeAirDate: next && typeof next.air_date === 'string' ? next.air_date.slice(0, 10) : null,
        nextEpisodeSeason: next && typeof next.season_number === 'number' ? next.season_number : null,
        nextEpisodeNumber: next && typeof next.episode_number === 'number' ? next.episode_number : null,
        lastEpisodeAirDate: last && typeof last.air_date === 'string' ? last.air_date.slice(0, 10) : null,
        lastEpisodeSeason: last && typeof last.season_number === 'number' ? last.season_number : null,
        lastEpisodeNumber: last && typeof last.episode_number === 'number' ? last.episode_number : null,
        episodeRunTime: runTimes.length ? runTimes[0] : null,
        genres: genreNames,
        networks: networkNames,
        showType: typeof detail.type === 'string' ? detail.type : null,
      });

      // Store EVERY season TMDB lists, including specials (season 0) and
      // undated/unaired ones. This is the source of truth for the detail page.
      const seasonRows = (Array.isArray(detail.seasons) ? detail.seasons : [])
        .filter((season) => season && typeof season.season_number === 'number')
        .map((season) => ({
          seasonNumber: season.season_number,
          name: typeof season.name === 'string' ? season.name : null,
          airDate: typeof season.air_date === 'string' && season.air_date ? season.air_date.slice(0, 10) : null,
          episodeCount: typeof season.episode_count === 'number' ? season.episode_count : null,
          posterPath: season.poster_path || null,
          overview: typeof season.overview === 'string' ? season.overview : null,
          isSpecials: season.season_number === 0,
        }));
      if (seasonRows.length) await store.upsertSeasons(id, seasonRows);

      // Eagerly fetch episodes only for seasons the day view needs now: the
      // next/last episode seasons and any season starting inside the window.
      // Everything else is fetched lazily when a season is expanded.
      const seasonNumbers = new Set();
      if (next && typeof next.season_number === 'number') seasonNumbers.add(next.season_number);
      if (last && typeof last.season_number === 'number') seasonNumbers.add(last.season_number);
      for (const season of seasonRows) {
        if (season.airDate && season.airDate >= windowFrom && season.airDate <= windowTo) {
          seasonNumbers.add(season.seasonNumber);
        }
      }

      const rows = [];
      for (const seasonNumber of [...seasonNumbers].slice(0, 5)) {
        let season;
        try { season = await api.tvSeason(id, seasonNumber); } catch (err) { lastError = err.message; continue; }
        for (const episode of Array.isArray(season && season.episodes) ? season.episodes : []) {
          if (!episode || typeof episode.episode_number !== 'number') continue;
          const seasonNo = typeof episode.season_number === 'number' ? episode.season_number : seasonNumber;
          const isLastOfSeries = !!(last
            && last.season_number === seasonNo
            && last.episode_number === episode.episode_number);
          const badges = deriveEpisodeBadges({
            season: seasonNo,
            episode: episode.episode_number,
            isLastEpisodeOfSeries: isLastOfSeries,
            showEnded: endedShow(detail.status),
          });
          rows.push({
            tmdbId: typeof episode.id === 'number' ? episode.id : -1,
            showTmdbId: id,
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
        await store.markSeasonEpisodesFetched(id, seasonNumber).catch(() => {});
      }
      // Episodes without a TMDB episode id cannot be keyed; skip them rather
      // than collide on a synthetic -1.
      const usable = rows.filter((row) => row.tmdbId > 0);
      if (usable.length) {
        await store.upsertEpisodes(usable);
        lastCounts.episodes += usable.length;
      }
      lastCounts.details++;
    } catch (err) {
      lastError = err.message;
    }
  });
}

async function runOnce(options = {}) {
  if (running) return { skipped: true };
  if (!releasesEnabled()) return { skipped: true, reason: 'disabled' };
  running = true;
  const startedAt = Date.now();
  lastCounts = { movies: 0, shows: 0, episodes: 0, details: 0, cleaned: 0 };
  try {
    const settings = releasesSettings();
    const today = todayIso();
    const from = options.nearOnly ? today : addDays(today, -settings.windowPastDays);
    const to = options.nearOnly ? addDays(today, settings.nearDays) : addDays(today, settings.windowFutureDays);

    const ok = await store.ensure();
    if (!ok) return { skipped: true, reason: 'no-database' };

    for (const region of settings.regions) {
      await discoverMovies(region, from, to, settings);
    }
    await refreshMovieDetails(settings.regions, settings);

    const showIds = await discoverShows(from, to, settings);
    await refreshShowDetails(showIds, settings);

    if (!options.nearOnly) {
      lastCounts.cleaned = await store.cleanupStale(settings.staleDays).catch(() => 0);
    }
    return { ran: true, from, to, counts: { ...lastCounts } };
  } catch (err) {
    lastError = err.message;
    console.warn('[Releases] sync failed:', err.message);
    return { ran: false, error: err.message };
  } finally {
    running = false;
    lastRunAt = new Date().toISOString();
    lastRunMs = Date.now() - startedAt;
  }
}

async function start() {
  if (started) return releasesEnabled();
  started = true;
  if (!releasesEnabled()) {
    console.log('[Releases] hosted-only feature off (RELEASES_TMDB_API_KEY unset)');
    return false;
  }
  const ok = await store.ensure().catch(() => false);
  if (!ok) {
    console.warn('[Releases] database unavailable, sync not started');
    return false;
  }
  const settings = releasesSettings();
  console.log(`[Releases] sync started: full=${settings.syncIntervalMs / 1000}s near=${settings.nearIntervalMs / 1000}s regions=${settings.regions.join(',')}`);
  const initial = setTimeout(() => { runOnce().catch(() => {}); }, 5000);
  initial.unref?.();
  const full = setInterval(() => { runOnce().catch(() => {}); }, settings.syncIntervalMs);
  full.unref?.();
  const near = setInterval(() => { runOnce({ nearOnly: true }).catch(() => {}); }, settings.nearIntervalMs);
  near.unref?.();
  timers = [initial, full, near];
  return true;
}

function stop() {
  for (const timer of timers) {
    clearTimeout(timer);
    clearInterval(timer);
  }
  timers = [];
  started = false;
}

function status() {
  return {
    enabled: releasesEnabled(),
    started,
    running,
    lastRunAt,
    lastRunMs,
    lastError,
    lastCounts,
  };
}

module.exports = { start, stop, runOnce, status };
