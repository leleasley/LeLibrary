// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createFakeWebdav } = require('./helpers/fake-webdav.ts');

process.env.WEBDAV_ALLOW_PRIVATE = 'on';
const createWebRoutes = require('../src/routes/website.ts');
const { mountCoreRoutes } = require('../src/routes/core.ts');

async function withApp(fn) {
  const app = express();
  mountCoreRoutes(app, { resolveConfig: async () => null, version: 'test' });
  app.use(createWebRoutes(async () => null));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.closeAllConnections?.(); server.close(); }
}
const post = (base, body) => fetch(`${base}/api/verify/webdav`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('the WebDAV check and flag are off by default', async () => {
  delete process.env.WEBDAV_SOURCE;
  await withApp(async (base) => {
    assert.equal((await post(base, { url: 'http://127.0.0.1:1/', user: 'u', password: 'p' })).status, 404);
    const features = await (await fetch(`${base}/api/features`)).json();
    assert.equal(features.webdavSource, false);
  });
});

test('the WebDAV check reports success and a wrong password, never echoing details', async () => {
  process.env.WEBDAV_SOURCE = 'on';
  const dav = await createFakeWebdav({ files: { '/Movies/Heat (1995)/Heat.mkv': 10, '/a.mkv': 10 } });
  try {
    await withApp(async (base) => {
      const ok = await (await post(base, { url: dav.url, user: 'u', password: 'p' })).json();
      assert.deepEqual(ok, { valid: true, folders: 1, videos: 1 });
      const bad = await (await post(base, { url: dav.url, user: 'u', password: 'wrong' })).json();
      assert.deepEqual(bad, { valid: false, error: 'auth' });
      const raw = JSON.stringify(bad);
      assert.ok(!raw.includes(dav.url) && !raw.includes('wrong'));
      assert.equal((await (await fetch(`${base}/api/features`)).json()).webdavSource, true);
    });
  } finally { delete process.env.WEBDAV_SOURCE; await dav.close(); }
});

test('pages carry the WebDAV flag in their boot data, so the setup card never pops in', () => {
  delete process.env.WEBDAV_SOURCE;
  assert.equal(createWebRoutes.bootData().features.webdavSource, false);
  process.env.WEBDAV_SOURCE = 'on';
  try { assert.equal(createWebRoutes.bootData().features.webdavSource, true); } finally { delete process.env.WEBDAV_SOURCE; }
});
