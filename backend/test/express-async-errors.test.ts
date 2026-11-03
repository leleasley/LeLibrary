// @ts-nocheck
// v6 (audit B19): app.ts no longer wraps every handler to catch async
// rejections. That wrapper dated from Express 4; Express 5 (router 2) forwards
// a rejected promise from any handler or middleware to next(err) itself. This
// pins that contract on the app, a mounted sub-router and middleware, so an
// Express downgrade (or a router that stops doing it) fails here instead of
// turning async errors into hung requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { errorHandler } = require('../src/middleware/error-handler.ts');

async function withServer(app, fn) {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

function quietConsole(t) {
  const original = console.error;
  console.error = () => {};
  t.after(() => { console.error = original; });
}

test('async rejections reach the terminal errorHandler without a wrapper', async (t) => {
  quietConsole(t);
  const app = express();
  app.get('/api/app-route', async () => { throw new Error('boom'); });
  const router = express.Router();
  router.get('/api/router-route', async () => { await Promise.resolve(); throw new Error('boom'); });
  app.use(router);
  app.use('/api/middleware', async () => { throw new Error('boom'); });
  app.get('/plain', async () => { throw new Error('boom'); });
  // A falsy rejection must still be an error, never a silent next().
  app.get('/api/falsy', async () => { throw undefined; });
  app.use(errorHandler);

  await withServer(app, async (base) => {
    for (const route of ['/api/app-route', '/api/router-route', '/api/middleware', '/api/falsy']) {
      const res = await fetch(base + route);
      assert.equal(res.status, 500, route);
      assert.deepEqual(await res.json(), { error: 'Internal error' }, route);
    }
    const plain = await fetch(base + '/plain');
    assert.equal(plain.status, 500);
    assert.equal(await plain.text(), 'Internal error');
  });
});
