// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const { isGenericEpisodeName } = require('../src/releases/episode-label.ts');

test('generic numbering names are generic', () => {
  for (const name of ['Episode 25', 'episode 1', 'EPISODE  25', 'Ep. 25', 'Ep 25', 'Chapter 3', 'Part 2', 'Episode #25']) {
    assert.equal(isGenericEpisodeName(name), true, name);
  }
});

test('date-shaped names are generic', () => {
  for (const name of [
    '2026-10-08',
    '10/08/2026',
    '10-08-2026',
    '8.10.2026',
    'Thursday, October 8, 2026',
    'October 8, 2026',
    'Oct 8, 2026',
    '8 October 2026',
    '8th October 2026',
  ]) {
    assert.equal(isGenericEpisodeName(name), true, name);
  }
});

test('empty and non-string names are generic', () => {
  assert.equal(isGenericEpisodeName(''), true);
  assert.equal(isGenericEpisodeName('   '), true);
  assert.equal(isGenericEpisodeName(null), true);
  assert.equal(isGenericEpisodeName(undefined), true);
  assert.equal(isGenericEpisodeName(25), true);
});

test('real episode titles are not generic', () => {
  for (const name of [
    'Kicking Down Doors',
    'The One Where Monica Gets a Roommate',
    'Jungle Classroom',
    'New Blood',
    'Halloween',
    'Episode of the Living Dead', // contains "Episode" but is a real title
    'The 100',
    'Partners in Crime',
  ]) {
    assert.equal(isGenericEpisodeName(name), false, name);
  }
});
