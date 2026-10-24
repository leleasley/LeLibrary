// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');

const { guessMediaInfo } = require('../src/media/parser.ts');

// A WIDTHxHEIGHT resolution ("1920x816") is release metadata, never a year,
// and never part of the title.
const cases = [
  ['2001.The.Fast.And.The.Furious.1920x816.BDRip.mkv', 'The Fast And The Furious', 2001],
  ['The.Fast.And.The.Furious.2001.1920x816.BDRip.mkv', 'The Fast And The Furious', 2001],
  ['Fast.Five.1920x1080.mkv', 'Fast Five', null],
  ['Movie 1280x720 2010.mkv', 'Movie', 2010],
  ['Blade.Runner.2049.2017.3840x2160.HDR.mkv', 'Blade Runner 2049', 2017],
  ['Movie (2004) 1920x800.mkv', 'Movie', 2004],
  ['The_Opposite_Of_Sex_(1998)_720x480_16x9.mp4', 'The Opposite Of Sex', 1998],
  ['Movie.2010.x264.mkv', 'Movie', 2010],
  ['Movie 2010 x265.mkv', 'Movie', 2010],
  ['The Most Wonderful Time of the Year 2008 x264 BDRip 1080p NovaLan mkv', 'The Most Wonderful Time Of The Year', 2008],
  ['2012.2009.1920x1080.mkv', '2012', 2009],
];

for (const [name, title, year] of cases) {
  test(`resolution is not a year: ${name}`, () => {
    const info = guessMediaInfo(name);
    assert.equal(info.title, title);
    assert.equal(info.year, year);
    assert.equal(info.isSeries, false);
  });
}

test('episode markers still parse beside a resolution', () => {
  const info = guessMediaInfo('Show.S01E02.1920x1080.mkv');
  assert.deepEqual([info.title, info.season, info.episode], ['Show', 1, 2]);
});
