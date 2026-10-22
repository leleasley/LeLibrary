// @ts-nocheck
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const aliases = require('../src/media/title-aliases.ts');
const sceneMap = require('../src/media/scene-mapping.ts');

test('title aliases map short release names to canonical titles', () => {
  assert.equal(aliases.resolveAlias('Raw'), 'WWE Raw');
  assert.equal(aliases.resolveAlias('WWE Raw'), 'WWE Raw');
  assert.equal(aliases.resolveAlias('Monday Night Raw'), 'WWE Raw');
  assert.equal(aliases.resolveAlias('Smackdown'), 'WWE SmackDown');
  assert.equal(aliases.resolveAlias('Friday Night SmackDown'), 'WWE SmackDown');
  assert.equal(aliases.resolveAlias('WWE SmackDown Live'), 'WWE SmackDown');
  assert.equal(aliases.resolveAlias('Some Unrelated Show'), null);
});

test('show aliases never apply to movie searches', () => {
  assert.equal(aliases.resolveAlias('Raw', 'movie'), null);
  assert.equal(aliases.resolveAlias('Smackdown', 'movie'), null);
});

test('title alias lookup ignores punctuation, case and "&" vs "and"', () => {
  const { normalizeTitle } = aliases;
  assert.equal(normalizeTitle('WWE: Raw!'), 'wweraw');
  assert.equal(normalizeTitle('Law & Order'), normalizeTitle('Law and Order'));
  assert.equal(aliases.resolveAlias('  raw  '), 'WWE Raw');
});

test('operator aliases can be layered over the defaults', () => {
  aliases.setAliases({ 'the office uk': 'The Office' });
  assert.equal(aliases.resolveAlias('The Office UK'), 'The Office');
  // Built-ins survive a merge.
  assert.equal(aliases.resolveAlias('Raw'), 'WWE Raw');
});

test('scene mapping keeps only real renames', () => {
  const map = sceneMap.buildMap([
    { title: 'CSI Las Vegas', searchTitle: 'CSI' },
    { title: 'Same Title', searchTitle: 'Same Title' },
    { title: 'BBC QI XL (Quite Interesting)', searchTitle: 'BBC QI XL' },
    { title: 'Empty Search', searchTitle: '' },
    { title: '', searchTitle: 'No Key' },
    { title: 'Bad', searchTitle: 42 },
  ]);
  assert.equal(map.size, 2);
  assert.equal(map.get(aliases.normalizeTitle('CSI Las Vegas')), 'CSI');
  assert.equal(map.get(aliases.normalizeTitle('BBC QI XL (Quite Interesting)')), 'BBC QI XL');
  assert.equal(map.has(aliases.normalizeTitle('Same Title')), false);
});

test('alternative titles (AKAs) score below an exact primary title', () => {
  const { titleScore } = require('../src/media/tmdb.ts');
  assert.equal(titleScore('Raw', { name: 'Raw' }), 100);
  assert.equal(titleScore('Raw', { name: 'WWE Raw', alternativeTitles: ['Raw'] }), 95);
  assert.equal(titleScore('Harry Potter and the Sorcerers Stone', {
    name: "Harry Potter and the Philosopher's Stone",
    alternativeTitles: ["Harry Potter and the Sorcerer's Stone"],
  }), 95);
  // Without alternative titles the original scoring is unchanged.
  assert.equal(titleScore('Raw', { name: 'WWE Raw' }), 65);
});

export interface TitleMatchingTestTestModule {};
