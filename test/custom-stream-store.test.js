const test = require('node:test');
const assert = require('node:assert/strict');

const cache = require('../src/cache');
const configstore = require('../src/configstore');

test('hosted-style config storage seals Custom Stream URLs before writing', async (t) => {
  const previousKey = process.env.ENCRYPTION_KEY;
  const previousSet = cache.set;
  const previousGet = cache.get;
  let storedKey = '';
  let storedValue = null;
  process.env.ENCRYPTION_KEY = '11'.repeat(32);
  cache.set = async (key, value) => { storedKey = key; storedValue = value; return true; };
  cache.get = async key => key === storedKey ? storedValue : null;
  t.after(() => {
    if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previousKey;
    cache.set = previousSet;
    cache.get = previousGet;
  });

  const config = {
    provider: 'torbox', torboxApiKey: 'synthetic-test-key',
    customStreams: [{ name: 'Private', url: 'https://private.invalid/file.mkv?signature=test', type: 'movie', ids: ['tt123'] }],
  };
  await configstore.saveStreamSettings(config);
  assert.equal(storedValue.customStreams, undefined);
  assert.ok(storedValue.customStreamsSealed?.iv);
  assert.doesNotMatch(JSON.stringify(storedValue), /private\.invalid|signature=test/);

  const loaded = await configstore.loadStreamSettings(config);
  assert.deepEqual(loaded.customStreams, config.customStreams);
  assert.equal(loaded.customStreamsSealed, undefined);
});

test('account-scoped mapping-only storage works without a provider key', async (t) => {
  const previousKey = process.env.ENCRYPTION_KEY;
  const previousSet = cache.set;
  const previousGet = cache.get;
  let storedKey = '';
  let storedValue = null;
  process.env.ENCRYPTION_KEY = '22'.repeat(32);
  cache.set = async (key, value) => { storedKey = key; storedValue = value; return true; };
  cache.get = async key => key === storedKey ? storedValue : null;
  t.after(() => {
    if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previousKey;
    cache.set = previousSet;
    cache.get = previousGet;
  });

  const config = { customStreams: [{ name: 'Only', url: 'https://example.invalid/only.mkv', type: 'movie', ids: ['tt456'] }] };
  Object.defineProperty(config, '__configScope', { value: { type: 'account', token: 'synthetic-token' }, enumerable: false });
  assert.equal(await configstore.saveStreamSettings(config), 'account');
  const loaded = await configstore.loadStreamSettings(config);
  assert.deepEqual(loaded.customStreams, config.customStreams);
});
