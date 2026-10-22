// @ts-nocheck
'use strict';
// Split-season remaps change the ENTRY, not just the season: building the
// stored meta from the pre-split candidate baked the wrong tmdbId (11294)
// with the right season (3), so episodes filtered against an entry that never
// had them. canonicalSource must hand back the target entry's own object.
// TMDB is stubbed; no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const tmdbPath = path.join(__dirname, '..', 'src', 'media', 'tmdb.ts');
let searchCalls = 0;
let searchImpl = async () => [];
require.cache[tmdbPath] = { id: tmdbPath, filename: tmdbPath, loaded: true, exports: {
  get searchCandidates() { return (...args) => { searchCalls++; return searchImpl(...args); }; },
} };

const { canonicalSource } = require('../src/catalog/builder.ts');

const CANDIDATE_11294 = { id: 11294, title: 'Kitchen Nightmares', poster_path: '/old.jpg', isJapaneseAnimation: false };

test('unmapped decisions return the candidate untouched without TMDB work', async () => {
  searchCalls = 0;
  const out = await canonicalSource('key', { tmdbId: 11294, title: 'Kitchen Nightmares', season: 7, candidate: CANDIDATE_11294 }, 'en-US');
  assert.equal(out, CANDIDATE_11294);
  assert.equal(searchCalls, 0);
});

test('remapped decisions resolve the target entry object', async () => {
  searchCalls = 0;
  searchImpl = async () => [{ id: 235884, title: 'Kitchen Nightmares', poster_path: '/new.jpg' }];
  const out = await canonicalSource('key', { tmdbId: 235884, title: 'Kitchen Nightmares', season: 3, candidate: CANDIDATE_11294 }, 'en-US');
  assert.equal(out.id, 235884);
  assert.equal(out.poster_path, '/new.jpg');
  assert.ok(searchCalls > 0);
});

test('a failed target lookup still fixes the id (never throws, never keeps the old entry)', async () => {
  searchCalls = 0;
  searchImpl = async () => { throw new Error('tmdb down'); };
  const out = await canonicalSource('key', { tmdbId: 235884, title: 'Kitchen Nightmares', season: 3, candidate: CANDIDATE_11294 }, 'en-US');
  assert.equal(out.id, 235884);
  assert.equal(out.poster_path, '/old.jpg');
});

export interface SplitSourceTestModule {};
