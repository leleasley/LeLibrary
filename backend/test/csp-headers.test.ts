// @ts-nocheck
'use strict';
// CSP step 1: every HTML document gets enforced anti-framing (X-Frame-Options
// + frame-ancestors) and the report-only policy with its report endpoint;
// addon JSON, scripts and images get none of it.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { securityHeaders, REPORT_ONLY_POLICY } = require('../src/middleware/security-headers.ts');

const UUID = '123e4567-e89b-12d3-a456-426614174000';

async function withApp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-static-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>static</title>');
  fs.writeFileSync(path.join(dir, 'home.html'), '<!doctype html><title>home</title>');
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1)');
  const app = express();
  app.use(require('compression')({ threshold: 1 }));
  app.use(securityHeaders);
  app.get('/', (req, res) => res.send('<!doctype html><title>shell</title>'));
  app.get('/configure/quick', (req, res) => res.type('html').send('<!doctype html>'));
  app.get(`/${UUID}`, (req, res) => res.send('<!doctype html><title>edit</title>'));
  app.get('/sendfile', (req, res) => res.sendFile(path.join(dir, 'home.html')));
  app.get('/raw', (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<p>raw</p>'); });
  app.get('/missing', (req, res) => res.status(404).type('html').send('<h1>404</h1>'));
  app.get('/manifest.json', (req, res) => res.json({ id: 'x' }));
  app.get('/:token/manifest.json', (req, res) => res.json({ id: 'x' }));
  app.get('/:token/catalog/movie/x.json', (req, res) => res.json({ metas: [] }));
  app.get('/img.png', (req, res) => res.type('png').send(Buffer.from([0x89, 0x50])));
  app.use('/static', express.static(dir));
  const server = app.listen(0);
  await once(server, 'listening');
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const get = (base, p, accept = 'text/html') => fetch(base + p, { headers: { accept } });

function assertDocument(res, label) {
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN', label);
  assert.equal(res.headers.get('content-security-policy'), "frame-ancestors 'self'", label);
  assert.equal(res.headers.get('content-security-policy-report-only'), REPORT_ONLY_POLICY, label);
  assert.ok(REPORT_ONLY_POLICY.includes('report-uri /api/csp-report'), label);
  assert.ok(REPORT_ONLY_POLICY.endsWith('report-to csp'), label);
  assert.equal(res.headers.get('reporting-endpoints'), 'csp="/api/csp-report"', label);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff', label);
}

function assertNotDocument(res, label) {
  for (const name of ['x-frame-options', 'content-security-policy', 'content-security-policy-report-only', 'reporting-endpoints']) {
    assert.equal(res.headers.get(name), null, `${label}: ${name}`);
  }
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff', label);
}

test('every HTML document gets anti-framing and the report-only policy', async () => {
  await withApp(async (base) => {
    for (const p of ['/', '/configure/quick', `/${UUID}`, '/sendfile', '/raw', '/missing', '/static/', '/static/index.html', '/static/home.html']) {
      const res = await get(base, p);
      await res.arrayBuffer();
      assertDocument(res, p);
    }
    // Any Accept header (curl, bots): still a document, still protected.
    const bare = await fetch(base + '/', { headers: { accept: '*/*' } });
    await bare.arrayBuffer();
    assertDocument(bare, '/ (any accept)');
    const head = await fetch(base + `/${UUID}`, { method: 'HEAD', headers: { accept: 'text/html' } });
    assertDocument(head, 'HEAD /{uuid}');
  });
});

test('addon JSON, scripts and images stay untouched', async () => {
  await withApp(async (base) => {
    for (const p of ['/manifest.json', `/${UUID}.secretvalue/manifest.json`, '/eyJzeW50aGV0aWMiOnRydWV9/catalog/movie/x.json', '/img.png', '/static/app.js']) {
      for (const accept of ['application/json', 'text/html']) {
        const res = await get(base, p, accept);
        await res.arrayBuffer();
        assertNotDocument(res, `${p} (${accept})`);
      }
    }
  });
});

test('the real app: addon manifest is untouched, HTML 404 is protected', async (t) => {
  const app = require('../app.ts');
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const manifest = await get(base, '/manifest.json', 'application/json');
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('content-type'), /json/);
  await manifest.arrayBuffer();
  assertNotDocument(manifest, 'app /manifest.json');
  const page = await get(base, '/this-page-does-not-exist-csp');
  await page.arrayBuffer();
  if (/text\/html/.test(page.headers.get('content-type') || '')) assertDocument(page, 'app HTML 404');
});

export interface CspHeadersTestModule {};
