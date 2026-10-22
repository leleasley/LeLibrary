// @ts-nocheck
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  allowPush,
  savedNuvioAccessToken,
  savedNuvioRefreshToken,
  isLeLibraryCollection,
  nuvioHomeKey,
  resolveNuvioProfile,
} = require('../src/setup/push.ts');

test('nuvio pushes are capped per setup', () => {
  const key = `test-uuid-${Date.now()}`;
  assert.equal(allowPush(key), true);
  assert.equal(allowPush(key), true);
  assert.equal(allowPush(key), true);
  assert.equal(allowPush(key), true);
  assert.equal(allowPush(key), false);
  assert.equal(allowPush(`other-${Date.now()}`), true);
});

test('nuvio token readers accept the canonical and legacy shapes', () => {
  assert.equal(savedNuvioAccessToken({ nuvioToken: 'abc' }), 'abc');
  assert.equal(savedNuvioAccessToken({ access_token: 'legacy' }), 'legacy');
  assert.equal(savedNuvioAccessToken(null), '');
  assert.equal(savedNuvioAccessToken({}), '');
  assert.equal(savedNuvioRefreshToken({ nuvioRefresh: 'r1' }), 'r1');
  assert.equal(savedNuvioRefreshToken({ refresh_token: 'r2' }), 'r2');
  assert.equal(savedNuvioRefreshToken({}), '');
});

test('lelibrary collections are recognised for cleanup', () => {
  assert.equal(isLeLibraryCollection({ id: 'collection-lelibrary-franchises' }), true);
  assert.equal(isLeLibraryCollection({ id: 'collection-lelibrary-pack-x' }), true);
  assert.equal(isLeLibraryCollection({ id: 'lelibrary-special' }), true);
  assert.equal(isLeLibraryCollection({ id: 'pack-lelibrary-special-1' }), true);
  assert.equal(isLeLibraryCollection({ title: 'LeLibrary Special' }), true);
  assert.equal(isLeLibraryCollection({ id: 'something-else', title: 'Other' }), false);
  assert.equal(isLeLibraryCollection(null), false);
});

test('nuvio home keys are underscore-delimited', () => {
  assert.equal(nuvioHomeKey('community.lelibrary', 'movie', 'lib-x'), 'community.lelibrary_movie_lib-x');
});

test('a chosen nuvio profile that is gone fails instead of retargeting profile 1', () => {
  const profiles = [
    { profile_index: 1, name: 'Lewis', uses_primary_addons: true },
    { profile_index: 2, name: 'Main2', uses_primary_addons: false },
  ];
  // The reported bug: profile 3 selected, only 1 and 2 exist, push used to
  // quietly go to profile 1.
  const missing = resolveNuvioProfile(profiles, 3);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /no longer on the account/);

  // A live choice is honoured, including a profile added after the setup.
  assert.equal(resolveNuvioProfile(profiles, 2).profile.name, 'Main2');
  assert.equal(resolveNuvioProfile(profiles, '2').profile.profile_index, 2);

  // No choice at all stays the documented first-profile default.
  assert.equal(resolveNuvioProfile(profiles, null).profile.profile_index, 1);
  assert.equal(resolveNuvioProfile(profiles, '').profile.profile_index, 1);

  // And nothing to push to is still an error.
  assert.equal(resolveNuvioProfile([], null).ok, false);
  assert.equal(resolveNuvioProfile([], 4).ok, false);
});
