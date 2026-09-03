const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeImportedSourceDefinition } = require('../src/import-sources/definition');
const { buildNormalizedImportedCatalog, ImportedSourceUpstreamError } = require('../src/libcatalog');

function memoryCache() {
  const values = new Map();
  return {
    values,
    async get(key) { return values.has(key) ? structuredClone(values.get(key)) : null; },
    async set(key, value) { values.set(key, structuredClone(value)); return true; },
  };
}

const convertTmdb = async (_key, _apiType, items, mediaType) => items
  .filter(item => item.mappable !== false)
  .map(item => ({ id: `tt${String(item.id).padStart(7, '0')}`, tmdbId: item.id, type: mediaType, name: item.title || item.name || `Item ${item.id}` }));

function definition(engine, mediaType = 'movie', params = {}) {
  return normalizeImportedSourceDefinition({ provider: 'tmdb', engine, mediaType, params, label: 'Synthetic' });
}

test('TMDB Discover translates logical skip across upstream pages and deduplicates', async () => {
  const calls = [];
  const source = definition('discover', 'movie', { sortBy: 'popularity.desc', filters: { with_genres: '28' } });
  const request = async (_url, options) => {
    calls.push(options.params.page);
    const start = (options.params.page - 1) * 20 + 1;
    const results = Array.from({ length: 20 }, (_, i) => ({ id: start + i }));
    if (options.params.page === 2) results[0] = { id: 20 };
    return { data: { results, total_pages: 4 } };
  };
  const rows = await buildNormalizedImportedCatalog({ definition: source, tmdbApiKey: 'synthetic', skip: 25, pageSize: 10, runtime: { cache: memoryCache(), request, convertTmdb } });
  assert.deepEqual(calls, [1, 2]);
  assert.equal(rows.length, 10);
  assert.equal(new Set(rows.map(row => row.id)).size, 10);
  assert.equal(rows[0].tmdbId, 27);
});

test('TMDB v4 public list paginates and filters mixed media before conversion', async () => {
  const source = definition('list', 'series', { listId: 10 });
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, page: options.params.page });
    return { data: { total_pages: 2, results: options.params.page === 1
      ? [{ id: 1, media_type: 'movie' }, { id: 2, media_type: 'tv' }]
      : [{ id: 3, media_type: 'tv' }] } };
  };
  const rows = await buildNormalizedImportedCatalog({ definition: source, tmdbApiKey: 'synthetic', pageSize: 10, runtime: { cache: memoryCache(), request, convertTmdb } });
  assert.equal(calls[0].url, 'https://api.themoviedb.org/4/list/10');
  assert.deepEqual(rows.map(row => row.tmdbId), [2, 3]);
  assert.deepEqual(calls.map(call => call.page), [1, 2]);
});

test('TMDB collection applies logical slicing to the complete parts list', async () => {
  const source = definition('collection', 'movie', { collectionId: 42 });
  const rows = await buildNormalizedImportedCatalog({
    definition: source, tmdbApiKey: 'synthetic', skip: 55, pageSize: 10,
    runtime: { cache: memoryCache(), request: async () => ({ data: { parts: Array.from({ length: 80 }, (_, i) => ({ id: i + 1 })) } }), convertTmdb },
  });
  assert.deepEqual(rows.map(row => row.tmdbId), [56, 57, 58, 59, 60, 61, 62, 63, 64, 65]);
});

test('Trakt sends explicit pagination and can continue past page one', async () => {
  const previous = process.env.TRAKT_CLIENT_ID;
  process.env.TRAKT_CLIENT_ID = 'synthetic-client';
  try {
    const source = normalizeImportedSourceDefinition({ provider: 'trakt', engine: 'list', mediaType: 'movie', params: { listId: 22 }, label: 'Synthetic' });
    const pages = [];
    const rows = await buildNormalizedImportedCatalog({
      definition: source, tmdbApiKey: 'synthetic', skip: 100, pageSize: 5,
      runtime: {
        cache: memoryCache(), backfillPosters: async (_k, _t, value) => value,
        request: async (_url, options) => {
          pages.push(options.params);
          const page = options.params.page;
          return {
            headers: { 'x-pagination-page-count': '2' },
            data: Array.from({ length: page === 1 ? 100 : 10 }, (_, i) => ({ movie: { title: 'Movie', ids: { imdb: `tt${String((page - 1) * 100 + i + 1).padStart(7, '0')}` } } })),
          };
        },
      },
    });
    assert.deepEqual(pages, [{ page: 1, limit: 100 }, { page: 2, limit: 100 }]);
    assert.equal(rows.length, 5);
  } finally {
    if (previous == null) delete process.env.TRAKT_CLIENT_ID; else process.env.TRAKT_CLIENT_ID = previous;
  }
});

test('temporary upstream failures use last-known-good but permanent failures do not', async () => {
  const source = definition('discover', 'movie', { filters: {} });
  const store = memoryCache();
  const working = async () => ({ data: { results: [{ id: 1 }], total_pages: 1 } });
  const first = await buildNormalizedImportedCatalog({ definition: source, tmdbApiKey: 'synthetic', runtime: { cache: store, request: working, convertTmdb } });
  assert.equal(first.length, 1);
  for (const key of [...store.values.keys()]) if (key.includes('imp-up-v1') || key.includes('imp-render-v1')) store.values.delete(key);
  const temporary = Object.assign(new Error('rate limited'), { response: { status: 429 } });
  const fallback = await buildNormalizedImportedCatalog({ definition: source, tmdbApiKey: 'synthetic', runtime: { cache: store, request: async () => { throw temporary; }, convertTmdb } });
  assert.equal(fallback.length, 1);

  for (const key of [...store.values.keys()]) if (key.includes('imp-up-v1') || key.includes('imp-render-v1')) store.values.delete(key);
  await assert.rejects(() => buildNormalizedImportedCatalog({
    definition: source, tmdbApiKey: 'synthetic', runtime: { cache: store, request: async () => { throw Object.assign(new Error('gone'), { response: { status: 404 } }); }, convertTmdb },
  }), error => error instanceof ImportedSourceUpstreamError && error.code === 'source_not_found');
});

test('logical skip is bounded', async () => {
  const rows = await buildNormalizedImportedCatalog({
    definition: definition('list', 'movie', { listId: 1 }), tmdbApiKey: 'synthetic', skip: 5001,
    runtime: { cache: memoryCache(), request: async () => { throw new Error('must not fetch'); }, convertTmdb },
  });
  assert.deepEqual(rows, []);
});

test('rendered cache never persists secret-bearing poster provider URLs', async () => {
  const store = memoryCache();
  const secret = 'synthetic-poster-token';
  const rows = await buildNormalizedImportedCatalog({
    definition: definition('discover', 'movie', { filters: {} }), tmdbApiKey: 'synthetic', enhance: { erdbToken: secret },
    runtime: { cache: store, request: async () => ({ data: { results: [{ id: 1 }], total_pages: 1 } }), convertTmdb },
  });
  assert.equal(rows[0].poster.includes(secret), true);
  assert.equal(JSON.stringify([...store.values.values()]).includes(secret), false);
});

test('concurrent imported page requests share one upstream flight', async () => {
  const store = memoryCache();
  const source = definition('discover', 'movie', { filters: {} });
  let calls = 0;
  const options = {
    definition: source, tmdbApiKey: 'synthetic',
    runtime: { cache: store, convertTmdb, request: async () => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 10));
      return { data: { results: [{ id: 1 }], total_pages: 1 } };
    } },
  };
  const [a, b] = await Promise.all([buildNormalizedImportedCatalog(options), buildNormalizedImportedCatalog(options)]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
});
