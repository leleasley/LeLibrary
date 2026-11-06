// @ts-nocheck
'use strict';
// Turnstile on the password endpoints (v6): edit unlock and setup creation.
// A configured instance must refuse a token-less request before the password
// is even considered, the dev localhost escape must let local tooling through,
// and an unconfigured (self-host) instance must behave exactly as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { once } = require('node:events');

const { mountSetupRoutes } = require('../src/routes/setup.ts');
const { createEditSessionStore } = require('../src/setup/edit-sessions.ts');

const UUID = '123e4567-e89b-12d3-a456-426614174000';

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

async function startApp() {
  const app = express();
  const sessions = createEditSessionStore();
  mountSetupRoutes(app, {
    editSessions: sessions,
    getStore: async () => ({
      // The gate runs first; a setup that does not exist still proves the
      // request got past the bot check.
      resolveByUuid: async () => null,
      checkPassword: async () => false,
      checkPasswordless: async () => false,
      toEngineConfig: (row) => ({ ...row.config, ...row.keys }),
    }),
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function post(port, path, body, host) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body ?? {});
    const req = http.request({
      hostname: '127.0.0.1', port, path, method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(data),
        ...(host ? { host } : {}),
      },
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

test('configured: unlock and create refuse a request with no token', async () => {
  const app = await startApp();
  try {
    await withEnv({ TURNSTILE_SECRET: 'synthetic-secret', TURNSTILE_SECRET_KEY: undefined, TURNSTILE_HOSTNAMES: 'lelibrary.uk', TURNSTILE_ALLOW_LOCALHOST: undefined }, async () => {
      const unlock = await post(app.port, `/api/setup/${UUID}/unlock`, { password: 'whatever-1' }, 'lelibrary.uk');
      assert.equal(unlock.status, 403);
      assert.match(unlock.body.error, /Bot check failed/);
      const create = await post(app.port, '/api/setup', { tier: 'quick' }, 'lelibrary.uk');
      assert.equal(create.status, 403);
      assert.match(create.body.error, /Bot check failed/);
    });
  } finally { await app.close(); }
});

test('the dev localhost escape lets local tooling through to the real checks', async () => {
  const app = await startApp();
  try {
    await withEnv({ TURNSTILE_SECRET: 'synthetic-secret', TURNSTILE_SECRET_KEY: undefined, TURNSTILE_HOSTNAMES: 'lelibrary.uk', TURNSTILE_ALLOW_LOCALHOST: 'on' }, async () => {
      const unlock = await post(app.port, `/api/setup/${UUID}/unlock`, { password: 'whatever-1' }, `localhost:${app.port}`);
      assert.equal(unlock.status, 401, 'reaches the password check, which fails: the gate did not block');
      const create = await post(app.port, '/api/setup', { tier: 'quick' }, `localhost:${app.port}`);
      assert.equal(create.status, 400, 'reaches normal validation (TMDB key required)');
      assert.doesNotMatch(create.body.error, /Bot check failed/);
    });
  } finally { await app.close(); }
});

test('unconfigured self-host: both endpoints behave as before', async () => {
  const app = await startApp();
  try {
    await withEnv({ TURNSTILE_SECRET: undefined, TURNSTILE_SECRET_KEY: undefined, TURNSTILE_HOSTNAMES: undefined, TURNSTILE_ALLOW_LOCALHOST: undefined }, async () => {
      const unlock = await post(app.port, `/api/setup/${UUID}/unlock`, { password: 'whatever-1' }, 'lelibrary.uk');
      assert.equal(unlock.status, 401);
      const create = await post(app.port, '/api/setup', { tier: 'quick' }, 'lelibrary.uk');
      assert.equal(create.status, 400);
      assert.doesNotMatch(create.body.error, /Bot check failed/);
    });
  } finally { await app.close(); }
});

export interface TurnstilePasswordGateTestModule {};
