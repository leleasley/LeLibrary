// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const { rateLimit } = require('../src/middleware/rate-limit.ts');

function call(limiter, ip = '10.0.0.9') {
  let status = 200;
  const req = { ip, method: 'GET', route: { path: '/:token/play/:source' }, path: '/x' };
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  let passed = false;
  limiter(req, res, () => { passed = true; });
  return passed ? 200 : status;
}

test('two limiters on one route with different scopes count separately', () => {
  const busy = rateLimit({ windowMs: 60000, max: 1000, scope: 'webdav-test' });
  const strict = rateLimit({ windowMs: 60000, max: 3, scope: 'debrid-test' });
  for (let i = 0; i < 200; i++) assert.equal(call(busy), 200);
  assert.equal(call(strict), 200, 'heavy use of one scope does not spend the other');
});
