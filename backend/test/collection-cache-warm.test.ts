// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');

const { uniqueLibraryIds } = require('../src/catalog/collection-cache-warm.ts');

test('collection cache warming normalises and deduplicates lib source ids', () => {
  assert.deepEqual(
    uniqueLibraryIds(['lib-trending_movies', 'trending_movies', 'lib-genre_action_movies', '', '../bad']),
    ['trending_movies', 'genre_action_movies']
  );
});

export interface CollectionCacheWarmTestTestModule {};
