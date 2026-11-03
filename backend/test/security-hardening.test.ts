// @ts-nocheck
'use strict';
// 5.9.6 security hardening (audit 2026-11-03: B2, B3, B5).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { once } = require('node:events');

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const TOKEN = `${UUID}.thesecret`;

async function startApp(hasPassword) {
  const { mountSetupRoutes } = require('../src/routes/setup.ts');
  const app = express();
  const opened = { uuid: UUID, tier: 'quick', name: null, hasPassword, config: {}, keys: {}, secret: 'thesecret', createdAt: null, updatedAt: null };
  mountSetupRoutes(app, {
    getStore: async () => ({
      resolveByUuid: async (uuid) => (uuid === UUID ? opened : null),
      resolveByToken: async (token) => (token === TOKEN ? opened : null),
      checkPassword: async () => false,
      remove: async () => true,
    }),
  });
  const server = app.listen(0);
  await once(server, 'listening');
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}
const post = (base, p, body, method = 'POST') => fetch(`${base}/api/setup${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('B2: a passwordless setup is never unlocked or edited by its UUID alone', async () => {
  const app = await startApp(false);
  try {
    assert.equal((await post(app.base, `/${UUID}/unlock`, { password: 'anything-at-all' })).status, 401, 'any password used to work');
    assert.equal((await post(app.base, `/${UUID}/unlock`, { installToken: `${UUID}.wrong` })).status, 401);
    const ok = await post(app.base, `/${UUID}/unlock`, { installToken: TOKEN });
    assert.equal(ok.status, 200);
    assert.ok((await ok.json()).editToken);
    assert.equal((await post(app.base, `/${UUID}`, {}, 'DELETE')).status, 401, 'delete without proof');
  } finally { await app.close(); }
});

test('B3: remembered install links are sealed and still open (old plaintext too)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llkey-'));
  const prev = process.env.CONFIG_SECRET;
  process.env.CONFIG_SECRET = 'a'.repeat(64);
  try {
    const store = require('../src/library/store.ts');
    const sealed = store.sealScopeToken(TOKEN);
    assert.ok(sealed.startsWith('sealed:v1:'));
    assert.ok(!sealed.includes('thesecret'), 'the secret never appears in the stored value');
    assert.equal(store.openScopeToken(sealed), TOKEN);
    assert.equal(store.openScopeToken(TOKEN), TOKEN, 'pre-5.9.6 plaintext rows still resume');
  } finally {
    if (prev === undefined) delete process.env.CONFIG_SECRET; else process.env.CONFIG_SECRET = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('B5: setup.key is created once and never overwritten', () => {
  const { loadServerKey } = require('../src/setup/keys.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llkey-'));
  const keyFile = path.join(dir, 'setup.key');
  const env = {};
  try {
    const first = loadServerKey({ env, keyFile });
    assert.ok(first && first.length === 32);
    assert.deepEqual(loadServerKey({ env, keyFile }), first, 'the same key comes back');
    fs.writeFileSync(keyFile, '   ');
    assert.equal(loadServerKey({ env, keyFile }), null, 'an empty key file is not replaced');
    assert.equal(fs.readFileSync(keyFile, 'utf8'), '   ');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('B4: saved self-host configs keep keys only for the x-selfhost-secret header', () => {
  const access = require('../src/platform/selfhost-access.ts');
  const env = { SELFHOST_CONFIGS_SECRET: 'operator-secret' };
  const req = (headers) => ({ get: (name) => headers[name.toLowerCase()] });
  assert.equal(access.headerAuthorized(req({ 'x-selfhost-secret': 'operator-secret' }), env), true);
  const cookie = `${access.COOKIE_NAME}=${access.cookieValue(env)}`;
  assert.equal(access.authorized(req({ cookie }), env), true, 'the visitor cookie still opens the list');
  assert.equal(access.headerAuthorized(req({ cookie }), env), false, 'but never the keys');
  assert.equal(access.headerAuthorized(req({}), {}), false);
});
