'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatStreamName } = require('../src/catalog/builder.ts');

const FILE = 'Movie.2024.1080p.WEB-DL.mkv';

test('a named style ignores templates left over from an old custom style', () => {
  const stale = { streamPreset: 'lelibrary', streamNameTemplate: 'OLDCUSTOM {addon.name}' };
  assert.doesNotMatch(String(formatStreamName(FILE, 'torbox', 1e9, stale, 'LeLibrary')), /OLDCUSTOM/);
});

test('the Custom style uses the saved templates', () => {
  const custom = { streamPreset: 'custom', streamNameTemplate: 'MYSTYLE {addon.name}' };
  assert.match(String(formatStreamName(FILE, 'torbox', 1e9, custom, 'LeLibrary')), /MYSTYLE/);
});

export interface StreamTemplatesPresetTestModule {};
