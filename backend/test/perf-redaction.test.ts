// @ts-nocheck
// Phase 0 Task 2: log redaction. The install URL carries uuid.secret (the read
// capability). Timing output must never contain the real path, query string,
// headers, or decrypted keys: only the route template and provider/operation names.
const test = require('node:test');
const assert = require('node:assert/strict');

const perf = require('../src/middleware/perf-timing.ts');

const FAKE_TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.s3cr3t-fake-value-12345678';
const FAKE_KEY = 'tb-fake-provider-key-abcdef123456';

function captureLogs(fn) {
  const lines = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...a) => { lines.push(a.join(' ')); };
  console.warn = (...a) => { lines.push(a.join(' ')); };
  console.error = (...a) => { lines.push(a.join(' ')); };
  try { fn(); } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
  return lines.join('\n');
}

test('routeTemplate never contains the real token path', () => {
  const req = {
    method: 'GET',
    path: `/${FAKE_TOKEN}/catalog/movie/torbox-movies.json`,
    originalUrl: `/${FAKE_TOKEN}/catalog/movie/torbox-movies.json?search=foo`,
    url: `/${FAKE_TOKEN}/catalog/movie/torbox-movies.json`,
    route: { path: '/:token/catalog/:type/:catalogId' },
  };
  const tpl = perf.routeTemplate(req);
  assert.equal(tpl, '/:token/catalog/:type/:catalogId');
  assert.ok(!tpl.includes(FAKE_TOKEN));
  assert.ok(!tpl.includes('s3cr3t'));
});

test('structured log + headers never leak token, secret, keys or query', () => {
  const prev = process.env.PERF_TIMING;
  process.env.PERF_TIMING = '1';
  try {
    const req = {
      method: 'GET',
      path: `/${FAKE_TOKEN}/catalog/movie/torbox-movies.json`,
      originalUrl: `/${FAKE_TOKEN}/catalog/movie/torbox-movies.json?search=foo&x=${FAKE_KEY}`,
      url: `/${FAKE_TOKEN}/catalog/movie/torbox-movies.json`,
      route: { path: '/:token/catalog/:type/:catalogId' },
      headers: { authorization: 'Bearer edit-fake-token', 'x-selfhost-secret': 'shhh' },
      perfTrace: perf.startPerfTrace(),
    };
    const headers = {};
    const res = { setHeader(n, v) { headers[n] = v; } };
    const out = captureLogs(() => {
      perf.perfMiddleware(req, res, () => {});
      perf.finishPerfTrace(req, res);
      perf.logPerf(req, `provider akamai ${FAKE_KEY} https://example.com/?key=${FAKE_KEY}`);
    });
    assert.ok(!out.includes(FAKE_TOKEN), 'log contains token');
    assert.ok(!out.includes('s3cr3t'), 'log contains secret');
    assert.ok(!out.includes(FAKE_KEY), 'log contains provider key');
    assert.ok(!out.includes('search=foo'), 'log contains query string');
    for (const v of Object.values(headers)) {
      assert.ok(!String(v).includes(FAKE_TOKEN), 'header contains token');
      assert.ok(!String(v).includes(FAKE_KEY), 'header contains key');
    }
  } finally {
    if (prev !== undefined) process.env.PERF_TIMING = prev;
    else delete process.env.PERF_TIMING;
  }
});

test('outbound span names carry provider + operation only, never URLs', () => {
  const name = perf.spanName('provider-fetch', { provider: 'torbox', op: 'downloads' });
  assert.equal(name, 'provider-fetch:torbox:downloads');
  const messy = perf.spanName('tmdb', { url: `https://api.example/?api_key=${FAKE_KEY}` });
  assert.ok(!messy.includes(FAKE_KEY));
  assert.ok(!messy.includes('http'));
});
