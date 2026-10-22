// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTmdbClient,
  parseRetryAfter,
  backoffDelay,
  isRetryableStatus,
} = require('../src/releases/tmdb.ts');

function depsWith(responses, sleeps) {
  const queue = [...responses];
  const calls = [];
  const transport = async (path, params) => {
    calls.push({ path, params });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return {
    deps: {
      apiKey: 'test-key',
      transport,
      sleep: async (ms) => { sleeps.push(ms); },
      maxRetries: 4,
    },
    calls,
  };
}

test('successful request returns data and sends the api key', async () => {
  const sleeps = [];
  const { deps, calls } = depsWith([{ status: 200, data: { ok: true } }], sleeps);
  const client = createTmdbClient(deps);
  const data = await client.discoverMovies({ region: 'GB', from: '2026-01-01', to: '2026-02-01' });
  assert.deepEqual(data, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.api_key, 'test-key');
  assert.equal(calls[0].params.region, 'GB');
  assert.equal(calls[0].params.with_release_type, 4);
  assert.equal(sleeps.length, 0);
});

test('429 honours Retry-After seconds then succeeds', async () => {
  const sleeps = [];
  const { deps, calls } = depsWith([
    { status: 429, headers: { 'retry-after': '2' }, data: {} },
    { status: 200, data: { results: [] } },
  ], sleeps);
  const client = createTmdbClient(deps);
  await client.request('/x');
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [2000]);
});

test('5xx retries with exponential backoff then succeeds', async () => {
  const sleeps = [];
  const { deps, calls } = depsWith([
    { status: 500, headers: {}, data: {} },
    { status: 200, data: { results: [] } },
  ], sleeps);
  const client = createTmdbClient(deps);
  await client.request('/x');
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [500]);
});

test('network error retries then succeeds', async () => {
  const sleeps = [];
  const { deps, calls } = depsWith([
    new Error('ECONNRESET'),
    { status: 200, data: { results: [] } },
  ], sleeps);
  const client = createTmdbClient(deps);
  await client.request('/x');
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [500]);
});

test('404 is not retried and throws with the status attached', async () => {
  const sleeps = [];
  const { deps, calls } = depsWith([
    { status: 404, headers: {}, data: { status_message: 'Not found' } },
  ], sleeps);
  const client = createTmdbClient(deps);
  await assert.rejects(() => client.request('/x'), /Not found/);
  assert.equal(calls.length, 1);
  assert.equal(sleeps.length, 0);
});

test('exhausts retries on persistent 500', async () => {
  const sleeps = [];
  const responses = [];
  for (let i = 0; i < 5; i++) responses.push({ status: 500, headers: {}, data: {} });
  const { deps, calls } = depsWith(responses, sleeps);
  const client = createTmdbClient(deps);
  await assert.rejects(() => client.request('/x'));
  // initial attempt + maxRetries (4) = 5 calls
  assert.equal(calls.length, 5);
  assert.equal(sleeps.length, 4);
  assert.deepEqual(sleeps, [500, 1000, 2000, 4000]);
});

test('parseRetryAfter accepts seconds and HTTP dates, clamps and rejects junk', () => {
  assert.equal(parseRetryAfter('5'), 5);
  assert.equal(parseRetryAfter(['7']), 7);
  assert.equal(parseRetryAfter('999'), 120);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter('not-a-date'), null);
  const future = new Date(Date.now() + 10000).toUTCString();
  const seconds = parseRetryAfter(future);
  assert.ok(seconds >= 8 && seconds <= 11, `expected ~10s, got ${seconds}`);
  const past = new Date(Date.now() - 10000).toUTCString();
  assert.equal(parseRetryAfter(past), 0);
});

test('backoffDelay uses Retry-After when present and exponential otherwise', () => {
  assert.equal(backoffDelay(0, 3), 3000);
  assert.equal(backoffDelay(3, 30), 15000); // clamped to maxMs
  assert.equal(backoffDelay(0, null), 500);
  assert.equal(backoffDelay(1, null), 1000);
  assert.equal(backoffDelay(10, null), 15000);
});

test('isRetryableStatus', () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(404), false);
});
