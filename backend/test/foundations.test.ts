// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');

const { guessMediaInfo, clearParseCache } = require('../src/media/parser.ts');
const { normalizePublicId, isPublicCollectionId } = require('../src/media/identity.ts');
const { searchCatalog } = require('../src/media/search.ts');
const { getSourceDefinition, listSources, validateSourceDefinitions } = require('../src/catalog/catalog-source-registry.ts');
const { listQuickPicks, validateQuickPicks } = require('../src/catalog/catalog-quick-picks.ts');
const { listCuratedCollections, buildCuratedCollections, curatedSourceIds, validateCuratedCollections } = require('../src/catalog/curated-collections.ts');
const { compileCollectionPlan } = require('../src/catalog/collection-plan.ts');

test('parser memoises results without changing parsed identity', () => {
  clearParseCache();
  const first = guessMediaInfo('The.Matrix.1999.1080p.mkv');
  const second = guessMediaInfo('The.Matrix.1999.1080p.mkv');
  assert.equal(first, second);
  assert.equal(first.title, 'The Matrix');
  assert.equal(first.year, 1999);
});
test('public ID namespaces stay explicit', () => {
  const publicIds = [normalizePublicId('tt1234567'), normalizePublicId('12345', 'kitsu')];
  for (const id of publicIds) {
    assert.equal(id.startsWith('torbox:'), false);
  }
  assert.equal('torbox:movie:278'.startsWith('torbox:'), true);
  assert.equal(isPublicCollectionId('torbox:movie:278'), false);
  assert.equal(isPublicCollectionId('tt1234567'), true);
  assert.equal(isPublicCollectionId('kitsu:12345'), true);
});
test('search safely returns empty results for incomplete requests', async () => {
  assert.deepEqual(await searchCatalog({ apiKey: '', query: 'Oppenheimer', type: 'movie' }), []);
  assert.deepEqual(await searchCatalog({ apiKey: 'synthetic', query: 'x', type: 'movie' }), []);
});

test('catalog source registry exposes stable, usable source contracts', () => {
  const validation = validateSourceDefinitions();
  assert.equal(validation.ok, true);
  assert.ok(validation.total >= 400);
  const inTheaters = getSourceDefinition('now_playing_movies');
  assert.equal(inTheaters.name, 'In Theaters');
  assert.equal(inTheaters.available, true);
  const top250 = listSources().find((source) => source.id === 'trending_imdb_top100_movies');
  assert.equal(top250.name, 'IMDb Top 250');
  assert.equal(top250.catalogId, 'lib-trending_imdb_top100_movies');
  const nolan = getSourceDefinition('director_nolan_movies');
  assert.equal(nolan.available, true);
  assert.equal(nolan.handler, 'tmdb_person');
  assert.equal(nolan.params.director, true);
  const decade = getSourceDefinition('decade_2020s_movies');
  assert.equal(decade.available, true);
  assert.equal(decade.handler, 'tmdb_discover');
  assert.equal(getSourceDefinition('language_japanese_series').type, 'series');
  assert.equal(getSourceDefinition('country_south_korea_movies').available, true);
});

test('streaming source labels distinguish provider, latest and top-ten lists', () => {
  const names = new Map(listSources().map((source) => [source.catalogId, source.name]));
  assert.equal(names.get('lib-streaming_netflix_movies'), 'Netflix Movies');
  assert.equal(names.get('lib-streaming_latest_netflix_movies'), 'Latest Netflix Movies');
  assert.equal(names.get('lib-streaming_netflix_top10_movies'), 'Top 10 Netflix Movies in Canada');
  assert.equal(getSourceDefinition('snoak_latest_netflix_movies').params.listName, 'Latest Netflix Movies');
});

test('quick picks only contain available, published catalog sources', () => {
  const validation = validateQuickPicks();
  assert.equal(validation.ok, true);
  const movieNight = listQuickPicks().find((pick) => pick.id === 'movie-night');
  assert.ok(movieNight.sources.some((source) => source.catalogId === 'lib-now_playing_movies'));
  assert.ok(movieNight.sources.every((source) => source.catalogId.startsWith('lib-')));
  const traktPublic = listQuickPicks().find((pick) => pick.id === 'trakt-public');
  assert.ok(traktPublic.sources.some((source) => source.sourceId === 'trakt_trending_movies'));
  assert.equal(traktPublic.sources.length, 6);
});

test('curated Nuvio packs only reference valid LeLibrary sources', () => {
  assert.deepEqual(curatedSourceIds([]), [], 'no pack ids means no curated sources/folders');
  assert.ok(curatedSourceIds(['genres']).includes('genre_action_movies'), 'nuvioCollectionPacks selects the genre pack');
  const validation = validateCuratedCollections();
  assert.equal(validation.ok, true);
  assert.ok(validation.packs >= 34);
  for (const id of ['preset-just-added', 'preset-family-night', 'preset-hidden-gems', 'preset-documentaries', 'preset-weekend-binge', 'preset-action-rush', 'preset-holiday-comfort', 'preset-directors', 'preset-decades', 'preset-world-cinema', 'preset-latest-streaming', 'preset-top-rated', 'preset-studio-spotlight']) {
    assert.equal(buildCuratedCollections([id]).length, 1, `${id} should be available in the wizard`);
  }
  assert.ok(validation.folders >= 170);
  const directors = buildCuratedCollections(['preset-directors']);
  assert.equal(directors[0].folders.length, 30);
  assert.ok(directors[0].folders.every((folder) => folder.catalogSources[0].catalogId.startsWith('lib-director_')));
  const decades = buildCuratedCollections(['preset-decades']);
  assert.deepEqual(
    decades[0].folders.find((folder) => folder.title === '2020s').catalogSources.map((source) => source.type).sort(),
    ['movie', 'series'],
  );
  const worldCinema = buildCuratedCollections(['preset-world-cinema']);
  assert.ok(worldCinema[0].folders.every((folder) => folder.catalogSources.every((source) => source.catalogId.startsWith('lib-language_'))));
  // 5.8 retired the community pack covers: the picker uses the generated
  // pack cover and no pushed collection names a retired file.
  for (const id of ['preset-directors', 'preset-decades', 'preset-world-cinema']) {
    const pack = listCuratedCollections().find((item) => item.id === id);
    assert.equal(pack?.coverImageUrl, '');
    assert.equal(pack?.backdropUrl, '');
    assert.ok(pack?.generatedCoverUrl);
    assert.equal(buildCuratedCollections([id])[0].backdropUrl, '');
  }
  const weekendBinge = listCuratedCollections().find((pack) => pack.id === 'preset-weekend-binge');
  assert.equal(weekendBinge.category, 'Discover');
  assert.equal(weekendBinge.refresh, 'daily');
  const actors = buildCuratedCollections(['actors']);
  assert.equal(actors.length, 1);
  assert.equal(actors[0].pinToTop, false);
  assert.ok(actors[0].folders.every((folder) => folder.catalogSources[0].catalogId.startsWith('lib-')));
  const discover = buildCuratedCollections(['discover']);
  const trending = discover[0].folders.find((folder) => folder.title === 'Trending');
  assert.deepEqual(trending.catalogSources.map((source) => source.type), ['movie', 'series']);
  assert.equal(discover[0].viewMode, 'TABBED_GRID');
  const configured = buildCuratedCollections(['discover'], { discover: { settings: { viewMode: 'FOLLOW_LAYOUT', pinToTop: true, showAllTab: false, focusGlowEnabled: false } } });
  assert.equal(configured[0].viewMode, 'FOLLOW_LAYOUT');
  assert.equal(configured[0].pinToTop, true);
  assert.equal(configured[0].showAllTab, false);
  assert.equal(configured[0].focusGlowEnabled, false);
  assert.ok(curatedSourceIds(['streaming', 'actors']).includes('streaming_netflix_movies'));
  assert.ok(curatedSourceIds(['streaming', 'actors']).includes('actor_keanu_reeves_movies'));
  const special = buildCuratedCollections(['lelibrary-special']);
  assert.deepEqual(special.map((collection) => collection.title), ['Discover', 'Streaming Services', 'Film Collections', 'Genres', 'Studios', 'Themes & Moods', 'Actors']);
  assert.ok(special.every((collection) => collection.folders.length > 0));
  assert.ok(special.some((collection) => collection.title === 'Studios'));
  assert.ok(special.some((collection) => collection.title === 'Actors'));
  assert.ok(curatedSourceIds(['lelibrary-special']).includes('streaming_netflix_movies'));
  assert.equal(buildCuratedCollections(['lelibrary-special', 'studios', 'actors']).length, special.length);
});

test('Hide anime removes only anime catalogue sources from curated folders', () => {
  const studios = buildCuratedCollections(['studios'], {}, { hideAnime: true });
  assert.equal(studios.length, 1);
  assert.equal(studios[0].folders.some((folder) => /studio ghibli/i.test(folder.title)), false);
  assert.ok(studios[0].folders.every((folder) => folder.catalogSources.length > 0));
});

test('curated Nuvio artwork overrides are applied to the token payload', () => {
  const collections = buildCuratedCollections(['discover'], {
    discover: {
      folders: {
        'folder-lelibrary-discover-trending-movies': {
          title: 'My Trending Movies',
          coverImageUrl: 'https://example.test/trending.png',
          focusGifUrl: 'https://example.test/trending.gif',
          focusGifEnabled: true,
          heroBackdropUrl: 'https://example.test/trending-backdrop.jpg',
          titleLogoUrl: 'https://example.test/trending-logo.png',
        },
      },
    },
  });
  const folder = collections[0].folders.find((item) => item.id === 'folder-lelibrary-discover-trending-movies');
  assert.equal(folder.title, 'My Trending Movies');
  assert.equal(folder.coverImageUrl, 'https://example.test/trending.png');
  assert.equal(folder.focusGifEnabled, true);
  assert.equal(folder.heroBackdropUrl, 'https://example.test/trending-backdrop.jpg');
  assert.equal(folder.titleLogoUrl, 'https://example.test/trending-logo.png');
  assert.equal(folder.catalogSources[0].catalogId, 'lib-trending_movies');
});

test('collection plan keeps wizard folders and Home rows on one manifest contract', () => {
  const plan = compileCollectionPlan({
    manifestId: 'community.lelibrary.dev',
    homeRows: [
      { enabled: true, order: 1, source: { id: 'torbox-trending-movies', type: 'movie' } },
      { enabled: true, order: 0, source: { catalogId: 'lib-now_playing_movies', type: 'movie' } },
    ],
    collections: [{ folders: [{ catalogSources: [
      { catalogId: 'lib-streaming_netflix_movies', type: 'movie' },
      { addonId: 'other.addon', addonUrl: 'https://example.test/manifest.json', catalogId: 'movies', type: 'movie' },
    ] }] }],
  });
  assert.deepEqual(plan.libraryIds.sort(), ['now_playing_movies', 'streaming_netflix_movies']);
  assert.deepEqual(plan.selectedCatalogIds.sort(), ['lib-now_playing_movies', 'torbox-trending-movies']);
  assert.equal(plan.externalAddons.length, 1);
  assert.equal(plan.externalAddons[0].addonId, 'other.addon');
  assert.equal(plan.collections[0].folders[0].catalogSources[0].addonId, 'community.lelibrary.dev');
  // The folder must point at the catalogue the manifest actually advertises,
  // never at a comma-suffixed internal id, and carry the readable label Nuvio
  // renders on the folder tab (which the catalogue handler resolves back).
  assert.equal(plan.collections[0].folders[0].catalogSources[0].catalogId, 'lelibrary-curated-movie');
  assert.equal(plan.collections[0].folders[0].catalogSources[0].genre, 'Netflix Movies');
  assert.ok(!plan.collections[0].folders[0].catalogSources[0].catalogId.includes(','));
  const { resolveCuratedSourceLabel } = require('../src/catalog/curated-collections.ts');
  assert.equal(resolveCuratedSourceLabel('Netflix Movies', 'movie'), 'streaming_netflix_movies');
  const stremioPlan = compileCollectionPlan({
    integration: 'stremio',
    collections: [{ folders: [{ catalogSources: [{ catalogId: 'lib-streaming_netflix_movies', type: 'movie' }] }] }],
  });
  assert.equal(stremioPlan.collections[0].folders[0].catalogSources[0].catalogId, 'lib-streaming_netflix_movies');
});

test('Nuvio keeps the franchise backing catalogue out of Home rows', () => {
  const plan = compileCollectionPlan({
    integration: 'nuvio',
    homeRows: [
      { enabled: true, order: 0, source: { catalogId: 'torbox-collections', type: 'movie' } },
      { enabled: true, order: 1, source: { catalogId: 'torbox-movies', type: 'movie' } },
    ],
  });
  assert.deepEqual(plan.homeRows.map((row) => row.source.catalogId), ['torbox-movies']);
});

test('collection plan compiles private imports into exact manifest routes with human genres', () => {
  const { normalizeImportedSourceDefinition } = require('../src/import-sources/definition.ts');
  const source = normalizeImportedSourceDefinition({
    provider: 'tmdb', engine: 'list', mediaType: 'movie', params: { listId: 987 },
    label: 'New Action Movies', provenance: { adapter: 'legacy-import', originHash: 'synthetic' },
  });
  const plan = compileCollectionPlan({
    integration: 'nuvio', manifestId: 'community.lelibrary.dev', sources: [source],
    collections: [{ folders: [{ catalogSources: [{ catalogId: source.id, type: 'movie', title: 'New Action Movies' }] }] }],
  });
  assert.equal(plan.collections[0].folders[0].catalogSources[0].catalogId, 'lelibrary-import-movie');
  assert.equal(plan.collections[0].folders[0].catalogSources[0].genre, 'New Action Movies');
  assert.deepEqual(plan.importedTypes, ['movie']);

  const stremio = compileCollectionPlan({
    integration: 'stremio', sources: [source],
    collections: [{ folders: [{ catalogSources: [{ catalogId: source.id, type: 'movie', title: 'New Action Movies' }] }] }],
  });
  assert.deepEqual(stremio.collections[0].folders[0].catalogSources, []);
});

test('collection plan rejects a private reference without an authorized context definition', () => {
  const plan = compileCollectionPlan({
    integration: 'nuvio',
    collections: [{ folders: [{ catalogSources: [{ catalogId: `imp_${'a'.repeat(64)}`, type: 'movie', title: 'Visible label' }] }] }],
  });
  assert.deepEqual(plan.collections[0].folders[0].catalogSources, []);
  assert.equal(plan.importedTypes.length, 0);
});

test('collection plan never pushes disabled unsupported imported folders', () => {
  const plan = compileCollectionPlan({
    integration: 'nuvio',
    collections: [{ _import: { adapter: 'legacy-import' }, folders: [
      { enabled: false, _import: { adapter: 'legacy-import', unsupported: [{ reason: 'unsupported_family' }] }, catalogSources: [] },
      { enabled: true, catalogSources: [{ catalogId: 'lib-genre_action_movies', type: 'movie' }] },
    ] }],
  });
  assert.equal(plan.collections.length, 1);
  assert.equal(plan.collections[0].folders.length, 1);
  assert.equal(plan.collections[0].folders[0].catalogSources[0].catalogId, 'lelibrary-curated-movie');

  const onlyUnsupported = compileCollectionPlan({
    integration: 'nuvio',
    collections: [{ _import: { adapter: 'legacy-import' }, folders: [
      { enabled: false, _import: { adapter: 'legacy-import', unsupported: [{ reason: 'unsupported_family' }] }, catalogSources: [] },
    ] }],
  });
  assert.deepEqual(onlyUnsupported.collections, []);
});

export interface FoundationsTestTestModule {};
