// @ts-nocheck
'use strict';
// The editor config endpoint pre-fills pickers from saved structural config.
// It must never leak secrets: keys live in a separate sealed column and the
// view picks the config envelope only.
const test = require('node:test');
const assert = require('node:assert/strict');

const { editorConfigView } = require('../src/routes/setup.ts');

function opened(config, keys) {
  return {
    uuid: 'f9ac0919-3b58-40f5-a6be-84be362d63fe',
    tier: 'quick',
    name: 'Living room',
    hasPassword: true,
    secret: 'synthetic-secret',
    config,
    keys,
    createdAt: null,
    updatedAt: null,
  };
}

test('editor config view returns the structural config only', () => {
  const view = editorConfigView(opened(
    { streamPreset: 'cinema', posterProvider: 'pictorium', nuvioBadgePack: 'nard-full' },
    { torboxApiKey: 'real-torbox-key', tmdbApiKey: 'real-tmdb-key' },
  ));
  assert.deepEqual(view, {
    config: { streamPreset: 'cinema', posterProvider: 'pictorium', nuvioBadgePack: 'nard-full' },
  });
});

test('editor config view never carries keys, secrets or hashes', () => {
  const raw = JSON.stringify(editorConfigView(opened(
    { streamPreset: 'cinema' },
    { torboxApiKey: 'real-torbox-key' },
  )));
  assert.ok(!raw.includes('real-torbox-key'));
  assert.ok(!raw.includes('synthetic-secret'));
  assert.ok(!raw.includes('torboxApiKey'));
});

test('editor config view tolerates a missing config envelope', () => {
  assert.deepEqual(editorConfigView(opened(null, {})), { config: {} });
  assert.deepEqual(editorConfigView(opened(undefined, {})), { config: {} });
});
