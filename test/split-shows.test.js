const test = require('node:test');
const assert = require('node:assert/strict');

const { guessMediaInfo } = require('../src/parser');
const { remapSplitSeason, SPLIT_SHOW_SEASON_REMAP } = require('../src/builder');

// Kitchen Nightmares US: TVDB keeps one series (S01-S10); TMDB split the
// 2023 revival into its own entry (235884, S01-S03). TVDB S08/S09/S10 must
// resolve to the 2023 entry's S01/S02/S03 so the episodes exist on TMDB.
test('split-show table maps Kitchen Nightmares TVDB seasons to the 2023 entry', () => {
  assert.deepEqual(remapSplitSeason(11294, 8), { tmdbId: 235884, season: 1 });
  assert.deepEqual(remapSplitSeason(11294, 9), { tmdbId: 235884, season: 2 });
  assert.deepEqual(remapSplitSeason(11294, 10), { tmdbId: 235884, season: 3 });
  assert.ok(SPLIT_SHOW_SEASON_REMAP[11294]);
});

test('split-show remap leaves ordinary seasons and shows alone', () => {
  assert.equal(remapSplitSeason(11294, 7), null);
  assert.equal(remapSplitSeason(11294, 1), null);
  assert.equal(remapSplitSeason(11294, 11), null);
  assert.equal(remapSplitSeason(235884, 1), null);
  assert.equal(remapSplitSeason(999999, 10), null);
});

test('split-show remap tolerates string ids and nulls', () => {
  assert.deepEqual(remapSplitSeason('11294', '10'), { tmdbId: 235884, season: 3 });
  assert.equal(remapSplitSeason(11294, null), null);
  assert.equal(remapSplitSeason(11294, undefined), null);
  assert.equal(remapSplitSeason(null, 10), null);
  assert.equal(remapSplitSeason(undefined, 8), null);
});

test('TVDB-numbered filenames parse to the legacy seasons', () => {
  const s10 = guessMediaInfo('Kitchen.Nightmares.US.S10E01.1080p.WEB.h264-EDITH');
  assert.equal(s10.isSeries, true);
  assert.equal(s10.season, 10);
  assert.equal(s10.episode, 1);
  const s08 = guessMediaInfo('Kitchen.Nightmares.US.S08E08.1080p.WEB.h264-BAE');
  assert.equal(s08.season, 8);
  assert.equal(s08.episode, 8);
});

test('TMDB-numbered 2023 filenames parse with the year intact', () => {
  const s01 = guessMediaInfo('Kitchen Nightmares 2023 S01E01 Bel Aire 1080p DSNP WEB-DL DDP5 1 H 264-FLUX');
  assert.equal(s01.title, 'Kitchen Nightmares');
  assert.equal(s01.year, 2023);
  assert.equal(s01.season, 1);
  const s02 = guessMediaInfo('Kitchen.Nightmares.2023.S02E01.Iberville.Ramsays.Worst.Nightmare.1080p.AMZN.WEB-DL.DDP5.1.H.264-FLUX.mkv');
  assert.equal(s02.year, 2023);
  assert.equal(s02.season, 2);
});

test('parsed TVDB seasons remap to existing 2023 seasons', () => {
  const s10 = guessMediaInfo('Kitchen.Nightmares.US.S10E01.1080p.WEB.h264-EDITH');
  // Pre-split match target: the 2007 entry (id 11294), as seen in prod cache.
  assert.deepEqual(remapSplitSeason(11294, s10.season), { tmdbId: 235884, season: 3 });
  const s08 = guessMediaInfo('Kitchen.Nightmares.US.S08E08.1080p.WEB.h264-BAE');
  assert.deepEqual(remapSplitSeason(11294, s08.season), { tmdbId: 235884, season: 1 });
});
