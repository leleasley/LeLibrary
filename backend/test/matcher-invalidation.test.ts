// @ts-nocheck
'use strict';
// A newly matched download changes its title's meta (new episode in videos[]),
// but meta responses cache 24h with no sync component: the matcher must evict
// the scope's metas on passes that matched something, or the episode stays
// invisible on the detail page for a day. Offline matching + stubbed store and
// cache keep this free of network and database.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const cachePath = path.join(__dirname, '..', 'src', 'runtime', 'cache.ts');
const storePath = path.join(__dirname, '..', 'src', 'library', 'store.ts');
const builderPath = path.join(__dirname, '..', 'src', 'catalog', 'builder.ts');
const metricsPath = path.join(__dirname, '..', 'src', 'library', 'metrics.ts');

const deletedPatterns = [];
const savedMatches = [];
let queuedJobs = [];

require.cache[cachePath] = { id: cachePath, filename: cachePath, loaded: true, exports: {
  delPattern: async (pattern) => { deletedPatterns.push(pattern); return 1; },
} };
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: {
  claimMatchJobs: async () => queuedJobs.splice(0, queuedJobs.length),
  saveMatch: async (id, patch) => { savedMatches.push({ id, ...patch }); },
} };
require.cache[builderPath] = { id: builderPath, filename: builderPath, loaded: true, exports: {
  publishMatchEntry: () => {},
} };
require.cache[metricsPath] = { id: metricsPath, filename: metricsPath, loaded: true, exports: {
  add: () => {}, time: () => {},
} };

const { matchScope, embeddedDominantMovieCandidate, parsedTypeCorrection } = require('../src/library/matcher.ts');
const { matchVersion } = require('../src/matching/resolve.ts');

const SCOPE = { scopeId: 'scope9', config: {}, tmdbApiKey: 'k', lang: 'en-US' };

function offlineJob() {
  return {
    id: 7, media_type: 'series',
    raw: { name: 'Show.S01E01.1080p.WEB', __match: { tmdbId: 123, type: 'series', title: 'Show' } },
  };
}

test('newly matched items evict the scope metas', async () => {
  const was = process.env.LIBRARY_MATCH_OFFLINE;
  process.env.LIBRARY_MATCH_OFFLINE = '1';
  try {
    queuedJobs = [offlineJob()];
    deletedPatterns.length = 0;
    savedMatches.length = 0;
    const stats = await matchScope(SCOPE, { batch: 50, concurrency: 1, budgetMs: 0 });
    assert.equal(stats.matched, 1);
    assert.equal(savedMatches[0].status, 'matched');
    // The stamped version MUST equal the claim comparator: anything else
    // re-queues the whole library on every pass, forever (measured 37.5k
    // re-matches per 2-minute sync from a missing 'mv' prefix).
    assert.equal(savedMatches[0].version, matchVersion());
    assert.deepEqual(deletedPatterns, ['meta:*scope9*']);
  } finally {
    if (was === undefined) delete process.env.LIBRARY_MATCH_OFFLINE;
    else process.env.LIBRARY_MATCH_OFFLINE = was;
  }
});

test('a pass with nothing matched evicts nothing', async () => {
  const was = process.env.LIBRARY_MATCH_OFFLINE;
  process.env.LIBRARY_MATCH_OFFLINE = '1';
  try {
    queuedJobs = [];
    deletedPatterns.length = 0;
    const stats = await matchScope(SCOPE, { batch: 50, concurrency: 1, budgetMs: 0 });
    assert.equal(stats.processed, 0);
    assert.deepEqual(deletedPatterns, []);
  } finally {
    if (was === undefined) delete process.env.LIBRARY_MATCH_OFFLINE;
    else process.env.LIBRARY_MATCH_OFFLINE = was;
  }
});

test('opaque multi-video recovery selects only a byte-dominant dated movie', () => {
  const candidate = embeddedDominantMovieCandidate([
    { name: 'Example.Feature.2001.1080p.mkv', size: 950 },
    { name: 'sample.mkv', size: 50 },
  ]);
  assert.deepEqual(candidate, { title: 'Example Feature', year: 2001 });
  assert.equal(embeddedDominantMovieCandidate([
    { name: 'Example.Feature.2001.1080p.mkv', size: 500 },
    { name: 'Other.Feature.2002.1080p.mkv', size: 500 },
  ]), null, 'mixed bundles without a dominant feature stay unresolved');
  assert.equal(embeddedDominantMovieCandidate([
    { name: 'Example.Feature.1080p.mkv', size: 950 },
    { name: 'sample.mkv', size: 50 },
  ]), null, 'yearless embedded titles do not pass the strict recovery gate');
  assert.equal(embeddedDominantMovieCandidate([
    { name: 'Example.Feature.2001.1080p.mkv' },
  ]), null, 'missing byte sizes cannot establish dominance');
  assert.equal(embeddedDominantMovieCandidate([
    { name: 'Example.Show.S01E01.1080p.mkv', size: 950 },
    { name: 'sample.mkv', size: 50 },
  ]), null, 'episode files cannot be reclassified as movies');
});

test('type correction uses explicit episode evidence and strict dated anime-to-movie fallback', () => {
  assert.equal(parsedTypeCorrection('movie', { isSeries: true, isAnime: false, season: 2 }, 'type-mismatch'), 'series');
  assert.equal(parsedTypeCorrection('movie', { isSeries: true, isAnime: true, season: 2 }, 'type-mismatch'), 'anime');
  assert.equal(parsedTypeCorrection('anime', { isSeries: false, isAnime: true, year: 2012 }, 'no-candidate'), 'movie-strong');
  assert.equal(parsedTypeCorrection('anime', { isSeries: false, isAnime: true, year: null }, 'no-candidate'), null);
  assert.equal(parsedTypeCorrection('anime', { isSeries: true, isAnime: true, year: 2012 }, 'no-candidate'), null);
  assert.equal(parsedTypeCorrection('series', { isSeries: false, year: 2012 }, 'no-candidate'), null);
});

export interface MatcherInvalidationTestModule {};
