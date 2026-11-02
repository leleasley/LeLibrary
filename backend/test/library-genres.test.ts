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

test('slugs are unique, rules are well formed, show rows never duplicate', () => {
  const slugs = genres.GENRES.map((g) => g.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const g of genres.GENRES) {
    assert.ok(g.movie || g.tv, g.slug);
    assert.match(g.slug, /^[a-z0-9]+$/);
    for (const rule of [g.movie, g.tv].filter(Boolean)) {
      assert.ok(rule.genres?.length || rule.keywords?.length || rule.langs?.length, `${g.slug} matches something`);
    }
  }
  assert.ok(genres.GENRES.length >= 80, 'every genre, theme and world cinema');
  assert.ok(genres.genresFor('movies').some((g) => g.slug === 'horror'));
  assert.ok(!genres.genresFor('series').some((g) => g.slug === 'horror'));
  const tvRules = genres.genresFor('series').map((g) => JSON.stringify(g.tv));
  assert.equal(new Set(tvRules).size, tvRules.length, 'no two show rows share a rule');
  const names = genres.genresFor('series').map((g) => genres.nameFor(g, 'series').toLowerCase());
  assert.equal(new Set(names).size, names.length, 'show names are unique (the Genres folder finds a genre by name)');
});

test('rules: genres or keywords, language, needed and excluded genres', () => {
  const facts = (genre_ids, keyword_ids = [], orig_lang = 'en') => ({ genre_ids, keyword_ids, orig_lang });
  const rule = (slug, kind = 'movies') => genres.genreBySlug(slug)[kind === 'movies' ? 'movie' : 'tv'];
  assert.equal(genres.matchesRule(rule('horror'), facts([27])), true);
  assert.equal(genres.matchesRule(rule('zombie'), facts([27], [12377])), true);
  assert.equal(genres.matchesRule(rule('zombie'), facts([27], [])), false);
  assert.equal(genres.matchesRule(rule('anime'), facts([16], [], 'ja')), true);
  assert.equal(genres.matchesRule(rule('anime'), facts([16], [], 'en')), false, 'western animation is not anime');
  assert.equal(genres.matchesRule(rule('japanese'), facts([18], [], 'ja')), true);
  assert.equal(genres.matchesRule(rule('japanese'), facts([16], [], 'ja')), false, 'Japanese live action leaves anime out');
  assert.equal(genres.matchesRule(rule('kdrama', 'series'), facts([18], [], 'ko')), true);
  assert.equal(genres.matchesRule(rule('kdrama', 'series'), facts([10764], [], 'ko')), false, 'K-Drama needs drama');
  assert.equal(genres.genreByName('series', 'Action & Adventure')?.slug, 'action');
  assert.equal(genres.genreByName('movies', 'horror')?.slug, 'horror');
  assert.equal(genres.genreByName('series', 'Horror'), null);
});

test('rules become SQL with parameters only', () => {
  const params = ['movie'];
  const sql = genres.ruleSql(genres.genreBySlug('japanese').movie, params);
  assert.match(sql, /orig_lang = ANY\(\$2::text\[\]\) AND NOT \(genre_ids && \$3::int\[\]\)/);
  assert.deepEqual(params, ['movie', ['ja'], [16]]);
});

test('one TMDB read gives genres, keywords and language; gone titles are remembered', async () => {
  const reply = (status, data) => async (url, opts) => {
    assert.equal(opts.params.append_to_response, 'keywords', 'one request, keywords appended');
    if (status !== 200) { const err = new Error('x'); err.response = { status }; throw err; }
    return { data };
  };
  assert.deepEqual(await genres.fetchFacts('k', 'movie', 1, reply(200, { genres: [{ id: 27 }], keywords: { keywords: [{ id: 12377 }] }, original_language: 'en' })),
    { genreIds: [27], keywordIds: [12377], lang: 'en' });
  assert.deepEqual(await genres.fetchFacts('k', 'tv', 1, reply(200, { genres: [{ id: 18 }], keywords: { results: [{ id: 9672 }] }, original_language: 'ko' })),
    { genreIds: [18], keywordIds: [9672], lang: 'ko' }, 'shows list keywords under results');
  assert.deepEqual(await genres.fetchFacts('k', 'movie', 1, reply(404)), { genreIds: [], keywordIds: [], lang: null });
  assert.equal(await genres.fetchFacts('k', 'movie', 1, reply(401)), 'rejected');
  assert.equal(await genres.fetchFacts('k', 'movie', 1, reply(503)), null);
});

test('the Hub Genres folder gets one tab per owned genre, and is dropped when empty', () => {
  const { withHubExtras, expandHubGenres, compileCollectionPlan } = require('../src/catalog/collection-plan.ts');
  const hub = { id: 'collection-lelibrary-hub', title: 'LeLibrary', folders: [
    { id: 'folder-lelibrary-hub-movies', title: 'Movies', tileShape: 'LANDSCAPE', catalogSources: [{ addonId: '', catalogId: 'rd-movies', type: 'movie', genre: '' }] },
  ] };
  const withExtras = withHubExtras(hub);
  const placeholder = withExtras.folders.find((f) => f.id === 'folder-lelibrary-hub-genres');
  assert.deepEqual(placeholder.catalogSources.map((s) => s.catalogId), ['rd-movies-genres', 'rd-series-genres']);
  const counts = [
    { slug: 'drama', kind: 'movies', name: 'Drama', count: 40 },
    { slug: 'crime', kind: 'series', name: 'Crime', count: 12 },
    { slug: 'horror', kind: 'movies', name: 'Horror', count: 11 },
    { slug: 'western', kind: 'movies', name: 'Western', count: 2 },
  ];
  const [expanded] = expandHubGenres([hub], counts);
  const tabs = expanded.folders.find((f) => f.id === 'folder-lelibrary-hub-genres').catalogSources;
  assert.deepEqual(tabs.map((t) => `${t.catalogId}:${t.genre}`), ['rd-movies-genres:Drama', 'rd-series-genres:Crime', 'rd-movies-genres:Horror']);
  // Not expanded (no push, or nothing owned yet): the folder never goes out empty.
  const plain = compileCollectionPlan({ collections: [hub], integration: 'nuvio' }).collections[0];
  assert.ok(!plain.folders.some((f) => f.id === 'folder-lelibrary-hub-genres'));
  const filled = compileCollectionPlan({ collections: [expanded], integration: 'nuvio' }).collections[0];
  assert.ok(filled.folders.some((f) => f.id === 'folder-lelibrary-hub-genres'));
  // A small library still gets a few tabs (3+ titles) rather than none.
  const [small] = expandHubGenres([hub], [{ slug: 'drama', kind: 'movies', name: 'Drama', count: 5 }, { slug: 'comedy', kind: 'movies', name: 'Comedy', count: 4 }]);
  assert.equal(small.folders.find((f) => f.id === 'folder-lelibrary-hub-genres').catalogSources.length, 2);
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
    assert.ok(!catalogs.some((c) => c.id === 'torbox-movies-genres'), 'no Genres folder catalogue without a Hub');
  } finally {
    engine.isIndexed = original;
  }
});

test('a Hub declares the two Movies / Shows by-genre catalogues with every genre name', () => {
  const engine = require('../src/library/engine.ts');
  const original = engine.isIndexed;
  engine.isIndexed = () => true;
  try {
    const { getConfiguredManifest } = require('../app.ts');
    const config = { provider: 'torbox', torboxApiKey: 'tb-test', tmdbApiKey: 'tmdb-test', wizard: true };
    const catalogs = getConfiguredManifest('http://localhost:7860', config, { integration: 'nuvio', qualityRefs: ['torbox-movies-genres', 'torbox-series-genres'] }).catalogs;
    const movies = catalogs.find((c) => c.id === 'torbox-movies-genres');
    const shows = catalogs.find((c) => c.id === 'torbox-series-genres');
    assert.equal(movies?.name, 'Movies');
    assert.equal(shows?.name, 'Shows');
    const genre = movies.extra.find((e) => e.name === 'genre');
    assert.equal(genre.isRequired, true);
    assert.ok(genre.options.includes('Horror') && genre.options.includes('Zombies') && genre.options.includes('Anime'));
    assert.ok(shows.extra.find((e) => e.name === 'genre').options.includes('Action & Adventure'));
    assert.equal(movies.showInHome, false);
  } finally {
    engine.isIndexed = original;
  }
});
