'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stripLeadingGroupPrefix, releaseNameHints } = require('../src/library/matcher.ts');

test('a scene group in front of a release name is dropped for the retry', () => {
  assert.equal(stripLeadingGroupPrefix('honor-wwe.wrestlemania.15.1999.720p.web.h264.mkv'), 'wwe.wrestlemania.15.1999.720p.web.h264.mkv');
  assert.equal(stripLeadingGroupPrefix('sparks-the.movie.2014.1080p.bluray.x264.mkv'), 'the.movie.2014.1080p.bluray.x264.mkv');
});

test('ordinary names are left alone', () => {
  assert.equal(stripLeadingGroupPrefix('Spider-Man No Way Home 2021'), null);   // spaces, not a dotted release
  assert.equal(stripLeadingGroupPrefix('Honor-Something.mkv'), null);          // capitalised, no year/quality
  assert.equal(stripLeadingGroupPrefix('x-files.notes.txt'), null);            // no year or quality tag
  assert.equal(stripLeadingGroupPrefix('The.Matrix.1999.1080p'), null);        // no prefix
});

test('a hash-named item offers the release name from its .nfo, then group-less video names', () => {
  const raw = { files: [
    { name: 'Amadeus/amadeus.1984.dc.internal.repack.1080p.bluray.x264-classic.nfo' },
    { name: 'Amadeus/cls-amadeusrp.mkv' },
    { name: 'Amadeus/RARBG.txt' },
  ] };
  assert.deepEqual(releaseNameHints(raw), ['amadeus.1984.dc.internal.repack.1080p.bluray.x264-classic']);
  assert.deepEqual(releaseNameHints({ files: [{ name: 's7-flipped.1080p (1).mkv' }, { name: 's7-flipped.1080p-sample.mkv' }] }), ['flipped.1080p']);
  assert.deepEqual(releaseNameHints({ files: [{ name: 'notes.txt' }, { name: 'random.mkv' }] }), []);
});

export interface MatcherGroupPrefixTestModule {};
