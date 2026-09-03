const test = require('node:test');
const assert = require('node:assert/strict');

const { convertXperienceV1, safeArtwork } = require('../src/import-sources/xperience-v1');
const { mergeImportedPlan } = require('../src/import-sources/merge');

function fixture(overrides = {}) {
  return {
    type: 'xperienceProfile', exportVersion: 1, id: 'synthetic-profile', name: 'Movie night',
    config: {
      catalog_name_overrides: {
        tmdb_discover_synthetic_movies: 'New Action Movies',
        tmdb_list_100_movies: 'Public Picks',
        tmdb_collection_1742094_movies: 'Exact Alien Films',
        trakt_list_200_series: 'Public Shows',
      },
      discover_catalogs: {
        tmdb_discover_synthetic_movies: {
          sort_by: 'primary_release_date.desc',
          filters: { withGenres: '28', voteCountGte: 10, includeAdult: false },
        },
      },
      collections: [{
        id: 'collection-a', title: 'Imported favourites',
        folders: [{
          id: 'folder-a', title: 'Fresh imports', coverImageUrl: 'https://images.example.test/cover.jpg',
          catalogSources: [
            { catalogId: 'tmdb_discover_synthetic_movies', type: 'movie' },
            { catalogId: 'tmdb_list_100_movies', type: 'movie' },
            { catalogId: 'tmdb_collection_1742094_movies', type: 'movie' },
            { catalogId: 'trakt_list_200_series', type: 'series' },
          ],
        }],
      }],
      ...overrides,
    },
  };
}

test('Xperience v1 converts all four supported source families', () => {
  const plan = convertXperienceV1(fixture());
  assert.deepEqual(plan.summary, {
    sourcesFound: 4, libraryMatches: 1, privateSources: 3, unsupported: 0,
    needsReview: 0, requiresXperience: 0, collections: 1, folders: 1,
  });
  assert.equal(plan.sources.length, 3);
  assert.deepEqual(new Set(plan.sources.map(source => `${source.provider}:${source.engine}:${source.mediaType}`)), new Set([
    'tmdb:discover:movie', 'tmdb:list:movie', 'trakt:list:series',
  ]));
  const refs = plan.collections[0].folders[0].catalogSources;
  assert.equal(refs.length, 4);
  assert.equal(refs.find(source => source.title === 'Exact Alien Films').catalogId, 'lib-collection_alien');
  assert.ok(refs.filter(source => source.catalogId.startsWith('imp_')).every(source => !source.catalogId.includes('xperience')));
  assert.equal(plan.collections[0].folders[0].coverImageUrl, 'https://images.example.test/cover.jpg');
});

test('Xperience v1 accepts the published exportType marker but rejects conflicting markers', () => {
  const published = fixture();
  published.exportType = published.type;
  delete published.type;
  assert.equal(convertXperienceV1(published).summary.sourcesFound, 4);

  const conflicting = fixture();
  conflicting.exportType = 'differentExport';
  assert.throws(() => convertXperienceV1(conflicting), error => error?.code === 'unsupported_export');
});

test('Xperience v1 translates only the documented legacy TV release-date sort', () => {
  const value = fixture();
  const source = value.config.collections[0].folders[0].catalogSources[0];
  source.catalogId = 'tmdb_discover_synthetic_series';
  source.type = 'series';
  value.config.catalog_name_overrides.tmdb_discover_synthetic_series = 'New Japanese Cinema Series';
  value.config.discover_catalogs.tmdb_discover_synthetic_series = {
    sort_by: 'primary_release_date.desc', filters: { withOriginalLanguage: 'ja', year: 2026, voteCountGte: 10 },
  };
  delete value.config.discover_catalogs.tmdb_discover_synthetic_movies;
  const plan = convertXperienceV1(value);
  const definition = plan.sources.find(item => item.label === 'New Japanese Cinema Series');
  assert.equal(definition.params.sortBy, 'first_air_date.desc');
  assert.equal(definition.params.filters.first_air_date_year, 2026);
  assert.ok(plan.warnings.some(warning => warning.includes('TV date sort')));

  value.config.discover_catalogs.tmdb_discover_synthetic_series.sort_by = 'revenue.desc';
  assert.equal(convertXperienceV1(value).summary.unsupported, 1);
});

test('opaque Xperience discover titles fall back to a clean provider label', () => {
  const value = fixture();
  delete value.config.catalog_name_overrides.tmdb_discover_synthetic_movies;
  value.config.collections[0].folders[0].catalogSources[0].title = 'Tmdb Discover Fcc12e9e Movies';
  const plan = convertXperienceV1(value);
  assert.equal(plan.collections[0].folders[0].catalogSources[0].title, 'TMDB Discover');
  assert.equal(JSON.stringify(plan.review).includes('Fcc12e9e'), false);
});

test('unsupported Xperience filters fail only that source and are not silently dropped', () => {
  const value = fixture({
    discover_catalogs: { tmdb_discover_synthetic_movies: { filters: { unreleasedMagic: true } } },
    collections: fixture().config.collections,
  });
  const plan = convertXperienceV1(value);
  assert.equal(plan.summary.unsupported, 1);
  assert.equal(plan.collections[0].folders[0].catalogSources.length, 3);
  assert.equal(plan.review.find(row => row.label === 'New Action Movies').status, 'unsupported');
});

test('unsupported built-ins are categorised and leave their folder disabled for review', () => {
  const value = fixture();
  value.config.collections[0].folders[0].catalogSources = [{ catalogId: 'genre_action_movies', type: 'movie' }];
  const plan = convertXperienceV1(value);
  assert.equal(plan.summary.unsupported, 1);
  assert.equal(plan.collections[0].folders[0].enabled, false);
  assert.equal(plan.review[0].category, 'TMDB genres');
});

test('duplicate folder references count once in source review', () => {
  const value = fixture();
  value.config.collections[0].folders[0].catalogSources.push({ catalogId: 'tmdb_list_100_movies', type: 'movie' });
  assert.equal(convertXperienceV1(value).summary.sourcesFound, 4);
});

test('private imported Home rows are explicit needs-review states and remain disabled', () => {
  const value = fixture({ ...fixture().config, home_rows: [{ id: 'home-a', title: 'Action at home', source: { catalogId: 'tmdb_list_100_movies', type: 'movie' } }] });
  const plan = convertXperienceV1(value);
  assert.equal(plan.homeRows[0].enabled, false);
  assert.equal(plan.summary.needsReview, 1);
  assert.equal(plan.review.some(item => item.status === 'needs_review' && item.label === 'Action at home'), true);
  assert.equal(plan.summary.sourcesFound, 4);
});

test('signed or private artwork URLs are stripped', () => {
  assert.equal(safeArtwork('https://xperience-app.com/art.jpg'), '');
  assert.equal(safeArtwork('https://cdn.example.test/art.jpg?token=synthetic'), '');
  assert.equal(safeArtwork('http://cdn.example.test/art.jpg'), '');
});

test('re-import is idempotent and preserves presentation edits', () => {
  const first = convertXperienceV1(fixture());
  const applied = mergeImportedPlan({}, first);
  const unchanged = mergeImportedPlan(applied, convertXperienceV1(fixture()));
  assert.equal(unchanged.changed, false);

  applied.collections[0].title = 'My renamed collection';
  applied.collections[0].folders[0].title = 'My renamed folder';
  applied.collections[0].folders[0].coverImageUrl = 'https://mine.example.test/custom.jpg';
  const merged = mergeImportedPlan(applied, convertXperienceV1(fixture()));
  assert.equal(merged.collections[0].title, 'My renamed collection');
  assert.equal(merged.collections[0].folders[0].title, 'My renamed folder');
  assert.equal(merged.collections[0].folders[0].coverImageUrl, 'https://mine.example.test/custom.jpg');
});

test('recipe changes update untouched references and retain old definitions only while referenced', () => {
  const first = mergeImportedPlan({}, convertXperienceV1(fixture()));
  const oldDiscover = first.collections[0].folders[0].catalogSources.find(source => source.title === 'New Action Movies').catalogId;
  const changedFixture = fixture();
  changedFixture.config.discover_catalogs.tmdb_discover_synthetic_movies.filters.voteCountGte = 999;
  const updated = mergeImportedPlan(first, convertXperienceV1(changedFixture));
  const newDiscover = updated.collections[0].folders[0].catalogSources.find(source => source.title === 'New Action Movies').catalogId;
  assert.notEqual(newDiscover, oldDiscover);
  assert.equal(updated.sources.some(source => source.id === oldDiscover), false);

  const customized = mergeImportedPlan({}, convertXperienceV1(fixture()));
  customized.collections[0].folders[0].catalogSources.reverse();
  const preserved = mergeImportedPlan(customized, convertXperienceV1(changedFixture));
  assert.equal(preserved.collections[0].folders[0].catalogSources.some(source => source.catalogId === oldDiscover), true);
  assert.equal(preserved.sources.some(source => source.id === oldDiscover), true);
});
