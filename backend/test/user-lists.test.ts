// @ts-nocheck
'use strict';
// Personal list rows (v6): Simkl, MDBList and AniList rows served from the
// requesting setup's own connection, key or username. Fakes only: a fake
// http client records every call, an in-memory store stands in for Redis,
// and the TMDB/poster steps are stubbed. Every key and token is synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');

const rt = require('../src/user-lists/runtime.ts');
const rows = require('../src/user-lists/rows.ts');
const simkl = require('../src/user-lists/simkl.ts');
const mdblist = require('../src/user-lists/mdblist.ts');
const anilist = require('../src/user-lists/anilist.ts');
const userLists = require('../src/user-lists/index.ts');

const SIMKL_TOKEN = 'synthetic-simkl-token-aaaa';
const SIMKL_TOKEN_2 = 'synthetic-simkl-token-bbbb';
const MDB_KEY = 'syntheticMdblistKey1234';
const MDB_KEY_2 = 'syntheticMdblistKey5678';
const ANILIST_TOKEN = 'synthetic-anilist-token-cccc';

// ── Fakes ─────────────────────────────────────────────────────────────────
// Honours TTLs against the test clock, like Redis would.
function fakeStore(clock) {
  const data = new Map();
  const expires = new Map();
  const now = () => (clock ? clock.t : Date.now());
  return {
    data,
    get: async (key) => {
      if (!data.has(key)) return null;
      if (expires.get(key) <= now()) { data.delete(key); return null; }
      return structuredClone(data.get(key));
    },
    set: async (key, value, ttl) => { data.set(key, structuredClone(value)); expires.set(key, now() + ttl * 1000); return true; },
  };
}

// `routes`: [matcher(url, options, body) => response | Error]
function fakeHttp(handler) {
  const calls = [];
  const run = async (method, url, options = {}, body) => {
    calls.push({ method, url, options, body });
    const out = await handler(method, url, options, body);
    if (out instanceof Error) throw out;
    return out;
  };
  return {
    calls,
    get: (url, options) => run('GET', url, options),
    post: (url, body, options) => run('POST', url, options, body),
  };
}

function httpError(status, headers = {}) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, headers } });
}

function context(http, store, clock = { t: 1_800_000_000_000 }) {
  store = store || fakeStore(clock);
  const logs = [];
  return { ctx: { http, store, now: () => clock.t, log: (line) => logs.push(line) }, store, clock, logs };
}

const noNetworkMetas = {
  imdbIds: async (_key, _type, ids) => new Map(ids.map((id) => [id, `tt${String(9000000 + id)}`])),
  backfill: async () => {},
  enhance: async (list) => list,
};

test.beforeEach(() => {
  rt.resetRuntime();
  anilist.resetBudget();
  process.env.SIMKL_CLIENT_ID = 'synthetic-simkl-client';
});

// ── Row ids ───────────────────────────────────────────────────────────────
test('row ids: the v6 ids, the old watchlist aliases, and nothing else', () => {
  assert.deepEqual(rows.parseUserListId('lelibrary-user-simkl-upnext-series'), { provider: 'simkl', list: 'upnext', type: 'series' });
  assert.deepEqual(rows.parseUserListId('lelibrary-user-mdblist-list.4242-movie'), { provider: 'mdblist', list: 'list.4242', type: 'movie' });
  assert.deepEqual(rows.parseUserListId('lelibrary-user-anilist-planning-movie'), { provider: 'anilist', list: 'planning', type: 'movie' });
  assert.deepEqual(rows.parseUserListId('torbox-watchlist-simkl-movie'), { provider: 'simkl', list: 'plantowatch', type: 'movie', alias: 'torbox-watchlist-simkl-movie' });
  assert.deepEqual(rows.parseUserListId('torbox-watchlist-mdblist-series'), { provider: 'mdblist', list: 'watchlist', type: 'series', alias: 'torbox-watchlist-mdblist-series' });
  // Trakt is dropped: its old rows are recognised (answered empty), not served.
  assert.equal(rows.parseUserListId('torbox-watchlist-trakt-movie'), null);
  assert.equal(rows.isUserListCatalogId('torbox-watchlist-trakt-movie'), true);
  // Series-only lists refuse a movie type; unknown lists are null.
  assert.equal(rows.parseUserListId('lelibrary-user-simkl-upnext-movie'), null);
  assert.equal(rows.parseUserListId('lelibrary-user-simkl-dropped-series'), null);
  assert.equal(rows.parseUserListId('lelibrary-user-mdblist-list.abc-movie'), null);
  assert.equal(rows.parseUserListId('lib-something'), null);
});

test('AniList is Connect only: there is no username rule or normaliser left', () => {
  assert.equal('normaliseAnilistUser' in rows, false);
  assert.equal('checkAnilistUser' in userLists, false);
});

test('services: a Simkl connection, an MDBList key and a live AniList connection', () => {
  assert.deepEqual(rows.userListServices({}), { simkl: false, mdblist: false, anilist: false });
  assert.deepEqual(rows.userListServices({
    watchlist: { simkl: { access_token: SIMKL_TOKEN }, anilist: { access_token: ANILIST_TOKEN } },
    mdblistKey: MDB_KEY,
  }), { simkl: true, mdblist: true, anilist: true });
  assert.equal(rows.userListServices({ watchlist: { anilist: { access_token: ANILIST_TOKEN, expires_at: Date.now() - 1000 } } }).anilist, false, 'expired AniList token');
  // A saved username from before v6.1 powers nothing.
  assert.equal(rows.userListServices({ anilistUser: 'Neo_99' }).anilist, false);
});

// ── Simkl ─────────────────────────────────────────────────────────────────
const SIMKL_DATA = {
  'shows/plantowatch': { shows: [
    { added_to_watchlist_at: '2026-10-01T00:00:00Z', show: { title: 'Older Plan', year: 2020, poster: '11/abc', ids: { simkl: 11, imdb: 'tt1100000', tmdb: '1101' } } },
    { added_to_watchlist_at: '2026-10-05T00:00:00Z', show: { title: 'Newer Plan', year: 2022, ids: { simkl: 12, tmdb: '1201' } } },
  ] },
  'anime/plantowatch': { anime: [
    { anime_type: 'movie', added_to_watchlist_at: '2026-10-03T00:00:00Z', show: { title: 'Anime Film', year: 2019, ids: { simkl: 21, imdb: 'tt2100000' } } },
    { anime_type: 'tv', added_to_watchlist_at: '2026-10-02T00:00:00Z', show: { title: 'Anime Show', year: 2021, ids: { simkl: 22, imdb: 'tt2200000' } } },
  ] },
  'movies/plantowatch': { movies: [
    { added_to_watchlist_at: '2026-10-04T00:00:00Z', movie: { title: 'Plain Film', year: 2018, ids: { simkl: 31, imdb: 'tt3100000', tmdb: '3101' } } },
  ] },
  'shows/watching': { shows: [
    { last_watched_at: '2026-10-09T00:00:00Z', next_to_watch: 'S02E05', next_to_watch_info: { title: 'The Return' }, show: { title: 'Watching One', ids: { simkl: 41, imdb: 'tt4100000' } } },
    { last_watched_at: '2026-10-08T00:00:00Z', next_to_watch: null, show: { title: 'Caught Up', ids: { simkl: 42, imdb: 'tt4200000' } } },
  ] },
  'anime/watching': { anime: [] },
  'shows/completed': null,
  'anime/completed': null,
  'movies/completed': { movies: [] },
};

function simklHandler(state = { all: '2026-10-10T00:00:00Z' }) {
  return (method, url) => {
    if (url.endsWith('/sync/activities')) return { data: { all: state.all } };
    const m = url.match(/\/sync\/all-items\/([a-z]+)\/([a-z]+)$/);
    if (m) return { data: SIMKL_DATA[`${m[1]}/${m[2]}`] };
    if (url.includes('data.simkl.in/calendar/tv.json')) {
      return { data: [
        { date: '2026-01-20T10:00:00Z', ids: { simkl_id: 41 }, episode: { season: 2, episode: 6 } },
        { date: '2026-01-16T10:00:00Z', ids: { simkl_id: 11 }, episode: { season: 1, episode: 1 } },
        { date: '2026-01-14T10:00:00Z', ids: { simkl_id: 999 }, episode: { season: 1, episode: 1 } },
        { date: '2026-01-10T10:00:00Z', ids: { simkl_id: 41 }, episode: { season: 2, episode: 5 } },
      ] };
    }
    if (url.includes('data.simkl.in/calendar/anime.json')) return { data: [] };
    if (url.endsWith('/users/settings')) return { data: { user: { name: 'SimklPerson' }, account: { id: 7 } } };
    return httpError(404);
  };
}

test('simkl mapping: status lists split into movies and series, newest first, anime films are movies', async () => {
  const http = fakeHttp(simklHandler());
  const { ctx } = context(http);
  const auth = { token: SIMKL_TOKEN, clientId: 'synthetic-simkl-client' };
  const movies = await simkl.simklRowItems(ctx, auth, 'plantowatch', 'movie');
  assert.deepEqual(movies.map((item) => item.title), ['Plain Film', 'Anime Film']);
  const series = await simkl.simklRowItems(ctx, auth, 'plantowatch', 'series');
  assert.deepEqual(series.map((item) => item.title), ['Newer Plan', 'Anime Show', 'Older Plan']);
  assert.equal(series[2].poster, 'https://simkl.in/posters/11/abc_m.jpg');
  assert.equal(series[0].tmdb, 1201);
  const upnext = await simkl.simklRowItems(ctx, auth, 'upnext', 'series');
  assert.deepEqual(upnext.map((item) => [item.title, item.note]), [['Watching One', 'Next: S02E05 The Return']]);
  const watching = await simkl.simklRowItems(ctx, auth, 'watching', 'series');
  assert.deepEqual(watching.map((item) => item.title), ['Watching One', 'Caught Up']);
  assert.deepEqual(await simkl.simklRowItems(ctx, auth, 'completed', 'series'), []);
  // Every call names the app the way Simkl asks.
  const call = http.calls.find((c) => c.url.includes('/sync/all-items/shows/watching'));
  assert.equal(call.options.params.client_id, 'synthetic-simkl-client');
  assert.equal(call.options.params['app-name'], 'lelibrary');
  assert.ok(call.options.params['app-version']);
  assert.equal(call.options.params.next_watch_info, 'yes');
  assert.match(call.options.headers['User-Agent'], /^LeLibrary\//);
  assert.equal(call.options.headers.Authorization, `Bearer ${SIMKL_TOKEN}`);
  assert.equal(call.options.headers['simkl-api-key'], 'synthetic-simkl-client');
});

test('simkl airing next: the public calendar joined with the user\'s shows, soonest first, one per show', async () => {
  const http = fakeHttp(simklHandler());
  const { ctx } = context(http, null, { t: Date.parse('2026-01-12T00:00:00Z') });
  const auth = { token: SIMKL_TOKEN, clientId: 'synthetic-simkl-client' };
  const airing = await simkl.simklRowItems(ctx, auth, 'airing', 'series');
  // 41's S02E05 aired two days ago (past the grace window); 999 is not theirs.
  assert.deepEqual(airing.map((item) => [item.title, item.note]), [
    ['Older Plan', 'S01E01 airs 2026-01-16'],
    ['Watching One', 'S02E06 airs 2026-01-20'],
  ]);
  const calendarCall = http.calls.find((c) => c.url.includes('calendar/tv.json'));
  assert.equal(calendarCall.options.headers.Authorization, undefined, 'the calendar never carries a user token');
  assert.equal(calendarCall.options.params['app-name'], 'lelibrary');
});

test('simkl activity gate: fresh for an hour, then one /sync/activities call; a new stamp pulls again', async () => {
  const state = { all: 'stamp-1' };
  const http = fakeHttp(simklHandler(state));
  const { ctx, clock } = context(http);
  const auth = { token: SIMKL_TOKEN, clientId: 'synthetic-simkl-client' };
  const pulls = () => http.calls.filter((c) => c.url.includes('/sync/all-items/movies/plantowatch')).length;
  const acts = () => http.calls.filter((c) => c.url.endsWith('/sync/activities')).length;
  await simkl.simklRowItems(ctx, auth, 'plantowatch', 'movie');
  assert.equal(pulls(), 1);
  clock.t += 30 * 60 * 1000;
  await simkl.simklRowItems(ctx, auth, 'plantowatch', 'movie');
  assert.equal(pulls(), 1, 'still fresh: no call at all');
  const actsBefore = acts();
  clock.t += 31 * 60 * 1000;
  await simkl.simklRowItems(ctx, auth, 'plantowatch', 'movie');
  assert.equal(pulls(), 1, 'stamp unchanged: no re-pull');
  assert.equal(acts(), actsBefore + 1);
  state.all = 'stamp-2';
  clock.t += 61 * 60 * 1000;
  await simkl.simklRowItems(ctx, auth, 'plantowatch', 'movie');
  assert.equal(pulls(), 2, 'stamp changed: pulled again');
});

test('simkl caches per user: another token never sees the first user\'s rows', async () => {
  const http = fakeHttp(simklHandler());
  const { ctx, store } = context(http);
  await simkl.simklRowItems(ctx, { token: SIMKL_TOKEN, clientId: 'c' }, 'plantowatch', 'movie');
  const keys = [...store.data.keys()].filter((k) => k.includes(':items:'));
  assert.ok(keys.length > 0);
  for (const key of keys) {
    assert.ok(!key.includes(SIMKL_TOKEN), 'no token in a cache key');
    assert.ok(key.endsWith(rt.credentialFp('simkl', SIMKL_TOKEN)), key);
  }
  // A second user whose upstream fails gets an empty row, not user one's.
  const broken = fakeHttp(() => httpError(500));
  const second = await simkl.simklRowItems({ ...ctx, http: broken }, { token: SIMKL_TOKEN_2, clientId: 'c' }, 'plantowatch', 'movie');
  assert.deepEqual(second, []);
});

test('simkl 429: Retry-After is honoured for that user, the last copy is served meanwhile', async () => {
  let limited = false;
  const base = simklHandler();
  const http = fakeHttp((method, url, options) => (limited ? httpError(429, { 'retry-after': '120' }) : base(method, url, options)));
  const { ctx, clock, logs } = context(http);
  const auth = { token: SIMKL_TOKEN, clientId: 'c' };
  const first = await simkl.simklRowItems(ctx, auth, 'plantowatch', 'movie');
  limited = true;
  clock.t += 2 * 60 * 60 * 1000;
  const during = await simkl.simklRowItems(ctx, auth, 'plantowatch', 'movie');
  assert.deepEqual(during, first, 'last copy for the same user');
  const callsAfter429 = http.calls.length;
  clock.t += 60 * 1000;
  await simkl.simklRowItems(ctx, auth, 'plantowatch', 'movie');
  assert.equal(http.calls.length, callsAfter429, 'no call inside Retry-After');
  assert.ok(logs.some((line) => /status=429/.test(line)));
  assert.ok(logs.every((line) => !line.includes(SIMKL_TOKEN)), 'no token in logs');
  limited = false;
  clock.t += 2 * 60 * 1000;
  await simkl.simklRowItems(ctx, auth, 'plantowatch', 'movie');
  assert.ok(http.calls.length > callsAfter429, 'asks again after Retry-After');
});

// ── MDBList ───────────────────────────────────────────────────────────────
function mdbItem(n, mediatype = 'movie') {
  return { id: 100 + n, title: `Title ${n}`, imdb_id: `tt${String(5000000 + n)}`, mediatype, release_year: 2000 + (n % 20) };
}

test('mdblist items page with the cursor and stop at the cap', async () => {
  const pages = [];
  const http = fakeHttp((method, url, options) => {
    pages.push(options.params);
    const start = options.params.cursor ? Number(options.params.cursor) : 0;
    const movies = Array.from({ length: options.params.limit }, (_, i) => mdbItem(start + i));
    return { data: { movies, shows: [], pagination: { next_cursor: String(start + movies.length), has_more: true } } };
  });
  const got = await mdblist.mdblistItemPages(http.get, 'https://api.mdblist.com/lists/7/items', { apikey: MDB_KEY });
  assert.equal(got.length, mdblist.ITEM_CAP);
  assert.equal(pages[0].cursor, undefined);
  assert.equal(pages[1].cursor, '250');
  assert.ok(pages.length <= 4);
});

test('mdblist items: no cursor but "more" falls back to offset; X-Has-More false stops', async () => {
  const seen = [];
  const http = fakeHttp((method, url, options) => {
    seen.push(options.params);
    if (seen.length === 1) return { data: { movies: [mdbItem(1)], shows: [mdbItem(2, 'show')] }, headers: { 'x-has-more': 'true' } };
    return { data: { movies: [mdbItem(3)] }, headers: { 'x-has-more': 'false' } };
  });
  const got = await mdblist.mdblistItemPages(http.get, 'https://api.mdblist.com/watchlist/items', { apikey: MDB_KEY });
  assert.equal(got.length, 3);
  assert.equal(seen[1].offset, 2);
  assert.equal(seen.length, 2);
});

test('the curated mdb_list handler pages past 100 items', async () => {
  const axios = require('axios');
  const original = axios.get;
  let calls = 0;
  axios.get = async (url, options) => {
    calls++;
    assert.match(url, /^https:\/\/api\.mdblist\.com\/lists\/42\/items$/);
    const start = options.params.cursor ? Number(options.params.cursor) : 0;
    const movies = start >= 300 ? [] : Array.from({ length: Math.min(options.params.limit, 300 - start) }, (_, i) => mdbItem(start + i));
    return { data: { movies, pagination: start + movies.length < 300 ? { next_cursor: String(start + movies.length) } : {} } };
  };
  try {
    const { buildCatalogRows } = require('../src/catalog/libcatalog.ts');
    const out = await buildCatalogRows('', { id: 'x', type: 'movie', handler: 'mdb_list', params: { listId: 42 } }, 'en-US', MDB_KEY);
    assert.equal(out.length, 300);
    assert.equal(calls, 2);
  } finally {
    axios.get = original;
  }
});

test('mdblist rows: watchlist split by type, up next with the next episode, own lists by id', async () => {
  const http = fakeHttp((method, url) => {
    if (url.endsWith('/sync/last_activities')) return { data: { watchlisted_at: '2026-10-10T00:00:00Z' } };
    if (url.endsWith('/watchlist/items')) return { data: { movies: [mdbItem(1)], shows: [mdbItem(2, 'show')] } };
    if (url.endsWith('/upnext')) return { data: { items: [{ show: { title: 'Next Show', year: 2024, poster: '/p.jpg', ids: { tmdb: 77, imdb: 'tt7700000' } }, next_episode: { display_code: 'S01E03', title: 'Third' } }] } };
    if (url.endsWith('/lists/555/items')) return { data: { movies: [mdbItem(5)], shows: [] } };
    return httpError(404);
  });
  const { ctx } = context(http);
  assert.deepEqual((await mdblist.mdblistRowItems(ctx, MDB_KEY, 'watchlist', 'movie')).map((i) => i.title), ['Title 1']);
  assert.deepEqual((await mdblist.mdblistRowItems(ctx, MDB_KEY, 'watchlist', 'series')).map((i) => i.title), ['Title 2']);
  const next = await mdblist.mdblistRowItems(ctx, MDB_KEY, 'upnext', 'series');
  assert.deepEqual(next.map((i) => [i.title, i.note, i.imdb]), [['Next Show', 'Next: S01E03 Third', 'tt7700000']]);
  assert.deepEqual((await mdblist.mdblistRowItems(ctx, MDB_KEY, 'list.555', 'movie')).map((i) => i.title), ['Title 5']);
  // The watchlist is one pull for both types.
  assert.equal(http.calls.filter((c) => c.url.endsWith('/watchlist/items')).length, 1);
  for (const call of http.calls) assert.ok(call.url.startsWith('https://api.mdblist.com/'), 'the key only goes to MDBList');
});

test('mdblist lists picker: own + liked, display fields only, never the key', async () => {
  const http = fakeHttp((method, url, options) => {
    if (url === 'https://api.mdblist.com/user') return { data: { username: 'listmaker', store_account_token: 'secret-account-token', api_requests: 1000 } };
    if (url.endsWith('/lists/user')) return { data: [{ id: 1, name: 'Mine', slug: 'mine', items: 12, likes: 3, mediatype: 'movie', private: true }] };
    if (url.endsWith('/lists/liked')) {
      assert.equal(options.params.limit, 100);
      return { data: { lists: [{ id: 2, name: 'Theirs', user_name: 'someone', items: 50, likes: 900, mediatype: '' }, { id: 1, name: 'Mine again' }], pagination: { has_more: false } } };
    }
    return httpError(404);
  });
  const { ctx } = context(http);
  const lists = await mdblist.mdblistLists(ctx, MDB_KEY);
  assert.deepEqual(lists, [
    { id: 1, name: 'Mine', user_name: 'listmaker', mediatype: 'movie', items: 12, likes: 3, source: 'own' },
    { id: 2, name: 'Theirs', user_name: 'someone', mediatype: '', items: 50, likes: 900, source: 'liked' },
  ]);
  const raw = JSON.stringify(lists);
  assert.ok(!raw.includes(MDB_KEY) && !raw.includes('secret-account-token'));
  const before = http.calls.length;
  await mdblist.mdblistLists(ctx, MDB_KEY);
  assert.equal(http.calls.length, before, 'cached');
  await mdblist.mdblistLists(ctx, MDB_KEY, true);
  assert.ok(http.calls.length > before, 'refresh skips the cache');
  assert.equal(await mdblist.mdblistUsername(ctx, MDB_KEY), 'listmaker');
});

test('mdblist caches are per key', async () => {
  const http = fakeHttp((method, url, options) => {
    if (url.endsWith('/sync/last_activities')) return { data: {} };
    return { data: { movies: [mdbItem(options.params.apikey === MDB_KEY ? 1 : 2)] } };
  });
  const { ctx } = context(http);
  const one = await mdblist.mdblistRowItems(ctx, MDB_KEY, 'watchlist', 'movie');
  const two = await mdblist.mdblistRowItems(ctx, MDB_KEY_2, 'watchlist', 'movie');
  assert.deepEqual(one.map((i) => i.title), ['Title 1']);
  assert.deepEqual(two.map((i) => i.title), ['Title 2']);
});

// ── AniList ───────────────────────────────────────────────────────────────
const ANILIST_COLLECTION = { data: { MediaListCollection: { lists: [
  { status: 'CURRENT', entries: [
    { status: 'CURRENT', media: { id: 1, format: 'TV', title: { english: 'Show One' }, startDate: { year: 2020 }, coverImage: { large: 'https://img.anili.st/1.jpg' } } },
    { status: 'REPEATING', media: { id: 2, format: 'TV', title: { romaji: 'Show Two' }, startDate: { year: 2021 } } },
    { status: 'CURRENT', media: { id: 3, format: 'MOVIE', title: { english: 'Film Three' }, startDate: { year: 2022 } } },
    { status: 'CURRENT', media: { id: 4, format: 'TV', isAdult: true, title: { english: 'Adult' } } },
    { status: 'CURRENT', media: { id: 5, format: 'TV', title: { english: 'Unmapped' } } },
  ] },
  { status: 'PLANNING', entries: [{ status: 'PLANNING', media: { id: 6, format: 'TV', title: { english: 'Planned' } } }] },
] } } };
const ID_MAP = { 1: { imdb: 'tt0000101', tv: 101 }, 2: { tv: 202 }, 3: { movie: 303 }, 4: { imdb: 'tt0000404' }, 6: { imdb: 'tt0000606' } };

test('anilist: a connection reads every list, mapped through the anime id map, adult and unmapped left out', async () => {
  const http = fakeHttp((method, url, options, body) => {
    assert.equal(url, 'https://graphql.anilist.co');
    assert.equal(options.headers.Authorization, `Bearer ${ANILIST_TOKEN}`);
    if (/Viewer/.test(body.query)) return { data: { data: { Viewer: { id: 77, name: 'ViewerName' } } } };
    assert.deepEqual(body.variables, { userId: 77 });
    assert.equal('userName' in body.variables, false, 'no username read');
    return { data: ANILIST_COLLECTION };
  });
  const { ctx } = context(http);
  const auth = { token: ANILIST_TOKEN };
  const idMap = async () => ID_MAP;
  const series = await anilist.anilistRowItems(ctx, auth, 'current', 'series', { idMap });
  assert.deepEqual(series.map((i) => [i.title, i.imdb, i.tmdb]), [['Show One', 'tt0000101', 101], ['Show Two', null, 202]]);
  const films = await anilist.anilistRowItems(ctx, auth, 'current', 'movie', { idMap });
  assert.deepEqual(films.map((i) => [i.title, i.tmdb]), [['Film Three', 303]]);
  const planned = await anilist.anilistRowItems(ctx, auth, 'planning', 'series', { idMap });
  assert.deepEqual(planned.map((i) => i.title), ['Planned']);
  assert.equal(http.calls.length, 2, 'one viewer call, then one list call');
  // No connection, no rows: there is no public-username read.
  assert.deepEqual(await anilist.anilistRowItems(ctx, { token: '' }, 'current', 'series', { idMap }), []);
});

test('anilist connection: the viewer\'s own lists under the token\'s own cache key', async () => {
  const http = fakeHttp((method, url, options, body) => {
    assert.equal(options.headers.Authorization, `Bearer ${ANILIST_TOKEN}`);
    if (/Viewer/.test(body.query)) return { data: { data: { Viewer: { id: 77, name: 'ViewerName' } } } };
    assert.deepEqual(body.variables, { userId: 77 });
    return { data: ANILIST_COLLECTION };
  });
  const { ctx, store } = context(http);
  const auth = { token: ANILIST_TOKEN };
  await anilist.anilistRowItems(ctx, auth, 'planning', 'series', { idMap: async () => ID_MAP });
  assert.ok([...store.data.keys()].some((k) => k.endsWith(rt.credentialFp('anilist-token', ANILIST_TOKEN))));
  assert.equal(await anilist.anilistName(ctx, auth), 'ViewerName');
});

test('anilist: a server-wide budget and a server-wide wait after a 429', async () => {
  let limited = false;
  const http = fakeHttp((method, url, options, body) => {
    if (/Viewer/.test(body.query)) return { data: { data: { Viewer: { id: 77, name: 'ViewerName' } } } };
    return limited ? httpError(429, { 'retry-after': '60' }) : { data: ANILIST_COLLECTION };
  });
  const { ctx, clock } = context(http);
  const idMap = async () => ID_MAP;
  // Each connection costs two calls (viewer, then lists). Ask for far more
  // connections than the budget allows; the budget stops the upstream.
  for (let n = 0; n < anilist.THROTTLE_PER_MIN; n++) {
    await anilist.anilistRowItems(ctx, { token: `token_${n}` }, 'current', 'series', { idMap }).catch(() => []);
  }
  assert.equal(http.calls.length, anilist.THROTTLE_PER_MIN, 'no more than the budget per minute');
  clock.t += 61_000;
  limited = true;
  await anilist.anilistRowItems(ctx, { token: 'late' }, 'current', 'series', { idMap }).catch(() => []);
  const after429 = http.calls.length;
  limited = false;
  await anilist.anilistRowItems(ctx, { token: 'other' }, 'current', 'series', { idMap }).catch(() => []);
  assert.equal(http.calls.length, after429, 'another user waits too (the limit is per server IP)');
  // Asking during the wait never extends it.
  clock.t += 61_000;
  await anilist.anilistRowItems(ctx, { token: 'third' }, 'current', 'series', { idMap }).catch(() => []);
  assert.ok(http.calls.length > after429, 'asks again once Retry-After has passed');
});

// ── The catalogue entry point ─────────────────────────────────────────────
test('catalogue: tt ids, TMDB-only items get their IMDb id, aliases fill, Trakt stays empty', async () => {
  const http = fakeHttp(simklHandler());
  const { ctx } = context(http);
  const config = { tmdbApiKey: 'synthetic-tmdb', watchlist: { simkl: { access_token: SIMKL_TOKEN } } };
  const metas = await userLists.buildUserListCatalog({ config, catalogId: 'lelibrary-user-simkl-plantowatch-series', type: 'series' }, ctx, noNetworkMetas);
  assert.deepEqual(metas.map((m) => m.id), ['tt9001201', 'tt2200000', 'tt1100000']);
  assert.ok(metas.every((m) => m.type === 'series' && /^tt\d+$/.test(m.id)));
  const alias = await userLists.buildUserListCatalog({ config, catalogId: 'torbox-watchlist-simkl-movie', type: 'movie' }, ctx, noNetworkMetas);
  assert.deepEqual(alias.map((m) => m.name), ['Plain Film', 'Anime Film']);
  assert.deepEqual(await userLists.buildUserListCatalog({ config, catalogId: 'torbox-watchlist-trakt-movie', type: 'movie' }, ctx, noNetworkMetas), []);
  // The wrong type for the id, or no connection: empty, no call.
  const calls = http.calls.length;
  assert.deepEqual(await userLists.buildUserListCatalog({ config, catalogId: 'lelibrary-user-simkl-upnext-series', type: 'movie' }, ctx, noNetworkMetas), []);
  assert.deepEqual(await userLists.buildUserListCatalog({ config: { tmdbApiKey: 'x' }, catalogId: 'lelibrary-user-simkl-upnext-series', type: 'series' }, ctx, noNetworkMetas), []);
  assert.equal(http.calls.length, calls);
});

test('catalogue: skip and search page the row', async () => {
  const http = fakeHttp((method, url) => {
    if (url.endsWith('/sync/last_activities')) return { data: {} };
    return { data: { movies: Array.from({ length: 70 }, (_, i) => mdbItem(i)) } };
  });
  const { ctx } = context(http);
  const config = { tmdbApiKey: 'synthetic-tmdb', mdblistKey: MDB_KEY };
  const page1 = await userLists.buildUserListCatalog({ config, catalogId: 'torbox-watchlist-mdblist-movie', type: 'movie' }, ctx, noNetworkMetas);
  assert.equal(page1.length, 50);
  const page2 = await userLists.buildUserListCatalog({ config, catalogId: 'torbox-watchlist-mdblist-movie', type: 'movie', skip: 50 }, ctx, noNetworkMetas);
  assert.equal(page2.length, 20);
  const found = await userLists.buildUserListCatalog({ config, catalogId: 'torbox-watchlist-mdblist-movie', type: 'movie', search: 'title 69' }, ctx, noNetworkMetas);
  assert.deepEqual(found.map((m) => m.name), ['Title 69']);
});

test('identities: display names only, per connected service', async () => {
  const http = fakeHttp((method, url) => {
    if (url.endsWith('/user')) return { data: { username: 'listmaker' } };
    if (url.endsWith('/users/settings')) return { data: { user: { name: 'SimklPerson' } } };
    return httpError(404);
  });
  const { ctx } = context(http);
  const out = await userLists.userListIdentities({
    mdblistKey: MDB_KEY,
    watchlist: { simkl: { access_token: SIMKL_TOKEN }, anilist: { access_token: ANILIST_TOKEN, username: 'StoredName' } },
  }, ctx);
  assert.deepEqual(out, { mdblist: 'listmaker', simkl: 'SimklPerson', anilist: 'StoredName' });
  assert.deepEqual(await userLists.userListIdentities({}, ctx), {});
});

// ── Manifest + collection plan ────────────────────────────────────────────
const scope = (tier) => ({ type: 'config', uuid: '00000000-0000-4000-8000-000000000000', tier });
const homeRow = (id, type, title = id) => ({ id: `row-${id}`, title, source: { kind: 'catalog', id, catalogId: id, type, addonId: '' }, enabled: true, order: 0 });

test('collection plan lists personal rows from Home rows and folders', () => {
  const { compileCollectionPlan } = require('../src/catalog/collection-plan.ts');
  const plan = compileCollectionPlan({
    homeRows: [homeRow('lelibrary-user-simkl-upnext-series', 'series', 'Up Next')],
    collections: [{ id: 'collection-mine', title: 'Mine', folders: [{ id: 'f', title: 'F', catalogSources: [
      { addonId: '', catalogId: 'lelibrary-user-mdblist-list.42-movie', type: 'movie', title: 'Best Films' },
      { addonId: '', catalogId: 'lelibrary-user-simkl-bogus-series', type: 'series' },
    ] }] }],
    manifestId: 'community.lelibrary.selfhosted',
  });
  assert.deepEqual(plan.userListRows, [
    { catalogId: 'lelibrary-user-simkl-upnext-series', type: 'series', title: 'Up Next', home: true, folder: false },
    { catalogId: 'lelibrary-user-mdblist-list.42-movie', type: 'movie', title: 'Best Films', home: false, folder: true },
  ]);
  // The folder keeps pointing at the row id itself; the unknown one is dropped.
  assert.deepEqual(plan.collections[0].folders[0].catalogSources.map((s) => s.catalogId), ['lelibrary-user-mdblist-list.42-movie']);
});

test('manifest declares personal rows only for services the setup has', () => {
  const { getConfiguredManifest } = require('../app.ts');
  const userListRows = [
    { catalogId: 'lelibrary-user-simkl-upnext-series', type: 'series', title: 'Up Next', home: true },
    { catalogId: 'lelibrary-user-mdblist-list.42-movie', type: 'movie', title: 'Best Films', folder: true },
    { catalogId: 'lelibrary-user-anilist-current-series', type: 'series', title: '', home: true },
  ];
  const homeRows = [homeRow('lelibrary-user-simkl-upnext-series', 'series'), homeRow('lelibrary-user-anilist-current-series', 'series')];
  const base = { provider: 'torbox', torboxApiKey: 'tb-synthetic', tmdbApiKey: 'tmdb-synthetic', __configScope: scope('full') };
  const ids = (config) => getConfiguredManifest('http://localhost:7860', config, { integration: 'nuvio', userListRows, homeRows })
    .catalogs.filter((c) => c.id.startsWith('lelibrary-user-'));
  assert.deepEqual(ids(base), [], 'nothing connected: nothing declared');
  const all = ids({ ...base, watchlist: { simkl: { access_token: SIMKL_TOKEN }, anilist: { access_token: ANILIST_TOKEN } }, mdblistKey: MDB_KEY });
  assert.deepEqual(all.map((c) => [c.id, c.name, c.showInHome]), [
    ['lelibrary-user-simkl-upnext-series', 'Simkl Up Next', undefined],
    ['lelibrary-user-mdblist-list.42-movie', 'Best Films', false],
    ['lelibrary-user-anilist-current-series', 'AniList Watching', undefined],
  ]);
  const mdbOnly = ids({ ...base, mdblistKey: MDB_KEY });
  assert.deepEqual(mdbOnly.map((c) => c.id), ['lelibrary-user-mdblist-list.42-movie']);
  // The folder-only row stays off Nuvio mobile Home (required genre).
  assert.ok(mdbOnly[0].extra.some((e) => e.name === 'genre' && e.isRequired === true));
});

// ── Routes ────────────────────────────────────────────────────────────────
const UUID = '123e4567-e89b-12d3-a456-426614174000';

async function startApp({ keys = { mdblistKey: MDB_KEY, tmdbApiKey: 'synthetic-tmdb' }, lists, identities, config = { lang: 'en-US' } } = {}) {
  const { mountSetupRoutes } = require('../src/routes/setup.ts');
  const { createEditSessionStore } = require('../src/setup/edit-sessions.ts');
  const sessions = createEditSessionStore();
  const setup = { uuid: UUID, tier: 'full', name: null, hasPassword: true, config: { ...config }, keys, secret: 'synthetic-secret', createdAt: null, updatedAt: null };
  const seen = [];
  const app = express();
  app.set('trust proxy', false);
  mountSetupRoutes(app, {
    editSessions: sessions,
    getStore: async () => ({
      resolveByUuid: async (uuid) => (uuid === UUID ? setup : null),
      resolveByToken: async () => null,
      checkPassword: async () => false,
      toEngineConfig: (o) => ({ ...o.config, ...o.keys }),
      save: async (_uuid, patch) => {
        if (patch.config) setup.config = { ...setup.config, ...patch.config };
        for (const key of patch.clearConfig ?? []) delete setup.config[key];
        return { ...setup };
      },
    }),
    mdblistLists: lists || (async (key, refresh) => { seen.push({ key, refresh }); return [{ id: 9, name: 'Mine', user_name: 'me', mediatype: 'show', items: 4, likes: 0, source: 'own', apikey: key }]; }),
    identities: identities || (async () => ({ mdblist: 'me' })),
  });
  const server = app.listen(0);
  await once(server, 'listening');
  return { base: `http://127.0.0.1:${server.address().port}`, sessions, seen, setup, close: () => new Promise((r) => server.close(r)) };
}

test('GET /:uuid/mdblist/lists: edit token required, saved key used server-side, never returned', async () => {
  const app = await startApp();
  try {
    const url = `${app.base}/api/setup/${UUID}/mdblist/lists`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: 'Bearer nope' } })).status, 401);
    const token = app.sessions.issue(UUID).token;
    const res = await fetch(`${url}?refresh=1`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const text = await res.text();
    assert.ok(!text.includes(MDB_KEY), 'no key in the response');
    assert.deepEqual(JSON.parse(text), { lists: [{ id: 9, name: 'Mine', user_name: 'me', mediatype: 'show', items: 4, likes: 0, source: 'own' }] });
    assert.deepEqual(app.seen, [{ key: MDB_KEY, refresh: true }]);
  } finally { await app.close(); }
});

test('GET /:uuid/mdblist/lists without a saved key is a 404', async () => {
  const app = await startApp({ keys: { tmdbApiKey: 'x' } });
  try {
    const token = app.sessions.issue(UUID).token;
    assert.equal((await fetch(`${app.base}/api/setup/${UUID}/mdblist/lists`, { headers: { Authorization: `Bearer ${token}` } })).status, 404);
  } finally { await app.close(); }
});

test('POST /mdblist/lists: a typed key, checked, used once, not echoed; MDBList refusals map to 400', async () => {
  const app = await startApp({ lists: async (key) => { if (key === 'rejectedKey12345') throw httpError(401); return [{ id: 3, name: 'L', source: 'liked' }]; } });
  try {
    const post = (body) => fetch(`${app.base}/api/setup/mdblist/lists`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ key: 'bad key with spaces' })).status, 400);
    const ok = await post({ key: MDB_KEY });
    assert.equal(ok.status, 200);
    const text = await ok.text();
    assert.ok(!text.includes(MDB_KEY));
    assert.equal(JSON.parse(text).lists[0].source, 'liked');
    assert.equal((await post({ key: 'rejectedKey12345' })).status, 400);
  } finally { await app.close(); }
});

test('GET /:uuid/config carries display identities, never keys', async () => {
  const app = await startApp();
  try {
    const token = app.sessions.issue(UUID).token;
    const res = await fetch(`${app.base}/api/setup/${UUID}/config`, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(text).identities, { mdblist: 'me' });
    assert.ok(!text.includes(MDB_KEY));
  } finally { await app.close(); }
});

test('/watchlist-config reports AniList and marks Trakt as legacy', async () => {
  const before = { id: process.env.ANILIST_CLIENT_ID, secret: process.env.ANILIST_CLIENT_SECRET };
  delete process.env.ANILIST_CLIENT_ID;
  delete process.env.ANILIST_CLIENT_SECRET;
  const app = await startApp();
  try {
    const off = await (await fetch(`${app.base}/api/setup/watchlist-config`)).json();
    assert.equal(off.anilist, false);
    assert.equal(off.traktLegacy, true);
    process.env.ANILIST_CLIENT_ID = 'synthetic-anilist-id';
    process.env.ANILIST_CLIENT_SECRET = 'synthetic-anilist-secret';
    const on = await (await fetch(`${app.base}/api/setup/watchlist-config`)).json();
    assert.equal(on.anilist, true);
    const oauth = require('../src/setup/oauth.ts');
    const url = new URL(oauth.authorizeUrl('anilist', 'state-1', 'https://lelibrary.test'));
    assert.equal(url.origin + url.pathname, 'https://anilist.co/api/v2/oauth/authorize');
    assert.equal(url.searchParams.get('client_id'), 'synthetic-anilist-id');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://lelibrary.test/api/setup/oauth/anilist/callback');
  } finally {
    await app.close();
    if (before.id === undefined) delete process.env.ANILIST_CLIENT_ID; else process.env.ANILIST_CLIENT_ID = before.id;
    if (before.secret === undefined) delete process.env.ANILIST_CLIENT_SECRET; else process.env.ANILIST_CLIENT_SECRET = before.secret;
  }
});

test('a saved AniList username is dropped on save, not validated or stored', async () => {
  const app = await startApp({ config: { anilistUser: 'Neo_99', lang: 'en-US' } });
  try {
    const token = app.sessions.issue(UUID).token;
    const res = await fetch(`${app.base}/api/setup/${UUID}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ config: { anilistUser: 'not valid!', lang: 'en-GB' } }),
    });
    assert.equal(res.status, 200);
    assert.equal('anilistUser' in app.setup.config, false);
    assert.equal(app.setup.config.lang, 'en-GB');
  } finally { await app.close(); }
});

test('AniList token exchange keeps a one-year token without refresh (fake http)', async () => {
  const axios = require('axios');
  const original = axios.post;
  process.env.ANILIST_CLIENT_ID = 'synthetic-anilist-id';
  process.env.ANILIST_CLIENT_SECRET = 'synthetic-anilist-secret';
  axios.post = async (url, body) => {
    assert.equal(url, 'https://anilist.co/api/v2/oauth/token');
    assert.equal(body.grant_type, 'authorization_code');
    assert.equal(body.code, 'code-1');
    return { data: { access_token: ANILIST_TOKEN, expires_in: 31536000 } };
  };
  try {
    const oauth = require('../src/setup/oauth.ts');
    const conn = await oauth.exchangeCode('anilist', 'code-1', 'https://lelibrary.test');
    assert.equal(conn.access_token, ANILIST_TOKEN);
    assert.equal(conn.refresh_token, null);
    assert.ok(conn.expires_at > Date.now() + 364 * 24 * 3600 * 1000);
  } finally {
    axios.post = original;
    delete process.env.ANILIST_CLIENT_ID;
    delete process.env.ANILIST_CLIENT_SECRET;
  }
});

// ── Preview draft ─────────────────────────────────────────────────────────
test('draft preview: personal rows are samples with a label, never fetched', async () => {
  const { buildDraftCatalog } = require('../src/setup/preview.ts');
  for (const [id, type, service] of [
    ['lelibrary-user-simkl-upnext-series', 'series', 'simkl'],
    ['lelibrary-user-mdblist-list.42-movie', 'movie', 'mdblist'],
    ['lelibrary-user-anilist-current-series', 'series', 'anilist'],
    ['torbox-watchlist-mdblist-movie', 'movie', 'mdblist'],
  ]) {
    const out = await buildDraftCatalog({ type, catalogId: id, config: {} }, { serverKey: () => { throw new Error('must not build'); } });
    assert.equal(out.status, 200);
    assert.equal(out.body.sample, true);
    assert.equal(out.body.reason, 'personal');
    assert.equal(out.body.service, service);
    assert.match(out.body.label, /once the setup is saved/);
  }
  const simklOut = await buildDraftCatalog({ type: 'series', catalogId: 'lelibrary-user-simkl-airing-series', config: {} });
  assert.equal(simklOut.body.label, 'Your Simkl rows show here once the setup is saved');
});

// ── Seams with the API keys cards (frontend) ──────────────────────────────

test('AniList rows come from the connection only; a username never serves rows', () => {
  const engine = { lang: 'en-US', watchlist: { anilist: { access_token: ANILIST_TOKEN } } };
  assert.equal(rows.userListServices(engine).anilist, true);
  assert.equal(rows.watchlistToken(engine, 'anilist'), ANILIST_TOKEN);
  assert.equal(rows.userListServices({ anilistUser: 'Neo_99' }).anilist, false);
  assert.equal(rows.userListServices({ meta: { anilistUser: 'Neo_99' } }).anilist, false);
});

test('identities only on the authenticated config read, never the public summary', async () => {
  const app = await startApp();
  try {
    const res = await fetch(`${app.base}/api/setup/${UUID}`);
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(text).identities, undefined);
    assert.ok(!text.includes(MDB_KEY));
  } finally { await app.close(); }
});
