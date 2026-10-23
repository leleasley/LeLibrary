'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nuvioTileShape } = require('../src/catalog/collection-artwork.ts');
const libraryCollections = require('../src/catalog/nuvio-library-collections.ts');

// Nuvio TV only accepts these (CollectionsDataStore validShapes).
const NUVIO_VALID = new Set(['POSTER', 'LANDSCAPE', 'SQUARE', 'poster', 'wide', 'square']);

test('every tile shape sent to Nuvio is one Nuvio accepts', () => {
  assert.equal(nuvioTileShape('PORTRAIT'), 'POSTER');
  assert.equal(nuvioTileShape('poster'), 'POSTER');
  assert.equal(nuvioTileShape('LANDSCAPE'), 'LANDSCAPE');
  assert.equal(nuvioTileShape('wide'), 'LANDSCAPE');
  assert.equal(nuvioTileShape('square'), 'SQUARE');
  assert.equal(nuvioTileShape(undefined), 'POSTER');
  for (const value of ['PORTRAIT', 'portrait', 'LANDSCAPE', 'SQUARE', '', null, 'weird']) {
    assert.ok(NUVIO_VALID.has(nuvioTileShape(value)), String(value));
  }
});

test('the LeLibrary Movie Collection folders use Nuvio\'s POSTER shape', () => {
  const metas = [{ collectionId: 10, name: 'Star Wars Collection', poster: 'https://image.tmdb.org/t/p/w500/x.jpg' }];
  const collection = libraryCollections.buildLibraryCollection(metas, 'community.lelibrary', {});
  assert.ok(collection.folders.length > 0);
  for (const folder of collection.folders) assert.equal(folder.tileShape, 'POSTER');
});

export interface NuvioTileShapeTestModule {};
