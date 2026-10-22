// @ts-nocheck
'use strict';
// The playback sync writes Nuvio's player_settings bucket for each platform.
// It must preserve the rest of the blob, skip a platform with no bucket, and
// never throw into the addon push.
const test = require('node:test');
const assert = require('node:assert/strict');

const { syncNuvioPlaybackSettings, pushOptionsFromConfig } = require('../src/setup/push.ts');

const SETTINGS = { mode: 'REGEX_MATCH', regex: '(2160p|4k)', nextEpisode: true };

function fakeRpc({ tvBlob = null, mobileBlob = null, throwPlatform = null } = {}) {
  const calls = [];
  const rpc = async (_token, path, params) => {
    calls.push({ path, params });
    if (path.endsWith('sync_pull_profile_settings_blob')) {
      if (throwPlatform && params.p_platform === throwPlatform) throw new Error('rpc down');
      const blob = params.p_platform === 'tv' ? tvBlob : mobileBlob;
      return blob ? [{ settings_json: blob }] : [];
    }
    return null;
  };
  return { rpc, calls };
}

const TV_BLOB = {
  version: 1,
  features: {
    theme_settings: { theme_id: { type: 'string', value: 'midnight' } },
    player_settings: {
      buffer_target_mb: { type: 'int', value: 64 },
    },
  },
};

test('writes only platforms that already have player settings', async () => {
  const { rpc, calls } = fakeRpc({ tvBlob: TV_BLOB, mobileBlob: null });

  await syncNuvioPlaybackSettings('token', 2, SETTINGS, 'uuid-key', { rpc });

  const pulls = calls.filter((call) => call.path.endsWith('sync_pull_profile_settings_blob'));
  const pushes = calls.filter((call) => call.path.endsWith('sync_push_profile_settings_blob'));
  assert.equal(pulls.length, 2);
  assert.equal(pushes.length, 1);

  const pushed = pushes[0].params;
  assert.equal(pushed.p_profile_id, 2);
  assert.equal(pushed.p_platform, 'tv');
  const player = pushed.p_settings_json.features.player_settings;
  assert.deepEqual(player.stream_auto_play_mode, { type: 'string', value: 'REGEX_MATCH' });
  assert.deepEqual(player.stream_auto_play_regex, { type: 'string', value: '(2160p|4k)' });
  assert.deepEqual(player.stream_auto_play_next_episode_enabled, { type: 'boolean', value: true });
  // Everything else survives.
  assert.deepEqual(player.buffer_target_mb, { type: 'int', value: 64 });
  assert.deepEqual(pushed.p_settings_json.features.theme_settings, TV_BLOB.features.theme_settings);
});

test('updates both platforms when both buckets exist', async () => {
  const mobileBlob = { version: 1, features: { player_settings: {} } };
  const { rpc, calls } = fakeRpc({ tvBlob: TV_BLOB, mobileBlob });

  await syncNuvioPlaybackSettings('token', 1, SETTINGS, 'uuid-key', { rpc });

  const pushes = calls.filter((call) => call.path.endsWith('sync_push_profile_settings_blob'));
  assert.deepEqual(pushes.map((call) => call.params.p_platform).sort(), ['mobile', 'tv']);
});

test('a platform failure never escapes into the addon push', async () => {
  const { rpc, calls } = fakeRpc({ tvBlob: TV_BLOB, throwPlatform: 'tv' });

  await assert.doesNotReject(() => syncNuvioPlaybackSettings('token', 1, SETTINGS, 'uuid-key', { rpc }));
  // The mobile pull still ran.
  assert.equal(calls.filter((call) => call.path.endsWith('sync_pull_profile_settings_blob')).length, 2);
});

test('config parsing feeds the push options and does not guess a mode', () => {
  const parsed = pushOptionsFromConfig({
    hideAnime: true,
    nuvioBadgePack: 'elite',
    nuvioBadgeUrl: 'https://example.com/b.json',
    nuvioPlayback: { mode: 'FIRST_STREAM', regex: '', nextEpisode: true },
    nuvioHideUnreleased: true,
  });
  assert.deepEqual(parsed, {
    hideAnime: true,
    badgePack: 'elite',
    badgeUrl: 'https://example.com/b.json',
    nuvioPlayback: { mode: 'FIRST_STREAM', regex: '', nextEpisode: true },
    nuvioHideUnreleased: true,
  });

  // No stored choice leaves Nuvio alone; an invalid one is ignored, not defaulted.
  assert.equal(pushOptionsFromConfig({}).nuvioPlayback, null);
  assert.equal(pushOptionsFromConfig({ nuvioPlayback: { mode: 'AUTO' } }).nuvioPlayback, null);
  assert.equal(pushOptionsFromConfig({}).nuvioHideUnreleased, null);
  assert.equal(pushOptionsFromConfig({ nuvioHideUnreleased: 'yes' }).nuvioHideUnreleased, null);
  assert.equal(pushOptionsFromConfig({ nuvioHideUnreleased: false }).nuvioHideUnreleased, false);
});

test('no settings means no Nuvio calls at all', async () => {
  const { rpc, calls } = fakeRpc({ tvBlob: TV_BLOB });
  await syncNuvioPlaybackSettings('token', 1, null, 'uuid-key', { rpc });
  assert.equal(calls.length, 0);
});

export interface NuvioPlaybackPushTestModule {}
