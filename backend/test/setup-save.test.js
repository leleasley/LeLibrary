// @ts-nocheck
'use strict';
// Partial-save merge semantics: the edit page saves one section at a time and
// can never read sealed secrets back, so omitted fields must survive and only
// an explicit clear list removes anything. Uses a fake pool (no database).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createConfigStore } = require('../src/setup/config-store.ts');
const { seal, unseal } = require('../src/setup/seal.ts');

const KEY = crypto.createHash('sha256').update('unit-test-key').digest();
const UUID = 'f9ac0919-3b58-40f5-a6be-84be362d63fe';

function fakePool(row) {
  const queries = [];
  return {
    queries,
    async query(text, params) {
      queries.push({ text, params });
      if (text.startsWith('SELECT uuid, tier, name, encrypted_config, encrypted_keys')) {
        return { rows: row ? [row] : [] };
      }
      if (text.startsWith('UPDATE configs SET encrypted_config')) {
        row.encrypted_config = params[1];
        row.encrypted_keys = params[2];
        row.tier = params[3];
        row.name = params[4];
        return { rows: [{ uuid: row.uuid, tier: row.tier, updated_at: null }] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

function storedRow() {
  return {
    uuid: UUID,
    tier: 'quick',
    name: 'Living room',
    encrypted_config: seal(KEY, { streamPreset: 'torrentio', lang: 'en-US' }),
    encrypted_keys: seal(KEY, { torboxApiKey: 'real-torbox-key', rdApiKey: 'real-rd-key' }),
  };
}

test('save merges partial keys and config without touching the rest', async () => {
  const row = storedRow();
  const pool = fakePool(row);
  const store = createConfigStore({ pool, key: KEY });
  const saved = await store.save(UUID, { keys: { rdApiKey: 'new-rd-key' }, config: { homeRows: ['movie-night'] } });
  assert.ok(saved);
  assert.deepEqual(unseal(KEY, row.encrypted_keys), { torboxApiKey: 'real-torbox-key', rdApiKey: 'new-rd-key' });
  assert.deepEqual(unseal(KEY, row.encrypted_config), { streamPreset: 'torrentio', lang: 'en-US', homeRows: ['movie-night'] });
});

test('save keeps both envelopes untouched when nothing changes', async () => {
  const row = storedRow();
  const beforeConfig = JSON.stringify(row.encrypted_config);
  const beforeKeys = JSON.stringify(row.encrypted_keys);
  const pool = fakePool(row);
  const store = createConfigStore({ pool, key: KEY });
  await store.save(UUID, { name: 'Renamed' });
  assert.equal(JSON.stringify(row.encrypted_config), beforeConfig);
  assert.equal(JSON.stringify(row.encrypted_keys), beforeKeys);
  assert.equal(row.name, 'Renamed');
});

test('save removes only explicitly cleared fields', async () => {
  const row = storedRow();
  const pool = fakePool(row);
  const store = createConfigStore({ pool, key: KEY });
  await store.save(UUID, { clearKeys: ['rdApiKey'], clearConfig: ['lang'] });
  assert.deepEqual(unseal(KEY, row.encrypted_keys), { torboxApiKey: 'real-torbox-key' });
  assert.deepEqual(unseal(KEY, row.encrypted_config), { streamPreset: 'torrentio' });
});

test('save on a missing setup returns null without writing', async () => {
  const pool = fakePool(null);
  const store = createConfigStore({ pool, key: KEY });
  assert.equal(await store.save(UUID, { keys: { a: 'b' } }), null);
  assert.ok(pool.queries.every((q) => !q.text.startsWith('UPDATE')));
});
