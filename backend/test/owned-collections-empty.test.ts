// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { mountCollectionsRoutes } = require('../src/routes/collections.ts');
const franchise = require('../src/catalog/franchise-collections.ts');
const providers = require('../src/providers/index.ts');
const { LIBRARY_COLLECTION_ID } = require('../src/catalog/nuvio-library-collections.ts');

test('a library with no franchise films answers the push at once, with an empty owned collection', async () => {
  const config = { provider: 'torbox', torboxApiKey: 'tb-synthetic', tmdbApiKey: 'tmdb-synthetic' };
  franchise.cacheCollections(providers.getUserKey(config), 'en-US', []);
  const app = express();
  mountCollectionsRoutes(app, { resolveConfig: async () => config });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const started = Date.now();
    const res = await fetch(`http://127.0.0.1:${server.address().port}/tok/collections.json?owned_only=1`);
    const body = await res.json();
    assert.ok(Date.now() - started < 5000, 'no waiting for a build that already finished');
    const owned = body.find((c) => c.id === LIBRARY_COLLECTION_ID);
    assert.ok(owned, 'the owned collection is present, so the push is not "still building"');
    assert.equal((owned.folders || []).length, 0);
  } finally { server.close(); }
});
