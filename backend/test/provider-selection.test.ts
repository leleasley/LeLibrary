// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');

const { activeProviders, getUserKey } = require('../src/providers/index.ts');

// v5.5 setups keep provider keys in a sealed store and may not carry the
// legacy `provider` selection: activeProviders must infer it from key
// presence so a saved key stays usable. Legacy tokens always carry
// `provider`, so they never touch the inference branch.
test('infers providers from key presence when the provider field is absent', () => {
  assert.deepEqual(activeProviders({ torboxApiKey: 'tb-key' }), ['torbox']);
  assert.deepEqual(
    activeProviders({ rdApiKey: 'rd-key', adApiKey: 'ad-key' }),
    ['realdebrid', 'alldebrid'],
  );
  assert.deepEqual(activeProviders({ tmdbApiKey: 'tmdb-key' }), []);
  assert.deepEqual(activeProviders({}), []);
});

test('legacy provider selection still gates on keys', () => {
  assert.deepEqual(activeProviders({ provider: 'torbox', torboxApiKey: 'tb-key' }), ['torbox']);
  assert.deepEqual(activeProviders({ provider: 'torbox' }), []);
  assert.deepEqual(activeProviders({ provider: 'both', torboxApiKey: 'tb-key' }), ['torbox']);
  assert.deepEqual(
    activeProviders({ provider: 'torbox,realdebrid', torboxApiKey: 'tb-key', rdApiKey: 'rd-key' }),
    ['torbox', 'realdebrid'],
  );
});

test('inferred providers produce a stable user key', () => {
  const key = getUserKey({ torboxApiKey: 'tb-key' });
  assert.match(key, /^[0-9a-f]{12}$/);
  assert.equal(getUserKey({}), '');
});
