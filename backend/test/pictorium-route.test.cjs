const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');

test('Pictorium proxy falls back on upstream failure and serves the recovered render', async (t) => {
  let upstreamStatus = 503;
  const calls = [];
  const imageHttpClient = {
    get: async (url, options) => {
      calls.push({ url, headers: options.headers });
      return {
        status: upstreamStatus,
        data: upstreamStatus === 200 ? Buffer.from('synthetic-poster') : Buffer.alloc(0),
        headers: { 'content-type': 'image/jpeg' },
      };
    },
  };
  const values = new Map();
  const cache = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
  };
  const app = express();
  const { mountImageRoutes } = require('../src/routes/images.ts');
  mountImageRoutes(app, {
    resolveConfig: async () => ({ tmdbApiKey: 'synthetic-key', posterProvider: 'pictorium' }),
    configStore: { mergeStoredConfig: async (config) => config },
    imageHttpClient,
    cache,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}`;
  const fallback = 'https://image.tmdb.org/t/p/w500/poster.jpg';
  const fallbackParam = encodeURIComponent(fallback);
  const warmUrl = `${base}/synthetic-token/pictorium/movie/550.jpg?warm=1&fallback=${fallbackParam}`;
  const failed = await fetch(warmUrl, { redirect: 'manual' });
  assert.equal(failed.status, 302);
  assert.equal(failed.headers.get('location'), fallback);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers['x-api-key'], 'synthetic-key');
  assert.equal(JSON.stringify(calls.map((call) => call.url)).includes('synthetic-key'), false, 'the API key must not be sent in a URL');

  upstreamStatus = 200;
  const recoveredWarm = await fetch(warmUrl, { redirect: 'manual' });
  assert.equal(recoveredWarm.status, 204);
  assert.equal(calls.length, 2);
  assert.equal(JSON.stringify(calls.map((call) => call.url)).includes('synthetic-key'), false);

  const cached = await fetch(`${base}/synthetic-token/pictorium/movie/550.jpg`);
  assert.equal(cached.status, 200);
  assert.equal(cached.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.from(await cached.arrayBuffer()).toString(), 'synthetic-poster');
  assert.equal(calls.length, 2, 'the recovered poster should be served from cache');
});
