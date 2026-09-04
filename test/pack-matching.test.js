const test = require('node:test');
const assert = require('node:assert/strict');

const { guessMediaInfo } = require('../src/parser');
const { summarizePackEpisodes } = require('../src/builder');

// A bare torrent name ("Kitchen.Nightmares", 30GB pack) parses as a
// non-series title: this is the gap the pack fallback closes. Inner files
// carry the real season/episode info.
test('bare pack name parses without series info', () => {
  const info = guessMediaInfo('Kitchen.Nightmares');
  assert.equal(info.isSeries, false);
  assert.equal(info.season, null);
  assert.equal(info.title, 'Kitchen Nightmares');
});

const BTW_S01 = [
  'Kitchen.Nightmares.US.S01E01.Peters.HULU.WEBRip.AAC2.0.H.264-BTW.mkv',
  'Kitchen.Nightmares.US.S01E02.Dillons.HULU.WEBRip.AAC2.0.H.264-BTW.mkv',
  'Kitchen.Nightmares.US.S01E03.The.Mixing.Bowl.HULU.WEBRip.AAC2.0.H.264-BTW.mkv',
  'Kitchen.Nightmares.US.S01E04.Seascape.HULU.WEBRip.AAC2.0.H.264-BTW.mkv',
  'Kitchen.Nightmares.US.S01E05.Olde.Stone.Mill.HULU.WEBRip.AAC2.0.H.264-BTW.mkv',
  'Kitchen.Nightmares.US.S01E06.Sebastians.HULU.WEBRip.AAC2.0.H.264-BTW.mkv',
];

test('full-season inner files summarize to a season pack', () => {
  assert.deepEqual(summarizePackEpisodes(BTW_S01), {
    title: 'Kitchen Nightmares Us',
    year: null,
    season: 1,
    episode: null,
    isAnime: false,
  });
});

test('single distinct episode resolves exactly', () => {
  assert.deepEqual(summarizePackEpisodes(['Some.Show.S02E05.1080p.mkv']), {
    title: 'Some Show',
    year: null,
    season: 2,
    episode: 5,
    isAnime: false,
  });
});

test('episodes across seasons resolve as the whole show', () => {
  const summary = summarizePackEpisodes([
    'Some.Show.S01E01.1080p.mkv',
    'Some.Show.S02E01.1080p.mkv',
  ]);
  assert.equal(summary.title, 'Some Show');
  assert.equal(summary.season, null);
  assert.equal(summary.episode, null);
});

test('split-show inner seasons survive aggregation for the remap', () => {
  // TVDB S10 inners aggregate to season 10; remapSplitSeason (tested in
  // split-shows.test.js) then moves them to the 2023 entry downstream.
  const summary = summarizePackEpisodes([
    'Kitchen.Nightmares.US.S10E01.1080p.WEB.h264-EDITH.mkv',
    'Kitchen.Nightmares.US.S10E02.1080p.WEB.h264-EDITH.mkv',
  ]);
  assert.equal(summary.season, 10);
  assert.equal(summary.episode, null);
});

test('movie and junk inner files are ignored', () => {
  assert.equal(summarizePackEpisodes([]), null);
  assert.equal(summarizePackEpisodes(['Dune.Part.Two.2024.1080p.mkv']), null);
  assert.equal(summarizePackEpisodes(['Some.Show.S01E01.sample.mkv']), null);
  assert.equal(summarizePackEpisodes([null, undefined, 42]), null);
});

test('absolute-numbered anime inners keep episode with null season', () => {
  const summary = summarizePackEpisodes(['[SubsPlease] One Piece - 101 [1080p].mkv']);
  assert.equal(summary.episode, 101);
  assert.equal(summary.season, null);
  assert.equal(summary.isAnime, true);
});
