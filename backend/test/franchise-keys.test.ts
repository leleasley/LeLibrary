// @ts-nocheck
'use strict';
// Franchise catalog keys must be URL-clean on every platform: Stremio shows
// them in Discover URLs, and a leading dash (from digit-led names like
// "101 Dalmatians") reads as broken. Keys stay letter-led with a stable
// letters-only hash suffix (never a bare numeric TMDB id).
const test = require('node:test');
const assert = require('node:assert/strict');

const { collectionKey, filterOfficialCollectionMembers } = require('../src/catalog/franchise-collections.ts');

test('digit-led franchises do not produce leading dashes', () => {
  for (const name of ['101 Dalmatians Collection', '28 Days Later Collection', '12 Angry Men']) {
    const key = collectionKey(name, 12345);
    assert.ok(!key.startsWith('-'), `${name} → ${key}`);
    assert.ok(!key.includes('--'), `${name} → ${key}`);
    assert.match(key, /^[a-z][a-z-]*[a-z]$/);
  }
});

test('keys carry no numeric segment (cannot misresolve as a TMDB id)', () => {
  const key = collectionKey('Toy Story Collection', 10194);
  for (const segment of key.split('-')) {
    assert.ok(!/^\d+$/.test(segment), `numeric segment in ${key}`);
  }
});

test('collection parts override a conflicting movie-level collection assignment', () => {
  const movies = [
    { result: { id: 100 }, detail: { collectionId: 724328 }, title: 'Collection endpoint member' },
    { result: { id: 200 }, detail: { collectionId: 999 }, title: 'Movie detail points elsewhere' },
    { result: { id: 300 }, detail: { collectionId: 724328 }, title: 'Movie detail only, absent from parts' },
  ];
  const filtered = filterOfficialCollectionMembers(movies, [{ id: '100' }, { id: '200' }, { id: 'invalid' }]);
  assert.deepEqual(filtered, [movies[0], movies[1]]);
});

test('collection detail failure preserves existing grouping fallback', () => {
  const movies = [{ result: { id: 100 } }, { result: { id: 200 } }];
  assert.equal(filterOfficialCollectionMembers(movies, null), movies);
});

export interface FranchiseKeysTestModule {};
