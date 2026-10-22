// @ts-nocheck
// "Your own" stream addons: slots, labels and ordering. No network.
const test = require('node:test');
const assert = require('node:assert');
const sa = require('../src/streams/streamAddons.ts');

test('only custom-1..3 are custom addon slots', () => {
  assert.equal(sa.customAddonSlot('custom-1'), 1);
  assert.equal(sa.customAddonSlot('custom-3'), 3);
  for (const id of ['custom-0', 'custom-4', 'torrentio', 'custom-1x', null]) assert.equal(sa.customAddonSlot(id), null, String(id));
  assert.equal(sa.MAX_CUSTOM_ADDONS, 3);
});

test('a slot without a saved link contributes nothing and never throws', async () => {
  const streams = await sa.fetchExternalStreams(['custom-2'], { customAddons: [{ id: 'custom-2', name: 'StreamNZB' }] }, 'movie', 'tt0111161', 3000);
  assert.deepEqual(streams, []);
});

test('a link to a private address is refused before any request', async () => {
  const config = { customAddon1: 'https://127.0.0.1/abc/manifest.json', customAddons: [{ id: 'custom-1', name: 'Local' }] };
  const streams = await sa.fetchExternalStreams(['custom-1'], config, 'movie', 'tt0111161', 3000);
  assert.deepEqual(streams, []);
});
