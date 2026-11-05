// @ts-nocheck
'use strict';
// Content filters (5.9.7): the eleven categories, the anime switch alias and
// the meta/library filters. Pure functions, no network, no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const filters = require('../src/catalog/content-filters.ts');

const state = (config) => filters.normalizeContentFilters(config);

test('the eleven categories are the operator list, in order', () => {
  assert.deepEqual(filters.CONTENT_CATEGORIES.map((category) => category.id), [
    'anime', 'animation', 'reality', 'talk', 'kids', 'family', 'musical', 'documentary', 'news', 'soap', 'horror',
  ]);
  assert.deepEqual(filters.CONTENT_CATEGORIES.map((category) => category.label), [
    'Anime', 'Animation', 'Reality TV', 'Talk Shows', 'Kids', 'Family', 'Musical', 'Documentary', 'News', 'Soap Operas', 'Horror',
  ]);
});

test('normalizeContentFilters: known ids only, Anime implies Hide anime', () => {
  assert.deepEqual(state({}), { hideAnime: false, hideAdult: false, excludeCategories: [] });
  // Not an array: ignored, never guessed.
  assert.deepEqual(state({ excludeCategories: 'horror' }).excludeCategories, []);
  // Unknown ids drop out, order follows the UI list.
  assert.deepEqual(state({ excludeCategories: ['nope', 'horror', 'news', 7] }).excludeCategories, ['news', 'horror']);
  // The Anime category IS Hide anime, both directions.
  assert.equal(state({ excludeCategories: ['anime'] }).hideAnime, true);
  assert.deepEqual(state({ hideAnime: true }).excludeCategories, []);
  assert.equal(filters.hideAnime({ excludeCategories: ['anime'] }), true);
  assert.equal(filters.hideAnime({ hideAnime: 'yes' }), false, 'only a real true counts');
  assert.equal(filters.hideAnime({}), false);
});

test('libraryRules skips Anime (already answered by hideAnime) and keeps kind-specific rules', () => {
  const movies = filters.libraryRules(state({ excludeCategories: ['anime', 'horror', 'reality'] }), 'movies');
  // Horror has a movie rule; Reality TV does not.
  assert.deepEqual(movies, [{ genres: [27] }]);
  const series = filters.libraryRules(state({ excludeCategories: ['anime', 'horror', 'reality'] }), 'series');
  assert.deepEqual(series, [{ genres: [10764] }, { keywords: [315058] }]);
});

test('metaExcluded: anime, genre ids and adult content; missing facts keep a title', () => {
  const s = state({ hideAnime: true, excludeCategories: ['horror', 'family'] });
  assert.equal(filters.metaExcluded({ _anime: true }, s, 'movie'), true);
  assert.equal(filters.metaExcluded({ _genres: [27] }, s, 'movie'), true, 'Horror by genre id');
  assert.equal(filters.metaExcluded({ _genres: [10751] }, s, 'movie'), true, 'Family by genre id');
  assert.equal(filters.metaExcluded({ _genres: [28] }, s, 'movie'), false);
  // Nothing known: never hidden.
  assert.equal(filters.metaExcluded({}, s, 'movie'), false);
  assert.equal(filters.metaExcluded({ _genres: [18] }, s, 'series'), false, 'TV has no Horror genre id');
});

test('hideAdultContent: TMDB adult flag and NC-17 / X / TV-MA only', () => {
  const s = state({ hideAdultContent: true });
  assert.equal(filters.metaExcluded({ _adult: true }, s, 'movie'), true);
  assert.equal(filters.metaExcluded({ _cert: 'NC-17' }, s, 'movie'), true);
  assert.equal(filters.metaExcluded({ _cert: 'x' }, s, 'movie'), true);
  assert.equal(filters.metaExcluded({ _cert: 'TV-MA' }, s, 'tv'), true);
  // R and PG-13 stay, and a show's certification is not read as a film one.
  assert.equal(filters.metaExcluded({ _cert: 'R' }, s, 'movie'), false);
  assert.equal(filters.metaExcluded({ _cert: 'NC-17' }, s, 'tv'), false);
  // Off by default.
  assert.equal(filters.metaExcluded({ _adult: true }, state({}), 'movie'), false);
});

test('factsExcluded uses the full rule (keywords and language)', () => {
  const s = state({ excludeCategories: ['anime', 'musical'] });
  assert.equal(filters.factsExcluded({ genre_ids: [16], keyword_ids: [], orig_lang: 'ja' }, s, 'movies'), true, 'anime by language');
  assert.equal(filters.factsExcluded({ genre_ids: [16], keyword_ids: [], orig_lang: 'en' }, s, 'movies'), false, 'western animation is not anime');
  assert.equal(filters.factsExcluded({ genre_ids: [35], keyword_ids: [4344], orig_lang: 'en' }, s, 'movies'), true, 'musical by keyword');
  assert.equal(filters.factsExcluded({ genre_ids: [35], keyword_ids: [], orig_lang: 'en' }, s, 'movies'), false);
});

test('excludeCategoriesForConfig returns only known slugs', () => {
  assert.deepEqual(filters.excludeCategoriesForConfig(['horror', 'bogus']), ['horror']);
  assert.deepEqual(filters.excludeCategoriesForConfig('horror'), []);
  assert.deepEqual(filters.excludeCategoriesForConfig(undefined), []);
});
