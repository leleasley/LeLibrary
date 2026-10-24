// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createFakeWebdav } = require('./helpers/fake-webdav.ts');

process.env.WEBDAV_SOURCE = 'on';
process.env.WEBDAV_ALLOW_PRIVATE = 'on';
const { mountStreamRoutes } = require('../src/routes/stream.ts');

const BODY = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
const NAME = '/Movies/A B #1 é.mkv';
const ref = (p) => Buffer.from(p, 'utf8').toString('base64url');

async function withApp(config, fn) {
  const app = express();
  mountStreamRoutes(app, { resolveConfig: async (token) => (token === 'good' ? config : null) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.closeAllConnections?.(); server.close(); }
}

const cfg = (dav) => ({ webdavUrl: dav.url, webdavUser: 'u', webdavPassword: 'p' });
const playUrl = (base, path) => `${base}/good/play/webdav/w:abc/${ref(path)}/file.mkv`;

test('seeking: a Range request gets 206 with the right bytes', async () => {
  const dav = await createFakeWebdav({ files: { [NAME]: BODY } });
  try {
    await withApp(cfg(dav), async (base) => {
      const res = await fetch(playUrl(base, NAME), { headers: { Range: 'bytes=100-199' } });
      assert.equal(res.status, 206);
      assert.equal(res.headers.get('content-range'), `bytes 100-199/${BODY.length}`);
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), BODY.subarray(100, 200));
      assert.match(String(res.headers.get('cache-control')), /no-store/);
      assert.match(String(res.headers.get('cache-control')), /no-transform/);
      assert.equal(res.headers.get('location'), null);
      assert.equal(res.headers.get('www-authenticate'), null);
      assert.equal(res.headers.get('set-cookie'), null);
      const upstream = dav.log.find((r) => r.method === 'GET');
      assert.equal(upstream.range, 'bytes=100-199');
    });
  } finally { await dav.close(); }
});

test('a plain request gets the whole file; HEAD gets headers only', async () => {
  const dav = await createFakeWebdav({ files: { [NAME]: BODY } });
  try {
    await withApp(cfg(dav), async (base) => {
      const full = await fetch(playUrl(base, NAME));
      assert.equal(full.status, 200);
      assert.equal(full.headers.get('accept-ranges'), 'bytes');
      assert.equal((await full.arrayBuffer()).byteLength, BODY.length);
      const head = await fetch(playUrl(base, NAME), { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('content-length'), String(BODY.length));
      assert.equal((await head.arrayBuffer()).byteLength, 0);
    });
  } finally { await dav.close(); }
});

test('paths that try to leave the WebDAV folder never reach the server', async () => {
  const dav = await createFakeWebdav({ files: { [NAME]: BODY } });
  try {
    await withApp(cfg(dav), async (base) => {
      for (const bad of ['../secret', '/Movies/../../etc/passwd', 'http://evil/x']) {
        const res = await fetch(`${base}/good/play/webdav/w:abc/${ref(bad)}/f.mkv`);
        assert.equal(res.status, 404, bad);
      }
      assert.equal((await fetch(`${base}/good/play/webdav/w:abc/not%2Fbase64/f.mkv`)).status, 404);
      assert.equal((await fetch(`${base}/bad/play/webdav/w:abc/${ref(NAME)}/f.mkv`)).status, 404);
      assert.equal(dav.log.length, 0);
    });
  } finally { await dav.close(); }
});

test('a player that hangs up stops the download from the WebDAV server', async () => {
  const dav = await createFakeWebdav({ files: { [NAME]: Buffer.alloc(10 * 1024 * 1024, 1) } });
  dav.server.slow = true;
  try {
    await withApp(cfg(dav), async (base) => {
      const controller = new AbortController();
      const res = await fetch(playUrl(base, NAME), { signal: controller.signal });
      const reader = res.body.getReader();
      await reader.read();
      controller.abort();
      const started = Date.now();
      while (dav.closed.count === 0 && Date.now() - started < 1500) await new Promise((r) => setTimeout(r, 25));
      assert.equal(dav.closed.count, 1);
    });
  } finally { await dav.close(); }
});

test('a redirect to another server never carries the WebDAV password', async () => {
  const seen = [];
  const cdn = http.createServer((req, res) => {
    seen.push({ auth: req.headers.authorization || null, url: req.url });
    res.writeHead(200, { 'Content-Length': 3, 'Content-Type': 'video/mp4' }); res.end('abc');
  });
  await new Promise((r) => cdn.listen(0, '127.0.0.1', r));
  const dav = await createFakeWebdav({ files: { [NAME]: BODY } });
  dav.server.redirectTo = `http://localhost:${cdn.address().port}/signed/file.mkv?token=x`;
  try {
    await withApp(cfg(dav), async (base) => {
      const res = await fetch(playUrl(base, NAME));
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'abc');
      assert.equal(seen.length, 1);
      assert.equal(seen[0].auth, null);
      assert.equal(seen[0].url, '/signed/file.mkv?token=x');
    });
  } finally { cdn.close(); await dav.close(); }
});

test('the WebDAV play route is off unless the self-host switch is on', async () => {
  const dav = await createFakeWebdav({ files: { [NAME]: BODY } });
  process.env.WEBDAV_SOURCE = '';
  try {
    await withApp(cfg(dav), async (base) => {
      assert.equal((await fetch(playUrl(base, NAME))).status, 404);
      assert.equal(dav.log.length, 0);
    });
  } finally { process.env.WEBDAV_SOURCE = 'on'; await dav.close(); }
});
