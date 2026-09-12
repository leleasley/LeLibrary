const test = require('node:test');
const assert = require('node:assert/strict');

const { pickBestResult, seriesSeasonsFromVideos, seasonEpisodesFromVideos } = require('../src/tmdb');

// Exact title + plausible year (±1: festival premiere vs wide release)
// must beat any partial-title match, even a same-year one. Both cases are
// real prod mismatches: an "Old Ways 2020" file matched the Apex short
// (TMDB 1637948) instead of the 2021-dated horror feature, and an
// "Influencer 2023" file matched the "Influencer Life" short instead of
// the feature.

function movie(id, title, release_date, vote_count) {
  return { id, title, release_date, vote_count };
}

const oldWaysShort = movie(1637948, 'Apex Legends Stories from the Outlands "The Old Ways"', '2020-04-02', 5);
const oldWaysFeature = movie(752505, 'The Old Ways', '2021-04-04', 100);
const influencerShort = movie(1159983, 'Influencer Life', '2023-02-24', 8);
const influencerFeature = movie(1197612, 'Influencer', '2022-10-06', 120);

test('exact feature beats same-year short despite year bonus gap', () => {
  assert.equal(pickBestResult('The Old Ways', [oldWaysShort, oldWaysFeature], 2020).id, 752505);
  assert.equal(pickBestResult('The Old Ways', [oldWaysFeature, oldWaysShort], 2020).id, 752505);
});

test('exact feature beats same-year prefix title', () => {
  assert.equal(pickBestResult('Influencer', [influencerShort, influencerFeature], 2023).id, 1197612);
  assert.equal(pickBestResult('Influencer', [influencerFeature, influencerShort], 2023).id, 1197612);
});

test('remakes still resolve by year among exact titles', () => {
  const dune1984 = movie(841, 'Dune', '1984-12-14', 2000);
  const dune2021 = movie(438631, 'Dune', '2021-09-15', 9000);
  assert.equal(pickBestResult('Dune', [dune1984, dune2021], 2021).id, 438631);
  assert.equal(pickBestResult('Dune', [dune2021, dune1984], 1984).id, 841);
});

test('same title and year falls back to votes (weekly-show variants)', () => {
  const a = movie(1, 'Weekly Show', '2020-01-01', 3);
  const b = movie(2, 'Weekly Show Classics', '2020-01-01', 50);
  const main = movie(3, 'Weekly Show', '2020-01-01', 400);
  assert.equal(pickBestResult('Weekly Show', [a, b, main], 2020).id, 3);
});

test('partial match still wins when no exact title exists', () => {
  const prefix = movie(10, 'Foo Bar', '2020-05-01', 20);
  const other = movie(11, 'Baz Foo Qux', '2019-05-01', 500);
  assert.equal(pickBestResult('Foo', [other, prefix], 2020).id, 10);
});

test('exact series title beats a newer higher-year spin-off', () => {
  const show = { id: 66732, name: 'Stranger Things', first_air_date: '2016-07-15', vote_count: 25000 };
  const spinOff = { id: 999999, name: "Stranger Things: Tales from '85", first_air_date: '2025-01-01', vote_count: 400 };
  assert.equal(pickBestResult('Stranger Things', [spinOff, show], 2025).id, 66732);
  assert.equal(pickBestResult('Stranger Things', [show, spinOff], 2025).id, 66732);
  assert.equal(pickBestResult('Stranger Things', [spinOff, show]).id, 66732);
});

test('exact title with no year requested wins on votes', () => {
  const old = movie(20, 'Dune', '1984-12-14', 2000);
  const neu = movie(21, 'Dune', '2021-09-15', 9000);
  assert.equal(pickBestResult('Dune', [old, neu]).id, 21);
});

test('series picker derives seasons and exact episodes from fallback videos', () => {
  const videos = [
    { season: 2, episode: 2, name: 'Second', released: '2025-01-08' },
    { season: 1, number: 1, name: 'Pilot', firstAired: '2024-01-01' },
    { season: 2, episode: 1, name: 'First' },
    { season: 2, episode: 1, name: 'Duplicate' },
    { season: -1, episode: 1 },
  ];
  assert.deepEqual(seriesSeasonsFromVideos(videos), [
    { season: 1, count: 1, name: 'Season 1' },
    { season: 2, count: 2, name: 'Season 2' },
  ]);
  assert.deepEqual(seasonEpisodesFromVideos(videos, 2), [
    { season: 2, episode: 1, name: 'First', released: null },
    { season: 2, episode: 2, name: 'Second', released: '2025-01-08' },
  ]);
});
