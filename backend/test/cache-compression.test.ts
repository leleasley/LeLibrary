'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cache = require('../src/runtime/cache.ts');

test('small values are stored as plain JSON', async () => {
  const encoded = await cache._encodeValue({ a: 1 });
  assert.equal(encoded, '{"a":1}');
  assert.deepEqual(await cache._decodeValue(encoded), { a: 1 });
});

test('large values are gzipped and read back unchanged', async () => {
  const rows = Array.from({ length: 5000 }, (_, i) => ({ id: i, name: `Some.Show.S01E${i}.1080p.WEB-DL.mkv`, files: [{ size: i * 1000 }] }));
  const encoded = await cache._encodeValue(rows);
  assert.ok(encoded.startsWith('gz1:'));
  assert.ok(encoded.length < JSON.stringify(rows).length / 4, 'compressed copy is much smaller');
  assert.deepEqual(await cache._decodeValue(encoded), rows);
});

test('values written before compression still read', async () => {
  const old = JSON.stringify([{ id: 1 }, 'gz1:not-a-prefix-inside-json']);
  assert.deepEqual(await cache._decodeValue(old), [{ id: 1 }, 'gz1:not-a-prefix-inside-json']);
});

test('operator-disabled stream addons are listed and never fetched', async () => {
  const streamAddons = require('../src/streams/streamAddons.ts');
  const before = process.env.STREAM_ADDONS_UNAVAILABLE;
  process.env.STREAM_ADDONS_UNAVAILABLE = 'torrentio, Bad Id!,comet';
  try {
    assert.deepEqual(streamAddons.unavailableStreamAddons(), ['torrentio', 'comet']);
    const result = await streamAddons.fetchExternalStreams(['torrentio', 'comet'], {}, 'movie', 'tt0111161');
    assert.deepEqual(result, []);
  } finally {
    if (before === undefined) delete process.env.STREAM_ADDONS_UNAVAILABLE; else process.env.STREAM_ADDONS_UNAVAILABLE = before;
  }
});

export interface CacheCompressionTestModule {};
