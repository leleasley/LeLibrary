'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cache = require('../src/cache');

test('batch cache reads preserve found nulls and skip missing keys', async () => {
  const prefix = `test:mget:${process.pid}:${Date.now()}`;
  cache.setMem(`${prefix}:value`, { ok: true }, 30);
  cache.setMem(`${prefix}:null`, null, 30);
  const rows = await cache.mget([`${prefix}:value`, `${prefix}:null`, `${prefix}:missing`, `${prefix}:value`]);
  assert.deepEqual(rows.get(`${prefix}:value`), { ok: true });
  assert.equal(rows.has(`${prefix}:null`), true);
  assert.equal(rows.get(`${prefix}:null`), null);
  assert.equal(rows.has(`${prefix}:missing`), false);
});

test('catalog page replacement removes stale pagination and restores prepared pages', async () => {
  const prefix = `replace-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const first = `${prefix}:catalog:user:0`;
  const later = `${prefix}:catalog:user:50`;
  const unrelated = `${prefix}:catalog:other:50`;
  await cache.set(first, { metas: ['old-first'] }, 60);
  await cache.set(later, { metas: ['old-later'] }, 60);
  await cache.set(unrelated, { metas: ['other'] }, 60);

  await cache.replacePattern(`${prefix}:catalog:user:*`, [
    { key: first, value: { metas: ['new-first'] }, ttl: 60 },
  ], 60);

  assert.deepEqual(await cache.get(first), { metas: ['new-first'] });
  assert.equal(await cache.get(later), null);
  assert.deepEqual(await cache.get(unrelated), { metas: ['other'] });
});
