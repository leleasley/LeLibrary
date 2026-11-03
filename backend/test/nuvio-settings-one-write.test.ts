// @ts-nocheck
'use strict';
// A Nuvio push changes the per-profile settings blob (badges, TMDB enrichment,
// playback) in ONE read-modify-write per platform: read once, apply every
// feature to the same document, write once, and skip the write when nothing
// changed. The resulting blob must match what the old three separate
// read-modify-writes produced (`legacyResult` below replays that sequence with
// the same pure helpers). No network: axios is a fake Nuvio store, and the
// origin and badge URLs are IP literals so the badge fetch needs no DNS.
const test = require('node:test');
const assert = require('node:assert/strict');

const badgePacks = require('../src/catalog/nuvio-badge-packs.ts');
const playbackSettings = require('../src/catalog/nuvio-playback-settings.ts');

const ORIGIN = 'https://203.0.113.10';
const LOCAL_BADGES = `${ORIGIN}${badgePacks.LOCAL_PATH}`;
const CUSTOM_BADGES = 'https://203.0.113.20/badges.json';
const BROKEN_BADGES = 'https://203.0.113.30/not-badges.json';
const MANIFESTS = {
  [LOCAL_BADGES]: { filters: [{ id: 'uhd', pattern: '2160p', imageURL: 'https://img.example/4k.png' }], groups: [{ id: 'q', name: 'Quality' }] },
  [CUSTOM_BADGES]: { filters: [{ id: 'hdr', pattern: 'HDR', imageURL: 'https://img.example/hdr.png' }], groups: [] },
  [BROKEN_BADGES]: { nothing: true },
};

const clone = (v) => JSON.parse(JSON.stringify(v));
let store = {};
const calls = [];
const reply = (data) => Promise.resolve({ status: 200, data });
function fakeAxios(config) {
  calls.push({ method: String(config.method || 'GET').toUpperCase(), url: String(config.url), body: config.data });
  return reply([]);
}
fakeAxios.get = (url) => {
  calls.push({ method: 'GET', url: String(url) });
  if (/manifest\.json/.test(url)) return reply({ id: 'community.lelibrary.test', name: 'LeLibrary', catalogs: [] });
  if (Object.prototype.hasOwnProperty.call(MANIFESTS, url)) return reply(clone(MANIFESTS[url]));
  return reply([]);
};
fakeAxios.post = (url, body) => {
  calls.push({ method: 'POST', url: String(url), body: clone(body ?? null) });
  if (url.endsWith('/rpc/sync_pull_profiles')) return reply([{ profile_index: 1, name: 'Mum', uses_primary_addons: false }, { profile_index: 2, name: 'Dad', uses_primary_addons: false }]);
  if (url.endsWith('/rpc/get_sync_owner')) return reply(['owner-1']);
  if (url.endsWith('/rpc/sync_pull_profile_settings_blob')) {
    const blob = store[body.p_profile_id]?.[body.p_platform];
    return reply(blob === undefined ? [] : [{ settings_json: clone(blob) }]);
  }
  if (url.endsWith('/rpc/sync_push_profile_settings_blob')) {
    store[body.p_profile_id] = store[body.p_profile_id] || {};
    store[body.p_profile_id][body.p_platform] = clone(body.p_settings_json);
    return reply(null);
  }
  return reply([]);
};
require.cache[require.resolve('axios')] = { id: 'axios', filename: 'axios', loaded: true, exports: fakeAxios };
const push = require('../src/setup/push.ts');

// The old push: badges, then TMDB enrichment, then playback, each pulling the
// blob the previous step wrote. Every step skipped a missing blob; playback
// also skipped a blob without a player_settings bucket.
function legacyResult(blob, { badgeUrl = null, playback = null } = {}) {
  if (!blob || typeof blob !== 'object') return blob;
  let next = blob;
  if (badgeUrl) {
    let badgeImport = null;
    try { badgeImport = badgePacks.buildBadgeImport(MANIFESTS[badgeUrl], badgeUrl); } catch { badgeImport = null; }
    if (badgeImport && MANIFESTS[badgeUrl] && Array.isArray(MANIFESTS[badgeUrl].filters)) next = badgePacks.applyBadgeImportToBlob(next, badgeImport);
  }
  next = badgePacks.enableTmdbEnrichmentInBlob(next);
  const played = playbackSettings.applyPlaybackSettingsToBlob(next, playbackSettings.normalisePlaybackSettings(playback));
  return played || next;
}

async function pushDad(options) {
  calls.length = 0;
  const result = await push.installSetup({
    uuid: '00000000-0000-4000-8000-000000000008', installToken: '00000000-0000-4000-8000-000000000008.secret',
    connection: { nuvioToken: 'token', nuvioSelectedProfile: 2 }, platform: 'nuvio', profileId: 2, internal: true,
    origin: ORIGIN, port: 1, document: { collections: [], homeRows: [], sources: [] }, options: push.pushOptionsFromConfig(options),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return calls.slice();
}
const settingsCalls = (log, rpc) => log.filter((c) => c.url.endsWith(`/rpc/${rpc}`)).map((c) => c.body);

const FULL_BLOB = {
  version: 1,
  features: {
    theme_settings: { theme_id: { type: 'string', value: 'midnight' } },
    tmdb_settings: { tmdb_language: { type: 'string', value: 'es' }, tmdb_enabled: { type: 'boolean', value: false } },
    stream_badge_settings: { stream_badge_rules: { type: 'string', value: '{"imports":[]}' }, badge_size: { type: 'int', value: 2 } },
    player_settings: {
      buffer_target_mb: { type: 'int', value: 64 },
      stream_auto_play_source: { type: 'string', value: 'INSTALLED_ADDONS_ONLY' },
      stream_auto_play_selected_addons: { type: 'string_set', value: ['LeLibrary'] },
    },
  },
};
const NO_PLAYER_BLOB = { version: 1, features: { theme_settings: { theme_id: { type: 'string', value: 'ocean' } } } };
const MUM_BLOB = { version: 1, features: { tmdb_settings: { tmdb_enabled: { type: 'boolean', value: false } } } };

const CASES = [
  {
    name: 'default badge pack, no playback choice',
    config: {},
    blobs: { tv: FULL_BLOB, mobile: NO_PLAYER_BLOB },
    expect: { badgeUrl: LOCAL_BADGES, playback: null },
  },
  {
    name: 'custom badges, playback with only-LeLibrary',
    config: { nuvioBadgePack: 'custom', nuvioBadgeUrl: CUSTOM_BADGES, nuvioPlayback: { mode: 'REGEX_MATCH', regex: '(2160p|4k)', nextEpisode: true, onlyLeLibrary: true } },
    blobs: { tv: FULL_BLOB, mobile: { version: 1, features: { player_settings: {} } } },
    expect: { badgeUrl: CUSTOM_BADGES, playback: { mode: 'REGEX_MATCH', regex: '(2160p|4k)', nextEpisode: true, onlyLeLibrary: true } },
  },
  {
    name: 'broken badge pack still writes TMDB and playback',
    config: { nuvioBadgePack: 'custom', nuvioBadgeUrl: BROKEN_BADGES, nuvioPlayback: { mode: 'FIRST_STREAM' } },
    blobs: { tv: FULL_BLOB, mobile: NO_PLAYER_BLOB },
    expect: { badgeUrl: BROKEN_BADGES, playback: { mode: 'FIRST_STREAM' } },
  },
  {
    name: 'no badge URL, missing TV blob, mobile blob without features',
    config: { nuvioBadgePack: 'custom', nuvioBadgeUrl: '', nuvioPlayback: { mode: 'MANUAL' } },
    blobs: { mobile: { version: 1 } },
    expect: { badgeUrl: null, playback: { mode: 'MANUAL' } },
  },
];

for (const c of CASES) {
  test(`one settings write per platform matches the old three writes: ${c.name}`, async () => {
    store = { 1: { tv: clone(MUM_BLOB), mobile: clone(MUM_BLOB) }, 2: clone(c.blobs) };
    const log = await pushDad(c.config);

    for (const platform of badgePacks.SETTINGS_PLATFORMS) {
      const expected = legacyResult(c.blobs[platform], c.expect);
      assert.deepEqual(store[2][platform], expected, `${platform} blob matches the old result`);
      const pulls = settingsCalls(log, 'sync_pull_profile_settings_blob').filter((b) => b.p_platform === platform);
      const writes = settingsCalls(log, 'sync_push_profile_settings_blob').filter((b) => b.p_platform === platform);
      assert.equal(pulls.length, 1, `${platform}: one settings read`);
      assert.ok(writes.length <= 1, `${platform}: at most one settings write`);
      // A missing blob is never created.
      if (c.blobs[platform] === undefined) assert.equal(writes.length, 0, `${platform}: no blob, no write`);
    }
    // Only the target profile is read or written.
    for (const body of [...settingsCalls(log, 'sync_pull_profile_settings_blob'), ...settingsCalls(log, 'sync_push_profile_settings_blob')]) {
      assert.equal(body.p_profile_id, 2);
    }
    assert.deepEqual(store[1], { tv: MUM_BLOB, mobile: MUM_BLOB }, 'the other profile is untouched');
  });
}

test('a second identical push reads the blobs but writes nothing', async () => {
  const config = { nuvioPlayback: { mode: 'FIRST_STREAM', nextEpisode: true } };
  store = { 2: { tv: clone(FULL_BLOB), mobile: clone(NO_PLAYER_BLOB) } };
  await pushDad(config);
  const after = clone(store[2]);
  const log = await pushDad(config);
  assert.equal(settingsCalls(log, 'sync_pull_profile_settings_blob').length, 2);
  assert.equal(settingsCalls(log, 'sync_push_profile_settings_blob').length, 0);
  assert.deepEqual(store[2], after);
});

test('no blob on either platform: nothing is created', async () => {
  store = { 2: {} };
  const log = await pushDad({ nuvioPlayback: { mode: 'FIRST_STREAM' } });
  assert.equal(settingsCalls(log, 'sync_pull_profile_settings_blob').length, 2);
  assert.equal(settingsCalls(log, 'sync_push_profile_settings_blob').length, 0);
  assert.deepEqual(store[2], {});
});

test('a step that throws is left out and the others are still written', async () => {
  const writes = [];
  const rpc = async (_token, path, params) => {
    if (path.endsWith('sync_pull_profile_settings_blob')) return [{ settings_json: { version: 1, features: {} } }];
    writes.push(params);
    return null;
  };
  const boom = { name: 'broken', apply: () => { throw new Error('bad step'); } };
  const mark = { name: 'mark', apply: (blob) => ({ ...blob, marked: true }) };
  await push.syncNuvioProfileSettings('token', 3, [boom, null, mark], 'uuid-key', { rpc, platforms: ['tv'] });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].p_profile_id, 3);
  assert.deepEqual(writes[0].p_settings_json, { version: 1, features: {}, marked: true });
});

test('a failed write on one platform does not stop the next, and never throws', async () => {
  const pulls = [];
  const rpc = async (_token, path, params) => {
    if (path.endsWith('sync_pull_profile_settings_blob')) { pulls.push(params.p_platform); return [{ settings_json: { version: 1 } }]; }
    if (params.p_platform === 'tv') throw new Error('rpc down');
    return null;
  };
  const mark = { name: 'mark', apply: (blob) => ({ ...blob, marked: true }) };
  await assert.doesNotReject(() => push.syncNuvioProfileSettings('token', 1, [mark], 'uuid-key', { rpc }));
  assert.deepEqual(pulls, ['tv', 'mobile']);
});

test('no steps means no Nuvio calls at all', async () => {
  let called = 0;
  await push.syncNuvioProfileSettings('token', 1, [null], 'uuid-key', { rpc: async () => { called++; return []; } });
  assert.equal(called, 0);
});

export interface NuvioSettingsOneWriteTestModule {}
