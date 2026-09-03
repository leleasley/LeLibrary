const test = require('node:test');
const assert = require('node:assert/strict');

const { uniqueLibraryIds } = require('../src/collection-cache-warm');

test('collection cache warming normalises and deduplicates lib source ids', () => {
  assert.deepEqual(
    uniqueLibraryIds(['lib-trending_movies', 'trending_movies', 'lib-genre_action_movies', '', '../bad']),
    ['trending_movies', 'genre_action_movies']
  );
});
