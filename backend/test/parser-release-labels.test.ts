// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');

const { guessMediaInfo } = require('../src/media/parser.ts');

// Names found wrong by the match bench (scripts/match-bench.ts).

test('"+" between words is a space when the name has no spaces', () => {
  const info = guessMediaInfo('Not+Going+Out+Season+4+Complete+WEB+x264+[i_c]');
  assert.equal(info.title, 'Not Going Out');
  assert.equal(info.season, 4);
  assert.equal(info.isSeries, true);
});

test('a real "+" in a spaced title is kept', () => {
  assert.equal(guessMediaInfo('Cinema Paradiso + Extras 1988 1080p.mkv').year, 1988);
  assert.equal(guessMediaInfo('Movie+ 2010 1080p.mkv').year, 2010);
});

test('dub / voice-over / subtitle label runs end the title and keep the year', () => {
  const heist = guessMediaInfo('Tower.Heist...Dub.+.2x.VO.+.AVO.+.Sub.Rus,.Ukr,.Eng.+.Original.Eng.2011.1080p.BDRip.avc');
  assert.deepEqual([heist.title, heist.year], ['Tower Heist', 2011]);
  const again = guessMediaInfo('You.Again...Dub.+.Original..+.Sub.2010.1080p.BDRip.avc');
  assert.deepEqual([again.title, again.year], ['You Again', 2010]);
  const monte = guessMediaInfo('Monte.Carlo...Dub.Sub.Rus.+.Original.Eng.2011.1080p.BDRip.avc');
  assert.deepEqual([monte.title, monte.year], ['Monte Carlo', 2011]);
  const shorty = guessMediaInfo('Get.Shorty...Dub.+.MVO.+.3x.AVO.+.Original.+.Commentary.+.Sub.1995.1080p.BDRip.avc');
  assert.deepEqual([shorty.title, shorty.year], ['Get Shorty', 1995]);
});

test('titles that merely contain the words stay intact', () => {
  assert.equal(guessMediaInfo('The.Sub.2023.1080p.WEB-DL.mkv').title, 'The Sub');
  assert.equal(guessMediaInfo('Original.Sin.2001.1080p.BluRay.mkv').title, 'Original Sin');
  assert.equal(guessMediaInfo('Dub.Club.2019.1080p.mkv').title, 'Dub Club');
});
