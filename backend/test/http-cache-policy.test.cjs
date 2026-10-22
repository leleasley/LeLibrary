const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { once } = require('node:events');
const engine = require('../src/library/engine.ts');
const { mountCatalogRoutes } = require('../src/routes/catalog.ts');
const { mountCollectionsRoutes } = require('../src/routes/collections.ts');
const { rateLimitBuckets } = require('../src/middleware/rate-limit.ts');
const { OWNED_CATALOG_CLIENT_TTL } = require('../src/runtime/refresh.ts');
const { libraryCatalogTtl } = require('../src/library/cache-policy.ts');
const { setPrivateResponseCache } = require('../src/routes/shared.ts');

function request(base, path, { method = 'GET', headers = {}, body = '' } = {}) {
  const target = new URL(path, base);
  return new Promise((resolve, reject) => {
    const req = http.request(target, { method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function withServer(register, fn) {
  rateLimitBuckets.clear();
  const app = express();
  app.use(express.json());
  register(app);
  const server = app.listen(0);
  await once(server, 'listening');
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('indexed library catalogs align private HTTP and protocol hints to five minutes', async () => {
  assert.equal(OWNED_CATALOG_CLIENT_TTL, 300);
  assert.equal(libraryCatalogTtl({}), 300);
  assert.equal(libraryCatalogTtl({ LIBRARY_CATALOG_TTL: '120' }), 120);
  assert.equal(libraryCatalogTtl({ LIBRARY_CATALOG_TTL: '2' }), 10);
  const responseHeaders = {};
  setPrivateResponseCache({ setHeader: (key, value) => { responseHeaders[key] = value; } }, 300, 300, 300);
  assert.equal(responseHeaders['Cache-Control'], 'private, max-age=300, stale-while-revalidate=300, stale-if-error=300');

  const originals = { isIndexed: engine.isIndexed, noteConfig: engine.noteConfig, buildCatalog: engine.buildCatalog };
  let name = 'Synthetic catalog row';
  engine.isIndexed = () => true;
  engine.noteConfig = () => {};
  engine.buildCatalog = async () => ({ metas: [{ id: 'torbox:movie:1', type: 'movie', name }], ready: true, syncing: false });
  try {
    await withServer(app => mountCatalogRoutes(app, { resolveConfig: async () => ({ torboxApiKey: 'synthetic', tmdbApiKey: 'synthetic' }) }), async base => {
      const first = await request(base, '/fixture/catalog/movie/torbox-movies.json');
      assert.equal(first.status, 200);
      assert.equal(first.headers['cache-control'], 'private, max-age=300, stale-while-revalidate=300, stale-if-error=300');
      assert.equal(JSON.parse(first.body).cacheMaxAge, 300);
      const firstEtag = first.headers.etag;
      assert.ok(firstEtag);

      const notModified = await request(base, '/fixture/catalog/movie/torbox-movies.json', { headers: { 'if-none-match': firstEtag } });
      assert.equal(notModified.status, 304);
      assert.equal(notModified.body.length, 0);

      name = 'Changed synthetic catalog row';
      const changed = await request(base, '/fixture/catalog/movie/torbox-movies.json');
      assert.equal(changed.status, 200);
      assert.notEqual(changed.headers.etag, firstEtag);
    });
  } finally {
    engine.isIndexed = originals.isIndexed;
    engine.noteConfig = originals.noteConfig;
    engine.buildCatalog = originals.buildCatalog;
  }
});

test('Nuvio collection document uses short private caching and conditional ETags', async () => {
  const engineOriginals = { isIndexed: engine.isIndexed, noteConfig: engine.noteConfig };
  let packs = ['discover'];
  engine.isIndexed = () => true;
  engine.noteConfig = () => {};
  try {
    await withServer(app => mountCollectionsRoutes(app, {
      resolveConfig: async () => ({
        torboxApiKey: 'synthetic', tmdbApiKey: 'synthetic',
        catalogFranchises: false, nuvioCollectionPacks: packs,
      }),
    }), async base => {
      const first = await request(base, '/fixture/nuvio-collections.json');
      assert.equal(first.status, 200);
      assert.equal(first.headers['cache-control'], 'private, max-age=60, stale-while-revalidate=60, stale-if-error=300');
      const bytes = first.body.length;
      const etag = first.headers.etag;
      assert.ok(etag);
      assert.ok(bytes > 0);

      const unchanged = await request(base, '/fixture/nuvio-collections.json', { headers: { 'if-none-match': etag } });
      assert.equal(unchanged.status, 304);
      assert.equal(unchanged.body.length, 0);

      packs = ['streaming'];
      const changed = await request(base, '/fixture/nuvio-collections.json');
      assert.equal(changed.status, 200);
      assert.notEqual(changed.headers.etag, etag);
      assert.ok(changed.body.length > 0);
    });
  } finally {
    engine.isIndexed = engineOriginals.isIndexed;
    engine.noteConfig = engineOriginals.noteConfig;
  }
});

test('catalog failures and preview responses stay non-cacheable', async () => {
  await withServer(app => mountCatalogRoutes(app, { resolveConfig: async () => null }), async base => {
    for (const path of [
      '/fixture/catalog/movie/torbox-movies.json',
      '/fixture/preview/movie/torbox-movies.json',
    ]) {
      const response = await request(base, path);
      assert.equal(response.headers['cache-control'], 'no-store', path);
    }
    const post = await request(base, '/api/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    });
    assert.equal(post.headers['cache-control'], 'no-store');
  });
});
