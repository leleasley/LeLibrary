const test = require('node:test');
const assert = require('node:assert/strict');
const { isRotationEligible, rotationFor, applyRotation } = require('../src/catalog-rotation');

const DAY_ONE = new Date('2026-09-01T12:00:00Z');
const DAY_TWO = new Date('2026-09-02T12:00:00Z');

function definition(overrides = {}) {
  return {
    id: 'genre_horror_movies', type: 'movie', group: '🎭 Genres',
    handler: 'tmdb_genre', params: { genreId: 27, sort: 'popularity.desc' },
    ...overrides,
  };
}

test('only broad TMDB discover sources rotate', () => {
  assert.equal(isRotationEligible(definition()), true);
  assert.equal(isRotationEligible(definition({ handler: 'tmdb_person' })), false);
  assert.equal(isRotationEligible(definition({ handler: 'mdb_list' })), false);
  assert.equal(isRotationEligible(definition({ group: '📚 Film Collections', handler: 'tmdb_keyword' })), false);
  assert.equal(isRotationEligible(definition({ id: 'genre_horror_toprated_movies' })), false);
  assert.equal(isRotationEligible(definition({ id: 'genre_horror_latest_movies', params: { sort: 'release_date.desc' } })), false);
});

test('daily rotation is deterministic, source-specific, and preserves its core filters', () => {
  const first = rotationFor(definition(), { date: DAY_ONE, now: DAY_ONE });
  assert.deepEqual(first, rotationFor(definition(), { date: DAY_ONE, now: DAY_ONE }));
  assert.notDeepEqual(first, rotationFor(definition(), { date: DAY_TWO, now: DAY_TWO }));
  const { definition: effective, rotation } = applyRotation(definition(), { date: DAY_ONE, now: DAY_ONE });
  assert.equal(effective.params.genreId, 27);
  assert.equal(effective.params.sort, 'popularity.desc');
  assert.equal(effective.params.rotation['primary_release_date.gte'].endsWith('-01-01'), true);
  assert.equal(rotation.slot, '2026-09-01');
});

test('TV rotation uses first-air-date filters', () => {
  const result = rotationFor(definition({ id: 'streaming_netflix_series', type: 'series', handler: 'tmdb_provider', group: '🎬 Streaming', params: { providerId: 8 } }), { date: DAY_ONE, now: DAY_ONE });
  assert.ok(result.filters['first_air_date.gte']);
  assert.equal(result.filters['primary_release_date.gte'], undefined);
});
