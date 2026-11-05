// @ts-nocheck
'use strict';
// Account names at connect time (v6): the Simkl / AniList OAuth callback
// asks for the account name once, stores it with the sealed connection and
// hands it to a pre-creation page; identities prefer the stored name; an
// older setup's public AniList name stays readable and clearable. Fakes
// only: every token, code and name is synthetic, no request leaves the box.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');

const rt = require('../src/user-lists/runtime.ts');
const anilist = require('../src/user-lists/anilist.ts');
const userLists = require('../src/user-lists/index.ts');

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const SIMKL_TOKEN = 'synthetic-simkl-token-aaaa';
const SIMKL_TOKEN_2 = 'synthetic-simkl-token-bbbb';
const ANILIST_TOKEN = 'synthetic-anilist-token-cccc';

function fakeHttp(handler) {
  const calls = [];
  const run = async (method, url, options = {}, body) => {
    calls.push({ method, url, options, body });
    const out = await handler(method, url, options, body);
    if (out instanceof Error) throw out;
    return out;
  };
  return { calls, get: (url, options) => run('GET', url, options), post: (url, body, options) => run('POST', url, options, body) };
}

function httpError(status) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, headers: {} } });
}

function context(http) {
  const data = new Map();
  const store = { get: async (key) => (data.has(key) ? structuredClone(data.get(key)) : null), set: async (key, value) => { data.set(key, structuredClone(value)); return true; } };
  return { http, store, now: () => 1_800_000_000_000, log: () => {} };
}

test.beforeEach(() => {
  rt.resetRuntime();
  anilist.resetBudget();
  process.env.SIMKL_CLIENT_ID = 'synthetic-simkl-client';
});

// One fake setup row behind the connection routes, with the name seam.
async function startApp({ config = {}, keys = {}, accountName } = {}) {
  const { mountSetupConnectionRoutes } = require('../src/routes/setup-connections.ts');
  const { createEditSessionStore } = require('../src/setup/edit-sessions.ts');
  const sessions = createEditSessionStore();
  const row = { uuid: UUID, tier: 'full', name: null, hasPassword: true, config: { ...config }, keys: { ...keys }, secret: 'synthetic-secret', createdAt: null, updatedAt: null };
  const saves = [];
  const store = {
    resolveByUuid: async (uuid) => (uuid === UUID ? row : null),
    resolveByToken: async () => null,
    save: async (_uuid, input) => {
      saves.push(structuredClone(input));
      if (input.keys) row.keys = input.keys;
      for (const field of input.clearConfig || []) delete row.config[field];
      return row;
    },
  };
  const app = express();
  mountSetupConnectionRoutes(app, { editSessions: sessions, getStore: async () => store, accountName });
  const server = app.listen(0);
  await once(server, 'listening');
  const bearer = () => ({ headers: { Authorization: `Bearer ${sessions.issue(UUID).token}` } });
  return { base: `http://127.0.0.1:${server.address().port}`, bearer, row, saves, close: () => new Promise((r) => server.close(r)) };
}

// The provider's token exchange, faked at axios.post.
function fakeTokenExchange(provider, token) {
  const axios = require('axios');
  const original = axios.post;
  const env = provider === 'simkl' ? ['SIMKL_CLIENT_ID', 'SIMKL_CLIENT_SECRET'] : ['ANILIST_CLIENT_ID', 'ANILIST_CLIENT_SECRET'];
  const before = env.map((name) => process.env[name]);
  for (const name of env) process.env[name] = `synthetic-${name.toLowerCase()}`;
  axios.post = async () => ({ data: { access_token: token, expires_in: 31536000 } });
  return () => {
    axios.post = original;
    env.forEach((name, i) => { if (before[i] === undefined) delete process.env[name]; else process.env[name] = before[i]; });
    process.env.SIMKL_CLIENT_ID = 'synthetic-simkl-client';
  };
}

test('callback (edit): the name is stored with the sealed connection and the status reports it', async () => {
  const restore = fakeTokenExchange('simkl', SIMKL_TOKEN);
  const asked = [];
  const app = await startApp({ accountName: async (provider, token) => { asked.push([provider, token]); return '  SimklPerson '; } });
  try {
    const { state } = require('../src/setup/oauth.ts').createPendingOAuth(UUID, 'simkl');
    const res = await fetch(`${app.base}/api/setup/oauth/simkl/callback?state=${state}&code=code-1`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.ok(!html.includes(SIMKL_TOKEN), 'the edit-mode page never carries the token');
    assert.deepEqual(asked, [['simkl', SIMKL_TOKEN]]);
    assert.equal(app.row.keys.watchlist.simkl.access_token, SIMKL_TOKEN);
    assert.equal(app.row.keys.watchlist.simkl.username, 'SimklPerson');
    const status = await (await fetch(`${app.base}/api/setup/${UUID}/watchlist`, app.bearer())).json();
    assert.equal(status.simkl.connected, true);
    assert.equal(status.simkl.username, 'SimklPerson');
    assert.ok(!JSON.stringify(status).includes(SIMKL_TOKEN));
  } finally { restore(); await app.close(); }
});

test('callback (create): the popup posts the tokens with the account name, nothing is sealed', async () => {
  const restore = fakeTokenExchange('anilist', ANILIST_TOKEN);
  const app = await startApp({ accountName: async () => 'Neo_99' });
  try {
    const { state } = require('../src/setup/oauth.ts').createPendingOAuth(null, 'anilist');
    const html = await (await fetch(`${app.base}/api/setup/oauth/anilist/callback?state=${state}&code=code-1`)).text();
    const payload = JSON.parse(html.match(/postMessage\((\{.*\}), window\.location\.origin\)/)[1]);
    assert.equal(payload.lelibraryWatchlistTokens.provider, 'anilist');
    assert.equal(payload.lelibraryWatchlistTokens.username, 'Neo_99');
    assert.equal(payload.lelibraryWatchlistTokens.connection.username, 'Neo_99');
    assert.equal(payload.lelibraryWatchlistTokens.connection.access_token, ANILIST_TOKEN);
    assert.equal(app.saves.length, 0);
  } finally { restore(); await app.close(); }
});

test('callback: a failed name lookup still connects, without a name', async () => {
  const restore = fakeTokenExchange('simkl', SIMKL_TOKEN);
  const app = await startApp({ accountName: async () => { throw new Error('Simkl down'); } });
  try {
    const { state } = require('../src/setup/oauth.ts').createPendingOAuth(UUID, 'simkl');
    const res = await fetch(`${app.base}/api/setup/oauth/simkl/callback?state=${state}&code=code-1`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Simkl connected/);
    assert.equal(app.row.keys.watchlist.simkl.access_token, SIMKL_TOKEN);
    assert.equal(app.row.keys.watchlist.simkl.username, undefined);
    const status = await (await fetch(`${app.base}/api/setup/${UUID}/watchlist`, app.bearer())).json();
    assert.equal(status.simkl.connected, true);
    assert.equal(status.simkl.username, undefined);
  } finally { restore(); await app.close(); }
});

test('a saved public AniList name is never reported: AniList is Connect only', async () => {
  const app = await startApp({ config: { anilistUser: 'Neo_99' } });
  try {
    const status = await (await fetch(`${app.base}/api/setup/${UUID}/watchlist`, app.bearer())).json();
    assert.equal(status.anilist.connected, false);
    assert.equal('publicUser' in status.anilist, false);
    const res = await fetch(`${app.base}/api/setup/${UUID}/watchlist/anilist/disconnect`, { method: 'POST', ...app.bearer() });
    assert.equal(res.status, 200);
    // The name is untouched here; the next save drops it.
    assert.equal(app.saves.at(-1).clearConfig, undefined);
    await fetch(`${app.base}/api/setup/${UUID}/watchlist/simkl/disconnect`, { method: 'POST', ...app.bearer() });
    assert.equal(app.saves.at(-1).clearConfig, undefined);
  } finally { await app.close(); }
});

test('an AniList login is the only way in; a saved username is left unused', async () => {
  const restore = fakeTokenExchange('anilist', ANILIST_TOKEN);
  const app = await startApp({ config: { anilistUser: 'Neo_99' }, accountName: async () => 'Neo_99' });
  try {
    const { state } = require('../src/setup/oauth.ts').createPendingOAuth(UUID, 'anilist');
    await (await fetch(`${app.base}/api/setup/oauth/anilist/callback?state=${state}&code=code-1`)).text();
    assert.equal(app.row.keys.watchlist.anilist.username, 'Neo_99');
    // The username field is not touched by a connect; the next save drops it.
    assert.equal(app.row.config.anilistUser, 'Neo_99');
    const status = await (await fetch(`${app.base}/api/setup/${UUID}/watchlist`, app.bearer())).json();
    assert.equal(status.anilist.connected, true);
    assert.equal(status.anilist.username, 'Neo_99');
    assert.equal('publicUser' in status.anilist, false);
  } finally { restore(); await app.close(); }
});

test('identities prefer the name stored with the connection; older connections still look it up', async () => {
  const none = fakeHttp(() => { throw new Error('must not call'); });
  const out = await userLists.userListIdentities({
    watchlist: { simkl: { access_token: SIMKL_TOKEN, username: 'Stored' }, anilist: { access_token: ANILIST_TOKEN, username: 'AniStored' } },
  }, context(none));
  assert.deepEqual(out, { simkl: 'Stored', anilist: 'AniStored' });
  assert.equal(none.calls.length, 0);
  const lookup = fakeHttp((_method, url) => (url.endsWith('/users/settings') ? { data: { user: { name: 'Looked' } } } : httpError(404)));
  assert.deepEqual(await userLists.userListIdentities({ watchlist: { simkl: { access_token: SIMKL_TOKEN_2 } } }, context(lookup)), { simkl: 'Looked' });
  assert.equal(lookup.calls[0].method, 'GET', 'Simkl /users/settings is a GET');
  // A saved public AniList name is never a display name (Connect only).
  assert.deepEqual(await userLists.userListIdentities({ anilistUser: 'Neo_99' }, context(none)), {});
});

test('connectionUsername: Simkl user.name and AniList Viewer.name with the new token; failures are null', async () => {
  const http = fakeHttp((_method, url, options) => {
    if (url.endsWith('/users/settings')) {
      assert.equal(options.headers.Authorization, `Bearer ${SIMKL_TOKEN}`);
      assert.equal(options.headers['simkl-api-key'], 'synthetic-simkl-client');
      return { data: { user: { name: 'SimklPerson' } } };
    }
    if (url.includes('graphql.anilist.co')) {
      assert.equal(options.headers.Authorization, `Bearer ${ANILIST_TOKEN}`);
      return { data: { data: { Viewer: { id: 5, name: 'AniPerson' } } } };
    }
    return httpError(404);
  });
  assert.equal(await userLists.connectionUsername('simkl', SIMKL_TOKEN, context(http)), 'SimklPerson');
  assert.equal(await userLists.connectionUsername('anilist', ANILIST_TOKEN, context(http)), 'AniPerson');
  assert.equal(await userLists.connectionUsername('trakt', 'synthetic', context(http)), null);
  assert.equal(await userLists.connectionUsername('simkl', SIMKL_TOKEN_2, context(fakeHttp(() => httpError(500)))), null);
  assert.equal(userLists.cleanAccountName(' a\u0000b '), 'ab');
  assert.equal(userLists.cleanAccountName(42), null);
  assert.equal(userLists.cleanAccountName('x'.repeat(200)).length, 80);
});
