// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const { dropMalformedHomeItems } = require('../src/catalog/nuvio-home-settings.ts');

// Nuvio Mobile re-splits a Home key it does not recognise on ":" (an old key
// format). LeLibrary keys use "_", so the whole key lands in addon_id with an
// empty type and catalog id, and every later push lengthened it ("____").
// Seen on a real profile (2026-10-24): 165 such entries.
test('broken LeLibrary Home entries are dropped; everything else is kept', () => {
  const items = [
    { key: 'community.lelibrary_movie_torbox-movies____', addon_id: 'community.lelibrary_movie_torbox-movies__', type: '', catalog_id: '', enabled: false, is_collection: false },
    { key: 'community.lelibrary.dev_series_torbox-series__', addon_id: 'community.lelibrary.dev_series_torbox-series', type: '', catalog_id: '', enabled: true, is_collection: false },
    { key: 'community.lelibrary_movie_torbox-movies', addon_id: 'community.lelibrary', type: 'movie', catalog_id: 'torbox-movies', enabled: true, is_collection: false },
    { key: 'collection_collection-lelibrary-franchises', addon_id: '', type: '', catalog_id: '', enabled: true, is_collection: true, collection_id: 'collection-lelibrary-franchises' },
    { key: 'other.addon_movie_top', addon_id: 'other.addon_movie_top', type: '', catalog_id: '', enabled: true, is_collection: false },
  ];
  const kept = dropMalformedHomeItems(items);
  assert.deepEqual(kept.map((i) => i.key), [
    'community.lelibrary_movie_torbox-movies',
    'collection_collection-lelibrary-franchises',
    'other.addon_movie_top',
  ]);
});
