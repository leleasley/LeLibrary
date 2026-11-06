// @ts-nocheck
'use strict';
// POST /api/csp-report: both report formats, one sanitised line per report
// (no query, no setup UUID or token, blocked URL cut to scheme + host, no
// samples), always 204, rate limited and deduplicated.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const csp = require('../src/routes/csp-report.ts');

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const SECRET = 'SyntheticSecretValue0123456789abcdef';

async function withServer(fn) {
  csp.resetCspReportState();
  const app = express();
  csp.mountCspReportRoutes(app);
  app.use((req, res) => res.status(404).json({ error: 'not found' }));
  const server = app.listen(0);
  await once(server, 'listening');
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => { lines.push(args.join(' ')); };
  try { await fn(`http://127.0.0.1:${server.address().port}`, lines); }
  finally {
    console.warn = original;
    await new Promise((r) => server.close(r));
    csp.resetCspReportState();
  }
}

const post = (base, type, body) => fetch(`${base}/api/csp-report`, {
  method: 'POST',
  headers: { 'Content-Type': type },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const legacyReport = (overrides = {}) => ({
  'csp-report': {
    'document-uri': `https://lelibrary.uk/${UUID}?tab=keys#top`,
    'blocked-uri': `https://evil.example.com:8443/x.js?token=${SECRET}#frag`,
    'effective-directive': 'script-src-elem',
    'violated-directive': 'script-src-elem',
    'original-policy': "default-src 'self'",
    'script-sample': `alert("${SECRET}")`,
    ...overrides,
  },
});

test('report-uri format: one sanitised line, 204', async () => {
  await withServer(async (base, lines) => {
    const res = await post(base, 'application/csp-report', legacyReport());
    assert.equal(res.status, 204);
    assert.deepEqual(lines, [`[CSP] script-src-elem blocked https://evil.example.com:8443 on /:setup`]);
    assert.ok(!lines.join('\n').includes(SECRET));
    assert.ok(!lines.join('\n').includes(UUID));
  });
});

test('Reporting API format: arrays, only csp-violation entries, samples dropped', async () => {
  await withServer(async (base, lines) => {
    const res = await post(base, 'application/reports+json', [
      { type: 'csp-violation', url: `https://lelibrary.uk/${UUID}.${SECRET}/configure`, body: {
        documentURL: `https://lelibrary.uk/${UUID}.${SECRET}/configure?x=1`,
        blockedURL: 'inline', effectiveDirective: 'script-src-elem', sample: `secret ${SECRET}`, disposition: 'report',
      } },
      { type: 'csp-violation', url: 'https://lelibrary.uk/configure/quick', body: {
        documentURL: 'https://lelibrary.uk/configure/quick', blockedURL: 'eval', effectiveDirective: 'script-src',
      } },
      { type: 'deprecation', url: 'https://lelibrary.uk/', body: { id: 'x' } },
    ]);
    assert.equal(res.status, 204);
    assert.deepEqual(lines, [
      '[CSP] script-src-elem blocked inline on /:setup/configure',
      '[CSP] script-src blocked eval on /configure/quick',
    ]);
    assert.ok(!lines.join('\n').includes(SECRET));
  });
});

test('path and blocked-uri sanitising', () => {
  assert.equal(csp.sanitisePagePath(`https://x.test/${UUID}`), '/:setup');
  assert.equal(csp.sanitisePagePath(`https://x.test/${Buffer.from('{"tmdbApiKey":"synthetic"}').toString('base64url')}/configure`), '/:token/configure');
  assert.equal(csp.sanitisePagePath('https://x.test/0123456789abcdef0123/catalog'), '/:token/catalog');
  assert.equal(csp.sanitisePagePath('https://x.test/guide?q=secret#h'), '/guide');
  assert.equal(csp.sanitisePagePath('https://x.test/a%20b'), '/:token');
  assert.match(csp.sanitisePagePath('not a url at all \u0000'), /^\/[a-z0-9:._\/-]*$/);
  assert.equal(csp.sanitisePagePath(undefined), 'unknown');
  assert.equal(csp.sanitiseBlocked('data:image/png;base64,AAAA'), 'data');
  assert.equal(csp.sanitiseBlocked('blob:https://x.test/uuid'), 'blob');
  assert.equal(csp.sanitiseBlocked('https://user:pw@cdn.example.org/a.js?k=1'), 'https://cdn.example.org');
  assert.equal(csp.sanitiseBlocked('inline'), 'inline');
  assert.equal(csp.sanitiseBlocked('javascript:alert(1)'), 'other');
  assert.equal(csp.sanitiseBlocked('\n[CSP] fake line'), 'other');
});

test('identical lines are logged once, then with a repeat count after the window', async () => {
  await withServer(async (base, lines) => {
    for (let i = 0; i < 5; i++) assert.equal((await post(base, 'application/csp-report', legacyReport())).status, 204);
    assert.equal(lines.length, 1);
    const realNow = Date.now;
    Date.now = () => realNow() + csp.CSP_REPORT_LIMITS.dedupeMs + 1000;
    try {
      assert.equal((await post(base, 'application/csp-report', legacyReport())).status, 204);
    } finally { Date.now = realNow; }
    assert.equal(lines.length, 2);
    assert.match(lines[1], /\(\+4 repeats in the last 10 min\)$/);
  });
});

test('per-IP rate limit drops reports but still answers 204', async () => {
  await withServer(async (base, lines) => {
    const max = csp.CSP_REPORT_LIMITS.perIp;
    for (let i = 0; i < max + 5; i++) {
      const res = await post(base, 'application/csp-report', legacyReport({ 'blocked-uri': `https://h${i}.example.com/x.js` }));
      assert.equal(res.status, 204);
    }
    assert.equal(lines.length, max);
  });
});

test('oversized, malformed and odd bodies are 204 and log nothing', async () => {
  await withServer(async (base, lines) => {
    const big = JSON.stringify(legacyReport({ pad: 'x'.repeat(20 * 1024) }));
    assert.equal((await post(base, 'application/csp-report', big)).status, 204);
    assert.equal((await post(base, 'application/csp-report', '{not json')).status, 204);
    assert.equal((await post(base, 'application/reports+json', '"a string"')).status, 204);
    assert.equal((await post(base, 'application/octet-stream', 'binary')).status, 204);
    assert.equal(lines.length, 0);
  });
});

export interface CspReportTestModule {};
