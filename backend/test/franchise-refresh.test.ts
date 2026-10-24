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
