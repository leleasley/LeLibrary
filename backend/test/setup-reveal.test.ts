// @ts-nocheck
'use strict';
// Reveal-on-demand decision logic: values leave the server only for
// password-protected setups, only for allowlisted key-shaped services, and
// only when a value is actually stored. Uses plain objects (no database).
const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveRevealKey } = require('../src/routes/setup.ts');

function opened(overrides = {}) {
  return {
    uuid: 'f9ac0919-3b58-40f5-a6be-84be362d63fe',
    tier: 'quick',
    name: null,
    hasPassword: true,
    config: {},
    keys: { torboxApiKey: 'real-torbox-key', tmdbApiKey: 'real-tmdb-key' },
    ...overrides,
  };
}

test('reveals a stored allowlisted key', () => {
  const out = resolveRevealKey(opened(), 'torboxApiKey');
  assert.equal(out.ok, true);
  assert.equal(out.key, 'real-torbox-key');
});

test('passwordless setups can never reveal, even unlocked', () => {
  const out = resolveRevealKey(opened({ hasPassword: false }), 'torboxApiKey');
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
});

test('unknown or non-key services are refused', () => {
  for (const service of ['__proto__', 'constructor', 'trakt', 'nuvio', '', null, 42]) {
    const out = resolveRevealKey(opened(), service);
    assert.equal(out.ok, false, String(service));
    assert.equal(out.status, 400, String(service));
  }
});

test('missing values 404 instead of leaking shape', () => {
  const out = resolveRevealKey(opened(), 'rdApiKey');
  assert.equal(out.ok, false);
  assert.equal(out.status, 404);
  const empty = resolveRevealKey(opened({ keys: { torboxApiKey: '' } }), 'torboxApiKey');
  assert.equal(empty.ok, false);
  assert.equal(empty.status, 404);
});
