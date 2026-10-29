// @ts-nocheck
'use strict';
// Every tier marks the TMDB key as required. POST /api/setup must refuse a
// payload the UI would have refused, so an API client cannot create a setup
// that then has no matching, metadata, posters or search.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');

const { mountSetupRoutes } = require('../src/routes/setup.ts');

const CREATED = {
  uuid: '123e4567-e89b-12d3-a456-426614174000',
  secret: 'secret',
  installToken: '123e4567-e89b-12d3-a456-426614174000.secret',
  tier: 'quick',
  createdAt: null,
};

async function startApp() {
  const app = express();
  mountSetupRoutes(app, {
    getStore: async () => ({
      create: async () => CREATED,
    }),
  });
  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function create(base, keys) {
  return fetch(`${base}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier: 'quick', password: 'hunter2hunter2', config: {}, keys }),
  });
}

test('refuses a setup without a TMDB key', async () => {
  const app = await startApp();
  try {
    const res = await create(app.base, { torboxApiKey: 'synthetic' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /TMDB API key is required/);
  } finally {
    await app.close();
  }
});

test('accepts a setup with a TMDB key', async () => {
  const app = await startApp();
  try {
    const res = await create(app.base, { tmdbApiKey: 'synthetic-tmdb' });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).uuid, CREATED.uuid);
  } finally {
    await app.close();
  }
});

test('a Destination-step login is sealed with the setup; a malformed one is dropped', async () => {
  const app = express();
  let stored = null;
  mountSetupRoutes(app, { getStore: async () => ({ create: async (input) => { stored = input; return CREATED; } }) });
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const nuvio = { platform: 'nuvio', nuvioToken: 'synthetic-access', nuvioRefresh: 'synthetic-refresh', nuvioSelectedProfile: 2 };
    let res = await create(base, { tmdbApiKey: 'synthetic-tmdb', push: { nuvio, stremio: { stremioAuth: '' }, other: { x: 1 } } });
    assert.equal(res.status, 201);
    assert.deepEqual(stored.keys.push, { nuvio }, 'only the well-formed Nuvio session is kept');
    res = await create(base, { tmdbApiKey: 'synthetic-tmdb', push: { nuvio: { nuvioToken: '' } } });
    assert.equal(res.status, 201);
    assert.equal(stored.keys.push, undefined, 'nothing usable, nothing stored');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

export interface SetupCreateValidationTestModule {}
