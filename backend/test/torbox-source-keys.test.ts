// @ts-nocheck
// A TorBox torrent and an NZB (or web download) can share a numeric id. The
// library key must keep them apart; torrents keep their bare id.
const test = require('node:test');
const assert = require('node:assert');
const { sourceIdOf, buildRecord, diffRecords, recordKey } = require('../src/library/diff.ts');

test('usenet and web downloads are keyed by family, torrents are not', () => {
  assert.equal(sourceIdOf({ id: 123, source: 'torrent' }), '123');
  assert.equal(sourceIdOf({ id: 123, source: 'usenet' }), 'usenet:123');
  assert.equal(sourceIdOf({ id: 123, source: 'webdl' }), 'webdl:123');
});

test('a torrent and an NZB with the same id both stay in the library', () => {
  const torrent = { id: 123, source: 'torrent', name: 'Movie.One.2020.1080p', files: [] };
  const nzb = { id: 123, source: 'usenet', name: 'Movie.Two.2021.1080p', files: [] };
  const records = [torrent, nzb].map((item) => buildRecord(item, sourceIdOf(item)));
  const keys = new Set(records.map(recordKey));
  assert.equal(keys.size, 2);
  const { toWrite } = diffRecords(new Map(), records);
  assert.equal(toWrite.length, 2);
});
