// @ts-nocheck
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { guessMediaInfo } = require('../src/media/parser.ts');
const { episodeTitleMatches } = require('../src/catalog/builder.ts');

test('parser extracts the episode title that follows SxxExx', () => {
  assert.equal(guessMediaInfo('The.Last.of.Us.S01E03.Long.Long.Time.1080p.WEB-DL.x264').episodeTitle, 'Long Long Time');
  assert.equal(guessMediaInfo('Show.Name.S02E10.The.Reckoning.2160p').episodeTitle, 'The Reckoning');
  // No title between the episode marker and the technical tokens.
  assert.equal(guessMediaInfo('Show.Name.S01E03.1080p.WEB-DL').episodeTitle, null);
  // A bare number is not a title.
  assert.equal(guessMediaInfo('Show.Name.S01E03.2024.1080p').episodeTitle, null);
  // Movies never get an episode title.
  assert.equal(guessMediaInfo('The.Matrix.1999.2160p').episodeTitle, null);
});

test('episode title matching is conservative', () => {
  assert.equal(episodeTitleMatches('Long Long Time', 'Long, Long Time'), true);
  assert.equal(episodeTitleMatches('The Reckoning', 'the reckoning'), true);
  assert.equal(episodeTitleMatches('Long Long Time', 'Kin'), false);
  assert.equal(episodeTitleMatches('', 'Kin'), false);
  assert.equal(episodeTitleMatches('Cat', 'Cats'), false); // too short to fuzzy match
});

export interface EpisodeTitleTestTestModule {};
