// @ts-nocheck
// After an import: remove only the imported old setup, and the whole old
// account (email included) only when nothing else is left to import.
const test = require('node:test');
const assert = require('node:assert');
const { purgeOldAccount, maskId } = require('../src/setup/migrate.ts');

function fakePool(tokens) {
  const state = { tokens: tokens.map((id) => ({ id, user_id: 'u1', revoked_at: null })), userDeleted: false, queries: [] };
  return {
    state,
    async query(sql, params = []) {
      state.queries.push(sql.replace(/\s+/g, ' ').trim());
      if (/^SELECT id FROM users/.test(sql)) return { rows: state.userDeleted ? [] : [{ id: 'u1' }] };
      if (/^SELECT id, user_id, config, label FROM tokens/.test(sql)) return { rows: state.tokens.map((t) => ({ ...t, config: {}, label: null })) };
      if (/^DELETE FROM tokens/.test(sql)) { state.tokens = state.tokens.filter((t) => t.id !== params[0]); return { rows: [] }; }
      if (/SELECT count\(\*\)::int AS n FROM tokens/.test(sql)) return { rows: [{ n: state.tokens.filter((t) => !t.revoked_at).length }] };
      if (/^DELETE FROM users/.test(sql)) { state.userDeleted = true; state.tokens = []; return { rows: [] }; }
      throw new Error('unexpected query: ' + sql);
    },
  };
}

test('with another old setup left, only the imported one is removed', async () => {
  const pool = fakePool(['tokenAAAAAAAAone', 'tokenBBBBBBBBtwo']);
  const result = await purgeOldAccount({ pool }, { email: 'a@b.c', idMasked: maskId('tokenAAAAAAAAone') });
  assert.deepEqual(result, { purged: 'token', tokenId: 'tokenAAAAAAAAone' });
  assert.equal(pool.state.userDeleted, false);
  assert.deepEqual(pool.state.tokens.map((t) => t.id), ['tokenBBBBBBBBtwo']);
});

test('importing the last old setup removes the whole account and its email', async () => {
  const pool = fakePool(['tokenBBBBBBBBtwo']);
  const result = await purgeOldAccount({ pool }, { email: 'a@b.c', idMasked: maskId('tokenBBBBBBBBtwo') });
  assert.equal(result.purged, 'account');
  assert.equal(pool.state.userDeleted, true);
});

test('a selection that does not match removes nothing', async () => {
  const pool = fakePool(['tokenAAAAAAAAone']);
  await assert.rejects(purgeOldAccount({ pool }, { email: 'a@b.c', idMasked: 'zzzz…zzz' }));
  assert.equal(pool.state.userDeleted, false);
  assert.equal(pool.state.tokens.length, 1);
});
