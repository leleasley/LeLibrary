const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const TOKEN = 'share-setup-token';
const EXT_ID = 'ext_' + 'c'.repeat(64);

// The account area is private: it ships only on the hosted instance, so it is
// absent for self-hosters and in CI. This file exercises the private accounts
// router, so it skips cleanly instead of failing where that code is missing.
const HAS_ACCOUNT_AREA = (() => {
  try { require.resolve('../src/accounts/db'); require.resolve('../src/accounts/index.js'); return true; }
  catch { return false; }
})();
const NO_ACCOUNT_AREA = HAS_ACCOUNT_AREA ? false : 'private account area not present';

function contextRow() {
  return {
    collections: [{ id: 'c1', title: 'Shared', folders: [{
      id: 'f1', title: 'Folder', catalogSources: [
        { addonId: 'community.lelibrary', catalogId: 'lib-trending_movies', type: 'movie', genre: '' },
        { addonId: 'some.addon', catalogId: 'some-catalog', type: 'movie', genre: '', externalSourceId: EXT_ID },
      ],
    }] }],
    home_rows: [],
    sources: [{ id: 'imp_' + 'd'.repeat(64), provider: 'tmdb', engine: 'list', mediaType: 'movie', params: { listId: 42 }, label: 'List', provenance: { adapter: 'test', originHash: 'x'.repeat(64) } }],
    external_sources: [{
      id: EXT_ID, resolution: 'companion', addonId: 'some.addon', addonName: 'Some',
      label: 'Some', catalogId: 'some-catalog', mediaType: 'movie', genre: '',
      manifestFingerprint: 'e'.repeat(16),
      manifestSealed: { iv: ' whale', tag: 'not-real', ct: 'sealed-bytes' },
      provenance: { adapter: 'nuvio-community', origin: 'requirements' },
    }],
    profile_name: 'Shared Setup',
  };
}

function installPool(t, state) {
  const previousBase = process.env.BASE_URL;
  delete process.env.BASE_URL;
  const previousKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = '3'.repeat(64);
  const db = require('../src/accounts/db');
  const originalGetPool = db.getPool;
  const pool = {
    async query(sql, params) {
      const text = String(sql);
      if (text.includes('FROM sessions')) return { rows: [{
        id: 'synthetic-session', csrf_token: 'synthetic-csrf', expires_at: new Date(Date.now() + 60000),
        user_id: 'synthetic-user', email: 'test@example.invalid', name: 'Test', avatar: null,
        github_id: null, google_sub: 'synthetic', created_at: new Date(),
      }] };
      if (text.includes('FROM tokens')) return { rows: state.token ? [{ id: TOKEN, config: { collection_setup: true } }] : [] };
      if (text.includes('FROM collection_contexts')) return { rows: state.context ? [contextRow()] : [] };
      if (text.includes('SELECT payload FROM collection_shares WHERE id')) {
        return { rows: state.payload && state.shareId === params[0] ? [{ payload: state.payload }] : [] };
      }
      if (text.startsWith('INSERT INTO collection_shares')) {
        state.shares = [{ id: params[0], profile_name: params[3], updated_at: new Date().toISOString() }];
        state.payload = JSON.parse(params[4]);
        return { rows: [] };
      }
      if (text.startsWith('DELETE FROM collection_shares')) { state.shares = []; state.payload = null; return { rows: [] }; }
      if (text.includes('FROM collection_shares')) return { rows: state.shares };
      return { rows: [] };
    },
  };
  db.getPool = () => pool;
  delete require.cache[require.resolve('../src/accounts/index.js')];
  t.after(() => {
    db.getPool = originalGetPool;
    if (previousBase == null) delete process.env.BASE_URL; else process.env.BASE_URL = previousBase;
    if (previousKey == null) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previousKey;
  });
}

async function startServer(t) {
  const { createAccountsRouter } = require('../src/accounts/index.js');
  const app = express();
  app.use(createAccountsRouter());
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

const authed = { 'content-type': 'application/json', cookie: 'll_session=synthetic-session', 'x-csrf-token': 'synthetic-csrf' };

test('share link serves a key-free profile snapshot, then revokes', { skip: NO_ACCOUNT_AREA }, async (t) => {
  const state = { token: true, context: true, shares: [], payload: null, shareId: null };
  installPool(t, state);
  const endpoint = await startServer(t);

  const created = await fetch(`${endpoint}/api/account/collection-setups/${TOKEN}/share`, { method: 'POST', headers: authed, body: '{}' });
  assert.equal(created.status, 200);
  const share = await created.json();
  assert.match(share.shareId, /^sh_[A-Za-z0-9_-]{32}$/);
  assert.ok(share.url.endsWith(`/share/collections/${share.shareId}`));
  state.shareId = share.shareId;

  // Snapshot keeps collections, sources and sealed companions, but no secrets.
  const dumped = JSON.stringify(state.payload);
  assert.equal(state.payload.kind, 'lelibrary-collection-profile');
  assert.equal(state.payload.collections.length, 1);
  assert.equal(state.payload.externalSources.length, 1);
  assert.equal(state.payload.externalSources[0].manifestSealed.ct, 'sealed-bytes');
  assert.equal('manifestUrl' in state.payload.externalSources[0], false);
  for (const secret of ['torboxApiKey', 'rdApiKey', 'tmdbApiKey', 'access_token', 'password']) {
    assert.equal(dumped.includes(`"${secret}"`), false, secret);
  }

  const status = await fetch(`${endpoint}/api/account/collection-setups/${TOKEN}/share`, { headers: authed });
  assert.equal((await status.json()).shared, true);

  const pub = await fetch(`${endpoint}/share/collections/${share.shareId}`);
  assert.equal(pub.status, 200);
  const body = await pub.json();
  assert.equal(body.kind, 'lelibrary-collection-profile');
  assert.equal(body.collections[0].folders[0].catalogSources.length, 2);

  const revoked = await fetch(`${endpoint}/api/account/collection-setups/${TOKEN}/share`, { method: 'DELETE', headers: authed });
  assert.equal(revoked.status, 200);
  assert.equal((await (await fetch(`${endpoint}/share/collections/${share.shareId}`)).json()).error, 'Unknown share');
});

test('sharing requires a saved setup', { skip: NO_ACCOUNT_AREA }, async (t) => {
  const state = { token: true, context: false, shares: [], payload: null, shareId: null };
  installPool(t, state);
  const endpoint = await startServer(t);
  const res = await fetch(`${endpoint}/api/account/collection-setups/${TOKEN}/share`, { method: 'POST', headers: authed, body: '{}' });
  assert.equal(res.status, 409);

  const unknown = await fetch(`${endpoint}/share/collections/sh_${'z'.repeat(32)}`);
  assert.equal(unknown.status, 404);
});
