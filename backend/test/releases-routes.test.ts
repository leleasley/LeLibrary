// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const hosted = require('../src/platform/hosted.ts');
const { createReleasesRouter } = require('../src/routes/releases.ts');
const { rateLimitBuckets } = require('../src/middleware/rate-limit.ts');

function makeStore(overrides = {}) {
          const calls = { upsertMovie: 0, upsertShow: 0, updateShowDetail: 0, upsertEpisodes: 0, markSeasonEpisodesFetched: 0, updateMovieMeta: 0 };
  const store = {
    listMovies: async () => [],
    countMovies: async () => 0,
    listDay: async () => [],
    listRange: async () => [],
    getMovie: async () => null,
    getMovieAnyRegion: async () => null,
    getShow: async () => null,
    listSeasons: async () => [],
    getSeason: async () => null,
    listSeasonEpisodes: async () => [],
    seasonEpisodesFetchedAt: async () => '2026-10-07T00:00:00.000Z',
    markSeasonEpisodesFetched: async () => { calls.markSeasonEpisodesFetched++; },
    listShowEpisodes: async () => [],
    localSearch: async () => [],
    upsertMovie: async () => { calls.upsertMovie++; },
    upsertShow: async () => { calls.upsertShow++; },
    updateShowDetail: async () => { calls.updateShowDetail++; },
    upsertEpisodes: async () => { calls.upsertEpisodes++; },
    updateMovieMeta: async () => { calls.updateMovieMeta++; },
    ...overrides,
  };
  return { store, calls };
}

function makeCache(overrides = {}) {
  return { get: async () => null, set: async () => undefined, ...overrides };
}

async function withServer(router, fn) {
  // The rate-limit buckets are a process-wide map shared by every limiter, so a
  // previous scenario's requests would otherwise count against this one.
  rateLimitBuckets.clear();
  const app = express();
  app.set('trust proxy', true);
  app.use(router);
  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function getJson(url, ip = '10.0.0.1') {
  const res = await fetch(url, { headers: { 'x-forwarded-for': ip } });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body, headers: res.headers };
}

const MOVIE_ROW = {
  tmdb_id: 101, region: 'GB', title: 'Wicked', overview: 'Elphaba and Glinda.',
  poster_path: '/wicked.jpg', backdrop_path: '/wicked-bg.jpg', genres: ['Drama'], popularity: 90, vote_average: 7.5,
  release_date: '2026-06-10', digital_date: '2026-06-10', theatrical_date: null, physical_date: null,
};

const DAY_ROW = {
  tmdb_id: 5001, show_tmdb_id: 900, season: 2, episode: 1, name: 'Return',
  air_date: '2026-10-07', is_series_premiere: false, is_season_premiere: true, is_finale: false,
  show_name: 'The Show', show_poster: '/show.jpg', show_status: 'Returning Series',
};

test('hosted flag follows RELEASES_TMDB_API_KEY presence', () => {
  const prev = process.env.RELEASES_TMDB_API_KEY;
  delete process.env.RELEASES_TMDB_API_KEY;
  assert.equal(hosted.releasesEnabled(), false);
  process.env.RELEASES_TMDB_API_KEY = 'test-key';
  assert.equal(hosted.releasesEnabled(), true);
  if (prev === undefined) delete process.env.RELEASES_TMDB_API_KEY;
  else process.env.RELEASES_TMDB_API_KEY = prev;
});

test('hosted mode off: every releases route is 404', async () => {
  const router = createReleasesRouter({
    releasesEnabled: () => false,
    store: makeStore().store,
    cache: makeCache(),
    getClient: () => ({ searchMulti: async () => ({ results: [] }) }),
  });
  await withServer(router, async (base) => {
    const paths = [
      '/api/releases/config',
      '/api/releases/movies?region=GB',
      '/api/releases/tv/day?region=GB&date=2026-10-07',
      '/api/releases/tv/week?from=2026-10-07&days=7',
      '/api/releases/title/movie/101?region=GB',
      '/api/releases/title/tv/900?region=GB',
      '/api/releases/search?region=GB&q=wicked',
    ];
    for (const path of paths) {
      const res = await getJson(`${base}${path}`);
      assert.equal(res.status, 404, path);
      assert.equal(res.body.error, 'Not found', path);
    }
  });
});

test('config exposes the cache window to the browser', async () => {
  const { store } = makeStore();
  const router = createReleasesRouter({
    releasesEnabled: () => true,
    store,
    cache: makeCache(),
    getClient: () => { throw new Error('config must not call TMDB'); },
  });
  await withServer(router, async (base) => {
    const res = await getJson(`${base}/api/releases/config`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.regions));
    assert.equal(typeof res.body.windowPastDays, 'number');
    assert.equal(typeof res.body.windowFutureDays, 'number');
    assert.equal(typeof res.body.maxRangeDays, 'number');
  });
});

test('movies returns cached rows with derived status and a TMDB poster URL', async () => {
  const { store } = makeStore({
    listMovies: async () => [MOVIE_ROW],
    countMovies: async () => 1,
  });
  const router = createReleasesRouter({ releasesEnabled: () => true, store, cache: makeCache() });
  await withServer(router, async (base) => {
    const res = await getJson(`${base}/api/releases/movies?region=GB&from=2026-06-01&to=2026-06-30`);
    assert.equal(res.status, 200);
    assert.equal(res.body.region, 'GB');
    assert.equal(res.body.total, 1);
    assert.equal(res.body.results.length, 1);
    const movie = res.body.results[0];
    assert.equal(movie.id, 101);
    assert.equal(movie.type, 'movie');
    assert.equal(movie.status, 'released');
    assert.equal(movie.poster, 'https://image.tmdb.org/t/p/w342/wicked.jpg');
    assert.match(res.headers.get('cache-control'), /max-age=600/);
  });
});

test('tv day groups episodes by show with badges', async () => {
  const { store } = makeStore({ listDay: async () => [DAY_ROW] });
  const router = createReleasesRouter({ releasesEnabled: () => true, store, cache: makeCache() });
  await withServer(router, async (base) => {
    const res = await getJson(`${base}/api/releases/tv/day?region=GB&date=2026-10-07`);
    assert.equal(res.status, 200);
    assert.equal(res.body.date, '2026-10-07');
    assert.equal(res.body.shows.length, 1);
    const show = res.body.shows[0];
    assert.equal(show.id, 900);
    assert.equal(show.episodes[0].season, 2);
    assert.equal(show.episodes[0].badges.seasonPremiere, true);
    assert.equal(show.episodes[0].badges.finale, false);
  });
});

test('title movie and tv detail shapes, including specials and undated seasons', async () => {
  const { store } = makeStore({
    getMovie: async () => MOVIE_ROW,
    getShow: async () => ({
      tmdb_id: 900, name: 'The Show', overview: 'Overview', poster_path: '/show.jpg', backdrop_path: '/show-bg.jpg',
      genres: ['Drama'], first_air_date: '2024-01-01', popularity: 10, vote_average: 6, status: 'Returning Series',
      number_of_seasons: 3, episode_run_time: 42,
      next_episode_air_date: '2026-11-01', next_episode_season: 3, next_episode_number: 5,
      last_episode_air_date: '2026-10-14', last_episode_season: 3, last_episode_number: 2,
    }),
    listSeasons: async () => [
      { season_number: 0, name: 'Specials', air_date: null, episode_count: 4, poster_path: null, overview: null, is_specials: true, episodes_fetched: false },
      { season_number: 1, name: 'Season 1', air_date: '2024-01-01', episode_count: 8, poster_path: '/s1.jpg', overview: null, is_specials: false, episodes_fetched: true },
      { season_number: 3, name: 'Season 3', air_date: null, episode_count: null, poster_path: null, overview: null, is_specials: false, episodes_fetched: false },
    ],
    listSeasonEpisodes: async () => ([
      { tmdb_id: 5001, season: 3, episode: 2, name: 'Return', air_date: '2026-10-14', runtime: 42, is_series_premiere: false, is_season_premiere: false, is_finale: false },
    ]),
    seasonEpisodesFetchedAt: async () => new Date().toISOString(),
  });
  const router = createReleasesRouter({ releasesEnabled: () => true, store, cache: makeCache() });
  await withServer(router, async (base) => {
    const movie = await getJson(`${base}/api/releases/title/movie/101?region=GB`);
    assert.equal(movie.status, 200);
    assert.equal(movie.body.type, 'movie');
    assert.equal(movie.body.status, 'released');
    assert.equal(movie.body.date, '2026-06-10');

    const tv = await getJson(`${base}/api/releases/title/tv/900?region=GB`);
    assert.equal(tv.status, 200);
    assert.equal(tv.body.type, 'tv');
    assert.equal(tv.body.seasons.length, 3);
    // numbered ascending, specials last
    assert.deepEqual(tv.body.seasons.map((s: any) => s.season), [1, 3, 0]);
    assert.equal(tv.body.seasons[2].isSpecials, true);
    assert.equal(tv.body.seasons[1].airDate, null);
    assert.equal(tv.body.genres[0], 'Drama');
    assert.equal(tv.body.episodeRunTime, 42);
    assert.equal(tv.body.nextEpisode.airDate, '2026-11-01');
    assert.match(tv.headers.get('cache-control'), /max-age=3600/);

    // Lazy season: fresh cache is served without a TMDB fetch.
    const season = await getJson(`${base}/api/releases/title/tv/900/season/3`);
    assert.equal(season.status, 200);
    assert.equal(season.body.episodes.length, 1);
    assert.equal(season.body.episodes[0].runtime, 42);
    assert.equal(season.body.fetched, true);
  });
});

test('validation errors are 400 with consistent JSON', async () => {
  const { store } = makeStore();
  const router = createReleasesRouter({ releasesEnabled: () => true, store, cache: makeCache() });
  await withServer(router, async (base) => {
    const cases = [
      '/api/releases/movies?region=ZZ',
      '/api/releases/movies?region=GB&from=2026-06-01&to=not-a-date',
      '/api/releases/movies?region=GB&from=2026-01-01&to=2026-12-31',
      '/api/releases/movies?region=GB&page=999',
      '/api/releases/tv/day?region=GB&date=07-10-2026',
      '/api/releases/title/nonsense/1?region=GB',
      '/api/releases/title/movie/abc?region=GB',
      '/api/releases/search?region=GB&q=a',
    ];
    for (const path of cases) {
      const res = await getJson(`${base}${path}`);
      assert.equal(res.status, 400, path);
      assert.equal(typeof res.body.error, 'string', path);
    }
  });
});

test('search uses the local cache first and does not call TMDB', async () => {
  let tmdbCalls = 0;
  const { store } = makeStore({
    localSearch: async () => [{
      kind: 'movie', tmdb_id: 101, title: 'Wicked', poster_path: '/wicked.jpg',
      digital_date: '2026-06-10', theatrical_date: null, physical_date: null,
      release_date: '2026-06-10', next_episode_air_date: null, popularity: 90,
    }],
  });
  const router = createReleasesRouter({
    releasesEnabled: () => true,
    store,
    cache: makeCache(),
    getClient: () => {
      tmdbCalls++;
      return { searchMulti: async () => ({ results: [] }) };
    },
  });
  await withServer(router, async (base) => {
    const res = await getJson(`${base}/api/releases/search?region=GB&q=wicked`);
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'local');
    assert.equal(res.body.results[0].status, 'released');
    assert.equal(tmdbCalls, 0);
  });
});

test('search returns the cached response when present', async () => {
  const cached = [{ type: 'movie', id: 1, title: 'Cached', poster: null, status: 'upcoming' }];
  const { store } = makeStore();
  const router = createReleasesRouter({
    releasesEnabled: () => true,
    store,
    cache: makeCache({ get: async () => cached }),
    getClient: () => { throw new Error('should not be called'); },
  });
  await withServer(router, async (base) => {
    const res = await getJson(`${base}/api/releases/search?region=GB&q=wicked`);
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'cache');
    assert.deepEqual(res.body.results, cached);
  });
});

test('search falls through to TMDB, caches and coalesces concurrent lookups', async () => {
  let searchMultiCalls = 0;
  const { store, calls } = makeStore({ localSearch: async () => [] });
  const client = {
    searchMulti: async () => {
      searchMultiCalls++;
      // Hold the upstream call open so the ten requests genuinely overlap;
      // with an instant mock the first would finish before the next arrives.
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { results: [{ media_type: 'movie', id: 101, title: 'Future Film', poster_path: '/f.jpg', release_date: '2026-12-01' }] };
    },
    movieReleaseDates: async () => ({ results: [{ iso_3166_1: 'GB', release_dates: [{ type: 4, release_date: '2026-12-01T00:00:00.000Z' }] }] }),
    tvDetail: async () => ({ next_episode_to_air: null, last_episode_to_air: null, status: 'Returning Series' }),
  };
  const router = createReleasesRouter({
    releasesEnabled: () => true,
    store,
    cache: makeCache(),
    getClient: () => client,
  });
  await withServer(router, async (base) => {
    const responses = await Promise.all(Array.from({ length: 10 }, () => getJson(`${base}/api/releases/search?region=GB&q=future+film`)));
    for (const res of responses) {
      assert.equal(res.status, 200);
      assert.equal(res.body.source, 'tmdb');
      assert.equal(res.body.results[0].status, 'upcoming');
    }
    assert.equal(searchMultiCalls, 1, 'ten concurrent searches must coalesce to one TMDB call');
    assert.equal(calls.upsertMovie, 1);
  });
});

test('tv day: notable default, facets, totals, filters and sort', async () => {
  const base = { ...DAY_ROW };
  const rows = [
    { ...base, tmdb_id: 1, show_tmdb_id: 1, show_name: 'Popular Scripted', show_popularity: 50, show_type: 'Scripted', show_language: 'en', is_season_premiere: false, is_series_premiere: false, is_finale: false },
    { ...base, tmdb_id: 2, show_tmdb_id: 2, show_name: 'Low Scripted', show_popularity: 1, show_type: 'Scripted', show_language: 'en', is_season_premiere: false, is_series_premiere: false, is_finale: false },
    { ...base, tmdb_id: 3, show_tmdb_id: 3, show_name: 'Daily Soap', show_popularity: 500, show_type: 'Soap', show_language: 'en', is_season_premiere: false, is_series_premiere: false, is_finale: false },
    { ...base, tmdb_id: 4, show_tmdb_id: 4, show_name: 'Reality Premiere', show_popularity: 0, show_type: 'Reality', show_language: 'es', is_season_premiere: true, is_series_premiere: false, is_finale: false },
  ];
  const { store } = makeStore({ listDay: async () => rows });
  const router = createReleasesRouter({ releasesEnabled: () => true, store, cache: makeCache() });
  await withServer(router, async (baseUrl) => {
    const notable = await getJson(`${baseUrl}/api/releases/tv/day?region=GB&date=2026-10-07`);
    assert.equal(notable.status, 200);
    assert.equal(notable.body.total, 2);
    assert.equal(notable.body.totalAll, 4);
    assert.equal(notable.body.facets.types.Scripted, 2);
    assert.equal(notable.body.facets.types.Soap, 1);
    assert.equal(notable.body.facets.languages.es, 1);
    // popularity desc
    assert.deepEqual(notable.body.shows.map((s: any) => s.title), ['Popular Scripted', 'Reality Premiere']);

    const all = await getJson(`${baseUrl}/api/releases/tv/day?region=GB&date=2026-10-07&notable=false`);
    assert.equal(all.body.total, 4);
    assert.equal(all.body.totalAll, 4);

    const reality = await getJson(`${baseUrl}/api/releases/tv/day?region=GB&date=2026-10-07&notable=false&type=Reality`);
    assert.deepEqual(reality.body.shows.map((s: any) => s.title), ['Reality Premiere']);

    const spanish = await getJson(`${baseUrl}/api/releases/tv/day?region=GB&date=2026-10-07&language=es`);
    assert.deepEqual(spanish.body.shows.map((s: any) => s.title), ['Reality Premiere']);

    const byName = await getJson(`${baseUrl}/api/releases/tv/day?region=GB&date=2026-10-07&notable=false&sort=name`);
    assert.deepEqual(byName.body.shows.map((s: any) => s.title), ['Daily Soap', 'Low Scripted', 'Popular Scripted', 'Reality Premiere']);
  });
});

test('tv day: filter params are validated', async () => {
  const { store } = makeStore({ listDay: async () => [] });
  const router = createReleasesRouter({ releasesEnabled: () => true, store, cache: makeCache() });
  await withServer(router, async (baseUrl) => {
    for (const q of ['sort=weird', 'language=english', 'type=Banana']) {
      const res = await getJson(`${baseUrl}/api/releases/tv/day?region=GB&date=2026-10-07&${q}`);
      assert.equal(res.status, 400, q);
      assert.equal(typeof res.body.error, 'string', q);
    }
  });
});

test('tv day cleans generic episode names', async () => {
  const rows = [
    { ...DAY_ROW, tmdb_id: 1, show_tmdb_id: 1, name: 'Episode 45', show_popularity: 20, show_type: 'Scripted', show_language: 'en', is_season_premiere: false, is_series_premiere: false, is_finale: false },
    { ...DAY_ROW, tmdb_id: 2, show_tmdb_id: 1, name: 'Thursday, October 8, 2026', show_popularity: 20, show_type: 'Scripted', show_language: 'en', is_season_premiere: false, is_series_premiere: false, is_finale: false },
    { ...DAY_ROW, tmdb_id: 3, show_tmdb_id: 1, name: 'A Real Title', show_popularity: 20, show_type: 'Scripted', show_language: 'en', is_season_premiere: false, is_series_premiere: false, is_finale: false },
  ];
  const { store } = makeStore({ listDay: async () => rows });
  const router = createReleasesRouter({ releasesEnabled: () => true, store, cache: makeCache() });
  await withServer(router, async (baseUrl) => {
    const res = await getJson(`${baseUrl}/api/releases/tv/day?region=GB&date=2026-10-07&notable=false`);
    assert.equal(res.body.shows.length, 1);
    const names = res.body.shows[0].episodes.map((e: any) => e.name);
    assert.deepEqual(names, [null, null, 'A Real Title']);
  });
});

test('browse, day and title read paths never call TMDB', async () => {
  let tmdbCalls = 0;
  const { store } = makeStore({
    listMovies: async () => [MOVIE_ROW],
    countMovies: async () => 1,
    listDay: async () => [DAY_ROW],
    getMovie: async () => MOVIE_ROW,
    getShow: async () => ({
      tmdb_id: 900, name: 'The Show', overview: null, poster_path: null, backdrop_path: null, genres: [],
      first_air_date: null, popularity: null, vote_average: null, status: null, number_of_seasons: null,
      episode_run_time: null,
      next_episode_air_date: null, next_episode_season: null, next_episode_number: null,
      last_episode_air_date: null, last_episode_season: null, last_episode_number: null,
    }),
  });
  const router = createReleasesRouter({
    releasesEnabled: () => true,
    store,
    cache: makeCache(),
    getClient: () => { tmdbCalls++; throw new Error('TMDB must not be used on read paths'); },
  });
  await withServer(router, async (base) => {
    const paths = [
      '/api/releases/movies?region=GB&from=2026-06-01&to=2026-06-30',
      '/api/releases/tv/day?region=GB&date=2026-10-07',
      '/api/releases/tv/week?from=2026-10-07&days=7',
      '/api/releases/title/movie/101?region=GB',
      '/api/releases/title/tv/900?region=GB',
    ];
    for (const path of paths) {
      const res = await getJson(`${base}${path}`);
      assert.equal(res.status, 200, path);
    }
    assert.equal(tmdbCalls, 0, 'browse/day/title must not touch the TMDB client');
  });
});

test('search is rate limited more strictly than browse', async () => {
  const { store } = makeStore({ localSearch: async () => [] });
  const router = createReleasesRouter({
    releasesEnabled: () => true,
    store,
    cache: makeCache(),
    getClient: () => ({
      searchMulti: async () => ({ results: [] }),
      movieReleaseDates: async () => ({ results: [] }),
      tvDetail: async () => ({}),
    }),
  });
  await withServer(router, async (base) => {
    const ip = '10.9.9.9';
    const statuses = [];
    for (let i = 0; i < 21; i++) {
      const res = await getJson(`${base}/api/releases/search?region=GB&q=ab`, ip);
      statuses.push(res.status);
    }
    assert.deepEqual(statuses.slice(0, 20), Array(20).fill(200));
    assert.equal(statuses[20], 429);
  });
});

test('search returns a date and status for every result when enrichment fails', async () => {
  const { store } = makeStore({ localSearch: async () => [] });
  const router = createReleasesRouter({
    releasesEnabled: () => true,
    store,
    cache: makeCache(),
    getClient: () => ({
      searchMulti: async () => ({ results: [
        { media_type: 'movie', id: 1, title: 'Future Film', release_date: '2026-12-01', genre_ids: [18] },
        { media_type: 'tv', id: 2, name: 'Old Show', first_air_date: '2005-03-26', genre_ids: [35] },
      ] }),
      movieReleaseDates: async () => { throw new Error('upstream down'); },
      tvDetail: async () => { throw new Error('upstream down'); },
    }),
  });
  await withServer(router, async (base) => {
    const res = await getJson(`${base}/api/releases/search?region=GB&q=show`);
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'tmdb');
    assert.equal(res.body.results.length, 2);
    const movie = res.body.results[0];
    const tv = res.body.results[1];
    assert.equal(movie.date, '2026-12-01');
    assert.equal(movie.status, 'upcoming');
    assert.equal(movie.enriched, false);
    assert.equal(movie.releaseDate, '2026-12-01');
    assert.equal(tv.date, '2005-03-26');
    assert.equal(tv.status, 'released');
    assert.equal(tv.enriched, false);
    assert.equal(tv.firstAirDate, '2005-03-26');
  });
});

test('one failing enrichment keeps that item and still returns the rest', async () => {
  const { store } = makeStore({ localSearch: async () => [] });
  const router = createReleasesRouter({
    releasesEnabled: () => true,
    store,
    cache: makeCache(),
    getClient: () => ({
      searchMulti: async () => ({ results: [
        { media_type: 'movie', id: 1, title: 'Works', release_date: '2026-12-01' },
        { media_type: 'movie', id: 2, title: 'Fails', release_date: '2026-12-02' },
      ] }),
      movieReleaseDates: async (id: number) => {
        if (id === 2) throw new Error('enrichment failed');
        return { results: [{ iso_3166_1: 'GB', release_dates: [{ type: 4, release_date: '2026-12-01' }] }] };
      },
      tvDetail: async () => ({}),
    }),
  });
  await withServer(router, async (base) => {
    const res = await getJson(`${base}/api/releases/search?region=GB&q=film`);
    assert.equal(res.status, 200);
    assert.equal(res.body.results.length, 2);
    assert.equal(res.body.results[0].enriched, true);
    assert.equal(res.body.results[0].digitalDate, '2026-12-01');
    assert.equal(res.body.results[1].enriched, false);
    assert.equal(res.body.results[1].date, '2026-12-02');
  });
});

test('a rejected upstream search is not cached and is retried next request', async () => {
  let searchMultiCalls = 0;
  const { store } = makeStore({ localSearch: async () => [] });
  const router = createReleasesRouter({
    releasesEnabled: () => true,
    store,
    cache: makeCache(),
    getClient: () => ({
      searchMulti: async () => {
        searchMultiCalls++;
        if (searchMultiCalls === 1) throw new Error('upstream down');
        return { results: [{ media_type: 'movie', id: 1, title: 'Recovered', release_date: '2026-12-01' }] };
      },
      movieReleaseDates: async () => ({ results: [] }),
      tvDetail: async () => ({}),
    }),
  });
  await withServer(router, async (base) => {
    const first = await getJson(`${base}/api/releases/search?region=GB&q=recover`);
    assert.equal(first.status, 502);
    assert.equal(typeof first.body.error, 'string');
    const second = await getJson(`${base}/api/releases/search?region=GB&q=recover`);
    assert.equal(second.status, 200);
    assert.equal(second.body.results.length, 1);
    assert.equal(searchMultiCalls, 2, 'a failed upstream search must not be cached');
  });
});

test('movie detail lazily enriches a sparse row from TMDB', async () => {
  const sparse = { tmdb_id: 402431, region: 'GB', title: 'Wicked', overview: null, poster_path: '/w.jpg', backdrop_path: null, genres: [], popularity: 1, vote_average: 1, release_date: '2024-10-16', digital_date: null, theatrical_date: '2024-11-22', physical_date: null };
  const { store, calls } = makeStore({ getMovie: async () => sparse, getMovieAnyRegion: async () => sparse });
  const router = createReleasesRouter({
    releasesEnabled: () => true,
    store,
    cache: makeCache(),
    getClient: () => ({ movieDetail: async () => ({ genre_ids: [18, 10749], backdrop_path: '/bg.jpg' }) }),
  });
  await withServer(router, async (base) => {
    const res = await getJson(`${base}/api/releases/title/movie/402431?region=GB`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.genres, ['Drama', 'Romance']);
    assert.match(res.body.backdrop, /\/bg\.jpg$/);
    assert.equal(calls.updateMovieMeta, 1);
  });
});

test('season route marks an undated episode as unknown, never released', async () => {
  const { store } = makeStore({
    getShow: async () => ({ tmdb_id: 900, status: 'Returning Series', last_episode_season: null, last_episode_number: null }),
    seasonEpisodesFetchedAt: async () => new Date().toISOString(),
    listSeasonEpisodes: async () => ([
      { tmdb_id: 1, season: 3, episode: 1, name: 'TBA', air_date: null, runtime: null, is_series_premiere: false, is_season_premiere: false, is_finale: false },
    ]),
  });
  const router = createReleasesRouter({ releasesEnabled: () => true, store, cache: makeCache(), getClient: () => { throw new Error('no fetch on fresh cache'); } });
  await withServer(router, async (base) => {
    const res = await getJson(`${base}/api/releases/title/tv/900/season/3`);
    assert.equal(res.status, 200);
    assert.equal(res.body.episodes[0].airDate, null);
    assert.equal(res.body.episodes[0].status, 'unknown');
  });
});

test('season route fails only that season when the fetch fails and nothing is cached', async () => {
  const { store } = makeStore({
    getShow: async () => ({ tmdb_id: 900, status: 'Returning Series', last_episode_season: null, last_episode_number: null }),
    seasonEpisodesFetchedAt: async () => null,
    listSeasonEpisodes: async () => [],
  });
  const router = createReleasesRouter({
    releasesEnabled: () => true,
    store,
    cache: makeCache(),
    getClient: () => ({ tvSeason: async () => { throw new Error('tmdb boom'); } }),
  });
  await withServer(router, async (base) => {
    const res = await getJson(`${base}/api/releases/title/tv/900/season/3`);
    assert.equal(res.status, 502);
    assert.equal(typeof res.body.error, 'string');
  });
});

test('season route serves stale cached episodes when the refresh fails', async () => {
  const { store } = makeStore({
    getShow: async () => ({ tmdb_id: 900, status: 'Returning Series', last_episode_season: null, last_episode_number: null }),
    seasonEpisodesFetchedAt: async () => null,
    listSeasonEpisodes: async () => ([
      { tmdb_id: 1, season: 3, episode: 1, name: 'Aired', air_date: '2026-01-01', runtime: 40, is_series_premiere: false, is_season_premiere: false, is_finale: false },
    ]),
  });
  const router = createReleasesRouter({
    releasesEnabled: () => true,
    store,
    cache: makeCache(),
    getClient: () => ({ tvSeason: async () => { throw new Error('tmdb boom'); } }),
  });
  await withServer(router, async (base) => {
    const res = await getJson(`${base}/api/releases/title/tv/900/season/3`);
    assert.equal(res.status, 200);
    assert.equal(res.body.stale, true);
    assert.equal(res.body.episodes.length, 1);
    assert.equal(res.body.episodes[0].status, 'released');
  });
});

test('tv week returns per-day counts that honour the day filters', async () => {
  const rows = [
    { ...DAY_ROW, air_date: '2026-10-12', tmdb_id: 1, show_tmdb_id: 1, show_name: 'Notable Premiere', show_popularity: 50, show_type: 'Scripted', show_language: 'en', is_season_premiere: true },
    { ...DAY_ROW, air_date: '2026-10-12', tmdb_id: 2, show_tmdb_id: 2, show_name: 'Quiet Import', show_popularity: 1, show_type: 'Scripted', show_language: 'en', is_season_premiere: false },
    { ...DAY_ROW, air_date: '2026-10-14', tmdb_id: 3, show_tmdb_id: 3, show_name: 'Spanish Reality', show_popularity: 80, show_type: 'Reality', show_language: 'es', is_season_premiere: false },
  ];
  const { store } = makeStore({ listRange: async () => rows });
  const router = createReleasesRouter({ releasesEnabled: () => true, store, cache: makeCache() });
  await withServer(router, async (baseUrl) => {
    const res = await getJson(`${baseUrl}/api/releases/tv/week?from=2026-10-12&days=7`);
    assert.equal(res.status, 200);
    // Every requested day is present, even the empty ones, so the strip is stable.
    assert.deepEqual(res.body.days.map((d: any) => d.date), [
      '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18',
    ]);
    const monday = res.body.days.find((d: any) => d.date === '2026-10-12');
    assert.equal(monday.total, 1); // the quiet import is below the notable threshold
    assert.equal(monday.totalAll, 2);
    assert.equal(monday.premieres, 1);
    const tuesday = res.body.days.find((d: any) => d.date === '2026-10-13');
    assert.deepEqual(tuesday, { date: '2026-10-13', total: 0, totalAll: 0, premieres: 0 });
    // Reality without a premiere is not notable, so it is counted only in totalAll.
    const wednesday = res.body.days.find((d: any) => d.date === '2026-10-14');
    assert.equal(wednesday.total, 0);
    assert.equal(wednesday.totalAll, 1);

    // The same filters the day view uses move the counts.
    const all = await getJson(`${baseUrl}/api/releases/tv/week?from=2026-10-12&days=7&notable=false`);
    assert.equal(all.body.days.find((d: any) => d.date === '2026-10-12').total, 2);
    assert.equal(all.body.days.find((d: any) => d.date === '2026-10-14').total, 1);

    const spanish = await getJson(`${baseUrl}/api/releases/tv/week?from=2026-10-12&days=7&notable=false&language=es`);
    assert.equal(spanish.body.days.find((d: any) => d.date === '2026-10-14').total, 1);
    assert.equal(spanish.body.days.find((d: any) => d.date === '2026-10-12').total, 0);

    const reality = await getJson(`${baseUrl}/api/releases/tv/week?from=2026-10-12&days=7&notable=false&type=Reality`);
    assert.equal(reality.body.days.find((d: any) => d.date === '2026-10-14').total, 1);
    assert.equal(reality.body.days.find((d: any) => d.date === '2026-10-12').total, 0);

    const scripted = await getJson(`${baseUrl}/api/releases/tv/week?from=2026-10-12&days=7&notable=false&type=Scripted`);
    assert.equal(scripted.body.days.find((d: any) => d.date === '2026-10-12').total, 2);
    assert.equal(scripted.body.days.find((d: any) => d.date === '2026-10-14').total, 0);
  });
});

test('tv week validates the range and bounds the requested span', async () => {
  const { store } = makeStore();
  const router = createReleasesRouter({ releasesEnabled: () => true, store, cache: makeCache() });
  await withServer(router, async (baseUrl) => {
    const cases = [
      'from=not-a-date&days=7',
      'from=2026-10-12&days=0',
      'from=2026-10-12&days=99',
      'from=2026-10-12&days=banana',
      'days=7',
      'from=2026-10-12&language=english',
      'from=2026-10-12&type=Banana',
    ];
    for (const q of cases) {
      const res = await getJson(`${baseUrl}/api/releases/tv/week?${q}`);
      assert.equal(res.status, 400, q);
      assert.equal(typeof res.body.error, 'string', q);
    }
  });
});
