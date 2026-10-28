// @ts-nocheck
// The Nuvio settings mapping: TV and phone key names and exact types, and the
// rule that a blob or group is never created and nothing else is touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const map = require('../src/nuvio/settings-map.ts');

function tvBlob() {
  return {
    version: 1,
    features: {
      player_settings: {
        stream_auto_play_mode: { type: 'string', value: 'MANUAL' },
        subtitle_preferred_language: { type: 'string', value: 'en' },
        stream_auto_play_timeout_seconds: { type: 'int', value: 3 },
        auto_skip_segment_types: { type: 'string_set', value: ['movie-credits', 'intro'] },
        some_unknown_key: { type: 'long', value: 12 },
      },
      layout_settings: { hide_unreleased_content: { type: 'boolean', value: false }, selected_layout: { type: 'string', value: 'GRID' } },
      track_preference: { 'sub_lang|tt1': { type: 'string', value: 'en' } },
    },
  };
}

function mobileBlob() {
  return {
    version: 4,
    features: {
      player_settings: {
        preferred_subtitle_language: { type: 'string', value: 'none' },
        stream_auto_play_prefer_binge_group: { type: 'boolean', value: true },
      },
      poster_card_style_settings_payload: '{"a":1}',
      notifications_settings: { episode_release_alerts_enabled: true },
    },
  };
}

const ALL_VALUES = {
  autoPlayMode: 'REGEX_MATCH',
  autoPlayRegex: '(?i)2160p',
  autoPlaySource: 'INSTALLED_ADDONS_ONLY',
  autoPlayTimeout: -1,
  nextEpisode: true,
  preloadNextEpisode: true,
  nextEpisodeThresholdMode: 'MINUTES_BEFORE_END',
  nextEpisodeThresholdPercent: 98.5,
  nextEpisodeThresholdMinutes: 1.5,
  stillWatching: true,
  stillWatchingEpisodes: 4,
  skipSegments: ['outro', 'intro'],
  audioLanguage: 'en',
  audioLanguage2: 'ja',
  subtitleLanguage: 'pt-br',
  subtitleLanguage2: 'es',
  forcedSubtitles: true,
  hideUnreleased: true,
};

test('every setting validates and round-trips through the TV blob with TV key names and types', () => {
  const { values, errors } = map.normaliseValues(ALL_VALUES);
  assert.deepEqual(errors, []);
  const { blob } = map.applySettings(tvBlob(), 'tv', values);
  const player = blob.features.player_settings;
  assert.deepEqual(player.subtitle_preferred_language, { type: 'string', value: 'pt-br' });
  assert.deepEqual(player.subtitle_secondary_language, { type: 'string', value: 'es' });
  assert.equal('preferred_subtitle_language' in player, false, 'the phone key is never written to the TV blob');
  assert.deepEqual(player.stream_auto_play_timeout_seconds, { type: 'int', value: 2147483647 }, 'unlimited is the int sentinel');
  assert.deepEqual(player.next_episode_threshold_percent_v2, { type: 'float', value: 98.5 });
  assert.deepEqual(player.still_watching_episode_threshold, { type: 'int', value: 4 });
  assert.deepEqual(player.auto_skip_segment_types, { type: 'string_set', value: ['intro', 'movie-credits', 'outro'] }, 'sorted, movie-credits kept');
  assert.deepEqual(blob.features.layout_settings.hide_unreleased_content, { type: 'boolean', value: true });
  const back = map.readBlob(blob, 'tv');
  assert.deepEqual(back, { ...ALL_VALUES, skipSegments: ['intro', 'outro'] });
});

test('the phone blob uses its own key names and has no TV-only keys', () => {
  const { values } = map.normaliseValues(ALL_VALUES);
  const { blob, changed } = map.applySettings(mobileBlob(), 'mobile', values);
  const player = blob.features.player_settings;
  assert.deepEqual(player.preferred_subtitle_language, { type: 'string', value: 'pt-br' });
  assert.deepEqual(player.secondary_preferred_subtitle_language, { type: 'string', value: 'es' });
  assert.equal('subtitle_preferred_language' in player, false);
  assert.equal('still_watching_enabled' in player, false, 'TV only');
  assert.equal('layout_settings' in blob.features, false, 'no group is created');
  assert.ok(!changed.includes('hideUnreleased') && !changed.includes('stillWatching'));
  const back = map.readBlob(blob, 'mobile');
  const { stillWatching, stillWatchingEpisodes, hideUnreleased, ...mobileOnly } = ALL_VALUES;
  assert.deepEqual(back, { ...mobileOnly, skipSegments: ['intro', 'outro'] });
});

test('every other key, group and the version stay byte for byte', () => {
  const before = tvBlob();
  const { blob } = map.applySettings(before, 'tv', { autoPlayMode: 'FIRST_STREAM' });
  assert.equal(blob.version, 1);
  assert.equal(JSON.stringify(blob.features.track_preference), JSON.stringify(before.features.track_preference));
  assert.equal(JSON.stringify(blob.features.layout_settings), JSON.stringify(before.features.layout_settings));
  const { stream_auto_play_mode: a, ...restAfter } = blob.features.player_settings;
  const { stream_auto_play_mode: b, ...restBefore } = before.features.player_settings;
  assert.equal(JSON.stringify(restAfter), JSON.stringify(restBefore));
  assert.deepEqual(a, { type: 'string', value: 'FIRST_STREAM' });
  assert.equal(before.features.player_settings.stream_auto_play_mode.value, 'MANUAL', 'the input is not mutated');
  const mobile = mobileBlob();
  const out = map.applySettings(mobile, 'mobile', { forcedSubtitles: true }).blob;
  assert.equal(out.features.poster_card_style_settings_payload, '{"a":1}');
  assert.deepEqual(out.features.notifications_settings, { episode_release_alerts_enabled: true });
  assert.equal(out.version, 4);
});

test('a blob or group that does not exist is never created', () => {
  assert.equal(map.applySettings(null, 'tv', { autoPlayMode: 'MANUAL' }).blob, null);
  assert.equal(map.applySettings({ version: 1 }, 'mobile', { autoPlayMode: 'MANUAL' }).blob, null);
  const noPlayer = { version: 1, features: { theme_settings: {} } };
  const result = map.applySettings(noPlayer, 'tv', { autoPlayMode: 'MANUAL', hideUnreleased: true });
  assert.deepEqual(result.blob, noPlayer);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.skipped.sort(), ['autoPlayMode', 'hideUnreleased']);
});

test('an empty language removes the key so each app uses its own default', () => {
  const blob = map.applySettings(tvBlob(), 'tv', { subtitleLanguage: '' }).blob;
  assert.equal('subtitle_preferred_language' in blob.features.player_settings, false);
  assert.equal(map.readBlob(blob, 'tv').subtitleLanguage, undefined);
});

test('reading: only keys present, wrong types skipped, unlimited and legacy timeouts read as -1', () => {
  const values = map.readSettings(tvBlob(), mobileBlob());
  assert.equal(values.autoPlayMode, 'MANUAL');
  assert.equal(values.subtitleLanguage, 'en', 'the TV value wins where both exist');
  assert.equal(values.nextEpisode, undefined);
  assert.deepEqual(values.skipSegments, ['intro']);
  const legacy = { features: { player_settings: { stream_auto_play_timeout_seconds: { type: 'int', value: 11 }, stream_auto_play_mode: { type: 'int', value: 1 } } } };
  const read = map.readBlob(legacy, 'tv');
  assert.equal(read.autoPlayTimeout, -1);
  assert.equal(read.autoPlayMode, undefined, 'a wrong type tag is skipped');
  assert.deepEqual(map.readSettings(null, mobileBlob()).subtitleLanguage, 'none', 'phone fills in without a TV blob');
});

test('invalid values and unknown ids are refused', () => {
  const { errors } = map.normaliseValues({
    autoPlayMode: 'SOMETIMES', autoPlayTimeout: 12, nextEpisodeThresholdPercent: 96, nextEpisodeThresholdMinutes: 0.25,
    stillWatchingEpisodes: 7, skipSegments: ['credits'], audioLanguage: 'english please', nextEpisode: 'yes', themeColour: 'red',
    autoPlaySource: 'ENABLED_PLUGINS_ONLY',
  });
  assert.deepEqual(errors.sort(), ['audioLanguage', 'autoPlayMode', 'autoPlaySource', 'autoPlayTimeout', 'nextEpisode', 'nextEpisodeThresholdMinutes', 'nextEpisodeThresholdPercent', 'skipSegments', 'stillWatchingEpisodes', 'themeColour'].sort());
  assert.deepEqual(map.normaliseValues('x').errors, ['values']);
});

test('the mapping table has the renamed subtitle keys', () => {
  assert.equal(map.mappedKey('subtitleLanguage', 'tv').key, 'subtitle_preferred_language');
  assert.equal(map.mappedKey('subtitleLanguage', 'mobile').key, 'preferred_subtitle_language');
  assert.equal(map.mappedKey('subtitleLanguage2', 'tv').key, 'subtitle_secondary_language');
  assert.equal(map.mappedKey('subtitleLanguage2', 'mobile').key, 'secondary_preferred_subtitle_language');
  assert.equal(map.mappedKey('stillWatching', 'mobile'), null);
  assert.equal(map.mappedKey('hideUnreleased', 'tv').group, 'layout_settings');
});
