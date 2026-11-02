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

test('collections lead Home: page order, Movie Collections at its slot, then the rows', () => {
  const rows = [{ key: 'll:movies', order: 0 }, { key: 'll:shows', order: 2 }, { key: 'll:4k', order: 1 }];
  assert.deepEqual(desiredHomeKeys({ rows, franchise: { key: 'collection_franchises', slot: 1 }, collectionKeys: ['collection_hub', 'collection_packs'] }),
    { lead: ['collection_hub', 'collection_franchises', 'collection_packs'], rows: ['ll:movies', 'll:4k', 'll:shows'] });
  // No stored slot (older setups): first among the collections.
  assert.deepEqual(desiredHomeKeys({ rows, franchise: { key: 'collection_franchises', slot: null }, collectionKeys: ['collection_hub'] }).lead,
    ['collection_franchises', 'collection_hub']);
  // A slot past the end is clamped.
  assert.deepEqual(desiredHomeKeys({ rows: [], franchise: { key: 'collection_franchises', slot: 9 }, collectionKeys: ['collection_hub'] }).lead,
    ['collection_hub', 'collection_franchises']);
});

test('lead keys go above every row, even rows other addons hold above them', () => {
  const existingKeys = ['other:a', 'll:movies', 'collection_mine', 'collection_collection-lelibrary-x'];
  const lead = ['collection_collection-lelibrary-x', 'collection_mine'];
  const managed = new Set(['ll:movies', 'collection_collection-lelibrary-x']);
  assert.deepEqual(layoutHomeKeys({ existingKeys, desired: ['ll:movies'], managed, lead }),
    ['collection_collection-lelibrary-x', 'collection_mine', 'other:a', 'll:movies']);
});
