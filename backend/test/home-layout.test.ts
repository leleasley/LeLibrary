// @ts-nocheck
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { layoutHomeKeys, desiredHomeKeys } = require('../src/setup/home-layout.ts');

test('LeLibrary entries are put back in the chosen order; other addons keep their places', () => {
  // On Nuvio now: an other-addon row, then our rows in an old order, another
  // addon in between, our collection last.
  const existingKeys = ['other:a', 'll:movies', 'other:b', 'll:shows', 'collection_collection-lelibrary-x'];
  const desired = ['collection_collection-lelibrary-x', 'll:shows', 'll:movies'];
  const managed = new Set(desired);
  assert.deepEqual(layoutHomeKeys({ existingKeys, desired, managed }),
    ['other:a', 'collection_collection-lelibrary-x', 'other:b', 'll:shows', 'll:movies']);
});

test('entries pushed for the first time go after the existing ones, in order', () => {
  assert.deepEqual(layoutHomeKeys({ existingKeys: ['other:a'], desired: ['ll:movies', 'collection_c1'], managed: new Set(['ll:movies', 'collection_c1']) }),
    ['other:a', 'll:movies', 'collection_c1']);
});

test('owned-but-unordered keys (manifest catalogues off Home) stay after the wanted order', () => {
  const managed = new Set(['ll:movies', 'll:hidden']);
  assert.deepEqual(layoutHomeKeys({ existingKeys: ['ll:hidden', 'll:movies'], desired: ['ll:movies'], managed }), ['ll:movies', 'll:hidden']);
});

test('Movie Collections sits where its Home row is; collections follow the rows', () => {
  const rows = [{ key: 'll:movies', order: 0 }, { key: 'll:shows', order: 2 }, { key: 'll:4k', order: 3 }];
  assert.deepEqual(desiredHomeKeys({ rows, franchise: { key: 'collection_franchises', order: 1 }, collectionKeys: ['collection_hub', 'collection_packs'] }),
    ['ll:movies', 'collection_franchises', 'll:shows', 'll:4k', 'collection_hub', 'collection_packs']);
  // No stored position (old setups): after everything, as before.
  assert.deepEqual(desiredHomeKeys({ rows, franchise: { key: 'collection_franchises', order: null }, collectionKeys: ['collection_hub'] }),
    ['ll:movies', 'll:shows', 'll:4k', 'collection_hub', 'collection_franchises']);
});
