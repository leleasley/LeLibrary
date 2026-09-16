const test = require('node:test');
const assert = require('node:assert/strict');

const { guessMediaInfo } = require('../src/parser');

// Multi-voiceover releases phrase episode totals as counts ("Серии 1-6 из
// 12 [2025, ...]", "... из 13 (Director, ...)"). The absolute-episode anime
// pattern ("Naruto 12 [1080p]") must not claim those trailing numbers, or a
// plain US series lands in the anime catalog (Riverdale, The Sandman).
test('episode-count phrasing is not absolute-episode anime numbering', () => {
  for (const name of [
    'Ривердэйл  Riverdale  Сезон 1  Серии 1-13 из 13 (Роб Шейденгланц) [2017, BDRip 1080p] MVO (TVShows)',
    'Песочный человек  The Sandman  Сезон 2  Серии 1-6 из 12 [2025, WEB-DL 2160p] MVO + Original',
    'Some Show S01 Eps 1-12 из 12 [2024, WEB-DL 1080p]',
  ]) {
    const info = guessMediaInfo(name);
    assert.equal(info.isAnime, false, name);
    assert.equal(info.episode, null, name);
  }
});

test('a bracket year after the number is a count, not an episode', () => {
  const info = guessMediaInfo('Some Series 12 [2025, WEB-DL 1080p]');
  assert.equal(info.isAnime, false);
});

test('genuine absolute-episode anime numbering still matches', () => {
  for (const [name, episode] of [
    ['[SubsPlease] One Piece - 101 [1080p].mkv', 101],
    ['Naruto 12 [1080p].mkv', 12],
    ['One Piece 101 [1080p].mkv', 101],
  ]) {
    const info = guessMediaInfo(name);
    assert.equal(info.isAnime, true, name);
    assert.equal(info.episode, episode, name);
  }
});

test('standard series releases are unaffected', () => {
  const riverdale = guessMediaInfo('Riverdale.S01E01.1080p.WEB.H264-STRiFE.mkv');
  assert.equal(riverdale.isAnime, false);
  assert.equal(riverdale.season, 1);
  assert.equal(riverdale.episode, 1);
  const sandman = guessMediaInfo('The.Sandman.S02E01.2160p.NF.WEB-DL.DDP5.1.H.265.mkv');
  assert.equal(sandman.isAnime, false);
  assert.equal(sandman.season, 2);
  assert.equal(sandman.episode, 1);
});
