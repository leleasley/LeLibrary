// @ts-nocheck
'use strict';
// Edit-page watchlist connects are staged (v6): the OAuth callback parks the
// connection server-side for the edit session that started it, the page
// gets only a pending id and the account name, and the edit save commits it
// (or a staged disconnect). Fakes only: every token, code and name here is
// synthetic, no request leaves the box.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');

const pc = require('../src/setup/pending-connections.ts');
const oauth = require('../src/setup/oauth.ts');

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const OTHER_UUID = '223e4567-e89b-12d3-a456-426614174000';
const SIMKL_TOKEN = 'synthetic-simkl-token-staged';
const ANILIST_TOKEN = 'synthetic-anilist-token-staged';
const PASSWORD = 'synthetic-password';

test.beforeEach(() => { pc.resetPendingConnections(); });

async function startApp({ config = {}, keys = {}, accountName = async () => 'StagedPerson' } = {}) {
  const { mountSetupRoutes } = require('../src/routes/setup.ts');
  const { mountSetupConnectionRoutes } = require('../src/routes/setup-connections.ts');
  const { createEditSessionStore } = require('../src/setup/edit-sessions.ts');
  require('../src/setup/runtime.ts').resetSetupRuntime();
  const sessions = createEditSessionStore();
  const row = { uuid: UUID, tier: 'full', name: null, hasPassword: true, config: { ...config }, keys: structuredClone(keys), secret: 'synthetic-secret', createdAt: null, updatedAt: null };
  const saves = [];
  const store = {
    resolveByUuid: async (uuid) => (uuid === UUID ? row : null),
    resolveByToken: async () => null,
    checkPassword: async (_uuid, password) => password === PASSWORD,
    save: async (_uuid, input) => {
      saves.push(structuredClone(input));
      if (input.keys) row.keys = { ...row.keys, ...input.keys };
      if (input.config) row.config = { ...row.config, ...input.config };
      for (const field of input.clearConfig || []) delete row.config[field];
      return { uuid: UUID, tier: row.tier, updatedAt: null };
    },
  };
  const app = express();
  mountSetupRoutes(app, { editSessions: sessions, getStore: async () => store });
  mountSetupConnectionRoutes(app, { editSessions: sessions, getStore: async () => store, accountName });
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, sessions, row, saves, close: () => new Promise((r) => server.close(r)) };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const put = (app, body, headers = {}) => fetch(`${app.base}/api/setup/${UUID}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

function fakeTokenExchange(token) {
  const axios = require('axios');
  const original = axios.post;
  const names = ['SIMKL_CLIENT_ID', 'SIMKL_CLIENT_SECRET', 'ANILIST_CLIENT_ID', 'ANILIST_CLIENT_SECRET'];
  const before = names.map((name) => process.env[name]);
  for (const name of names) process.env[name] = `synthetic-${name.toLowerCase()}`;
  axios.post = async () => ({ data: { access_token: token, expires_in: 31536000 } });
  return () => {
    axios.post = original;
    names.forEach((name, i) => { if (before[i] === undefined) delete process.env[name]; else process.env[name] = before[i]; });
  };
}

// Start (edit token, ?stage=1) -> callback: the pending id the popup posts.
async function stageConnect(app, editToken, provider = 'simkl') {
  const started = await fetch(`${app.base}/api/setup/${UUID}/oauth/${provider}?stage=1`, { headers: auth(editToken) });
  assert.equal(started.status, 200);
  const state = new URL((await started.json()).url).searchParams.get('state');
  const res = await fetch(`${app.base}/api/setup/oauth/${provider}/callback?state=${state}&code=code-1`);
  const html = await res.text();
  assert.equal(res.status, 200);
  const payload = JSON.parse(html.match(/postMessage\((\{.*\}), window\.location\.origin\)/)[1]);
  return { html, payload: payload.lelibraryWatchlistPending };
}

test('the staged start needs the edit token of this setup', async () => {
  const restore = fakeTokenExchange(SIMKL_TOKEN);
  const app = await startApp();
  try {
    assert.equal((await fetch(`${app.base}/api/setup/${UUID}/oauth/simkl?stage=1`)).status, 401);
    const foreign = app.sessions.issue(OTHER_UUID).token;
    assert.equal((await fetch(`${app.base}/api/setup/${UUID}/oauth/simkl?stage=1`, { headers: auth(foreign) })).status, 401);
  } finally { restore(); await app.close(); }
});

test('callback (edit page): staged, not saved; the page gets an id and the name, never the token', async () => {
  const restore = fakeTokenExchange(SIMKL_TOKEN);
  const app = await startApp();
  try {
    const editToken = app.sessions.issue(UUID).token;
    const { html, payload } = await stageConnect(app, editToken);
    assert.ok(!html.includes(SIMKL_TOKEN), 'the popup never carries the token');
    assert.ok(!html.includes(editToken), 'nor the edit token');
    assert.equal(payload.provider, 'simkl');
    assert.equal(payload.username, 'StagedPerson');
    assert.match(payload.pendingId, /^[A-Za-z0-9_-]{20,}$/);
    assert.equal(app.saves.length, 0, 'nothing is written before Save');
    assert.equal(app.row.keys.watchlist, undefined);
    const status = await (await fetch(`${app.base}/api/setup/${UUID}/watchlist`, { headers: auth(editToken) })).json();
    assert.equal(status.simkl.connected, false, 'the saved setup is unchanged');
  } finally { restore(); await app.close(); }
});

test('Save commits a staged connect for the same edit session only', async () => {
  const restore = fakeTokenExchange(SIMKL_TOKEN);
  const app = await startApp({ keys: { tmdbApiKey: 'synthetic-tmdb', watchlist: { anilist: { access_token: 'synthetic-old-anilist' } } } });
  try {
    const editToken = app.sessions.issue(UUID).token;
    const { payload } = await stageConnect(app, editToken);
    const body = { connections: { simkl: { pendingId: payload.pendingId } } };
    // Another edit session of the same setup, the password alone, or no
    // authority at all cannot commit it.
    const other = app.sessions.issue(UUID).token;
    assert.equal((await put(app, body, auth(other))).status, 409);
    assert.equal((await put(app, { ...body, password: PASSWORD })).status, 401);
    assert.equal((await put(app, body)).status, 401);
    assert.equal(app.saves.length, 0);
    const res = await put(app, body, auth(editToken));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes(SIMKL_TOKEN), 'the save response never carries the token');
    assert.equal(app.row.keys.watchlist.simkl.access_token, SIMKL_TOKEN);
    assert.equal(app.row.keys.watchlist.simkl.username, 'StagedPerson');
    assert.equal(app.row.keys.watchlist.anilist.access_token, 'synthetic-old-anilist', 'other connections stay');
    assert.equal(app.row.keys.tmdbApiKey, 'synthetic-tmdb');
    // Single use: the same pending id does not commit twice.
    assert.equal((await put(app, body, auth(editToken))).status, 409);
    assert.equal(pc.pendingConnectionCount(), 0);
  } finally { restore(); await app.close(); }
});

test('an expired sign-in saves nothing, not even the rest of the edit', async () => {
  const sessionHash = pc.editSessionHash('synthetic-edit-session-token-0001');
  const { pendingId } = pc.stagePendingConnection({ uuid: UUID, sessionHash, provider: 'simkl', connection: { access_token: SIMKL_TOKEN }, nowMs: 1_000 });
  const read = (nowMs) => pc.readPendingConnection({ pendingId, uuid: UUID, editToken: 'synthetic-edit-session-token-0001', provider: 'simkl', nowMs });
  assert.equal(read(1_000 + pc.PENDING_CONNECTION_TTL_MS - 1).access_token, SIMKL_TOKEN);
  assert.equal(pc.readPendingConnection({ pendingId, uuid: OTHER_UUID, editToken: 'synthetic-edit-session-token-0001', provider: 'simkl', nowMs: 2_000 }), null, 'bound to the setup');
  assert.equal(pc.readPendingConnection({ pendingId, uuid: UUID, editToken: 'synthetic-edit-session-token-0001', provider: 'anilist', nowMs: 2_000 }), null, 'bound to the provider');
  assert.equal(read(1_000 + pc.PENDING_CONNECTION_TTL_MS), null, 'gone after 30 minutes');
  assert.equal(pc.pendingConnectionCount(), 0);

  const app = await startApp();
  try {
    const editToken = app.sessions.issue(UUID).token;
    const res = await put(app, { name: 'Living room', connections: { simkl: { pendingId: 'no-such-pending-id-000000' } } }, auth(editToken));
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /Connect again/);
    assert.equal(app.saves.length, 0);
  } finally { await app.close(); }
});

test('a staged disconnect is removed on Save (AniList also drops an old public name)', async () => {
  const app = await startApp({
    config: { anilistUser: 'Neo_99' },
    keys: { watchlist: { simkl: { access_token: SIMKL_TOKEN }, trakt: { access_token: 'synthetic-trakt' } } },
  });
  try {
    const editToken = app.sessions.issue(UUID).token;
    const res = await put(app, { connections: { simkl: { remove: true }, anilist: { remove: true } } }, auth(editToken));
    assert.equal(res.status, 200);
    assert.equal(app.row.keys.watchlist.simkl, undefined);
    assert.equal(app.row.keys.watchlist.trakt.access_token, 'synthetic-trakt');
    assert.equal(app.row.config.anilistUser, undefined);
    assert.deepEqual(app.saves.at(-1).clearConfig, ['anilistUser']);
    // A removal needs edit authority like any other edit.
    assert.equal((await put(app, { connections: { trakt: { remove: true } } })).status, 401);
    assert.equal((await put(app, { connections: { trakt: { remove: true } }, password: PASSWORD })).status, 200);
    assert.equal(app.row.keys.watchlist.trakt, undefined);
  } finally { await app.close(); }
});

test('an AniList connect commits and replaces the old public name', async () => {
  const restore = fakeTokenExchange(ANILIST_TOKEN);
  const app = await startApp({ config: { anilistUser: 'Neo_99' } });
  try {
    const editToken = app.sessions.issue(UUID).token;
    const { payload } = await stageConnect(app, editToken, 'anilist');
    assert.equal(app.row.config.anilistUser, 'Neo_99', 'kept until Save');
    assert.equal((await put(app, { connections: { anilist: { pendingId: payload.pendingId } } }, auth(editToken))).status, 200);
    assert.equal(app.row.keys.watchlist.anilist.access_token, ANILIST_TOKEN);
    assert.equal(app.row.config.anilistUser, undefined);
  } finally { restore(); await app.close(); }
});

test('Clear my edits discards a staged connect (only its own session can)', async () => {
  const restore = fakeTokenExchange(SIMKL_TOKEN);
  const app = await startApp();
  try {
    const editToken = app.sessions.issue(UUID).token;
    const { payload } = await stageConnect(app, editToken);
    const url = `${app.base}/api/setup/${UUID}/watchlist/pending/${payload.pendingId}`;
    assert.equal((await fetch(url, { method: 'DELETE' })).status, 401);
    const other = app.sessions.issue(UUID).token;
    assert.equal((await fetch(url, { method: 'DELETE', headers: auth(other) })).status, 200);
    assert.equal(pc.pendingConnectionCount(), 1, 'another session cannot drop it');
    assert.equal((await fetch(url, { method: 'DELETE', headers: auth(editToken) })).status, 200);
    assert.equal(pc.pendingConnectionCount(), 0);
    assert.equal((await put(app, { connections: { simkl: { pendingId: payload.pendingId } } }, auth(editToken))).status, 409);
    assert.equal(app.saves.length, 0);
  } finally { restore(); await app.close(); }
});

test('the Ready page flow (no ?stage) still seals at once', async () => {
  const restore = fakeTokenExchange(SIMKL_TOKEN);
  const app = await startApp();
  try {
    const editToken = app.sessions.issue(UUID).token;
    const started = await fetch(`${app.base}/api/setup/${UUID}/oauth/simkl`, { headers: auth(editToken) });
    const state = new URL((await started.json()).url).searchParams.get('state');
    const html = await (await fetch(`${app.base}/api/setup/oauth/simkl/callback?state=${state}&code=code-1`)).text();
    assert.ok(!html.includes('lelibraryWatchlistPending'));
    assert.equal(app.row.keys.watchlist.simkl.access_token, SIMKL_TOKEN);
    assert.equal(pc.pendingConnectionCount(), 0);
  } finally { restore(); await app.close(); }
});

test('the connections field is checked', () => {
  assert.deepEqual(pc.parseStagedConnections(undefined), { ok: true, changes: {} });
  assert.equal(pc.parseStagedConnections({ mdblist: { remove: true } }).ok, false);
  assert.equal(pc.parseStagedConnections({ simkl: { access_token: SIMKL_TOKEN } }).ok, false, 'tokens are never accepted from the browser');
  assert.equal(pc.parseStagedConnections([]).ok, false);
  assert.deepEqual(pc.parseStagedConnections({ simkl: { pendingId: 'abc' }, trakt: { remove: true } }).changes, { simkl: { pendingId: 'abc' }, trakt: { remove: true } });
  // The pending map never holds the token in the clear.
  const { pendingId } = pc.stagePendingConnection({ uuid: UUID, sessionHash: pc.editSessionHash('x'.repeat(30)), provider: 'simkl', connection: { access_token: SIMKL_TOKEN } });
  assert.ok(pendingId);
  assert.ok(!pc.editSessionHash('x'.repeat(30)).includes('x'.repeat(30)));
  assert.equal(oauth.consumePendingOAuth('nope'), null);
});
