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

test('WebDAV counts only when the self-host switch is on', () => {
  const config = { tmdbApiKey: 't', webdavUrl: 'https://dav.example.test/x', webdavUser: 'u', webdavPassword: 'p' };
  const before = process.env.WEBDAV_SOURCE;
  try {
    delete process.env.WEBDAV_SOURCE;
    assert.deepEqual(activeProviders(config), []);
    assert.deepEqual(activeProviders({ ...config, provider: 'webdav' }), []);
    process.env.WEBDAV_SOURCE = 'on';
    assert.deepEqual(activeProviders(config), ['webdav']);
    assert.deepEqual(activeProviders({ ...config, torboxApiKey: 'tb' }), ['torbox', 'webdav']);
    assert.deepEqual(activeProviders({ ...config, webdavUrl: 'not a url' }), []);
  } finally {
    if (before === undefined) delete process.env.WEBDAV_SOURCE; else process.env.WEBDAV_SOURCE = before;
  }
});

test('the WebDAV library keeps its id when only the password changes', () => {
  const before = process.env.WEBDAV_SOURCE;
  process.env.WEBDAV_SOURCE = 'on';
  try {
    const base = { webdavUrl: 'https://dav.example.test/x', webdavUser: 'u', webdavPassword: 'p' };
    const id = getUserKey(base);
    assert.match(id, /^[0-9a-f]{12}$/);
    assert.equal(getUserKey({ ...base, webdavPassword: 'other' }), id);
    assert.notEqual(getUserKey({ ...base, webdavUser: 'v' }), id);
    assert.notEqual(getUserKey({ ...base, webdavUrl: 'https://dav.example.test/y' }), id);
    assert.equal(require('../src/providers/index.ts').providerBySource('webdav'), 'webdav');
    assert.equal(require('../src/providers/index.ts').providerByCat('dav'), 'webdav');
  } finally {
    if (before === undefined) delete process.env.WEBDAV_SOURCE; else process.env.WEBDAV_SOURCE = before;
  }
});
