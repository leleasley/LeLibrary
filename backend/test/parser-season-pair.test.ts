// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');

const { guessMediaInfo } = require('../src/media/parser.ts');

test('"S1.S9" style season pairs are read as a pack range', () => {
  for (const [name, start, end, title] of [
    ['Chicago PD S1.S9 720p Dual YG', 1, 9, 'Chicago Pd'],
    ['Chicago.PD.S01.S09.720p.WEB-DL', 1, 9, 'Chicago Pd'],
    ['Show Name S01 S03 S05 S09 1080p', 1, 9, 'Show Name'],
  ]) {
    const info = guessMediaInfo(name);
    assert.equal(info.isSeries, true, name);
    assert.equal(info.seasonStart, start, name);
    assert.equal(info.seasonEnd, end, name);
    assert.equal(info.title, title, name);
  }
});

test('season pairs never override an episode marker or a descending pair', () => {
  assert.equal(guessMediaInfo('Show.S01.S02.E05.720p').seasonEnd, null);
  assert.equal(guessMediaInfo('Show.S03.S01.720p').seasonStart, null);
  assert.equal(guessMediaInfo('Show.S03.S01.720p').season, 3);
  assert.equal(guessMediaInfo('Show S01E02 S03 720p').episode, 2);
  assert.equal(guessMediaInfo('Chicago.P.D.S11.1080p.AMZN.WEB-DL').season, 11);
});
