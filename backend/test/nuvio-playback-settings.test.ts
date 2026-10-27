// @ts-nocheck
'use strict';
// Nuvio playback settings ride in the per-profile settings blob, under the
// player_settings feature. The merge must preserve every other feature and key
// because the Nuvio client clears the whole feature bucket before applying it.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalisePlaybackSettings,
  applyPlaybackSettingsToBlob,
  PLAYBACK_MODES,
} = require('../src/catalog/nuvio-playback-settings.ts');

const VALID = { mode: 'REGEX_MATCH', regex: '(2160p|4k|remux)', nextEpisode: true };

test('normalises a valid payload and trims the pattern', () => {
  assert.deepEqual(normalisePlaybackSettings(VALID), {
    mode: 'REGEX_MATCH',
    regex: '(2160p|4k|remux)',
    nextEpisode: true,
    onlyLeLibrary: false,
  });
  assert.deepEqual(normalisePlaybackSettings({ mode: 'MANUAL', regex: '   ', nextEpisode: false, onlyLeLibrary: true }), {
    mode: 'MANUAL',
    regex: '',
    nextEpisode: false,
    onlyLeLibrary: true,
  });
  assert.deepEqual(PLAYBACK_MODES, ['MANUAL', 'FIRST_STREAM', 'REGEX_MATCH']);
});

test('rejects unusable payloads instead of guessing', () => {
  assert.equal(normalisePlaybackSettings(null), null);
  assert.equal(normalisePlaybackSettings(undefined), null);
  assert.equal(normalisePlaybackSettings('nope'), null);
  assert.equal(normalisePlaybackSettings({ mode: 'AUTO' }), null);
  // Regex mode needs a pattern.
  assert.equal(normalisePlaybackSettings({ mode: 'REGEX_MATCH', regex: '  ' }), null);
  // Bounded so a pasted blob cannot grow without limit.
  assert.equal(normalisePlaybackSettings({ mode: 'MANUAL', regex: 'x'.repeat(301) }), null);
  assert.equal(normalisePlaybackSettings({ mode: 'MANUAL', regex: 'x'.repeat(300) }).regex.length, 300);
});

test('merges playback keys and preserves every other setting', () => {
  const blob = {
    version: 1,
    features: {
      theme_settings: { theme_id: { type: 'string', value: 'midnight' } },
      player_settings: {
        buffer_target_mb: { type: 'int', value: 64 },
        stream_auto_play_mode: { type: 'string', value: 'FIRST_STREAM' },
        stream_auto_play_regex: { type: 'string', value: 'old' },
      },
      tmdb_settings: { tmdb_enabled: { type: 'boolean', value: true } },
    },
  };

  const next = applyPlaybackSettingsToBlob(blob, VALID);

  assert.deepEqual(next.features.theme_settings, blob.features.theme_settings);
  assert.deepEqual(next.features.tmdb_settings, blob.features.tmdb_settings);
  assert.deepEqual(next.features.player_settings.buffer_target_mb, { type: 'int', value: 64 });
  assert.deepEqual(next.features.player_settings.stream_auto_play_mode, { type: 'string', value: 'REGEX_MATCH' });
  assert.deepEqual(next.features.player_settings.stream_auto_play_regex, { type: 'string', value: '(2160p|4k|remux)' });
  assert.deepEqual(next.features.player_settings.stream_auto_play_next_episode_enabled, { type: 'boolean', value: true });
  // The input blob is untouched.
  assert.equal(blob.features.player_settings.stream_auto_play_mode.value, 'FIRST_STREAM');
});

test('refuses to invent a player_settings bucket', () => {
  // Nuvio clears the feature bucket before applying, so a blob without one
  // means the client has never synced player settings: writing three keys
  // would wipe the rest of its player preferences.
  assert.equal(applyPlaybackSettingsToBlob({ version: 1, features: {} }, VALID), null);
  assert.equal(applyPlaybackSettingsToBlob({ version: 1, features: { player_settings: null } }, VALID), null);
  assert.equal(applyPlaybackSettingsToBlob(null, VALID), null);
});

test('a blob with an empty player_settings bucket is safe to fill', () => {
  const next = applyPlaybackSettingsToBlob({ version: 1, features: { player_settings: {} } }, VALID);
  assert.equal(next.features.player_settings.stream_auto_play_mode.value, 'REGEX_MATCH');
});

export interface NuvioPlaybackSettingsTestModule {}

test('only LeLibrary: limits auto-play to the LeLibrary addon, and switching it off undoes only that', () => {
  const blob = { version: 1, features: { player_settings: { other: { type: 'boolean', value: true } } } };
  const on = applyPlaybackSettingsToBlob(blob, normalisePlaybackSettings({ mode: 'FIRST_STREAM', onlyLeLibrary: true }));
  const player = on.features.player_settings;
  assert.deepEqual(player.stream_auto_play_source, { type: 'string', value: 'INSTALLED_ADDONS_ONLY' });
  assert.deepEqual(player.stream_auto_play_selected_addons, { type: 'string_set', value: ['LeLibrary'] });
  assert.deepEqual(player.other, { type: 'boolean', value: true }, 'other player keys survive');

  const off = applyPlaybackSettingsToBlob(on, normalisePlaybackSettings({ mode: 'FIRST_STREAM' })).features.player_settings;
  assert.deepEqual(off.stream_auto_play_source, { type: 'string', value: 'ALL_SOURCES' });
  assert.deepEqual(off.stream_auto_play_selected_addons, { type: 'string_set', value: [] });

  const mine = { version: 1, features: { player_settings: {
    stream_auto_play_source: { type: 'string', value: 'INSTALLED_ADDONS_ONLY' },
    stream_auto_play_selected_addons: { type: 'string_set', value: ['LeLibrary', 'Torrentio'] },
  } } };
  const kept = applyPlaybackSettingsToBlob(mine, normalisePlaybackSettings({ mode: 'FIRST_STREAM' })).features.player_settings;
  assert.deepEqual(kept.stream_auto_play_selected_addons.value, ['LeLibrary', 'Torrentio'], 'a choice made in Nuvio is left alone');
});
