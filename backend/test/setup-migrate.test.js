'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { seal } = require('../src/setup/seal.ts');
const { migrateAccount, listAccountSetups, previewImport, importOldSetupData, splitConfigAndKeys, MigrateError } = require('../src/setup/migrate.ts');

const OLD_KEY = crypto.createHash('sha256').update('old-server-key').digest();
const NEW_KEY = crypto.createHash('sha256').update('new-server-key').digest();

function fakePool(fixtures) {
  fixtures.deleted = fixtures.deleted || [];
  return {
    async query(sql, params) {
      const text = String(sql);
      if (text.startsWith('DELETE FROM users')) {
        fixtures.deleted.push({ table: 'users', id: params[0] });
        return { rows: [] };
      }
      if (text.startsWith('DELETE FROM tokens')) {
        fixtures.deleted.push({ table: 'tokens', id: params[0] });
        return { rows: [] };
      }
      if (text.includes('FROM users')) {
        const row = (fixtures.users || []).find((u) => String(u.email).toLowerCase() === String(params[0]).toLowerCase());
        return { rows: row ? [row] : [] };
      }
      if (text.includes('FROM tokens WHERE id')) {
        const row = (fixtures.tokens || []).find((t) => t.id === params[0] && !t.revoked_at);
        return { rows: row ? [row] : [] };
      }
      if (text.includes('FROM tokens') && text.includes('WHERE user_id')) {
        const rows = (fixtures.tokens || []).filter((t) => String(t.user_id) === String(params[0]) && !t.revoked_at);
        // The picker list asks for label/config/dates; the migrate-by-email
        // path takes the most recent single row.
        return { rows };
      }
      if (text.includes('FROM provider_keys')) {
        return { rows: (fixtures.keys || []).filter((k) => String(k.user_id) === String(params[0])) };
      }
      if (text.includes('FROM watchlist_conns')) {
        return { rows: (fixtures.watchlist || []).filter((k) => String(k.user_id) === String(params[0])) };
      }
      if (text.includes('FROM push_conns')) {
        return { rows: (fixtures.push || []).filter((k) => String(k.user_id) === String(params[0])) };
      }
      if (text.includes('collection_contexts') && text.includes('COUNT')) {
        return { rows: [{ contexts: String(fixtures.contexts ?? 0), collections: String(fixtures.collections ?? 0) }] };
      }
      if (text.includes('FROM collection_contexts')) {
        return { rows: fixtures.contextDocs || [] };
      }
      if (text.includes('FROM collection_config')) {
        return { rows: fixtures.legacyDocs ? [fixtures.legacyDocs] : [] };
      }
      if (text.includes('FROM configs')) return { rows: [] };
      throw new Error(`unexpected query in test: ${text.slice(0, 60)}`);
    },
  };
}

function fakeStore(captured) {
  return {
    async create(input) {
      captured.input = input;
      return { uuid: 'new-uuid', secret: 'new-secret', installToken: 'new-uuid.new-secret', tier: input.tier || 'partial', createdAt: null };
    },
  };
}

function accountFixtures() {
  return {
    users: [{ id: 'user-1', email: 'Operator@Example.com' }],
    tokens: [{ id: 'old-token', user_id: 'user-1', label: 'Living room', revoked_at: null, config: { provider: 'torbox', lang: 'en-US', tmdbApiKey: 'MUST-NOT-COPY' } }],
    keys: [
      { user_id: 'user-1', service: 'torboxApiKey', sealed: seal(OLD_KEY, 'real-torbox-key') },
      { user_id: 'user-1', service: 'tmdbApiKey', sealed: seal(OLD_KEY, 'real-tmdb-key') },
      { user_id: 'user-1', service: 'broken', sealed: { nope: true } },
    ],
    contexts: 2,
    collections: 3,
  };
}

async function migrateWith(fixtures, input) {
  const captured = {};
  const store = fakeStore(captured);
  return withOldKey(() => migrateAccount(
    { pool: fakePool(fixtures), key: NEW_KEY, createStore: () => store },
    input,
  ).then((result) => ({ result, captured })));
}

function withOldKey(work) {
  const fake = { ...process.env, ENCRYPTION_KEY: crypto.createHash('sha256').update('old-server-key').digest('hex') };
  const realEnv = process.env;
  process.env = fake;
  try {
    const out = work();
    if (out && typeof out.then === 'function') {
      return out.finally(() => { process.env = realEnv; });
    }
    process.env = realEnv;
    return out;
  } catch (error) {
    process.env = realEnv;
    throw error;
  }
}

async function importDataWith(fixtures, input) {
  return withOldKey(() => importOldSetupData({ pool: fakePool(fixtures), key: NEW_KEY }, input));
}

test('migrating by token id reseals keys and never copies them out of the old config', async () => {
  const { result, captured } = await migrateWith(accountFixtures(), { tokenId: 'old-token', password: 'a-good-password' });
  assert.equal(result.uuid, 'new-uuid');
  assert.equal(result.installToken, 'new-uuid.new-secret');
  assert.deepEqual(result.keyServices.sort(), ['tmdbApiKey', 'torboxApiKey']);
  assert.deepEqual(result.collections, { contexts: 2, collections: 3 });
  assert.equal(result.sourceLabel, 'Living room');
  assert.equal(result.purged, 'none');
  // The new row gets decrypted values and a structural config without secrets.
  assert.equal(captured.input.keys.torboxApiKey, 'real-torbox-key');
  assert.equal(captured.input.keys.tmdbApiKey, 'real-tmdb-key');
  assert.ok(!('broken' in captured.input.keys));
  assert.equal(captured.input.config.provider, 'torbox');
  assert.ok(!('tmdbApiKey' in captured.input.config));
  assert.equal(captured.input.password, 'a-good-password');
});

// The v5 account model sealed provider keys as raw strings (enc.seal), not
// JSON (enc.sealJson). The shared unseal() JSON-parses and returns null for
// those rows, so the migration must also try the old raw-string open.
function sealOldRaw(key, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

test('old raw-string sealed keys (v5 account format) still migrate', async () => {
  const fixtures = accountFixtures();
  fixtures.keys = [{ user_id: 'user-1', service: 'torboxApiKey', sealed: sealOldRaw(OLD_KEY, 'legacy-raw-key') }];
  const { result, captured } = await migrateWith(fixtures, { tokenId: 'old-token', password: 'a-good-password' });
  assert.equal(captured.input.keys.torboxApiKey, 'legacy-raw-key');
  assert.deepEqual(result.keyServices.sort(), ['tmdbApiKey', 'torboxApiKey']);
});

test('migrating by token id finds the exact saved setup', async () => {
  const { result } = await migrateWith(accountFixtures(), { tokenId: 'old-token', password: 'a-good-password', tier: 'full' });
  assert.equal(result.tier, 'full');
  assert.equal(result.uuid, 'new-uuid');
});

test('migrating by picker selection (email + masked id) resolves the setup', async () => {
  const { result, captured } = await migrateWith(accountFixtures(), {
    email: 'operator@example.com', idMasked: 'old-…ken', password: 'a-good-password',
  });
  assert.equal(result.uuid, 'new-uuid');
  assert.equal(result.sourceLabel, 'Living room');
  assert.equal(captured.input.keys.torboxApiKey, 'real-torbox-key');
});

test('picker selection with no match reads back as not found', async () => {
  await assert.rejects(
    migrateWith(accountFixtures(), { email: 'operator@example.com', idMasked: 'xxxx…yyy', password: 'a-good-password' }),
    (e) => e instanceof MigrateError && e.code === 'not_found',
  );
  await assert.rejects(
    migrateWith(accountFixtures(), { email: 'operator@example.com', password: 'a-good-password' }),
    (e) => e instanceof MigrateError && e.code === 'bad_request',
  );
});

test('input is validated before any database work', async () => {
  // A stray email field is ignored: only the token id counts.
  const { result } = await migrateWith(accountFixtures(), { email: 'a@b.c', tokenId: 'old-token', password: 'a-good-password' });
  assert.equal(result.uuid, 'new-uuid');
  await assert.rejects(migrateWith(accountFixtures(), { email: 'a@b.c', password: 'a-good-password' }), (e) => e instanceof MigrateError && e.code === 'bad_request');
  await assert.rejects(migrateWith(accountFixtures(), { tokenId: 'old-token', password: 'short' }), (e) => e instanceof MigrateError && e.code === 'bad_request');
});

test('unknown identifiers read back as not found', async () => {
  // Email alone never reaches the database: it cannot prove ownership.
  await assert.rejects(migrateWith(accountFixtures(), { email: 'nobody@example.com', password: 'a-good-password' }), (e) => e instanceof MigrateError && e.code === 'bad_request');
  await assert.rejects(migrateWith(accountFixtures(), { tokenId: 'missing', password: 'a-good-password' }), (e) => e instanceof MigrateError && e.code === 'not_found');
});

test('unreadable old rows degrade to structure-only instead of failing', async () => {
  const fixtures = accountFixtures();
  fixtures.keys = [];
  const { result, captured } = await migrateWith(fixtures, { tokenId: 'old-token', password: 'a-good-password' });
  assert.deepEqual(captured.input.keys, {});
  // The old document still names the field, so it is reported as carried even
  // though no secret value came across.
  assert.deepEqual(result.keyServices, ['tmdbApiKey']);
});

test('splitConfigAndKeys strips embedded secrets and reports them', () => {
  const { config, carriedKeys } = splitConfigAndKeys({ provider: 'torbox', tmdbApiKey: 'x', nick: 'y' });
  assert.deepEqual(config, { provider: 'torbox', nick: 'y' });
  assert.deepEqual(carriedKeys, ['tmdbApiKey']);
});

test('lookup lists an email’s setups with metadata only', async () => {
  const fixtures = accountFixtures();
  const pool = fakePool(fixtures);
  const found = await listAccountSetups({ pool, key: NEW_KEY }, 'operator@example.com');
  assert.equal(found.setups.length, 1);
  assert.equal(found.setups[0].label, 'Living room');
  // The picker masks ids: enough to recognise your own setup, useless as proof.
  assert.match(found.setups[0].idMasked, /^old-…ken$/);
  assert.ok(!('id' in found.setups[0]));
  assert.deepEqual(found.keyServices.sort(), ['broken', 'tmdbApiKey', 'torboxApiKey']);
  assert.deepEqual(found.collections, { contexts: 2, collections: 3 });
  // No secret values, no configs, no install tokens in the picker payload.
  assert.ok(!JSON.stringify(found).includes('real-torbox-key'));
  assert.ok(!JSON.stringify(found).includes('MUST-NOT-COPY'));
});

test('lookup rejects bad input and unknown emails generically', async () => {
  const pool = fakePool(accountFixtures());
  await assert.rejects(listAccountSetups({ pool, key: NEW_KEY }, 'not-an-email'), (e) => e instanceof MigrateError && e.code === 'bad_request');
  await assert.rejects(listAccountSetups({ pool, key: NEW_KEY }, 'nobody@example.com'), (e) => e instanceof MigrateError && e.code === 'not_found');
});

test('lookup tags collection setups so the picker can pill them', async () => {
  const fixtures = accountFixtures();
  fixtures.tokens.push(
    { id: 'collection-token', user_id: 'user-1', label: 'Franchises', revoked_at: null, config: { wizard: true, collection_setup: true } },
  );
  const pool = fakePool(fixtures);
  const found = await listAccountSetups({ pool, key: NEW_KEY }, 'operator@example.com');
  assert.equal(found.setups.length, 2);
  const byMask = Object.fromEntries(found.setups.map((s) => [s.idMasked, s.kind]));
  assert.equal(byMask['old-…ken'], 'token');
  assert.equal(byMask['coll…ken'], 'collection');
});

test('purgeToken deletes only the migrated token row', async () => {
  const fixtures = accountFixtures();
  const pool = fakePool(fixtures);
  const captured = {};
  const store = fakeStore(captured);
  const fake = { ...process.env, ENCRYPTION_KEY: crypto.createHash('sha256').update('old-server-key').digest('hex') };
  const realEnv = process.env;
  process.env = fake;
  try {
    const result = await migrateAccount(
      { pool, key: NEW_KEY, createStore: () => store },
      { tokenId: 'old-token', password: 'a-good-password', purgeToken: true },
    );
    assert.equal(result.purged, 'token');
    assert.deepEqual(fixtures.deleted, [{ table: 'tokens', id: 'old-token' }]);
  } finally {
    process.env = realEnv;
  }
});

test('purgeAccount deletes the whole old account row', async () => {
  const fixtures = accountFixtures();
  const pool = fakePool(fixtures);
  const captured = {};
  const store = fakeStore(captured);
  const fake = { ...process.env, ENCRYPTION_KEY: crypto.createHash('sha256').update('old-server-key').digest('hex') };
  const realEnv = process.env;
  process.env = fake;
  try {
    const result = await migrateAccount(
      { pool, key: NEW_KEY, createStore: () => store },
      { tokenId: 'old-token', password: 'a-good-password', purgeAccount: true },
    );
    assert.equal(result.purged, 'account');
    assert.deepEqual(fixtures.deleted, [{ table: 'users', id: 'user-1' }]);
  } finally {
    process.env = realEnv;
  }
});

test('migrate carries watchlist and push connections into the keys envelope', async () => {
  const { seal: sealValue } = require('../src/setup/seal.ts');
  const fixtures = accountFixtures();
  fixtures.watchlist = [
    { user_id: 'user-1', provider: 'trakt', sealed: sealValue(OLD_KEY, { access_token: 'trakt-tok', refresh_token: 'r' }) },
    { user_id: 'user-1', provider: 'broken', sealed: { nope: true } },
  ];
  fixtures.push = [
    { user_id: 'user-1', platform: 'nuvio', sealed: sealValue(OLD_KEY, { nuvioToken: 'nuvio-tok' }) },
  ];
  const { result, captured } = await migrateWith(fixtures, { tokenId: 'old-token', password: 'a-good-password' });
  assert.deepEqual(captured.input.keys.watchlist, { trakt: { access_token: 'trakt-tok', refresh_token: 'r' } });
  assert.deepEqual(captured.input.keys.nuvio, undefined);
  assert.deepEqual(captured.input.keys.push, { nuvio: { nuvioToken: 'nuvio-tok' } });
  assert.ok(result.keyServices.includes('watchlist:trakt'));
  assert.ok(result.keyServices.includes('push:nuvio'));
  assert.ok(!result.keyServices.includes('watchlist:broken'));
});

test('preview returns the old settings with secrets stripped', async () => {
  const fixtures = accountFixtures();
  const pool = fakePool(fixtures);
  const preview = await previewImport({ pool, key: NEW_KEY }, { email: 'operator@example.com', idMasked: 'old-…ken' });
  assert.equal(preview.sourceLabel, 'Living room');
  assert.equal(preview.kind, 'token');
  assert.equal(preview.config.provider, 'torbox');
  assert.ok(!('tmdbApiKey' in preview.config));
  assert.deepEqual(preview.keyServices.sort(), ['broken', 'tmdbApiKey', 'torboxApiKey']);
  // Nothing secret-shaped survives in the payload.
  assert.ok(!JSON.stringify(preview).includes('real-torbox-key'));
  assert.ok(!JSON.stringify(preview).includes('MUST-NOT-COPY'));
});

test('preview rejects bad input and unknown selections generically', async () => {
  const pool = fakePool(accountFixtures());
  await assert.rejects(previewImport({ pool, key: NEW_KEY }, { email: 'nope', idMasked: 'old-…ken' }), (e) => e instanceof MigrateError && e.code === 'bad_request');
  await assert.rejects(previewImport({ pool, key: NEW_KEY }, { email: 'operator@example.com', idMasked: 'xxxx…yyy' }), (e) => e instanceof MigrateError && e.code === 'not_found');
});

test('full data import returns keys, logins and the setup-owned collection docs', async () => {
  const { seal: sealValue } = require('../src/setup/seal.ts');
  const fixtures = accountFixtures();
  fixtures.tokens = [{
    id: 'old-token', user_id: 'user-1', label: 'Living room', revoked_at: null,
    config: { provider: 'torbox', wizard: true, collection_setup: true, keyContext: { integration: 'nuvio', profile_id: '1' } },
  }];
  fixtures.keys = [
    { user_id: 'user-1', service: 'torboxApiKey', sealed: seal(OLD_KEY, 'real-torbox-key') },
    { user_id: 'user-1', service: 'tmdbApiKey', sealed: seal(OLD_KEY, 'real-tmdb-key') },
  ];
  fixtures.watchlist = [
    { user_id: 'user-1', provider: 'trakt', sealed: sealValue(OLD_KEY, { access_token: 'trakt-tok' }) },
  ];
  fixtures.push = [
    { user_id: 'user-1', platform: 'nuvio', sealed: sealValue(OLD_KEY, { nuvioToken: 'nuvio-tok' }) },
  ];
  fixtures.contextDocs = [
    {
      integration: 'stremio', profile_id: 'default',
      collections: [{ id: 'wrong-scope' }], home_rows: [],
    },
    {
      integration: 'nuvio', profile_id: '1',
      collections: [{ id: 'coll-1', title: 'Franchises', folders: [] }],
      home_rows: [{ id: 'row-1', title: 'Row', source: { kind: 'catalog', id: 'x', catalogId: 'x', type: 'movie' } }],
    },
  ];
  const data = await importDataWith(fixtures, { email: 'operator@example.com', idMasked: 'old-…ken' });
  // Secrets included by design (operator decision): the page fills its inputs.
  assert.equal(data.keys.torboxApiKey, 'real-torbox-key');
  assert.equal(data.keys.tmdbApiKey, 'real-tmdb-key');
  assert.deepEqual(data.watchlist, ['trakt']);
  assert.deepEqual(data.push, ['nuvio']);
  // The token's own nuvio/1 context wins over the stremio one.
  assert.deepEqual(data.context, { integration: 'nuvio', profileId: '1' });
  assert.deepEqual(data.collections, [{ id: 'coll-1', title: 'Franchises', folders: [] }]);
  assert.equal(data.homeRows.length, 1);
  assert.equal(data.kind, 'collection');
});

test('full data import falls back to the legacy user row without contexts', async () => {
  const fixtures = accountFixtures();
  fixtures.contextDocs = [];
  fixtures.legacyDocs = {
    collections: [{ id: 'legacy-1', title: 'Old', folders: [] }],
    home_rows: [{ id: 'legacy-row-1', title: 'Row', source: { kind: 'catalog', id: 'x', catalogId: 'x', type: 'movie' } }],
  };
  const data = await importDataWith(fixtures, { email: 'operator@example.com', idMasked: 'old-…ken' });
  assert.equal(data.context, null);
  assert.deepEqual(data.collections, [{ id: 'legacy-1', title: 'Old', folders: [] }]);
  assert.equal(data.homeRows.length, 1);
});

test('full data import rejects unknown selections', async () => {
  const pool = fakePool(accountFixtures());
  await assert.rejects(importOldSetupData({ pool, key: NEW_KEY }, { email: 'operator@example.com', idMasked: 'xxxx…yyy' }), (e) => e instanceof MigrateError && e.code === 'not_found');
});

test('purging the only old setup deletes it and the whole old account', async () => {
  const { purgeOldAccount } = require('../src/setup/migrate.ts');
  const fixtures = accountFixtures();
  const pool = fakePool(fixtures);
  const out = await purgeOldAccount({ pool }, { email: 'operator@example.com', idMasked: 'old-…ken' });
  // The only old setup was imported, so the setup row and then the whole
  // account go (multi-setup accounts are covered in migrate-purge.test.ts).
  assert.deepEqual(out, { purged: 'account', tokenId: 'old-token' });
  assert.deepEqual(fixtures.deleted, [{ table: 'tokens', id: 'old-token' }, { table: 'users', id: 'user-1' }]);
});

test('purge rejects unknown selections without deleting', async () => {
  const { purgeOldAccount } = require('../src/setup/migrate.ts');
  const fixtures = accountFixtures();
  const pool = fakePool(fixtures);
  await assert.rejects(purgeOldAccount({ pool }, { email: 'operator@example.com', idMasked: 'xxxx…yyy' }), (e) => e instanceof MigrateError && e.code === 'not_found');
  assert.deepEqual(fixtures.deleted, []);
});
test('migrate accepts only a token id: email alone proves nothing', async () => {
  await assert.rejects(migrateWith(accountFixtures(), { email: 'operator@example.com', password: 'a-good-password' }), (e) => e instanceof MigrateError && e.code === 'bad_request');
  await assert.rejects(migrateWith(accountFixtures(), { tokenId: '', password: 'a-good-password' }), (e) => e instanceof MigrateError && e.code === 'bad_request');
});
