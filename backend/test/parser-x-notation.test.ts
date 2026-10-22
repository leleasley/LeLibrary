// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');

const { guessMediaInfo } = require('../src/media/parser.ts');

test('bare 1x02 numbering resolves season and episode', () => {
  for (const [name, season, episode] of [
    ['Breaking.Bad.1x02.1080p.WEB-DL.mkv', 1, 2],
    ['Show.Name.1x01.HDTV.mkv', 1, 1],
    ['Show Name - 10x05 - Title [1080p].mkv', 10, 5],
  ]) {
    const info = guessMediaInfo(name);
    assert.equal(info.isSeries, true, name);
    assert.equal(info.season, season, name);
    assert.equal(info.episode, episode, name);
    assert.equal(info.isAnime, false, name);
  }
});

test('Sxx x yy notation resolves episodes in prefixed releases', () => {
  const info = guessMediaInfo('The.Originals.S02x02.1080p.WEB-DL.mkv');
  assert.equal(info.title, 'The Originals');
  assert.equal(info.isSeries, true);
  assert.equal(info.season, 2);
  assert.equal(info.episode, 2);
  assert.equal(info.isAnime, false);
});

test('leading distributor domains and FHD quality prefixes do not pollute titles', () => {
  assert.equal(guessMediaInfo('www.example.com.Plankton.The.Movie.2025.1080p.mkv').title, 'Plankton The Movie');
  assert.equal(guessMediaInfo('FHD-Demolition.Man.1993.1080p.mkv').title, 'Demolition Man');
});

test('x-notation ranges resolve episodeEnd', () => {
  const info = guessMediaInfo('Show.Name.2x13-14.720p.HDTV.mkv');
  assert.equal(info.isSeries, true);
  assert.equal(info.season, 2);
  assert.equal(info.episode, 13);
  assert.equal(info.episodeEnd, 14);
});

test('explicit SxxExx still wins over x-notation', () => {
  const info = guessMediaInfo('Show.S02E03.1x04.1080p.mkv');
  assert.equal(info.season, 2);
  assert.equal(info.episode, 3);
});

test('resolutions and codecs are not episodes', () => {
  for (const name of [
    'Movie.2024.1920x1080.BluRay.mkv',
    'Movie.2024.1280x720.WEB-DL.mkv',
    'Some.Release.1080p.WEB.x264-GROUP.mkv',
  ]) {
    const info = guessMediaInfo(name);
    assert.equal(info.isSeries, false, name);
    assert.equal(info.season, null, name);
    assert.equal(info.episode, null, name);
  }
});

export interface ParserXNotationTestModule {};
