const test = require('node:test');
const assert = require('node:assert/strict');

const { ADDON_LIST, buildJackettioConfigUrls } = require('../src/streamAddons');

test('Jackettio creates one configured manifest per active compatible provider', () => {
  const urls = buildJackettioConfigUrls({
    torboxApiKey: 'test-torbox-key',
    rdApiKey: 'test-rd-key',
    pmApiKey: 'test-premiumize-key',
  });

  assert.equal(urls.length, 3);
  for (const url of urls) {
    assert.match(url, /^https:\/\/jackettio\.elfhosted\.com\/.+\/manifest\.json$/);
  }

  const configs = urls.map(url => {
    const token = url.slice('https://jackettio.elfhosted.com/'.length, -'/manifest.json'.length);
    return JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
  });
  assert.deepEqual(configs.map(config => config.debridId).sort(), ['premiumize', 'realdebrid', 'torbox']);
  assert.ok(configs.every(config => config.useStremThru === true));
  assert.ok(configs.every(config => Array.isArray(config.indexers) && config.indexers.length > 0));
});

test('Jackettio is offered as a curated external stream addon', () => {
  assert.ok(ADDON_LIST.some(addon => addon.id === 'jackettio' && addon.name === 'Jackettio'));
});
