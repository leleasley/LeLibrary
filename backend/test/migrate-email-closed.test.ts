// @ts-nocheck
'use strict';
// SECURITY (5.9.5): the email-picked old-account import trusted the email
// alone and handed out decrypted keys and sessions. Those endpoints must stay
// closed; only /migrate with the old setup's own token id may reach a handler.
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

const post = (base, path, body) => fetch(`${base}/api/setup${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('email lookup, preview, data and purge are gone (410)', async () => {
  const app = await startApp();
  try {
    for (const path of ['/migrate/lookup', '/migrate/preview', '/migrate/data', '/migrate/purge']) {
      const res = await post(app.base, path, { email: 'someone@example.com', idMasked: 'abcd…xyz' });
      assert.equal(res.status, 410, path);
      const body = await res.json();
      assert.equal(body.keys, undefined, `${path} must never return keys`);
    }
  } finally { await app.close(); }
});

test('migrate by email is refused; only the old token id path continues', async () => {
  const app = await startApp();
  try {
    const byEmail = await post(app.base, '/migrate', { email: 'someone@example.com', idMasked: 'abcd…xyz', password: 'longenough1' });
    assert.equal(byEmail.status, 410);
    const byToken = await post(app.base, '/migrate', { tokenId: 'old-token-id', password: 'longenough1' });
    assert.notEqual(byToken.status, 410, 'the install-link path is not blocked by the email guard');
  } finally { await app.close(); }
});
