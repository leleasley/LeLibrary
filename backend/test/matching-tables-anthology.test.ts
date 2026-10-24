// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const { lookupSplitSeason, lookupTitleRedirect } = require('../src/matching/tables.ts');

// Verified on TMDB 2026-10-24: Slasher (65784) has seasons 1-3; season 4 is
// "Slasher: Flesh & Blood" (304556) and season 5 "Slasher: Ripper" (304561).
test('Slasher seasons 4 and 5 point at their own TMDB entries', () => {
  assert.deepEqual(lookupSplitSeason(65784, 4), { tmdbId: 304556, season: 1 });
  assert.deepEqual(lookupSplitSeason(65784, 5), { tmdbId: 304561, season: 1 });
  assert.equal(lookupSplitSeason(65784, 3), null);
});

// Monster (2022): season 2 is "Monsters: The Lyle and Erik Menendez Story"
// (225634), season 3 "Monster: The Ed Gein Story" (286801).
test('Monster seasons 2 and 3 redirect to their anthology entries', () => {
  assert.equal(lookupTitleRedirect('Monster (2022) S02 (1080p NF WEB-DL x265 10bit EAC3 Atmos 5.1 Ghost)', 'Monster', 2).tmdbId, 225634);
  assert.equal(lookupTitleRedirect('Monster (2022) S03 The Ed Gein Story (1080p NF WEB-DL)', 'Monster', 3).tmdbId, 286801);
  assert.equal(lookupTitleRedirect('Monster.S03.1080p', 'Monster', 3), null, 'a different Monster show is untouched');
  assert.equal(lookupTitleRedirect('Monster.S04.Lizzie.Borden.1080p', 'Monster', 4).tmdbId, 299939);
});
