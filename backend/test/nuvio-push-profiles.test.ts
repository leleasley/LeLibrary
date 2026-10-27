// @ts-nocheck
// A push changes only the Nuvio profile it targets. Other profiles keep
// everything, including their own LeLibrary setup (one setup per person).
const test = require('node:test');
const assert = require('node:assert/strict');

const calls = [];
const reply = (data) => Promise.resolve({ status: 200, data });
function fakeAxios(config) {
  calls.push({ method: String(config.method || 'GET').toUpperCase(), url: String(config.url), body: config.data });
  return reply([]);
}
fakeAxios.get = (url) => {
  calls.push({ method: 'GET', url: String(url) });
  if (/manifest\.json/.test(url)) return reply({ id: 'community.lelibrary.test', name: 'LeLibrary', catalogs: [] });
  return reply([]);
};
fakeAxios.post = (url, body) => {
  calls.push({ method: 'POST', url: String(url), body });
  if (url.endsWith('/rpc/sync_pull_profiles')) {
    return reply([{ profile_index: 1, name: 'Mum', uses_primary_addons: false }, { profile_index: 2, name: 'Dad', uses_primary_addons: false }]);
  }
  if (url.endsWith('/rpc/get_sync_owner')) return reply(['owner-1']);
  if (url.endsWith('/rpc/sync_pull_collections')) {
    return reply([{ collections_json: [{ id: 'collection-lelibrary-mums-setup', folders: [] }] }]);
  }
  return reply([]);
};
require.cache[require.resolve('axios')] = { id: 'axios', filename: 'axios', loaded: true, exports: fakeAxios };
const push = require('../src/setup/push.ts');

test('pushing to one Nuvio profile writes nothing to the others', async () => {
  const result = await push.installSetup({
    uuid: '00000000-0000-4000-8000-000000000002', installToken: '00000000-0000-4000-8000-000000000002.secret',
    connection: { nuvioToken: 'token', nuvioSelectedProfile: 2 }, platform: 'nuvio', profileId: 2, internal: true,
    origin: 'https://lelibrary.example', port: 1, document: { collections: [], homeRows: [], sources: [] }, options: {},
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const writes = calls.filter((c) => c.method !== 'GET' && !/sync_pull_|get_sync_owner|\/auth\//.test(c.url));
  assert.ok(writes.length > 0, 'the target profile was written');
  for (const call of writes) {
    if (call.url.endsWith('/rpc/sync_push_profiles')) {
      // The profile list goes back whole; only the target changes.
      const mum = call.body.p_profiles.find((p) => p.profile_index === 1);
      assert.equal(mum.uses_primary_addons, false);
      continue;
    }
    const profile = call.body?.p_profile_id ?? (Array.isArray(call.body) ? call.body[0]?.profile_id : undefined) ?? (/profile_id=eq\.(\d+)/.exec(call.url) || [])[1];
    assert.equal(String(profile), '2', `${call.url} must only touch profile 2`);
  }
});
