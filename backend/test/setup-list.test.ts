// @ts-nocheck
'use strict';
// The self-host setup list reads summaries only. It must never select the
// sealed secret, the encrypted config or the keys, and it must bound the row
// count: one query, no per-row decryption.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createConfigStore } = require('../src/setup/config-store.ts');

const KEY = crypto.createHash('sha256').update('list-test-key').digest();
const UUID_A = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';

function fakePool(rows) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows, rowCount: rows.length };
    },
  };
}

const ROWS = [
  {
    uuid: UUID_A,
    name: 'Living room',
    tier: 'quick',
    has_password: true,
    created_at: new Date('2026-10-01T10:00:00Z'),
    updated_at: new Date('2026-10-02T10:00:00Z'),
    last_used_at: new Date('2026-10-03T10:00:00Z'),
  },
  {
    uuid: UUID_B,
    name: null,
    tier: 'full',
    has_password: false,
    created_at: new Date('2026-09-01T10:00:00Z'),
    updated_at: null,
    last_used_at: null,
  },
];

test('list maps summary rows and never fetches secret material', async () => {
  const pool = fakePool(ROWS);
  const store = createConfigStore({ pool, key: KEY });

  const summaries = await store.list();

  assert.equal(summaries.length, 2);
  assert.deepEqual(summaries[0], {
    uuid: UUID_A,
    name: 'Living room',
    tier: 'quick',
    hasPassword: true,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-02T10:00:00Z'),
    lastUsedAt: new Date('2026-10-03T10:00:00Z'),
  });
  assert.equal(summaries[1].hasPassword, false);
  assert.equal(summaries[1].name, null);
  assert.equal(summaries[1].updatedAt, null);

  const { sql } = pool.calls[0];
  for (const forbidden of ['secret_sealed', 'secret_hash', 'encrypted_config', 'encrypted_keys']) {
    assert.ok(!sql.includes(forbidden), `list SQL must not select ${forbidden}`);
  }
  // Ordering is most-recently-used first.
  assert.match(sql, /ORDER BY COALESCE\(last_used_at, updated_at, created_at\) DESC/);
  // An empty-string hash is not a password: match the editor's own predicate.
  assert.match(sql, /password_hash <> ''/);
});

test('list clamps an unbounded or zero limit', async () => {
  const pool = fakePool([]);
  const store = createConfigStore({ pool, key: KEY });

  await store.list({ limit: 9999 });
  assert.equal(pool.calls[0].params[0], 200);

  await store.list({ limit: 0 });
  assert.equal(pool.calls[1].params[0], 50);

  await store.list({ limit: 'nonsense' });
  assert.equal(pool.calls[2].params[0], 50);
});

export interface SetupListTestModule {}
