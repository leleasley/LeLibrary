// @ts-nocheck
'use strict';
// A setup request must not wait for the OS TCP timeout when Postgres is down:
// the 503 path already exists once the pool errors, this makes it fail fast.
const test = require('node:test');
const assert = require('node:assert/strict');

const runtime = require('../src/setup/runtime.ts');

test('the setup pool has a connection timeout', async () => {
  process.env.DATABASE_URL = 'postgres://user:pass@127.0.0.1:1/lelibrary';
  const pool = runtime.getSetupPool();
  assert.ok(pool, 'pool should be created when DATABASE_URL is set');
  assert.equal(pool.options.connectionTimeoutMillis, 5000);
  await pool.end();
  runtime.resetSetupRuntime();
  delete process.env.DATABASE_URL;
});

export interface SetupRuntimeTestModule {}
