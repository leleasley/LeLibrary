// @ts-nocheck
'use strict';
// Full erasure removes the whole configs row (settings + sealed secrets) and
// reports whether anything was actually deleted. Uses a fake pool.
const test = require('node:test');
const assert = require('node:assert/strict');

const { createConfigStore } = require('../src/setup/config-store.ts');

const UUID = 'f9ac0919-3b58-40f5-a6be-84be362d63fe';

function fakePool({ rowCount }) {
  const queries = [];
  return {
    queries,
    async query(text, params) {
      queries.push({ text, params });
      if (text.startsWith('DELETE FROM configs WHERE uuid')) {
        return { rowCount };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

test('remove deletes the row and reports success', async () => {
  const pool = fakePool({ rowCount: 1 });
  const store = createConfigStore({ pool, key: Buffer.alloc(32) });
  assert.equal(await store.remove(UUID), true);
  assert.match(pool.queries[0].text, /^DELETE FROM configs/);
  assert.deepEqual(pool.queries[0].params, [UUID]);
});

test('remove reports false when nothing matched', async () => {
  const pool = fakePool({ rowCount: 0 });
  const store = createConfigStore({ pool, key: Buffer.alloc(32) });
  assert.equal(await store.remove(UUID), false);
});

test('remove refuses non-UUID input without querying', async () => {
  const pool = fakePool({ rowCount: 1 });
  const store = createConfigStore({ pool, key: Buffer.alloc(32) });
  assert.equal(await store.remove('not-a-uuid'), false);
  assert.equal(pool.queries.length, 0);
});
