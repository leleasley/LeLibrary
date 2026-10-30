// @ts-nocheck
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { currentSeason, compactMap, mapItems, fetchSeason } = require('../src/catalog/anilist-season.ts');
const { getSourceDefinition } = require('../src/catalog/catalog-source-registry.ts');

test('the season follows AniList months', () => {
  assert.equal(currentSeason(new Date(Date.UTC(2026, 0, 5))).key, '2026-winter');
  assert.equal(currentSeason(new Date(Date.UTC(2026, 3, 1))).key, '2026-spring');
  assert.equal(currentSeason(new Date(Date.UTC(2026, 8, 30))).key, '2026-summer');
  assert.equal(currentSeason(new Date(Date.UTC(2026, 9, 30))).key, '2026-fall');
});

test('the id map keeps IMDb (list or string) and TMDB tv ids, nothing else', () => {
  const map = compactMap([
    { anilist_id: 21, imdb_id: ['tt0388629'], themoviedb_id: { tv: 37854 }, type: 'TV' },
    { anilist_id: 5, imdb_id: 'tt1234567', type: 'TV' },
    { anilist_id: 7, themoviedb_id: { movie: [999] }, type: 'MOVIE' },
    { anilist_id: 8, imdb_id: ['nope'], type: 'TV' },
    { mal_id: 3, imdb_id: ['tt7654321'] },
  ]);
  assert.deepEqual(map['21'], { imdb: 'tt0388629', tv: 37854 });
  assert.deepEqual(map['5'], { imdb: 'tt1234567' });
  assert.equal(map['7'], undefined, 'a film with no IMDb id is no help to a series row');
  assert.equal(map['8'], undefined);
  assert.equal(Object.keys(map).length, 2);
});

test('season items keep AniList order, drop unknown titles and merge later seasons', () => {
  const map = { 1: { imdb: 'tt1', tv: 10 }, 2: { imdb: 'tt1', tv: 10 }, 3: { tv: 30 } };
  const rows = mapItems([
    { anilistId: 3, title: 'Third' }, { anilistId: 9, title: 'Unknown' },
    { anilistId: 1, title: 'Show S2', year: 2026 }, { anilistId: 2, title: 'Show S3' },
  ], map);
  assert.deepEqual(rows, [
    { imdbId: null, tmdbId: 30, title: 'Third' },
    { imdbId: 'tt1', tmdbId: 10, title: 'Show S2', year: 2026 },
  ]);
});

test('the AniList query asks for the season by popularity, safe titles only', async () => {
  const calls = [];
  const request = async (url, body) => {
    calls.push(body);
    return { data: { data: { Page: { pageInfo: { hasNextPage: calls.length < 2 }, media: [{ id: calls.length, title: { romaji: 'R', english: calls.length === 1 ? 'E' : null }, startDate: { year: 2026 } }] } } } };
  };
  const items = await fetchSeason('FALL', 2026, request);
  assert.deepEqual(items.map((i) => [i.anilistId, i.title]), [[1, 'E'], [2, 'R']]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].variables, { season: 'FALL', year: 2026, page: 1, perPage: 50 });
  assert.match(calls[0].query, /isAdult: false/);
  assert.match(calls[0].query, /POPULARITY_DESC/);
});

test('Anime This Season is an available, key-free anime row', () => {
  const def = getSourceDefinition('anime_season_series');
  assert.equal(def.available, true);
  assert.equal(def.type, 'series');
  assert.equal(def.handler, 'anilist_season');
});

export interface AnilistSeasonTestModule {};
