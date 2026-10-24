'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const boxsets = require('../src/library/boxsets.ts');

const FF = [
  { id: 9799, title: 'The Fast and the Furious', originalTitle: 'The Fast and the Furious', year: 2001 },
  { id: 584, title: '2 Fast 2 Furious', originalTitle: '2 Fast 2 Furious', year: 2003 },
  { id: 9615, title: 'The Fast and the Furious: Tokyo Drift', originalTitle: 'The Fast and the Furious: Tokyo Drift', year: 2006 },
  { id: 13804, title: 'Fast & Furious', originalTitle: 'Fast & Furious', year: 2009 },
  { id: 51497, title: 'Fast Five', originalTitle: 'Fast Five', year: 2011 },
  { id: 82992, title: 'Fast & Furious 6', originalTitle: 'Fast & Furious 6', year: 2013 },
  { id: 168259, title: 'Furious 7', originalTitle: 'Furious 7', year: 2015 },
  { id: 337339, title: 'The Fate of the Furious', originalTitle: 'The Fate of the Furious', year: 2017 },
  { id: 385128, title: 'F9', originalTitle: 'F9', year: 2021 },
  { id: 385687, title: 'Fast X', originalTitle: 'Fast X', year: 2023 },
];

const film = (name: string) => {
  const p = boxsets.parseFilm(name);
  return { key: '', title: p.title, year: p.year, files: [] };
};

test('every Fast & Furious file lands on its own film, including the hard ones', () => {
  const cases: [string, number][] = [
    ['2001.The.Fast.And.The.Furious.1920x816.BDRip.x264.DTS-HD.MA.mkv', 9799],
    ['2003.2.Fast.2.Furious.1920x816.BDRip.x264.DTS-HD.MA.mkv', 584],
    ['2006.The.Fast.And.The.Furious-.Tokyo.Drift.1920x816.BDRip.x264.DTS-HD.MA.mkv', 9615],
    ['2009.Fast.&.Furious.1920x800.BDRip.x264.DTS-HD.MA.mkv', 13804],
    ['2009.Fast.and.Furious.1920x800.BDRip.x264.DTS-HD.MA.mkv', 13804],
    ['2013.Fast.and.Furious.6.[Extended.Cut].1920x816.BDRip.x264.DTS-HD.MA.mkv', 82992],
    ['2021.F9-.The.Fast.Saga.1920x804.BDRip.x264.TrueHD-Atmos.mkv', 385128],
    ['2023.Fast.X.1920x804.BDRip.x264.TrueHD-Atmos.mkv', 385687],
  ];
  for (const [name, id] of cases) assert.equal(boxsets.matchToPart(film(name), FF)?.id, id, name);
});

test('a film that is not in the collection is left for the normal matcher', () => {
  assert.equal(boxsets.matchToPart(film('2019.Fast.&.Furious.Presents-.Hobbs.&.Shaw.1920x804.BDRip.x264.TrueHD-Atmos.mkv'), FF), null);
});

test('only real box sets with several feature files are expanded', () => {
  const big = (n: string) => ({ id: n, name: n, size: 5e9 });
  assert.equal(boxsets.looksLikeBoxSet('Critters The Complete Collection (1986-2019)', { files: [big('a.mkv'), big('b.mkv')] }), true);
  assert.equal(boxsets.looksLikeBoxSet('Critters The Complete Collection (1986-2019)', { files: [big('a.mkv'), { id: 2, name: 'sample.mkv', size: 5e9 }] }), false);
  assert.equal(boxsets.looksLikeBoxSet('Dune.Part.Two.2024.2160p', { files: [big('a.mkv'), big('b.mkv')] }), false);
});

export interface LibraryBoxsetsTestModule {};

test('miniseries parts keep their part number', () => {
  const p1 = boxsets.parseFilm('Hogfather Part 1 2006 1080p BluRay HEVC x265 5.1 BONE.mkv');
  const p2 = boxsets.parseFilm('The Color of Magic 2008 Part 2 1080p BluRay HEVC x265 5.1 BONE.mkv');
  assert.deepEqual([p1.title, p1.year, p1.part], ['Hogfather', 2006, 1]);
  assert.deepEqual([p2.title, p2.year, p2.part], ['The Color of Magic', 2008, 2]);
  const big = 1500 * 1024 * 1024;
  const groups = boxsets.groupFilms({ files: [
    { id: 1, name: 'Going Postal Part 1 2010 1080p BluRay BONE.mkv', size: big },
    { id: 2, name: 'Going Postal Part 2 2010 1080p BluRay BONE.mkv', size: big },
    { id: 3, name: 'Hogfather Part 1 2006 1080p BluRay BONE.mkv', size: big },
  ] });
  assert.equal(groups.length, 2);
  assert.equal(groups.find((g: any) => g.title === 'Going Postal').files.length, 2);
});

test('UK and US spellings still find the collection film', () => {
  const parts = [{ id: 1, title: 'The Colour of Magic', originalTitle: 'The Colour of Magic', year: 2008 }, { id: 2, title: 'Magic Mike', originalTitle: 'Magic Mike', year: 2012 }];
  assert.equal(boxsets.matchToPart({ key: 'k', title: 'The Color of Magic', year: 2008, files: [] }, parts)?.id, 1);
});
