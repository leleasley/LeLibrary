const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeNuvioCommunityCollections } = require('../src/accounts/source-import');

test('Nuvio community built-in sources become live account-scoped definitions', () => {
  const result = normalizeNuvioCommunityCollections({ collections: [{
    id: 'kaptain', title: "Kaptain's Mega Collection", folders: [
      { id: 'popular-movies', title: 'Popular Movies', sources: [{ provider: 'tmdb', tmdbSourceType: 'DISCOVER', mediaType: 'MOVIE', sortBy: 'popularity.desc', filters: { with_genres: '28' } }] },
      { id: 'tv-list', title: 'TV List', sources: [{ provider: 'trakt', traktListId: 42, mediaType: 'TV' }] },
    ],
  }] });
  assert.equal(result.collections.length, 1);
  assert.equal(result.sources.length, 2);
  assert.equal(result.collections[0].folders[0].catalogSources[0].catalogId, result.sources[0].id);
  assert.equal(result.collections[0].folders[0].catalogSources[0].title, 'Popular Movies');
  assert.deepEqual(result.sources.map(source => source.label), ['Popular Movies', 'TV List']);
  assert.deepEqual(result.sources.map(source => source.mediaType), ['movie', 'series']);
});
