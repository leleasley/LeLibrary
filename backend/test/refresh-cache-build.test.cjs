// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');

const cache = require('../src/runtime/cache.ts');
const providers = require('../src/providers/index.ts');
const configstore = require('../src/runtime/configstore.ts');
const fingerprint = require('../src/runtime/cache-fingerprint.ts');
const builder = require('../src/catalog/builder.ts');
const collections = require('../src/catalog/franchise-collections.ts');
const originalBuildCatalog = builder.buildCatalog;
const originalBuildCollectionsCatalog = collections.buildCollectionsCatalog;
let recordBuiltType = () => {};
builder.buildCatalog = async (...args) => { recordBuiltType(args[2]); return []; };
collections.buildCollectionsCatalog = async () => [];
const refresh = require('../src/runtime/refresh.ts');

test.after(() => {
  builder.buildCatalog = originalBuildCatalog;
  collections.buildCollectionsCatalog = originalBuildCollectionsCatalog;
});

test('legacy background cache rebuild resolves shared fingerprint and catalog helpers', async (t) => {
  const config = { tmdbApiKey: 'synthetic-test-value', torboxApiKey: 'synthetic-test-value', lang: 'en-US' };
  const expectedHash = `${refresh.LIBRARY_PROJECTION_VERSION}:${refresh.hashDownloads([])}:${fingerprint.posterFp(config)}:torbox`;
  const originals = {
    mergeStoredConfig: configstore.mergeStoredConfig,
    activeProviders: providers.activeProviders,
    getUserKey: providers.getUserKey,
    fetchDownloads: providers.fetchDownloads,
    setCachedDownloads: providers.setCachedDownloads,
    downloadsFor: providers.downloadsFor,
    providerMeta: providers.PROVIDER_META,
    get: cache.get,
    makeKey: cache.makeKey,
    exists: cache.exists,
    touchPattern: cache.touchPattern,
    set: cache.set,
    expire: cache.expire,
  };
  t.after(() => {
    Object.assign(configstore, { mergeStoredConfig: originals.mergeStoredConfig });
    Object.assign(providers, {
      activeProviders: originals.activeProviders,
      getUserKey: originals.getUserKey,
      fetchDownloads: originals.fetchDownloads,
      setCachedDownloads: originals.setCachedDownloads,
      downloadsFor: originals.downloadsFor,
      PROVIDER_META: originals.providerMeta,
    });
    Object.assign(cache, {
      get: originals.get,
      makeKey: originals.makeKey,
      exists: originals.exists,
      touchPattern: originals.touchPattern,
      set: originals.set,
      expire: originals.expire,
    });
  });

  configstore.mergeStoredConfig = async (value) => value;
  providers.activeProviders = () => ['torbox'];
  providers.getUserKey = () => 'synthetic-cache-test';
  providers.fetchDownloads = async () => [];
  providers.setCachedDownloads = async () => {};
  providers.downloadsFor = () => [];
  providers.PROVIDER_META = { ...originals.providerMeta, torbox: { ...originals.providerMeta.torbox, cat: 'torbox' } };
  cache.get = async () => expectedHash;
  cache.makeKey = (...parts) => parts.join(':');
  cache.exists = async () => false;
  cache.touchPattern = async () => 0;
  cache.set = async () => true;
  cache.expire = async () => true;

  const errors = [];
  const oldError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  try {
    await refresh.buildAndCacheForConfigInner('synthetic-cache-build-test', config);
  } finally {
    console.error = oldError;
  }
  assert.deepEqual(errors, []);
});

test('legacy background cache rebuild replaces a changed catalog projection', async (t) => {
  const config = {
    tmdbApiKey: 'synthetic-test-value', torboxApiKey: 'synthetic-test-value',
    lang: 'en-US', catalogTrending: false, catalogPopular: false,
  };
  const item = { source: 'torbox', id: 'synthetic-item', name: 'Synthetic test item', files: [] };
  const originals = {
    mergeStoredConfig: configstore.mergeStoredConfig,
    activeProviders: providers.activeProviders,
    getUserKey: providers.getUserKey,
    fetchDownloads: providers.fetchDownloads,
    setCachedDownloads: providers.setCachedDownloads,
    downloadsFor: providers.downloadsFor,
    providerMeta: providers.PROVIDER_META,
    get: cache.get,
    makeKey: cache.makeKey,
    replacePattern: cache.replacePattern,
    set: cache.set,
    delPattern: cache.delPattern,
  };
  t.after(() => {
    Object.assign(configstore, { mergeStoredConfig: originals.mergeStoredConfig });
    Object.assign(providers, {
      activeProviders: originals.activeProviders,
      getUserKey: originals.getUserKey,
      fetchDownloads: originals.fetchDownloads,
      setCachedDownloads: originals.setCachedDownloads,
      downloadsFor: originals.downloadsFor,
      PROVIDER_META: originals.providerMeta,
    });
    Object.assign(cache, {
      get: originals.get,
      makeKey: originals.makeKey,
      replacePattern: originals.replacePattern,
      set: originals.set,
      delPattern: originals.delPattern,
    });
    recordBuiltType = () => {};
    refresh.providerRefreshSnapshots.clear();
    refresh.providerRefreshInFlight.clear();
  });

  refresh.providerRefreshSnapshots.clear();
  refresh.providerRefreshInFlight.clear();
  configstore.mergeStoredConfig = async (value) => value;
  providers.activeProviders = () => ['torbox'];
  providers.getUserKey = () => 'synthetic-changed-cache-test';
  providers.fetchDownloads = async () => [item];
  providers.setCachedDownloads = async () => {};
  providers.downloadsFor = () => [item];
  providers.PROVIDER_META = { ...originals.providerMeta, torbox: { ...originals.providerMeta.torbox, cat: 'torbox' } };
  cache.get = async () => null;
  cache.makeKey = (...parts) => parts.join(':');
  cache.replacePattern = async () => 1;
  cache.set = async () => true;
  cache.delPattern = async () => 0;

  const builtTypes = [];
  recordBuiltType = (type) => builtTypes.push(type);
  const errors = [];
  const oldError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  try {
    await refresh.buildAndCacheForConfigInner('synthetic-changed-cache-build-test', config);
  } finally {
    console.error = oldError;
  }
  assert.deepEqual(builtTypes, ['movie', 'series', 'anime']);
  assert.deepEqual(errors, []);
  recordBuiltType = () => {};
});
