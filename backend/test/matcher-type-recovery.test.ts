// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const tmdb = require('../src/media/tmdb.ts');
const matcher = require('../src/library/matcher.ts');
const resolve = require('../src/matching/resolve.ts');
const parser = require('../src/media/parser.ts');

function deps(candidates) {
  return {
    parse: (name) => parser.guessMediaInfo(name),
    search: async () => candidates,
    pick: (_query, rows) => rows[0] || null,
    titleScore: (query, candidate) => tmdb.titleScore(query, candidate),
    seasonCounts: async () => null,
    isAnimeCandidate: () => false,
    findEpisode: async () => null,
  };
}

test('series classification changes only for one exact-title, exact-year movie candidate', async () => {
  const result = await matcher.resolveEmbeddedMovieTypeConflict({
    mediaType: 'series',
    lang: 'en-US',
    files: [{ name: 'The Great Adventure 2001 1080p WEB-DL.mkv' }],
  }, deps([{ id: 101, title: 'The Great Adventure', release_date: '2001-01-01' }]));
  assert.equal(result.ok, true);
  assert.equal(result.tmdbId, 101);
  assert.equal(result.tmdbType, 'movie');
});

test('ambiguous or yearless embedded movie evidence does not change series type', async () => {
  const duplicateCandidates = [
    { id: 101, title: 'The Great Adventure', release_date: '2001-01-01' },
    { id: 102, title: 'The Great Adventure', release_date: '2001-06-01' },
  ];
  const ambiguous = await matcher.resolveEmbeddedMovieTypeConflict({
    mediaType: 'series', lang: 'en-US',
    files: [{ name: 'The Great Adventure 2001 1080p WEB-DL.mkv' }],
  }, deps(duplicateCandidates));
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, 'ambiguous-candidate');

  const yearless = await matcher.resolveEmbeddedMovieTypeConflict({
    mediaType: 'series', lang: 'en-US',
    files: [{ name: 'The Great Adventure 1080p WEB-DL.mkv' }],
  }, deps([{ id: 101, title: 'The Great Adventure', release_date: '2001-01-01' }]));
  assert.equal(yearless, null);
});

test('single-candidate gate rejects non-series, multi-file, and non-movie requests', async () => {
  const file = { name: 'The Great Adventure 2001 1080p WEB-DL.mkv' };
  assert.equal(await matcher.resolveEmbeddedMovieTypeConflict({ mediaType: 'movie', files: [file] }), null);
  assert.equal(await matcher.resolveEmbeddedMovieTypeConflict({ mediaType: 'series', files: [file, file] }), null);
});

test('resolver strict gate does not accept an exact title with a different year', async () => {
  const result = await resolve.resolveMatch({
    name: 'The Great Adventure 2001', mediaType: 'movie', requireUniqueStrongYear: true,
  }, deps([{ id: 101, title: 'The Great Adventure', release_date: '2002-01-01' }]));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-candidate');
});

test('an eligible type correction preserves a no-candidate result instead of the original parse failure', async () => {
  const result = await matcher.resolveEmbeddedMovieTypeConflict({
    mediaType: 'series', lang: 'en-US',
    files: [{ name: 'The Great Adventure 2001 1080p WEB-DL.mkv' }],
  }, deps([]));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-candidate');
});
