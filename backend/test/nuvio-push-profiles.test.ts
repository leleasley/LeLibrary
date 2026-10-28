// @ts-nocheck
// A push changes only the Nuvio profile it targets. Other profiles keep
// everything, including their own LeLibrary setup (one setup per person).
const test = require('node:test');
const assert = require('node:assert/strict');

const calls = [];
let profileRows = [{ profile_index: 1, name: 'Mum', uses_primary_addons: false }, { profile_index: 2, name: 'Dad', uses_primary_addons: false }];
let settingsBlob = null;
let manifestCatalogs = [];
let profileCollections = [{ id: 'collection-lelibrary-mums-setup', folders: [] }];
const reply = (data) => Promise.resolve({ status: 200, data });
function fakeAxios(config) {
  calls.push({ method: String(config.method || 'GET').toUpperCase(), url: String(config.url), body: config.data });
  return reply([]);
}
fakeAxios.get = (url) => {
  calls.push({ method: 'GET', url: String(url) });
  if (/manifest\.json/.test(url)) return reply({ id: 'community.lelibrary.test', name: 'LeLibrary', catalogs: manifestCatalogs });
  return reply([]);
};
fakeAxios.post = (url, body) => {
  calls.push({ method: 'POST', url: String(url), body });
  if (url.endsWith('/rpc/sync_pull_profiles')) {
    return reply(profileRows);
  }
  if (url.endsWith('/rpc/get_sync_owner')) return reply(['owner-1']);
  if (url.endsWith('/rpc/sync_pull_profile_settings_blob')) return reply(settingsBlob ? [{ settings_json: settingsBlob }] : []);
  if (url.endsWith('/rpc/sync_pull_collections')) {
    return reply([{ collections_json: profileCollections }]);
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

async function pushDad(options) {
  calls.length = 0;
  const result = await push.installSetup({
    uuid: '00000000-0000-4000-8000-000000000003', installToken: '00000000-0000-4000-8000-000000000003.secret',
    connection: { nuvioToken: 'token', nuvioSelectedProfile: 2 }, platform: 'nuvio', profileId: 2, internal: true,
    origin: 'https://lelibrary.example', port: 1, document: { collections: [], homeRows: [], sources: [] }, options,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return calls;
}
const written = (log, rpc) => log.filter((c) => c.url.endsWith(`/rpc/${rpc}`)).map((c) => c.body);

test('other collections on the profile are kept unless this push asks to remove them', async () => {
  profileCollections = [{ id: 'aiometadata-trending', folders: [] }, { id: 'collection-lelibrary-old', folders: [] }];
  const kept = written(await pushDad({}), 'sync_push_collections')[0].p_collections_json.map((c) => c.id);
  assert.deepEqual(kept, ['aiometadata-trending'], 'another addon\'s collection stays, LeLibrary\'s old one goes');
  const replaced = written(await pushDad({ replaceOtherCollections: true }), 'sync_push_collections')[0].p_collections_json.map((c) => c.id);
  assert.deepEqual(replaced, [], 'the tick box removes everything that is not this push');
  profileCollections = [{ id: 'collection-lelibrary-mums-setup', folders: [] }];
});

test('Hide unreleased reaches Nuvio on a push', async () => {
  const home = written(await pushDad({ nuvioHideUnreleased: true }), 'sync_push_home_catalog_settings');
  assert.ok(home.length > 0, 'the Home settings were written');
  assert.equal(home[0].p_settings_json.hide_unreleased_content, true);
});

test('a push never creates a settings blob (the phone app would reset its settings)', async () => {
  settingsBlob = null;
  const log = await pushDad({});
  assert.equal(written(log, 'sync_push_profile_settings_blob').length, 0);
  settingsBlob = { version: 4, features: { player_settings: { x: { type: 'boolean', value: true } } } };
  const withBlob = written(await pushDad({}), 'sync_push_profile_settings_blob');
  assert.ok(withBlob.length > 0, 'an existing blob is still updated');
  assert.deepEqual(withBlob[0].p_settings_json.features.player_settings.x, { type: 'boolean', value: true }, 'other settings kept');
  settingsBlob = null;
});

test('profiles are left alone unless the target still uses the main profile\'s addons', async () => {
  profileRows = [
    { profile_index: 1, name: 'Mum', avatar_id: 'cat-7', uses_primary_addons: false, profile_background_url: 'https://img.example/bg.jpg' },
    { profile_index: 2, name: 'Dad', uses_primary_addons: false },
  ];
  assert.equal(written(await pushDad({}), 'sync_push_profiles').length, 0, 'nothing to change, nothing written');
  profileRows[1].uses_primary_addons = true;
  const [sent] = written(await pushDad({}), 'sync_push_profiles');
  const mum = sent.p_profiles.find((p) => p.profile_index === 1);
  const dad = sent.p_profiles.find((p) => p.profile_index === 2);
  assert.equal(dad.uses_primary_addons, false);
  assert.equal(mum.avatar_id, 'cat-7', 'a picked avatar is kept');
  assert.equal('avatar_url' in mum, false, 'avatar_url is not sent when unset (it would clear avatar_id)');
  assert.equal(mum.profile_background_url, 'https://img.example/bg.jpg', 'backgrounds are kept');
  assert.equal(sent.p_client_max_profiles, 6);
  profileRows = [{ profile_index: 1, name: 'Mum', uses_primary_addons: false }, { profile_index: 2, name: 'Dad', uses_primary_addons: false }];
});

test('Home rows carry the key Nuvio mobile matches on (manifestId:type:catalogId)', async () => {
  manifestCatalogs = [{ type: 'movie', id: 'torbox-movies', name: 'My Movies' }];
  const [home] = written(await pushDad({}), 'sync_push_home_catalog_settings');
  const row = home.p_settings_json.items.find((i) => i.catalog_id === 'torbox-movies');
  assert.equal(row.key, 'community.lelibrary.test:movie:torbox-movies');
  assert.equal(row.addon_id, 'community.lelibrary.test');
  manifestCatalogs = [];
});
