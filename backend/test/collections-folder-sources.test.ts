// @ts-nocheck
// A Nuvio folder source must name a catalogue the manifest actually declares,
// and the label carried in `genre` must resolve back to that exact source.
// These tests pin the contract between the collection plan and the manifest so
// a folder can never again point at an internal id (raw label, nothing loads).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { compileCollectionPlan } = require('../src/catalog/collection-plan.ts');
const {
  curatedFolderLabel, resolveCuratedSourceLabel, listCuratedCollections, curatedSourceDisplayName,
} = require('../src/catalog/curated-collections.ts');
const { getSourceDefinition } = require('../src/catalog/catalog-source-registry.ts');
const { getConfiguredManifest } = require('../app.ts');

const MANIFEST_ID = 'community.lelibrary.dev';
const BASE = 'https://example.invalid';

function folderSource(catalogId, extra = {}) {
  return { addonId: '', addonUrl: '', catalogId, type: 'movie', genre: '', ...extra };
}

function planFolderSources(collections) {
  const plan = compileCollectionPlan({
    collections, homeRows: [], sources: [], manifestId: MANIFEST_ID, integration: 'nuvio',
  });
  return plan.collections.flatMap((collection) => collection.folders).flatMap((folder) => folder.catalogSources);
}

test('every curated pack source has a unique, resolvable folder label', () => {
  const ids = new Set();
  for (const pack of listCuratedCollections({})) {
    for (const folder of pack.folders) {
      for (const source of folder.catalogSources) ids.add(String(source.catalogId).replace(/^lib-/, ''));
    }
  }
  assert.ok(ids.size > 200, `expected the curated packs to expose their sources (got ${ids.size})`);
  for (const id of ids) {
    const type = getSourceDefinition(id)?.type === 'series' ? 'series' : 'movie';
    const label = curatedFolderLabel(`lib-${id}`, type);
    assert.ok(label, `${id} has no folder label`);
    assert.equal(resolveCuratedSourceLabel(label, type), id, `${id} label did not resolve back`);
  }
});

test('folder labels stay readable and disambiguate same-named sources', () => {
  assert.equal(curatedFolderLabel('lib-trending_movies', 'movie'), 'Trending Movies');
  assert.equal(curatedFolderLabel('lib-genre_action_latest_movies', 'movie'), 'Action Movies · Latest');
  // Two sources share the plain name "Horror Movies": the genre row keeps a
  // readable variant rather than either serving the wrong catalogue.
  const horror = curatedFolderLabel('lib-genre_horror_movies', 'movie');
  const themed = curatedFolderLabel('lib-themed_modern_horror_movies', 'movie');
  assert.notEqual(horror, themed);
  assert.equal(resolveCuratedSourceLabel(horror, 'movie'), 'genre_horror_movies');
  assert.equal(resolveCuratedSourceLabel(themed, 'movie'), 'themed_modern_horror_movies');
});

test('the plan points Nuvio folders at the manifest-exact compact route', () => {
  const sources = planFolderSources([{ folders: [{ catalogSources: [
    folderSource('lib-trending_movies'),
    folderSource('lib-genre_scifi_series', { type: 'series' }),
  ] }] }]);
  assert.deepEqual(sources, [
    { addonId: MANIFEST_ID, addonUrl: '', catalogId: 'lelibrary-curated-movie', type: 'movie', genre: 'Trending Movies' },
    { addonId: MANIFEST_ID, addonUrl: '', catalogId: 'lelibrary-curated-series', type: 'series', genre: 'Sci-Fi Series' },
  ]);
});

test('the plan ignores a stale source title and heals legacy internal ids', () => {
  const titleCase = planFolderSources([{ folders: [{ catalogSources: [
    folderSource('lib-trending_movies', { title: 'Trending movies (old)' }),
  ] }] }]);
  // The label is derived from the id, so a stale title can never change which
  // catalogue a folder resolves to.
  assert.equal(titleCase[0].genre, 'Trending Movies');
  assert.equal(titleCase[0].catalogId, 'lelibrary-curated-movie');

  const legacyForms = [
    folderSource('lelibrary-curated-movie,lib-trending_movies', { genre: 'Trending Movies' }),
    folderSource('lelibrary-curated-movie', { genre: 'lib-trending_movies' }),
    folderSource('lelibrary-curated-movie', { genre: 'Trending Movies' }),
  ];
  const legacy = planFolderSources([{ folders: [{ catalogSources: legacyForms }] }]);
  for (const source of legacy) {
    assert.equal(source.catalogId, 'lelibrary-curated-movie');
    assert.equal(source.genre, 'Trending Movies');
  }
});

test('a declared media type that disagrees with the source is corrected', () => {
  const [source] = planFolderSources([{ folders: [{ catalogSources: [
    folderSource('lib-trending_series', { type: 'movie' }),
  ] }] }]);
  assert.equal(source.catalogId, 'lelibrary-curated-series');
  assert.equal(source.type, 'series');
});

test('Stremio keeps the plain library catalogue id', () => {
  const plan = compileCollectionPlan({
    collections: [{ folders: [{ catalogSources: [folderSource('lib-trending_movies')] }] }],
    manifestId: MANIFEST_ID, integration: 'stremio',
  });
  assert.equal(plan.collections[0].folders[0].catalogSources[0].catalogId, 'lib-trending_movies');
});

test('a Nuvio setup with folder sources advertises its compact catalogue', () => {
  const config = { tmdbApiKey: 'k', provider: 'none', wizardPlatform: 'nuvio' };
  const manifest = getConfiguredManifest(BASE, config, {
    integration: 'nuvio',
    collectionRefs: ['trending_movies', 'genre_scifi_movies'],
  });
  const compact = manifest.catalogs.find((row) => row.id === 'lelibrary-curated-movie');
  assert.ok(compact, 'the compact catalogue the folders point at must be declared');
  assert.equal(compact.showInHome, false);
  assert.ok(compact.extra.some((extra) => extra.name === 'genre'));
});

test('a Nuvio setup without folder sources keeps its rows and gains no compact catalogue', () => {
  const config = { tmdbApiKey: 'k', provider: 'none', wizardPlatform: 'nuvio', nuvioCollectionPacks: ['discover'] };
  const manifest = getConfiguredManifest(BASE, config, { integration: 'nuvio' });
  assert.equal(manifest.catalogs.find((row) => row.id === 'lelibrary-curated-movie'), undefined);
  assert.ok(manifest.catalogs.some((row) => row.id === 'lib-trending_movies'));
});

test('an account-era wizard setup still collapses its pack rows into the compact routes', () => {
  const config = { tmdbApiKey: 'k', provider: 'none', wizard: true, wizardPlatform: 'nuvio', nuvioCollectionPacks: ['discover'] };
  const manifest = getConfiguredManifest(BASE, config, { integration: 'nuvio' });
  assert.ok(manifest.catalogs.some((row) => row.id === 'lelibrary-curated-movie'));
  assert.equal(manifest.catalogs.find((row) => row.id === 'lib-trending_movies'), undefined);
});

test('a compact folder label resolves through the catalogue handler', () => {
  const label = curatedFolderLabel('lib-now_playing_movies', 'movie');
  assert.equal(resolveCuratedSourceLabel(label, 'movie'), 'now_playing_movies');
  // The old raw-id transport keeps working.
  assert.equal(curatedSourceDisplayName('lib-now_playing_movies', 'movie'), label);
});

test('every folder the plan pushes is declared by the same manifest', () => {
  // Exactly what the manifest route does for a v5.5 setup: compile the setup's
  // own document, then advertise what the plan produced.
  const config = { tmdbApiKey: 'k', provider: 'none', wizardPlatform: 'nuvio' };
  const collections = [{ id: 'c1', title: 'Test', folders: [
    { id: 'f1', catalogSources: [folderSource('lib-trending_movies')] },
    { id: 'f2', catalogSources: [folderSource('lib-genre_scifi_series', { type: 'series' })] },
    { id: 'f3', catalogSources: [folderSource('lelibrary-curated-movie,lib-now_playing_movies', { genre: 'In Theaters Movies' })] },
  ] }];
  const plan = compileCollectionPlan({ collections, homeRows: [], sources: [], manifestId: MANIFEST_ID, integration: 'nuvio' });
  const manifest = getConfiguredManifest(BASE, config, {
    integration: 'nuvio',
    collectionRefs: plan.folderLibraryIds,
    homeRows: plan.homeRows,
    importedTypes: plan.importedTypes,
  });
  const declared = new Set(manifest.catalogs.map((row) => `${row.type}:${row.id}`));
  for (const collection of plan.collections) {
    for (const folder of collection.folders) {
      for (const source of folder.catalogSources) {
        assert.ok(declared.has(`${source.type}:${source.catalogId}`),
          `folder source ${source.type}:${source.catalogId} is not declared by the manifest`);
      }
    }
  }
  // The compact catalogue is shared: one per media type, no comma forms.
  assert.ok(declared.has('movie:lelibrary-curated-movie'));
  assert.ok(declared.has('series:lelibrary-curated-series'));
});

test('a disabled Home row is not advertised', () => {
  const config = { tmdbApiKey: 'k', provider: 'none', wizardPlatform: 'nuvio' };
  const manifest = getConfiguredManifest(BASE, config, {
    integration: 'nuvio',
    homeRows: [
      { enabled: true, order: 0, source: { id: 'lib-trending_movies', catalogId: 'lib-trending_movies', type: 'movie' } },
      { enabled: false, order: 1, source: { id: 'lib-now_playing_movies', catalogId: 'lib-now_playing_movies', type: 'movie' } },
    ],
  });
  assert.ok(manifest.catalogs.some((row) => row.id === 'lib-trending_movies'));
  assert.equal(manifest.catalogs.find((row) => row.id === 'lib-now_playing_movies'), undefined);
});
