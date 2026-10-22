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
