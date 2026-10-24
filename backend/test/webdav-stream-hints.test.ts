// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const { ownedStreamHints, wholeItemFileId } = require('../src/catalog/builder.ts');

test('WebDAV streams are marked not web-ready and carry name and size', () => {
  assert.deepEqual(ownedStreamHints('Heat (1995)/Heat.1995.1080p.mkv', 1500, 'webdav', 'lib:1'),
    { notWebReady: true, filename: 'Heat.1995.1080p.mkv', videoSize: 1500, bingeGroup: 'lib:1' });
});

test('debrid streams keep their existing hints', () => {
  assert.deepEqual(ownedStreamHints('Folder/Show.S01E02.mkv', 900, 'torrent', undefined),
    { notWebReady: false, filename: 'Show.S01E02.mkv' });
});

test('playing a whole WebDAV item uses its first file, never file 0', () => {
  assert.equal(wholeItemFileId({ source: 'webdav', files: [{ id: 'L01vdmllcy9hLm1rdg' }] }), 'L01vdmllcy9hLm1rdg');
  assert.equal(wholeItemFileId({ source: 'webdav', files: [] }), null);
  assert.equal(wholeItemFileId({ source: 'torrent', files: [{ id: 5 }] }), 0);
});
