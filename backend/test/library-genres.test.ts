// @ts-nocheck
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLibraryCatalogId, matchesVariant, isGenreVariant } = require('../src/library/quality-filter.ts');
const genres = require('../src/library/genres.ts');

test('genre row ids parse only for genres TMDB has for that kind', () => {
  assert.deepEqual(parseLibraryCatalogId('torbox-movies-g-horror'), { prefix: 'torbox', kind: 'movies', variant: 'g-horror' });
  assert.deepEqual(parseLibraryCatalogId('rd-series-g-comedy'), { prefix: 'rd', kind: 'series', variant: 'g-comedy' });
  assert.equal(parseLibraryCatalogId('torbox-series-g-horror'), null, 'TMDB has no TV horror genre');
  assert.equal(parseLibraryCatalogId('torbox-movies-g-kids'), null, 'TMDB has no film kids genre');
  assert.equal(parseLibraryCatalogId('torbox-movies-g-nonsense'), null);
  assert.equal(parseLibraryCatalogId('torbox-anime-g-comedy'), null);
  // The quality rows are unchanged.
  assert.deepEqual(parseLibraryCatalogId('torbox-movies-4k'), { prefix: 'torbox', kind: 'movies', variant: '4k' });
});

test('genre rows are not filtered by release name', () => {
  assert.equal(isGenreVariant('g-horror'), true);
  assert.equal(isGenreVariant('4k'), false);
  assert.equal(matchesVariant({ name: 'Plain.Film.1080p' }, 'g-horror'), true);
  assert.equal(matchesVariant({ name: 'Plain.Film.1080p' }, '4k'), false);
});

test('slugs are unique and every genre exists for at least one kind', () => {
  const slugs = genres.GENRES.map((g) => g.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const g of genres.GENRES) assert.ok(g.movie.length || g.tv.length, g.slug);
  assert.ok(genres.genresFor('movies').some((g) => g.slug === 'horror'));
  assert.ok(!genres.genresFor('series').some((g) => g.slug === 'horror'));
  // TMDB merges these for TV: one show row each, never two identical rows.
  const tvIds = genres.genresFor('series').map((g) => g.tv.join(','));
  assert.equal(new Set(tvIds).size, tvIds.length, 'no two show rows share a TMDB genre');
});

test('a TMDB read gives genre ids, remembers gone titles, stops on a rejected key', async () => {
  const reply = (status, data) => async () => { if (status !== 200) { const err = new Error('x'); err.response = { status }; throw err; } return { data }; };
  assert.deepEqual(await genres.fetchGenreIds('k', 'movie', 1, reply(200, { genres: [{ id: 27 }, { id: 53 }] })), [27, 53]);
  assert.deepEqual(await genres.fetchGenreIds('k', 'movie', 1, reply(404)), [], 'gone from TMDB: stored as no genres');
  assert.equal(await genres.fetchGenreIds('k', 'movie', 1, reply(401)), 'rejected');
  assert.equal(await genres.fetchGenreIds('k', 'movie', 1, reply(503)), null, 'try again later');
});

test('the manifest never declares genre rows without the library database', () => {
  const { getConfiguredManifest } = require('../app.ts');
  const config = { provider: 'torbox', torboxApiKey: 'tb-test', tmdbApiKey: 'tmdb-test', wizard: true };
  const homeRows = [{ enabled: true, source: { id: 'torbox-movies-g-horror', catalogId: 'torbox-movies-g-horror', type: 'movie' } }];
  const ids = getConfiguredManifest('http://localhost:7860', config, { integration: 'nuvio', homeRows }).catalogs.map((c) => c.id);
  assert.ok(!ids.includes('torbox-movies-g-horror'));
});

test('with the library database, a picked genre row is declared with its name', () => {
  const engine = require('../src/library/engine.ts');
  const original = engine.isIndexed;
  engine.isIndexed = () => true;
  try {
    const { getConfiguredManifest } = require('../app.ts');
    const row = (id) => ({ id: `r-${id}`, title: id, enabled: true, source: { kind: 'catalog', id, catalogId: id, type: id.includes('-movies-') ? 'movie' : 'series', addonId: '' } });
    const config = { provider: 'torbox', torboxApiKey: 'tb-test', tmdbApiKey: 'tmdb-test', wizard: true };
    const catalogs = getConfiguredManifest('http://localhost:7860', config, { integration: 'nuvio', homeRows: [row('torbox-movies-g-horror'), row('torbox-series-g-comedy')] }).catalogs;
    const horror = catalogs.find((c) => c.id === 'torbox-movies-g-horror');
    assert.ok(horror, 'picked genre row is declared');
    assert.equal(horror.name, '🎬 Your Horror Movies');
    assert.equal(catalogs.find((c) => c.id === 'torbox-series-g-comedy')?.name, '📺 Your Comedy Shows');
    assert.ok(!catalogs.some((c) => c.id === 'torbox-movies-g-drama'), 'unpicked genres stay out of the manifest');
  } finally {
    engine.isIndexed = original;
  }
});
