const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ExternalCatalogError,
  validateManifestUrl,
  pinPublicLookup,
  boundedExtras,
  externalCatalogUrl,
  fetchConfiguredManifest,
  fetchExternalCatalog,
  fingerprint,
} = require('../src/accounts/external-catalog');

const manifestUrl = 'https://addon.example/config/opaque/manifest.json?mode=public';
const binding = {
  addonId: 'aio-metadata',
  catalogId: 'letterboxd.42',
  mediaType: 'movie',
  genre: '',
  manifestUrl,
  manifestFingerprint: fingerprint(manifestUrl),
};

test('gateway accepts only standard credential-free HTTPS manifest addresses', () => {
  assert.equal(validateManifestUrl(manifestUrl).hostname, 'addon.example');
  for (const value of [
    'http://addon.example/manifest.json',
    'https://user:pass@addon.example/manifest.json',
    'https://addon.example/config.json',
    'https://addon.example/manifest.json#secret',
  ]) assert.throws(() => validateManifestUrl(value), ExternalCatalogError);
});

test('DNS pinning rejects every private or mixed resolution', async () => {
  await assert.rejects(() => pinPublicLookup(new URL(manifestUrl), async () => [{ address: '127.0.0.1', family: 4 }]), /public network/);
  await assert.rejects(() => pinPublicLookup(new URL(manifestUrl), async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.2', family: 4 }]), /public network/);
  const pinned = await pinPublicLookup(new URL(manifestUrl), async () => [{ address: '8.8.8.8', family: 4 }]);
  const resolved = await new Promise((resolve, reject) => pinned('ignored', {}, (error, address, family) => error ? reject(error) : resolve({ address, family })));
  assert.deepEqual(resolved, { address: '8.8.8.8', family: 4 });
});

test('catalogue routing preserves configured query data and bounds allowed extras', () => {
  assert.equal(boundedExtras({ skip: 999999, genre: 'Sci Fi', search: 'Alien & Predator' }), 'skip=5000&genre=Sci%20Fi&search=Alien%20%26%20Predator');
  const target = externalCatalogUrl(manifestUrl, binding, { skip: 20, genre: 'Drama' });
  assert.equal(target.pathname, '/config/opaque/catalog/movie/letterboxd.42/skip=20&genre=Drama.json');
  assert.equal(target.searchParams.get('mode'), 'public');
});

test('manifest validation authorizes only the exact saved catalogue tuple', async () => {
  const writes = [];
  const runtime = {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    cacheGet: async () => null,
    cacheSet: async (key, value) => { writes.push({ key, value }); },
    request: async (_url, options) => {
      assert.equal(options.maxRedirects, 0);
      assert.equal(options.maxContentLength, 1024 * 1024);
      return { data: JSON.stringify({ id: 'aio-metadata', catalogs: [{ id: 'letterboxd.42', type: 'movie' }] }) };
    },
  };
  const manifest = await fetchConfiguredManifest(binding, runtime);
  assert.equal(manifest.id, 'aio-metadata');
  assert.equal(JSON.stringify(writes).includes('opaque/manifest'), false);
  await assert.rejects(() => fetchConfiguredManifest({ ...binding, catalogId: 'other' }, runtime), error => error.code === 'external_catalog_missing');
});

test('catalogue gateway keeps canonical public ids and caches no configured URL', async () => {
  const values = new Map();
  const calls = [];
  const runtime = {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    cacheGet: async key => values.get(key) || null,
    cacheSet: async (key, value) => { values.set(key, value); },
    request: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('/manifest.json')) return { data: JSON.stringify({ id: 'aio-metadata', catalogs: [{ id: 'letterboxd.42', type: 'movie' }] }) };
      return { data: JSON.stringify({ metas: [
        { id: 'tt0133093', type: 'movie', name: 'The Matrix', poster: 'https://images.example/matrix.jpg' },
        { id: 'tmdb:603', type: 'movie', name: 'Non-canonical' },
      ] }) };
    },
  };
  const metas = await fetchExternalCatalog(binding, { skip: 0 }, runtime);
  assert.deepEqual(metas.map(meta => meta.id), ['tt0133093']);
  assert.equal(calls[1].options.maxRedirects, 0);
  assert.equal(calls[1].options.maxContentLength, 5 * 1024 * 1024);
  assert.equal(JSON.stringify([...values]).includes('opaque/manifest'), false);
});
