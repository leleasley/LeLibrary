// @ts-nocheck
// Phase 0 Task 1: opt-in addon timing middleware. Flag-gated (PERF_TIMING=1),
// behaviour-neutral when off.
const test = require('node:test');
const assert = require('node:assert/strict');

const perf = require('../src/middleware/perf-timing.ts');

function fakeReqRes(routePath) {
  const req = { method: 'GET', path: '/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.mmmmmmmm/catalog/movie/x.json', route: routePath ? { path: routePath } : undefined, perfTrace: undefined };
  const headers = {};
  const res = { setHeader(name, value) { headers[name] = value; }, getHeader(name) { return headers[name]; } };
  return { req, res, headers };
}

test('no Server-Timing header when the flag is off', () => {
  const prev = process.env.PERF_TIMING;
  delete process.env.PERF_TIMING;
  try {
    const { req, res, headers } = fakeReqRes('/:token/catalog/:type/:catalogId');
    perf.perfMiddleware(req, res, () => {});
    perf.finishPerfTrace(req, res);
    assert.equal(headers['Server-Timing'], undefined);
  } finally {
    if (prev !== undefined) process.env.PERF_TIMING = prev;
  }
});

test('adds a route Server-Timing header when the flag is on', () => {
  const prev = process.env.PERF_TIMING;
  process.env.PERF_TIMING = '1';
  try {
    const { req, res, headers } = fakeReqRes('/:token/catalog/:type/:catalogId');
    perf.perfMiddleware(req, res, () => {});
    perf.finishPerfTrace(req, res);
    assert.match(String(headers['Server-Timing'] || ''), /route;dur=/);
  } finally {
    if (prev !== undefined) process.env.PERF_TIMING = prev;
    else delete process.env.PERF_TIMING;
  }
});

test('timeSpan records durations without touching secrets', async () => {
  const trace = perf.startPerfTrace();
  const out = await perf.timeSpan(trace, 'resolve-config', async () => 'ok');
  assert.equal(out, 'ok');
  assert.ok(trace.spans.resolve_config >= 0 || trace.spans['resolve-config'] >= 0);
});

// Task 3: handlers record at least the resolve-config span without network I/O
// when resolveConfig yields no config (early empty return).
test('handleCatalog records resolve-config span on early return', async () => {
  const { handleCatalog } = require('../src/routes/catalog.ts');
  const trace = perf.startPerfTrace();
  const req = { params: { token: 'bogus', type: 'movie', catalogId: 'x' }, perfTrace: trace };
  let body;
  const res = { setHeader() {}, json(b) { body = b; } };
  await handleCatalog(req, res, { resolveConfig: async () => null });
  assert.deepEqual(body, { metas: [] });
  assert.ok(typeof trace.spans['resolve-config'] === 'number');
});

test('handleStream records resolve-config span on early return', async () => {
  const { handleStream } = require('../src/routes/stream.ts');
  const trace = perf.startPerfTrace();
  const req = { params: { token: 'bogus', type: 'movie', id: 'torbox:movie:1' }, perfTrace: trace };
  let body;
  const res = { setHeader() {}, json(b) { body = b; } };
  await handleStream(req, res, { resolveConfig: async () => null });
  assert.deepEqual(body, { streams: [] });
  assert.ok(typeof trace.spans['resolve-config'] === 'number');
});
