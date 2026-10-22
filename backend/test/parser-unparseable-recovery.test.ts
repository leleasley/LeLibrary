// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const { guessMediaInfo } = require('../src/media/parser.ts');

test('year-first movie releases recover the title and year', () => {
  const info = guessMediaInfo('2021.The.Great.Adventure.1080p.WEB-DL.x264.mkv');
  assert.equal(info.title, 'The Great Adventure');
  assert.equal(info.year, 2021);
  assert.equal(info.isSeries, false);
});

test('year-first names with a later year keep the title before release metadata', () => {
  const info = guessMediaInfo('2021.The.Great.Adventure.2019.1080p.WEB-DL.mkv');
  assert.equal(info.title, 'The Great Adventure');
  assert.equal(info.year, 2019);
  assert.equal(info.isSeries, false);
});

test('repeated leading years are treated as metadata before the title', () => {
  const info = guessMediaInfo('2021.2021.The.Great.Adventure.1080p.WEB-DL.mkv');
  assert.equal(info.title, 'The Great Adventure');
  assert.equal(info.year, 2021);
  assert.equal(info.isSeries, false);
});

test('a leading season marker followed by a multiword show title remains a series', () => {
  const info = guessMediaInfo('S02.The.Long.Running.Show.2023.1080p.WEB-DL.mkv');
  assert.equal(info.title, 'The Long Running Show');
  assert.equal(info.year, 2023);
  assert.equal(info.isSeries, true);
  assert.equal(info.season, 2);
});

test('Jackass version-date forms remain movies', () => {
  for (const version of ['2.5', '3.5', '4.5']) {
    const info = guessMediaInfo(`Jackass.${version}.3.5.2007.1080p.WEB-DL.mkv`);
    assert.equal(info.isSeries, false, version);
    assert.equal(info.year, 2007, version);
  }
});

test('a leading season marker without a recoverable title remains unparseable', () => {
  assert.equal(guessMediaInfo('S01.1080p.WEB-DL.mkv'), null);
});

test('recognizes pre-1950 film years and keeps title numbers distinct', () => {
  const cases = [
    ['1917.2019.1080p', '1917', 2019],
    ['1984.1984.INTERNAL.REMASTERED.1080p', '1984', 1984],
    ['2012.2009.1080p', '2012', 2009],
    ['2001.A.Space.Odyssey.1968', '2001 A Space Odyssey', 1968],
    ['Metropolis 1927 2010 Complete Version', 'Metropolis', 1927],
    ['Death Race 2000 1975 Bluray', 'Death Race 2000', 1975],
    ['Bambi (1942) 1080p BluRay', 'Bambi', 1942],
    ['A.Merry.War1997(George.Orwell)', 'A Merry War', 1997],
    ['Bottle Rocket 1994', 'Bottle Rocket', 1994],
    ['Movie.Title.1920.BluRay.1080p.x264-GRP', 'Movie Title', 1920],
    ['Movie.Title.1949.BluRay.1080p.x264-GRP', 'Movie Title', 1949],
  ];

  for (const [name, title, year] of cases) {
    const info = guessMediaInfo(name);
    assert.equal(info.title, title, name);
    assert.equal(info.year, year, name);
    assert.equal(info.isSeries, false, name);
  }
});
