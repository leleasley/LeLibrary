const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LIBRARY_COLLECTION_ID,
  buildLibraryCollection,
  collectionCatalogMetas,
  mergeCollectionsInPlace,
} = require('../src/nuvio-library-collections');
const { encodeConfig, normalizeConfig } = require('../website/public/token-map');
const { compileCollectionPlan } = require('../src/collection-plan');
const { normalizeImportedSourceDefinition } = require('../src/import-sources/definition');

// Synthetic output of the existing debrid -> TMDB matcher. `videos` contains
// only owned downloads; absent TMDB franchise parts never enter this fixture.
const ownedFranchises = [
  {
    collectionId: 1241,
    name: 'Harry Potter Collection',
    poster: 'https://image.test/harry.jpg',
    videos: [
      { id: 'torbox:collection:harry:1', title: 'Harry Potter 1', thumbnail: 'https://image.test/w300/hp1.jpg', released: '2001-01-01' },
      { id: 'torbox:collection:harry:2', title: 'Harry Potter 2', thumbnail: 'https://image.test/w300/hp2.jpg', released: '2002-01-01' },
      { id: 'torbox:collection:harry:3', title: 'Harry Potter 3', thumbnail: 'https://image.test/w300/hp3.jpg', released: '2004-01-01' },
      { id: 'torbox:collection:harry:5', title: 'Harry Potter 5', thumbnail: 'https://image.test/w300/hp5.jpg', released: '2007-01-01' },
    ],
  },
  {
    collectionId: 404609,
    name: 'John Wick Collection',
    poster: 'https://image.test/wick.jpg',
    videos: [
      { id: 'torbox:collection:wick:101', title: 'John Wick', thumbnail: 'https://image.test/w300/jw1.jpg', released: '2014-01-01' },
      { id: 'torbox:collection:wick:102', title: 'John Wick Chapter 2', thumbnail: 'https://image.test/w300/jw2.jpg', released: '2017-01-01' },
    ],
  },
];

test('Nuvio franchise folders are deterministic addon sources over owned films only', () => {
  const collection = buildLibraryCollection(ownedFranchises, 'community.lelibrary.dev', { pinCollections: false });
  assert.equal(collection.id, LIBRARY_COLLECTION_ID);
  assert.equal(collection.pinToTop, false);
  assert.deepEqual(collection.folders.map((folder) => [folder.id, folder.title, folder.catalogSources[0]]), [
    ['lelibrary-tmdb-1241', 'Harry Potter', { addonId: 'community.lelibrary.dev', type: 'movie', catalogId: 'torbox-collections', genre: 'collection-1241' }],
    ['lelibrary-tmdb-404609', 'John Wick', { addonId: 'community.lelibrary.dev', type: 'movie', catalogId: 'torbox-collections', genre: 'collection-404609' }],
  ]);
  assert.equal(collection.folders.some((folder) => folder.title === 'Random Movie'), false);
  assert.equal(collection.folders.some((folder) => folder.catalogSources[0].provider === 'tmdb'), false);
  assert.deepEqual(buildLibraryCollection(ownedFranchises, 'community.lelibrary.dev', { pinCollections: false }), collection);
});

test('a dynamic franchise catalog returns exactly its owned TorBox movie ids', () => {
  const harry = collectionCatalogMetas(ownedFranchises, 1241);
  const wick = collectionCatalogMetas(ownedFranchises, 404609);
  assert.equal(harry.length, 4);
  assert.equal(wick.length, 2);
  assert.deepEqual(harry.map((movie) => movie.id), [
    'torbox:movie:1', 'torbox:movie:2', 'torbox:movie:3', 'torbox:movie:5',
  ]);
  assert.equal(harry.some((movie) => movie.name === 'Harry Potter 4'), false);
  assert.deepEqual(collectionCatalogMetas(ownedFranchises, 999999), []);
});

test('generated franchise collections stay unpinned while config preserves the setting', () => {
  assert.equal(buildLibraryCollection(ownedFranchises, 'community.lelibrary.dev', { pinCollections: false }).pinToTop, false);
  assert.equal(buildLibraryCollection(ownedFranchises, 'community.lelibrary.dev', { pinCollections: true }).pinToTop, false);
  const decode = (token) => normalizeConfig(JSON.parse(Buffer.from(token, 'base64url').toString('utf8')));
  assert.equal(decode(encodeConfig({ provider: 'torbox', pinCollections: false })).pinCollections, false);
  assert.equal(decode(encodeConfig({ provider: 'torbox', pinCollections: true })).pinCollections, true);
});

test('the native franchise collection keeps its fixed title', () => {
  assert.equal(
    buildLibraryCollection(ownedFranchises, 'community.lelibrary.dev', { collectionsName: '🍿 Alice\'s Film Shelf' }).title,
    'LeLibrary Collections'
  );
});

test('collection sync forces the franchise to the very bottom', () => {
  const generated = buildLibraryCollection(ownedFranchises, 'community.lelibrary.dev', { pinCollections: false });
  const existing = [
    { id: 'collection-a', title: 'Collection A', folders: [{ id: 'a' }] },
    { id: 'collection-b', title: 'Collection B', folders: [{ id: 'b' }] },
    { id: LIBRARY_COLLECTION_ID, title: 'Old LeLibrary Collections', folders: [] },
    { id: 'collection-c', title: 'Collection C', folders: [{ id: 'c' }] },
  ];
  const merged = mergeCollectionsInPlace(existing, [generated]);
  assert.deepEqual(merged.map((item) => item.id), ['collection-a', 'collection-b', 'collection-c', LIBRARY_COLLECTION_ID]);
  assert.equal(merged[0], existing[0]);
  assert.equal(merged[1], existing[1]);
  assert.equal(merged[2], existing[3]);
  assert.deepEqual(mergeCollectionsInPlace(merged, [generated]), merged);
});

test('the Hub sits immediately above Movie Collections when both are enabled', () => {
  const franchise = buildLibraryCollection(ownedFranchises, 'community.lelibrary.dev');
  const hub = { id: 'collection-lelibrary-hub', title: 'LeLibrary', pinToTop: true };
  const regular = { id: 'collection-lelibrary-discover', title: 'Discover' };
  assert.deepEqual(
    mergeCollectionsInPlace([{ id: 'collection-external', title: 'External' }], [regular, hub, franchise])
      .map((collection) => [collection.id, collection.pinToTop]),
    [
      ['collection-external', undefined],
      ['collection-lelibrary-discover', undefined],
      ['collection-lelibrary-hub', false],
      [LIBRARY_COLLECTION_ID, false],
    ]
  );
});

test('collection sync respects the wizard order for existing LeLibrary collections', () => {
  const existing = [
    { id: 'collection-lelibrary-first', title: 'First' },
    { id: 'collection-external', title: 'External' },
    { id: 'collection-lelibrary-second', title: 'Second' },
  ];
  const generated = [
    { id: 'collection-lelibrary-second', title: 'Second moved first' },
    { id: 'collection-lelibrary-first', title: 'First moved second' },
  ];
  assert.deepEqual(
    mergeCollectionsInPlace(existing, generated).map((collection) => collection.id),
    ['collection-external', 'collection-lelibrary-second', 'collection-lelibrary-first']
  );
});

test('the shared wizard plan removes only the legacy flat franchise source for Nuvio', () => {
  const plan = compileCollectionPlan({
    manifestId: 'community.lelibrary.dev',
    integration: 'nuvio',
    collections: [{
      id: 'wizard-collection',
      folders: [
        { id: 'flat', catalogSources: [{ catalogId: 'torbox-collections', type: 'movie' }] },
        { id: 'normal', catalogSources: [{ catalogId: 'lib-now_playing_movies', type: 'movie' }] },
      ],
    }],
  });
  assert.deepEqual(plan.collections[0].folders[0].catalogSources, []);
  assert.deepEqual(plan.collections[0].folders[1].catalogSources, [{
    addonId: 'community.lelibrary.dev', addonUrl: '', catalogId: 'lelibrary-curated-movie', type: 'movie', genre: 'lib-now_playing_movies',
  }]);
});

test('private imported folders use the exact manifest catalogue ID and a human genre label', () => {
  const source = normalizeImportedSourceDefinition({
    provider: 'tmdb', engine: 'discover', mediaType: 'movie',
    params: { filters: { with_companies: 41077 }, sortBy: 'primary_release_date.desc' },
    label: 'A24 Recent Movies',
  });
  const plan = compileCollectionPlan({
    manifestId: 'community.lelibrary.dev', integration: 'nuvio', sources: [source],
    collections: [{ id: 'a24', folders: [{ id: 'recent', catalogSources: [{ catalogId: `lelibrary-import-movie,${source.id}`, type: 'movie' }] }] }],
  });
  assert.deepEqual(plan.collections[0].folders[0].catalogSources, [{
    addonId: 'community.lelibrary.dev', addonUrl: '', catalogId: 'lelibrary-import-movie', type: 'movie', genre: 'A24 Recent Movies',
  }]);
  assert.deepEqual(plan.importedTypes, ['movie']);
});

test('Hide anime removes anime Home rows and the complete collection containing anime folders', () => {
  const plan = compileCollectionPlan({
    manifestId: 'community.lelibrary.dev',
    integration: 'nuvio',
    hideAnime: true,
    homeRows: [
      { source: { catalogId: 'lib-studio_ghibli_movies', type: 'movie', title: 'Studio Ghibli' } },
      { source: { catalogId: 'lib-genre_action_movies', type: 'movie', title: 'Action Movies' } },
    ],
    collections: [{
      id: 'mixed',
      folders: [
        { id: 'anime', title: 'Anime', catalogSources: [{ catalogId: 'lib-studio_ghibli_movies', type: 'movie' }] },
        { id: 'action', title: 'Action', catalogSources: [{ catalogId: 'lib-genre_action_movies', type: 'movie' }] },
      ],
    }],
  });
  assert.deepEqual(plan.homeRows.map((row) => row.source.catalogId), ['lib-genre_action_movies']);
  assert.deepEqual(plan.collections, []);
});

test('Hide anime removes imported anime collections even when their source IDs are generic', () => {
  const plan = compileCollectionPlan({
    manifestId: 'community.lelibrary.dev',
    integration: 'nuvio',
    hideAnime: true,
    collections: [
      { id: 'imported-anime', title: 'Anime', folders: [{ id: 'anime-folder', title: 'Seasonal picks', catalogSources: [{ addonId: 'external', addonUrl: 'https://example.com/manifest.json', catalogId: 'featured', type: 'movie' }] }] },
      { id: 'imported-movies', title: 'Movies', folders: [{ id: 'movie-folder', title: 'Action', catalogSources: [{ addonId: 'external', addonUrl: 'https://example.com/manifest.json', catalogId: 'action', type: 'movie' }] }] },
    ],
  });
  assert.deepEqual(plan.collections.map((collection) => collection.id), ['imported-movies']);
});

test('Hide anime removes an entire imported collection when an anime addon sits inside a generic folder', () => {
  const plan = compileCollectionPlan({
    manifestId: 'community.lelibrary.dev',
    integration: 'nuvio',
    hideAnime: true,
    collections: [{
      id: 'community-pack',
      title: 'Imported favourites',
      folders: [{
        id: 'mixed-folder',
        title: 'Featured',
        catalogSources: [{ addonId: 'org.stremio.anime', catalogId: 'featured', type: 'movie' }],
      }],
    }],
  });
  assert.deepEqual(plan.collections, []);
});

test('the Hub rejects its old flat Movie Collections folder', () => {
  const plan = compileCollectionPlan({
    manifestId: 'community.lelibrary.dev',
    integration: 'nuvio',
    collections: [{
      id: 'collection-lelibrary-hub',
      folders: [{
        id: 'folder-lelibrary-hub-franchises',
        catalogSources: [{ catalogId: 'torbox-collections', type: 'movie' }],
      }],
    }],
  });
  assert.deepEqual(plan.collections[0].folders[0].catalogSources, []);
});

test('the shared wizard plan keeps Movie Collections opt-in, honours its hidden toggle, and strips it from Home rows', () => {
  const plan = compileCollectionPlan({
    manifestId: 'community.lelibrary.dev',
    integration: 'nuvio',
    homeRows: [
      { enabled: true, order: 0, source: { catalogId: 'torbox-movies', type: 'movie' } },
      { enabled: true, order: 1, source: { catalogId: 'torbox-collections', type: 'movie' } },
    ],
  });
  assert.equal(plan.nativeFranchiseCollection.enabled, true);
  assert.deepEqual(plan.homeRows.map((row) => row.source.catalogId), ['torbox-movies']);
  const emptyPlan = compileCollectionPlan({
    manifestId: 'community.lelibrary.dev',
    integration: 'nuvio',
    homeRows: [],
  });
  assert.equal(emptyPlan.nativeFranchiseCollection.enabled, false);
  const disabledPlan = compileCollectionPlan({
    manifestId: 'community.lelibrary.dev',
    integration: 'nuvio',
    homeRows: [{
      _nativeFranchiseCollection: true,
      enabled: false,
      order: 0,
      source: { catalogId: 'torbox-collections', type: 'movie' },
    }],
  });
  assert.equal(disabledPlan.nativeFranchiseCollection.enabled, false);
  assert.deepEqual(disabledPlan.homeRows, []);
});

test('the shared wizard plan remaps legacy LeLibrary source IDs to the installed manifest', () => {
  const plan = compileCollectionPlan({
    manifestId: 'community.lelibrary.dev',
    integration: 'nuvio',
    collections: [{ folders: [{ catalogSources: [{ addonId: 'community.lelibrary', catalogId: 'torbox-movies', type: 'movie' }] }] }],
  });
  assert.equal(plan.collections[0].folders[0].catalogSources[0].addonId, 'community.lelibrary.dev');
});
