// @ts-nocheck
'use strict';
// The old account-era import is removed (v6). SECURITY (5.9.5): its email
// endpoints trusted the email alone and handed out decrypted keys and
// sessions. Every /migrate path must keep answering 410 Gone with a short
// message and nothing else, whatever the method or body.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { mountSetupRoutes } = require('../src/routes/setup.ts');

async function startApp() {
  const app = express();
  mountSetupRoutes(app, { getStore: async () => null });
  const server = app.listen(0);
  await once(server, 'listening');
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

const send = (base, method, path, body) => fetch(`${base}/api/setup${path}`, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function assertGone(res, label) {
  assert.equal(res.status, 410, label);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['error'], `${label} must only carry an error message`);
  assert.equal(typeof body.error, 'string');
}

test('every old import path answers 410 Gone', async () => {
  const app = await startApp();
  try {
    const paths = ['/migrate', '/migrate/lookup', '/migrate/preview', '/migrate/data', '/migrate/purge', '/migrate/anything/else'];
    const bodies = [
      { email: 'someone@example.com', idMasked: 'abcd...xyz' },
      { tokenId: 'old-token-id', password: 'longenough1' },
      {},
    ];
    for (const path of paths) {
      for (const body of bodies) await assertGone(await send(app.base, 'POST', path, body), `POST ${path}`);
    }
  } finally { await app.close(); }
});

test('other methods on the old import paths are 410 too', async () => {
  const app = await startApp();
  try {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      await assertGone(await send(app.base, method, '/migrate'), `${method} /migrate`);
      await assertGone(await send(app.base, method, '/migrate/purge'), `${method} /migrate/purge`);
    }
  } finally { await app.close(); }
});
