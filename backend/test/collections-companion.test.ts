// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');

const EXT_ID = 'ext_' + 'a'.repeat(64);
const OTHER_EXT_ID = 'ext_' + 'b'.repeat(64);

// The account area is private: it ships only on the hosted instance, so it is
// absent for self-hosters and in CI. This file exercises the private accounts
// router, so it skips cleanly instead of failing where that code is missing.
const HAS_ACCOUNT_AREA = (() => {
  try { require.resolve('../src/accounts/db'); require.resolve('../src/accounts/index.js'); return true; }
  catch { return false; }
})();
const NO_ACCOUNT_AREA = HAS_ACCOUNT_AREA ? false : 'private account area not present';

function installMocks(t, { existingExternal = null } = {}) {
  const previousKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = '2'.repeat(64);
  const db = require('../src/accounts/db');
  const originalGetPool = db.getPool;
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('FROM sessions')) return { rows: [{
        id: 'synthetic-session', csrf_token: 'synthetic-csrf', expires_at: new Date(Date.now() + 60000),
        user_id: 'synthetic-user', email: 'test@example.invalid', name: 'Test', avatar: null,
        github_id: null, google_sub: 'synthetic', created_at: new Date(),
      }] };
      if (String(sql).includes('FROM collection_contexts') && String(sql).includes('SELECT collections')) {
        return { rows: existingExternal ? [{ collections: [], home_rows: [], sources: [], external_sources: existingExternal }] : [] };
      }
      return { rows: [] };
    },
  };
  db.getPool = () => pool;
  // Fresh router + fresh module state per test file run.
  delete require.cache[require.resolve('../src/accounts/index.js')];
  t.after(() => {
    db.getPool = originalGetPool;
    if (previousKey == null) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previousKey;
  });
  return { queries, pool };
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

function putConfig(endpoint, body) {
  return fetch(`${endpoint}/api/account/collections-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: 'll_session=synthetic-session', 'x-csrf-token': 'synthetic-csrf' },
    body: JSON.stringify(body),
  });
}

function collectionsWith(refId) {
  return [{ id: 'c1', title: 'Shared', folders: [{
    id: 'f1', title: 'Folder', catalogSources: [
      { addonId: 'community.lelibrary', catalogId: 'lib-trending_movies', type: 'movie', genre: '' },
      { addonId: 'some.addon', catalogId: 'some-catalog', type: 'movie', genre: '', externalSourceId: refId },
    ],
  }] }];
}

test('missing companion refs are stripped with a warning instead of failing the save', { skip: NO_ACCOUNT_AREA }, async (t) => {
  const { queries } = installMocks(t);
  const endpoint = await startServer(t);
  const res = await putConfig(endpoint, {
    integration: 'nuvio', profile_id: 'default',
    collections: collectionsWith(EXT_ID), home_rows: [], sources: [], external_sources: [],
    defer_push: true,
  });
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.deepEqual(payload.strippedExternalSourceIds, [EXT_ID]);
  const insert = queries.find(q => q.sql.includes('INSERT INTO collection_contexts'));
  assert.ok(insert, 'expected the config INSERT');
  const stored = JSON.parse(insert.params[3]);
  assert.equal(stored[0].folders[0].catalogSources.length, 1);
  assert.equal(stored[0].folders[0].catalogSources[0].catalogId, 'lib-trending_movies');
});

test('stored companion bindings survive a save that does not re-send them', { skip: NO_ACCOUNT_AREA }, async (t) => {
  const { queries, pool } = installMocks(t);
  const enc = require('../src/accounts/encrypt');
  const manifestUrl = 'https://example.com/manifest.json';
  const stored = [{
    id: OTHER_EXT_ID,
    resolution: 'companion',
    addonId: 'some.addon', addonName: 'Some', label: 'Some', catalogId: 'some-catalog',
    mediaType: 'movie', genre: '',
    manifestFingerprint: crypto.createHash('sha256').update(manifestUrl).digest('hex').slice(0, 16),
    manifestSealed: enc.sealJson({ ownerId: 'synthetic-user', manifestUrl }),
    provenance: { adapter: 'nuvio-community', origin: 'requirements' },
  }];
  // Swap the load-bearing context response to carry the stored binding. The
  // session mock stays untouched.
  const baseQuery = pool.query;
  pool.query = async (sql, params) => {
    if (String(sql).includes('FROM collection_contexts') && String(sql).includes('SELECT collections')) {
      return { rows: [{ collections: [], home_rows: [], sources: [], external_sources: stored }] };
    }
    return baseQuery(sql, params);
  };
  const endpoint = await startServer(t);
  const res = await putConfig(endpoint, {
    integration: 'nuvio', profile_id: 'default',
    collections: collectionsWith(OTHER_EXT_ID), home_rows: [], sources: [], external_sources: [],
    defer_push: true,
  });
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.deepEqual(payload.strippedExternalSourceIds, []);
  const insert = queries.find(q => q.sql.includes('INSERT INTO collection_contexts'));
  assert.ok(insert, 'expected the config INSERT');
  const storedCollections = JSON.parse(insert.params[3]);
  assert.equal(storedCollections[0].folders[0].catalogSources.length, 2);
  const storedExternal = JSON.parse(insert.params[6]);
  assert.equal(storedExternal.length, 1);
  assert.equal(storedExternal[0].id, OTHER_EXT_ID);
});

export interface CollectionsCompanionTestTestModule {};
