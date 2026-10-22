// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');

const { ADDON_LIST, buildJackettioConfigUrls } = require('../src/streams/streamAddons.ts');
const streamAddons = require('../src/streams/streamAddons.ts');

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

test('KNABEN duplicate infohashes yield one stream per active debrid provider', async () => {
  const axios = require('axios');
  const cache = require('../src/runtime/cache.ts');
  const originalPost = axios.post;
  const originalMset = cache.mset;
  const hash = 'a'.repeat(40);
  axios.post = async () => ({ data: { hits: [
    { hash, title: 'Release title one', seeders: 10, magnetUrl: `magnet:?xt=urn:btih:${hash}&dn=one` },
    { hash, title: 'Release title variant', seeders: 20, magnetUrl: `magnet:?xt=urn:btih:${hash}&dn=two` },
  ] } });
  cache.mset = async () => true;
  try {
    const streams = await streamAddons.fetchExternalStreams(
      ['knaben'],
      { provider: 'torbox', torboxApiKey: 'synthetic-test-only' },
      'movie',
      'tt0133093',
      4000,
      { knabenMetadata: Promise.resolve({ title: 'Synthetic movie', year: '2000' }), token: 'qa-only', origin: 'https://qa.invalid' },
    );
    assert.equal(streams.length, 1);
    assert.equal(streams[0]._sourceAddonId, 'knaben');
    assert.equal(streams[0]._debridProviderId, 'torbox');
    assert.match(streams[0].url, new RegExp(`/knaben/play/torbox/${hash}\\.json`));
  } finally {
    axios.post = originalPost;
    cache.mset = originalMset;
  }
});

export interface StreamAddonsTestTestModule {};
