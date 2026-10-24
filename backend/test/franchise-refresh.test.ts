// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');

const franchise = require('../src/catalog/franchise-collections.ts');

// The background projection refresh must never touch the network (or Redis)
// unless it has everything it needs: no user key, no TMDB key, or no snapshot
// all resolve locally to null.
test('refreshCollectionsProjection no-ops without key inputs or snapshot', async () => {
  assert.equal(await franchise.refreshCollectionsProjection({}), null);
  assert.equal(await franchise.refreshCollectionsProjection({ userKey: 'u1' }), null);
  assert.equal(
    await franchise.refreshCollectionsProjection({ userKey: 'u1', tmdbApiKey: 'k', downloads: [] }),
    null
  );
  assert.equal(
    await franchise.refreshCollectionsProjection({ userKey: 'u1', tmdbApiKey: 'k' }),
    null
  );
});

export interface FranchiseRefreshTestModule {};

// A library that owns no franchise films used to look "not built yet" forever,
// so a Nuvio push kept saying the library was building and its background
// follow-up retried until it expired (prod, 2026-10-24).
test('a build that finds no franchises is remembered as built, not as pending', () => {
  assert.equal(franchise.collectionsBuilt('empty-user', 'en-US'), false);
  franchise.cacheCollections('empty-user', 'en-US', []);
  assert.equal(franchise.collectionsBuilt('empty-user', 'en-US'), true);
  assert.deepEqual(franchise.getCollections('empty-user', 'en-US'), []);
});

test('the background projection records an empty result', async () => {
  const downloads = [{ id: 1, name: 'Some.Show.S01E01.1080p.mkv', source: 'torrent', files: [] }];
  await franchise.refreshCollectionsProjection({ userKey: 'series-only', tmdbApiKey: 'synthetic', downloads });
  assert.equal(franchise.collectionsBuilt('series-only', 'en-US'), true);
});

// Prod, 2026-10-24: "14 Cameras" was matched in the library but missing from
// its franchise folder, because the franchise build re-parsed download names
// instead of using the library's matches (also missing box-set films).
test('franchises are built from the films the library already matched', async () => {
  const details = {
    1: { collectionId: 877586, collectionName: 'Cameras Collection', genres: ['Horror'], cast: [] },
    2: { collectionId: 877586, collectionName: 'Cameras Collection', genres: ['Horror'], cast: [] },
    3: { collectionId: 877586, collectionName: 'Cameras Collection', genres: ['Horror'], cast: [] },
    9: { collectionId: null, cast: [] },
  };
  const parts = [
    { id: 1, title: '13 Cameras', release_date: '2016-04-01', poster_path: '/a.jpg' },
    { id: 2, title: '14 Cameras', release_date: '2018-07-27', poster_path: '/b.jpg' },
    { id: 3, title: '15 Cameras', release_date: '2023-10-13', poster_path: '/c.jpg' },
  ];
  const deps = {
    getMovieDetail: async (_k, id) => details[id] || null,
    getCollectionDetails: async () => ({ name: '... Cameras', parts, poster: '/p.jpg', backdrop: '/bg.jpg' }),
    getImdbId: async () => null,
  };
  const metas = await franchise.buildCollectionsFromMatched([{ tmdbId: 3 }, { tmdbId: 1 }, { tmdbId: 2 }, { tmdbId: 2 }, { tmdbId: 9 }], 'k', 'en-US', {}, deps);
  assert.equal(metas.length, 1);
  assert.deepEqual(metas[0].videos.map((v) => v.title), ['13 Cameras (2016)', '14 Cameras (2018)', '15 Cameras (2023)']);
  assert.equal(metas[0].collectionId, 877586);
});
