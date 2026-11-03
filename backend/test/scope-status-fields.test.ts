// @ts-nocheck
// Audit B21 (follow-up to B3): the library status endpoint picks lib_scopes
// columns from an allowlist instead of spreading the row, so the sealed
// install link (config_token) and any column added later stay private.
// The store is stubbed: no database, synthetic values only.
const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('../src/library/store.ts');
const engine = require('../src/library/engine.ts');

test('scopeStatus never echoes config_token or unlisted columns', async (t) => {
  const originals = {
    getScope: store.getScope,
    identityCounts: store.identityCounts,
    identityCoverage: store.identityCoverage,
    mediaTypeCounts: store.mediaTypeCounts,
  };
  t.after(() => Object.assign(store, originals));
  store.getScope = async () => ({
    scope_id: 'scope-synthetic',
    provider: 'torbox',
    config_token: 'sealed:v1:synthetic',
    last_status: 'ok',
    item_count: 3,
    some_future_column: 'private',
  });
  store.identityCounts = async () => null;
  store.identityCoverage = async () => null;
  store.mediaTypeCounts = async () => null;

  const status = await engine.scopeStatus('scope-synthetic');
  assert.equal(status.scope_id, 'scope-synthetic');
  assert.equal(status.last_status, 'ok');
  assert.equal(status.item_count, 3);
  assert.equal('config_token' in status, false);
  assert.equal('some_future_column' in status, false);
  assert.equal(JSON.stringify(status).includes('sealed:v1'), false);
});
