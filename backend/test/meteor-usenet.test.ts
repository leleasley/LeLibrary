// @ts-nocheck
// Meteor's usenet search runs through TorBox, which only includes usenet on
// its Pro plan (TorBox reports Pro as plan 2, Standard as 3). No network.
const test = require('node:test');
const assert = require('node:assert');
const { hasTorBoxUsenet } = require('../src/providers/torbox.ts');
const { ADDONS } = require('../src/streams/streamAddons.ts');

test('only an unexpired TorBox Pro plan allows usenet', () => {
  const now = Date.parse('2026-10-22T00:00:00Z');
  assert.equal(hasTorBoxUsenet({ plan: 2, expiresAt: '2027-01-01T00:00:00Z' }, now), true);
  assert.equal(hasTorBoxUsenet({ plan: 2, expiresAt: null }, now), true);
  assert.equal(hasTorBoxUsenet({ plan: 2, expiresAt: '2026-01-01T00:00:00Z' }, now), false);
  for (const plan of [0, 1, 3, null]) assert.equal(hasTorBoxUsenet({ plan, expiresAt: null }, now), false, String(plan));
  assert.equal(hasTorBoxUsenet(null, now), false);
});

function meteorConfig(url) {
  const encoded = url.split('/').slice(-2)[0];
  return JSON.parse(Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

test('the Meteor config switches usenet on only when prepared for it', () => {
  const config = { provider: 'torbox', torboxApiKey: 'synthetic-key-for-tests', streamAddons: ['meteor'] };
  assert.equal(meteorConfig(ADDONS.meteor.buildConfigUrl(config)).enableUsenet, false);
  assert.equal(meteorConfig(ADDONS.meteor.buildConfigUrl(config, { usenet: false })).enableUsenet, false);
  assert.equal(meteorConfig(ADDONS.meteor.buildConfigUrl(config, { usenet: true })).enableUsenet, true);
});

test('Meteor never looks up a plan when TorBox is not connected', async () => {
  const extras = await ADDONS.meteor.prepare({ provider: 'realdebrid', rdApiKey: 'synthetic' });
  assert.deepEqual(extras, { usenet: false });
});
