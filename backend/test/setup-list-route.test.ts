// @ts-nocheck
'use strict';
// GET /api/setup is the self-host "saved setups" list. It must stay invisible
// unless the operator configured the self-host secret, reject an unproven
// caller, and never put secret material in the response.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');

const { mountCoreRoutes } = require('../src/routes/core.ts');
const { mountSetupRoutes } = require('../src/routes/setup.ts');
const { rateLimitBuckets } = require('../src/middleware/rate-limit.ts');

const UUID_A = '123e4567-e89b-12d3-a456-426614174000';

const SUMMARY = {
  uuid: UUID_A,
  name: 'Living room',
  tier: 'quick',
  hasPassword: true,
  createdAt: new Date('2026-10-01T10:00:00Z'),
  updatedAt: new Date('2026-10-02T10:00:00Z'),
  lastUsedAt: null,
};

function withEnv(vars, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = fn();
    return result && typeof result.then === 'function' ? result.finally(restore) : (restore(), result);
  } catch (error) {
    restore();
    throw error;
  }
}

async function startApp({ store = { list: async () => [SUMMARY] }, getStoreThrows = false } = {}) {
  const app = express();
  mountCoreRoutes(app, { resolveConfig: async () => null, version: 'test' });
  mountSetupRoutes(app, {
    getStore: async () => {
      if (getStoreThrows) throw new Error('connection terminated unexpectedly');
      return store;
    },
  });
  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('feature off: no secret means no list and no feature flag', async () => {
  rateLimitBuckets.clear();
  await withEnv({ SELFHOST_CONFIGS_SECRET: undefined, SELFHOST_LIST_SETUPS: undefined }, async () => {
    const app = await startApp();
    try {
      const features = await (await fetch(`${app.base}/api/features`)).json();
      assert.equal(features.savedSetups, false);
      assert.equal(features.releases, false);

      const res = await fetch(`${app.base}/api/setup`);
      assert.equal(res.status, 404);
    } finally {
      await app.close();
    }
  });
});

test('secret set: unauthorized 401, authorized returns summaries only', async () => {
  rateLimitBuckets.clear();
  await withEnv({ SELFHOST_CONFIGS_SECRET: 'test-secret', SELFHOST_LIST_SETUPS: undefined }, async () => {
    const app = await startApp();
    try {
      assert.equal((await (await fetch(`${app.base}/api/features`)).json()).savedSetups, true);

      const denied = await fetch(`${app.base}/api/setup`, { headers: { 'x-selfhost-secret': 'wrong' } });
      assert.equal(denied.status, 401);

      const res = await fetch(`${app.base}/api/setup`, { headers: { 'x-selfhost-secret': 'test-secret' } });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.setups.length, 1);
      assert.equal(body.setups[0].uuid, UUID_A);
      assert.equal(body.setups[0].hasPassword, true);

      const raw = JSON.stringify(body);
      for (const forbidden of ['secret', 'encrypted', 'password_hash', 'installToken', 'torboxApiKey']) {
        assert.ok(!raw.includes(forbidden), `response must not contain ${forbidden}`);
      }
    } finally {
      await app.close();
    }
  });
});

test('the browser access cookie authorizes the list', async () => {
  rateLimitBuckets.clear();
  await withEnv({ SELFHOST_CONFIGS_SECRET: 'cookie-secret', SELFHOST_LIST_SETUPS: undefined }, async () => {
    const access = require('../src/platform/selfhost-access.ts');
    const app = await startApp();
    try {
      const cookie = `${access.COOKIE_NAME}=${access.cookieValue()}`;
      const res = await fetch(`${app.base}/api/setup`, { headers: { cookie } });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).setups.length, 1);
    } finally {
      await app.close();
    }
  });
});

test('list switch off hides it without disabling the gate', async () => {
  rateLimitBuckets.clear();
  await withEnv({ SELFHOST_CONFIGS_SECRET: 'test-secret', SELFHOST_LIST_SETUPS: 'off' }, async () => {
    const app = await startApp();
    try {
      assert.equal((await (await fetch(`${app.base}/api/features`)).json()).savedSetups, false);
      const res = await fetch(`${app.base}/api/setup`, { headers: { 'x-selfhost-secret': 'test-secret' } });
      assert.equal(res.status, 404);
    } finally {
      await app.close();
    }
  });
});

test('a broken database connection returns 503 instead of hanging', async () => {
  rateLimitBuckets.clear();
  await withEnv({ SELFHOST_CONFIGS_SECRET: 'test-secret', SELFHOST_LIST_SETUPS: undefined }, async () => {
    const app = await startApp({ store: null, getStoreThrows: true });
    try {
      const res = await fetch(`${app.base}/api/setup`, { headers: { 'x-selfhost-secret': 'test-secret' } });
      assert.equal(res.status, 503);
      assert.match((await res.json()).error, /unavailable/i);
    } finally {
      await app.close();
    }
  });
});

test('no database: authorized caller gets a clear 503', async () => {
  rateLimitBuckets.clear();
  await withEnv({ SELFHOST_CONFIGS_SECRET: 'test-secret', SELFHOST_LIST_SETUPS: undefined }, async () => {
    const app = await startApp({ store: null });
    try {
      const res = await fetch(`${app.base}/api/setup`, { headers: { 'x-selfhost-secret': 'test-secret' } });
      assert.equal(res.status, 503);
      assert.match((await res.json()).error, /unavailable/i);
    } finally {
      await app.close();
    }
  });
});

export interface SetupListRouteTestModule {}
