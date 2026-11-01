// @ts-nocheck
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// 5.9 search options (config.searchOptions): anime row, Similar titles,
// People, order, little-known filter, row names, collections opt-in and the
// off switch. Synthetic TMDB data, in-memory cache, no network or keys.
const entries = new Map();
let candidates = [];
let person = null;
let recommendations = [];
const cachePath = path.join(__dirname, '..', 'src', 'runtime', 'cache.ts');
const tmdbPath = path.join(__dirname, '..', 'src', 'media', 'tmdb.ts');
require.cache[cachePath] = { id: cachePath, filename: cachePath, loaded: true, exports: {
  makeKey: (...parts) => JSON.stringify(parts),
  get: async (key) => entries.get(key),
  set: async (key, value) => entries.set(key, value),
} };
require.cache[tmdbPath] = { id: tmdbPath, filename: tmdbPath, loaded: true, exports: {
  searchCandidates: async () => candidates,
  searchPersonCredits: async () => person,
  getRecommendations: async () => recommendations,
  findByImdbId: async () => null,
  discoverByGenre: async () => [],
  getImdbId: async (_key, _type, id) => `tt${id}`,
  getImdbIds: async (_key, _type, ids) => new Map((ids || []).map((id) => [id, `tt${id}`])),
  titleScore: () => 100,
} };
const { searchCatalog, normalizeSearchOptions, applySearchOptions, nameMatchesQuery } = require('../src/media/search.ts');
const run = (query, extra = {}) => searchCatalog({ apiKey: 'synthetic-test-key', type: 'series', query, ...extra });
const ids = (rows) => rows.map((row) => row.id);

test('options default to search as it was', () => {
  assert.deepEqual(normalizeSearchOptions(undefined), {
    enabled: true, animeRow: false, similar: false, people: false, collections: false,
    order: 'relevance', hideObscure: false, names: {},
  });
  const custom = normalizeSearchOptions({ enabled: false, order: 'sideways', names: { movies: '  Films ', series: 42, people: 'x'.repeat(90) } });
  assert.equal(custom.enabled, false);
  assert.equal(custom.order, 'relevance');
  assert.deepEqual(custom.names, { movies: 'Films', people: 'x'.repeat(60) });
});

test('the anime row takes anime out of Series and keeps only anime itself', async () => {
  entries.clear();
  candidates = [
    { id: 1, name: 'Monster', isJapaneseAnimation: true, vote_count: 900 },
    { id: 2, name: 'Monster House', vote_count: 900 },
  ];
  assert.deepEqual(ids(await run('monster')), ['tt1', 'tt2']);
  assert.deepEqual(ids(await run('monster', { variant: 'no-anime' })), ['tt2']);
  assert.deepEqual(ids(await run('monster', { variant: 'anime' })), ['tt1']);
});

test('little-known results drop out, but an exact title always stays', async () => {
  entries.clear();
  candidates = [
    { id: 1, name: 'Dune', vote_count: 2 },
    { id: 2, name: 'Dune Drifter', vote_count: 3 },
    { id: 3, name: 'Dune: Part Two', vote_count: 6000 },
  ];
  const rows = await run('dune', { hideObscure: true });
  assert.deepEqual(ids(rows), ['tt1', 'tt3']);
});

test('order by popular, newest and rating', () => {
  const rows = [
    { id: 'a', _pop: 5, released: '2001-01-01', _rating: 9.5, _votes: 4 },
    { id: 'b', _pop: 50, released: '1999-01-01', _rating: 7, _votes: 900 },
    { id: 'c', _pop: 20, released: '2024-01-01', _rating: 8, _votes: 900 },
  ];
  assert.deepEqual(applySearchOptions(rows, { order: 'popular' }).map((r) => r.id), ['b', 'c', 'a']);
  assert.deepEqual(applySearchOptions(rows, { order: 'newest' }).map((r) => r.id), ['c', 'a', 'b']);
  // A 9.5 from four votes sits under properly rated titles.
  assert.deepEqual(applySearchOptions(rows, { order: 'rating' }).map((r) => r.id), ['c', 'b', 'a']);
  assert.deepEqual(applySearchOptions(rows, {}).map((r) => r.id), ['a', 'b', 'c']);
});

test('People shows only the person the query actually names', async () => {
  assert.equal(nameMatchesQuery('Tom Hanks', 'tom hanks'), true);
  assert.equal(nameMatchesQuery('Tom Hanks', 'tom ha'), true);
  assert.equal(nameMatchesQuery('Batman Smith', 'the batman'), false);
  entries.clear();
  person = { personId: 31, name: 'Tom Hanks', results: [{ id: 7, name: 'Band of Brothers', vote_count: 900 }] };
  assert.deepEqual(ids(await run('tom hanks', { variant: 'people' })), ['tt7']);
  entries.clear();
  person = { personId: 99, name: 'Batman Smith', results: [{ id: 8, name: 'Nobody', vote_count: 900 }] };
  assert.deepEqual(await run('the batman', { variant: 'people' }), []);
});

test('Similar titles follows a clear match and gives nothing for a vague query', async () => {
  entries.clear();
  candidates = [{ id: 10, name: 'Severance', vote_count: 3000 }];
  recommendations = [{ id: 10, name: 'Severance' }, { id: 11, name: 'Silo', vote_count: 900 }];
  assert.deepEqual(ids(await run('severance', { variant: 'similar' })), ['tt11'], 'the title itself is not "similar"');
  entries.clear();
  candidates = [{ id: 12, name: 'The Office Christmas Party', vote_count: 300 }];
  assert.deepEqual(await run('party office xmas', { variant: 'similar' }), []);
});

test('each option set has its own cache entry', async () => {
  entries.clear();
  candidates = [{ id: 1, name: 'Monster', isJapaneseAnimation: true, vote_count: 900 }, { id: 2, name: 'Monster House', vote_count: 900 }];
  await run('monster');
  candidates = [];
  // Same query, different variant: must not reuse the plain result.
  assert.deepEqual(ids(await run('monster', { variant: 'no-anime' })), []);
  assert.deepEqual(ids(await run('monster')), ['tt1', 'tt2']);
});

test('manifest search rows follow the options', () => {
  const { getConfiguredManifest } = require('../app.ts');
  const base = { provider: 'torbox', torboxApiKey: 'tb-test', tmdbApiKey: 'tmdb-test' };
  const searchRows = (config) => getConfiguredManifest('http://localhost:7860', config, { integration: 'nuvio' })
    .catalogs.filter((c) => c.id.startsWith('lelibrary-search-'));
  const plain = searchRows(base).map((c) => c.id);
  assert.deepEqual(plain, ['lelibrary-search-movies', 'lelibrary-search-series', 'lelibrary-search-my-movies', 'lelibrary-search-my-series']);

  const all = searchRows({ ...base, searchOptions: { animeRow: true, similar: true, people: true, collections: true, names: { movies: 'Films', similar: 'More like this' } } });
  const byId = Object.fromEntries(all.map((c) => [c.id, c]));
  assert.equal(byId['lelibrary-search-movies'].name, 'Films');
  assert.ok(byId['lelibrary-search-anime']);
  assert.equal(byId['lelibrary-search-similar-series'].name, 'More like this · Series');
  assert.ok(byId['lelibrary-search-people-movies']);
  assert.ok(byId['lelibrary-search-collections'], 'collections search is opt-in');
  for (const c of all) {
    assert.equal(c.showInHome, false);
    assert.ok(c.extra.some((e) => e.name === 'search' && e.isRequired === true), `${c.id} only answers searches`);
  }

  assert.ok(!searchRows({ ...base, hideAnime: true, searchOptions: { animeRow: true } }).some((c) => c.id === 'lelibrary-search-anime'), 'Hide anime wins over the anime row');
  assert.deepEqual(searchRows({ ...base, searchOptions: { enabled: false, people: true } }), [], 'switched off: no search rows');
});
