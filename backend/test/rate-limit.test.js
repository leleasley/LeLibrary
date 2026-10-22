'use strict';
// The shared limiter must budget per route, not per IP: one global bucket let
// a busy endpoint (or a retrying user) starve every other sensitive route on
// the same IP with 429s.
const test = require('node:test');
const assert = require('node:assert/strict');

const { rateLimit, rateLimitBuckets } = require('../src/middleware/rate-limit.ts');

function fakeReq(path) {
  return {
    ip: '10.0.0.9',
    method: 'POST',
    path,
    route: { path },
    connection: {},
  };
}

function hit(middleware, req) {
  let status = 200;
  let nexted = false;
  const res = { status(code) { status = code; return res; }, json() { return res; } };
  middleware(req, res, () => { nexted = true; });
  return { status, nexted };
}

test('different routes do not share one IP budget', () => {
  rateLimitBuckets.clear();
  const tight = rateLimit({ windowMs: 60_000, max: 2 });
  const other = rateLimit({ windowMs: 60_000, max: 2 });
  assert.ok(hit(tight, fakeReq('/api/setup/migrate/lookup')).nexted);
  assert.ok(hit(tight, fakeReq('/api/setup/migrate/lookup')).nexted);
  assert.equal(hit(tight, fakeReq('/api/setup/migrate/lookup')).status, 429);
  // A different route on the same IP still passes.
  assert.ok(hit(other, fakeReq('/api/setup/migrate/preview')).nexted);
});

test('parameterised routes share one pattern bucket', () => {
  rateLimitBuckets.clear();
  const tight = rateLimit({ windowMs: 60_000, max: 1 });
  assert.ok(hit(tight, fakeReq('/api/setup/aaa/keys/reveal')).nexted);
  // Same route pattern, different uuid: still the same bucket (no rotation bypass).
  const rotated = fakeReq('/api/setup/bbb/keys/reveal');
  rotated.route = { path: '/api/setup/:uuid/keys/reveal' };
  const first = fakeReq('/api/setup/aaa/keys/reveal');
  first.route = { path: '/api/setup/:uuid/keys/reveal' };
  rateLimitBuckets.clear();
  assert.ok(hit(tight, first).nexted);
  assert.equal(hit(tight, rotated).status, 429);
});
