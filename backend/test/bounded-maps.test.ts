// @ts-nocheck
'use strict';
// Module-level maps keyed by user/request input stay bounded (audit B11-B13).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Count unseal calls: patch the seal module before config-store destructures it.
const sealModule = require('../src/setup/seal.ts');
const realUnseal = sealModule.unseal;
const unsealCalls = [];
sealModule.unseal = (key, value) => { unsealCalls.push(value); return realUnseal(key, value); };

const { boundedSet } = require('../src/runtime/bounded-map.ts');
const { openRow, shouldTouch, TOUCH_THROTTLE_MAX, createConfigStore } = require('../src/setup/config-store.ts');
const { createPendingOAuth, consumePendingOAuth, pendingOAuthCount, PENDING_MAX } = require('../src/setup/oauth.ts');

const KEY = crypto.createHash('sha256').update('bounded-maps-test-key').digest();

test('boundedSet keeps the map under its cap and drops the oldest first', () => {
  const map = new Map();
  for (let i = 0; i < 1000; i++) boundedSet(map, `k${i}`, i, 50);
  assert.equal(map.size, 50);
  assert.equal(map.keys().next().value, 'k950');
  assert.equal(map.get('k999'), 999);
});

test('boundedSet sweeps stale entries from the front and re-orders on update', () => {
  const map = new Map();
  boundedSet(map, 'a', 1, 10);
  boundedSet(map, 'b', 2, 10);
  boundedSet(map, 'a', 3, 10); // moves "a" to the back
  assert.deepEqual([...map.keys()], ['b', 'a']);
  boundedSet(map, 'c', 10, 10, (v) => v < 5); // "b" (2) and "a" (3) are stale
  assert.deepEqual([...map.keys()], ['c']);
});

test('openRow opens a sealed row and unseals the secret once', () => {
  const secretSealed = sealModule.seal(KEY, 'install-secret');
  const row = {
    uuid: '11111111-2222-4333-8444-555555555555',
    secret_hash: 'x',
    secret_sealed: secretSealed,
    tier: 'partial',
    name: 'Test',
    password_salt: null,
    password_hash: null,
    encrypted_config: sealModule.seal(KEY, { a: 1 }),
    encrypted_keys: sealModule.seal(KEY, { torboxApiKey: 'synthetic' }),
    created_at: null,
    updated_at: null,
  };
  unsealCalls.length = 0;
  const opened = openRow(row, KEY);
  assert.equal(opened.secret, 'install-secret');
  assert.deepEqual(opened.config, { a: 1 });
  assert.deepEqual(opened.keys, { torboxApiKey: 'synthetic' });
  assert.equal(opened.tier, 'partial');
  assert.equal(opened.hasPassword, false);
  assert.equal(unsealCalls.filter((v) => v === secretSealed).length, 1);
  assert.equal(unsealCalls.length, 3);
  assert.equal(openRow(undefined, KEY), null);
  assert.equal(openRow({ ...row, secret_sealed: null }, KEY).secret, null);
});

test('touch throttle writes once a minute and stays under its cap', () => {
  const map = new Map();
  assert.equal(shouldTouch(map, 'u1', 1000), true);
  assert.equal(shouldTouch(map, 'u1', 30_000), false);
  assert.equal(shouldTouch(map, 'u1', 61_001), true);
  for (let i = 0; i < 500; i++) shouldTouch(map, `u${i}`, 100_000 + i, 100);
  assert.ok(map.size <= 100, `size ${map.size}`);
  // A later insert sweeps every entry past the window.
  shouldTouch(map, 'late', 100_000 + 500 + 61_000, 100);
  assert.equal(map.size, 1);
  assert.ok(TOUCH_THROTTLE_MAX > 0);
});

test('resolveByToken touches last_used_at through the bounded throttle', async () => {
  const { buildInstallToken, secretHash } = require('../src/setup/token.ts');
  const uuid = '11111111-2222-4333-8444-555555555555';
  const secret = 'synthetic-secret-value';
  const row = {
    uuid, secret_hash: secretHash(secret), secret_sealed: sealModule.seal(KEY, secret), tier: 'quick', name: null,
    password_salt: null, password_hash: null,
    encrypted_config: sealModule.seal(KEY, {}), encrypted_keys: sealModule.seal(KEY, {}),
  };
  const updates = [];
  const pool = {
    async query(sql, params) {
      if (sql.startsWith('UPDATE')) { updates.push(params[0]); return { rows: [], rowCount: 1 }; }
      return { rows: [row], rowCount: 1 };
    },
  };
  const store = createConfigStore({ pool, key: KEY });
  const token = buildInstallToken(uuid, secret);
  assert.equal((await store.resolveByToken(token)).secret, secret);
  await store.resolveByToken(token);
  assert.deepEqual(updates, [uuid]);
});

test('expired OAuth states are pruned on insert and the map stays capped', () => {
  const start = 5_000_000;
  for (let i = 0; i < 50; i++) createPendingOAuth(null, 'simkl', start + i);
  assert.ok(pendingOAuthCount() >= 50);
  // Eleven minutes later every earlier state has expired: one insert sweeps them.
  const later = start + 11 * 60 * 1000;
  const fresh = createPendingOAuth('uuid-x', 'trakt', later);
  assert.equal(pendingOAuthCount(), 1);
  assert.deepEqual(consumePendingOAuth(fresh.state, later + 1), { uuid: 'uuid-x', provider: 'trakt' });

  const burst = later + 1000;
  let first = null;
  for (let i = 0; i < PENDING_MAX + 300; i++) {
    const { state } = createPendingOAuth(null, 'simkl', burst);
    if (i === 0) first = state;
  }
  assert.equal(pendingOAuthCount(), PENDING_MAX);
  assert.equal(consumePendingOAuth(first, burst + 1), null); // oldest dropped by the cap
});
