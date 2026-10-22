// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  deriveMovieStatus,
  deriveStatusFromDate,
  pickRegionDates,
  deriveEpisodeBadges,
  pickNextEpisode,
  deriveTvStatus,
} = require('../src/releases/status.ts');

test('movie status: released when any known date is in the past', () => {
  assert.equal(deriveMovieStatus({ digital: '2026-01-01', theatrical: null, physical: null }, '2026-06-15'), 'released');
  assert.equal(deriveMovieStatus({ digital: null, theatrical: '2026-01-01', physical: null }, '2026-06-15'), 'released');
  assert.equal(deriveMovieStatus({ digital: null, theatrical: null, physical: '2025-12-01' }, '2026-06-15'), 'released');
});

test('movie status: digital is authoritative even when a cinema date is past', () => {
  // The reported bug: out in cinemas, digital still upcoming.
  assert.equal(deriveMovieStatus({ digital: '2026-10-09', theatrical: '2026-09-01', physical: null }, '2026-10-07'), 'upcoming');
  assert.equal(deriveMovieStatus({ digital: '2026-10-10', theatrical: '2026-09-01', physical: null }, '2026-10-07'), 'upcoming');
  assert.equal(deriveMovieStatus({ digital: '2026-06-15', theatrical: '2026-01-01', physical: null }, '2026-06-15'), 'released');
  assert.equal(deriveMovieStatus({ digital: '2026-06-15', theatrical: null, physical: null }, '2026-06-15'), 'released');
  assert.equal(deriveMovieStatus({ digital: '2026-07-01', theatrical: null, physical: null }, '2026-06-15'), 'upcoming');
});

test('movie status: with no digital date, fall back to cinema/physical', () => {
  assert.equal(deriveMovieStatus({ digital: null, theatrical: '2026-01-01', physical: null }, '2026-06-15'), 'released');
  assert.equal(deriveMovieStatus({ digital: null, theatrical: null, physical: '2025-12-01' }, '2026-06-15'), 'released');
  assert.equal(deriveMovieStatus({ digital: null, theatrical: '2026-07-01', physical: null }, '2026-06-15'), 'upcoming');
});

test('movie status: missing dates are unknown, never released', () => {
  assert.equal(deriveMovieStatus({ digital: null, theatrical: null, physical: null }, '2026-06-15'), 'unknown');
  assert.equal(deriveMovieStatus({ digital: null, theatrical: null, physical: undefined }, '2026-06-15'), 'unknown');
});

test('baseline date status: null is unknown, today/past released, future upcoming', () => {
  assert.equal(deriveStatusFromDate(null, '2026-06-15'), 'unknown');
  assert.equal(deriveStatusFromDate('2026-06-14', '2026-06-15'), 'released');
  assert.equal(deriveStatusFromDate('2026-06-15', '2026-06-15'), 'released');
  assert.equal(deriveStatusFromDate('2026-06-16', '2026-06-15'), 'upcoming');
});

test('pickRegionDates prefers the requested region, then US, then first', () => {
  const results = [
    { iso_3166_1: 'FR', release_dates: [{ type: 4, release_date: '2026-01-01T00:00:00.000Z' }] },
    { iso_3166_1: 'US', release_dates: [{ type: 4, release_date: '2026-02-01T00:00:00.000Z' }] },
    { iso_3166_1: 'GB', release_dates: [
      { type: 3, release_date: '2026-03-01T00:00:00.000Z' },
      { type: 4, release_date: '2026-03-20T00:00:00.000Z' },
      { type: 4, release_date: '2026-03-10T00:00:00.000Z' },
    ] },
  ];
  const gb = pickRegionDates(results, 'GB');
  assert.equal(gb.digital, '2026-03-10'); // earliest digital wins
  assert.equal(gb.theatrical, '2026-03-01');
  assert.equal(gb.physical, null);

  const de = pickRegionDates(results, 'DE'); // missing -> US fallback
  assert.equal(de.digital, '2026-02-01');

  const empty = pickRegionDates([], 'GB');
  assert.deepEqual(empty, { digital: null, theatrical: null, physical: null });
  assert.deepEqual(pickRegionDates(null, 'GB'), { digital: null, theatrical: null, physical: null });
});

test('pickRegionDates treats non-date strings as absent', () => {
  const results = [{ iso_3166_1: 'GB', release_dates: [{ type: 4, release_date: '' }, { type: 4 }] }];
  assert.deepEqual(pickRegionDates(results, 'GB'), { digital: null, theatrical: null, physical: null });
});

test('episode badges: structural premieres, guarded finale', () => {
  assert.deepEqual(deriveEpisodeBadges({ season: 1, episode: 1 }), { seriesPremiere: true, seasonPremiere: false, finale: false });
  assert.deepEqual(deriveEpisodeBadges({ season: 2, episode: 1 }), { seriesPremiere: false, seasonPremiere: true, finale: false });
  assert.deepEqual(deriveEpisodeBadges({ season: 2, episode: 5 }), { seriesPremiere: false, seasonPremiere: false, finale: false });
  assert.deepEqual(
    deriveEpisodeBadges({ season: 4, episode: 10, isLastEpisodeOfSeries: true, showEnded: true }),
    { seriesPremiere: false, seasonPremiere: false, finale: true },
  );
  // A last episode of a still-running show is not a finale.
  assert.equal(deriveEpisodeBadges({ season: 4, episode: 10, isLastEpisodeOfSeries: true, showEnded: false }).finale, false);
  // A finale flag without the last-episode marker is not claimed.
  assert.equal(deriveEpisodeBadges({ season: 4, episode: 9, isLastEpisodeOfSeries: false, showEnded: true }).finale, false);
});

test('pickNextEpisode extracts the summary or returns null', () => {
  const detail = {
    next_episode_to_air: { air_date: '2026-07-04', season_number: 3, episode_number: 2, name: 'Part Two' },
  };
  assert.deepEqual(pickNextEpisode(detail), { airDate: '2026-07-04', season: 3, episode: 2, name: 'Part Two' });
  assert.equal(pickNextEpisode({ next_episode_to_air: null }), null);
  assert.equal(pickNextEpisode({ next_episode_to_air: { season_number: 1 } }), null);
  assert.equal(pickNextEpisode(null), null);
});

test('tv status from next/last air dates', () => {
  assert.equal(deriveTvStatus(null, '2026-06-01', '2026-06-15'), 'released');
  assert.equal(deriveTvStatus(null, '2026-06-15', '2026-06-15'), 'released');
  assert.equal(deriveTvStatus('2026-07-01', '2026-06-01', '2026-06-15'), 'released');
  assert.equal(deriveTvStatus('2026-07-01', null, '2026-06-15'), 'upcoming');
  assert.equal(deriveTvStatus('2026-06-15', null, '2026-06-15'), 'released');
  assert.equal(deriveTvStatus('2026-06-01', null, '2026-06-15'), 'released');
  assert.equal(deriveTvStatus(null, null, '2026-06-15'), 'unknown');
});
