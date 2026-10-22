// @ts-nocheck
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Exercise the real search pipeline with synthetic metadata and an in-memory
// cache. No provider credentials, persistent caches or network requests.
const entries = new Map();
let candidates = [];
let calls = 0;
let candidateSearch = async () => candidates;
const cachePath = path.join(__dirname, '..', 'src', 'runtime', 'cache.ts');
const tmdbPath = path.join(__dirname, '..', 'src', 'media', 'tmdb.ts');
require.cache[cachePath] = { id: cachePath, filename: cachePath, loaded: true, exports: {
  makeKey: (...parts) => JSON.stringify(parts),
  get: async key => entries.get(key),
  set: async (key, value) => entries.set(key, value),
} };
require.cache[tmdbPath] = { id: tmdbPath, filename: tmdbPath, loaded: true, exports: {
  searchCandidates: async (...args) => { calls++; return candidateSearch(...args); },
  getImdbId: async (_key, _type, id) => `tt${id}`,
  getImdbIds: async (_key, _type, ids) => new Map((ids || []).map((id) => [id, `tt${id}`])),
  titleScore: () => 100,
} };
const { searchCatalog, normalize, resultScore } = require('../src/media/search.ts');
const search = (query, extra = {}) => searchCatalog({ apiKey: 'synthetic-test-key', type: 'movie', query, ...extra });

test('native search preserves international titles and isolates their cached results', async () => {
  entries.clear();
  assert.equal(normalize('千と千尋の神隠し'), '千と千尋の神隠し');
  assert.equal(normalize('Солярис'), 'солярис');
  assert.notEqual(normalize('कल'), normalize('काला'));
  assert.ok(resultScore('Солярис', { title: 'Солярис' }) > resultScore('Солярис', { title: 'Сталкер' }));
  candidates = [{ id: 1, title: '千と千尋の神隠し' }];
  assert.equal((await search('千と千尋の神隠し'))[0].id, 'tt1');
  candidates = [{ id: 2, title: '天空の城ラピュタ' }];
  assert.equal((await search('天空の城ラピュタ'))[0].id, 'tt2');
  assert.equal((await search('千と千尋の神隠し'))[0].id, 'tt1');
});

test('year-qualified search still ranks the exact title before popular partial matches', async () => {
  entries.clear();
  candidates = [
    { id: 1, title: 'Batman Begins', popularity: 1000 },
    { id: 2, title: 'Batman', popularity: 1 },
  ];
  assert.equal((await search('batman 2022'))[0].id, 'tt2');
});

test('a canonical title word prefix outranks a longer incidental prefix', async () => {
  entries.clear();
  candidates = [
    { id: 1, title: 'Matriarch', popularity: 10000 },
    { id: 2, title: 'The Matrix', popularity: 1 },
  ];
  assert.equal((await search('Matr'))[0].id, 'tt2');
});

test('a supplied year ranks matching releases first without filtering the year-free fallback', async () => {
  entries.clear();
  const wrongYearSearch = [
    { id: 3, title: 'The Matrix', release_date: '2025-01-01', popularity: 1 },
  ];
  const yearFreeSearch = [
    { id: 4, title: 'The Matrix', release_date: '1999-03-31', popularity: 10000 },
    { id: 5, title: 'The Matrix Reloaded', release_date: '2003-05-15', popularity: 5000 },
  ];
  try {
    candidateSearch = async (_key, _query, _type, year) => year ? wrongYearSearch : yearFreeSearch;
    const rows = await search('The Matrix 2025');
    assert.deepEqual(rows.map((row) => row.id), ['tt3', 'tt4', 'tt5']);
    assert.deepEqual(rows.map((row) => row.releaseInfo), ['2025', '1999', '2003']);
  } finally {
    candidateSearch = async () => candidates;
  }
});

test('duplicate titles and invalid dates do not spoil the result list', async () => {
  entries.clear();
  candidates = [
    { id: 1, title: 'Example', release_date: 'invalid', poster_path: '/example.jpg' },
    { id: 1, title: 'Example' },
    { id: 2, title: 'Example Two', release_date: '2020-01-01' },
  ];
  const rows = await search('example');
  assert.deepEqual(rows.map(row => row.id), ['tt1', 'tt2']);
  assert.equal(rows[0].released, undefined);
  assert.equal(rows[1].released, '2020-01-01T00:00:00.000Z');
  assert.match(rows[0].poster, /\/w342\//);
});

test('a small result limit cannot truncate subsequent full searches', async () => {
  entries.clear();
  candidates = [{ id: 1, title: 'Example' }, { id: 2, title: 'Example Two' }];
  assert.equal((await search('example', { limit: 1 })).length, 1);
  assert.equal((await search('example', { limit: 20 })).length, 2);
});

test('punctuation-only queries return no results without upstream work', async () => {
  const before = calls;
  assert.deepEqual(await search('!!!'), []);
  assert.equal(calls, before);
  assert.equal(resultScore('!!!', { title: 'Anything' }), 0);
});

export interface SearchCatalogTestTestModule {};
