// @ts-nocheck
'use strict';
// Issue #21: a public Nuvio community collection imported into Move In came
// through with its folders but 0 sources, because only `catalogSources` was
// read and TMDB / Trakt packs keep everything in `sources`. The studio now
// stores those as `nativeSources`; this checks the server half: the plan keeps
// them (Nuvio only), the push sends them in Nuvio's own shape after the addon
// sources, the Preview lists them, and the community list counts them.
// Fixture: trimmed real public collections (no personal data).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileCollectionPlan, cloneNativeSource } = require('../src/catalog/collection-plan.ts');
const push = require('../src/setup/push.ts');
const community = require('../src/catalog/nuvio-community.ts');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'nuvio-public-collections.json'), 'utf8'));
const publicCollections = fixture.item.envelope.collections;
const MANIFEST_ID = 'community.lelibrary.dev';
const ORIGIN = 'https://dev.example.test';

const isAddon = (source) => !source.provider || source.provider === 'addon';

// The studio document the browser import builds (public-collection-import.ts).
function studioDoc(collection) {
  return {
    id: collection.id,
    title: collection.title,
    folders: collection.folders.map((folder) => ({
      id: folder.id,
      title: folder.title,
      tileShape: folder.tileShape,
      hideTitle: folder.hideTitle === true,
      coverImageUrl: folder.coverImageUrl || '',
      focusGifEnabled: folder.focusGifEnabled === true,
      focusGifUrl: folder.focusGifUrl || '',
      heroBackdropUrl: folder.heroBackdropUrl || '',
      ...(folder.titleLogoUrl ? { titleLogoUrl: folder.titleLogoUrl } : {}),
      catalogSources: folder.sources.filter(isAddon).map((source) => ({
        addonId: source.addonId, addonUrl: '', catalogId: source.catalogId, type: source.type, genre: source.genre || '',
      })),
      nativeSources: folder.sources.filter((source) => !isAddon(source)),
    })),
  };
}

function pushed(collections, integration = 'nuvio') {
  const plan = compileCollectionPlan({ collections, homeRows: [], sources: [], externalSources: [], manifestId: MANIFEST_ID, integration });
  return { plan, nuvio: push.nuvioCollectionsFromPlan(plan.collections, MANIFEST_ID, ORIGIN) };
}

test('every public collection reaches the Nuvio push with all of its sources', () => {
  const { plan, nuvio } = pushed(publicCollections.map(studioDoc));
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(nuvio.map((collection) => collection.title), publicCollections.map((collection) => collection.title));
  nuvio.forEach((collection, ci) => {
    collection.folders.forEach((folder, fi) => {
      assert.equal(folder.sources.length, publicCollections[ci].folders[fi].sources.length, `${collection.title} / ${folder.title}`);
    });
  });
});

test('TMDB and Trakt sources go out exactly as Nuvio wrote them', () => {
  const { nuvio } = pushed(publicCollections.map(studioDoc));
  const byTitle = Object.fromEntries(nuvio.map((collection) => [collection.title, collection]));
  const nbc = byTitle.Networks.folders[0];
  assert.deepEqual(nbc.sources[0], {
    provider: 'tmdb', tmdbSourceType: 'DISCOVER', tmdbId: null, title: 'Popular Series', mediaType: 'TV',
    sortBy: 'popularity.desc', filters: { voteCountGte: 50, withNetworks: '6', withOriginalLanguage: 'en' },
  });
  assert.equal(nbc.hideTitle, true);
  assert.match(nbc.titleLogoUrl, /^https:\/\//, 'a hidden-title folder keeps its logo');
  assert.deepEqual(byTitle['Film Collections'].folders[0].sources[0], {
    provider: 'tmdb', tmdbSourceType: 'COLLECTION', tmdbId: 14890, title: 'Bad Boys Collection', mediaType: 'MOVIE', sortBy: 'original', filters: {},
  });
  assert.deepEqual(byTitle.Awards.folders[0].sources[0], {
    provider: 'trakt', traktListId: 4325279, title: 'Best Picture - All Time', mediaType: 'MOVIE', sortBy: 'rank', sortHow: 'asc',
  });
  // Addon packs are unchanged: other addons keep their own id.
  assert.deepEqual(byTitle['Streaming Services'].folders[0].sources[0], {
    provider: 'addon', addonId: 'aio-metadata', catalogId: 'custom.pw_ers_netflix_catalog.movie.nfx', type: 'movie', genre: '',
  });
});

test('a folder mixing addon and native sources keeps both, addon sources first', () => {
  const { nuvio } = pushed([{
    id: 'mixed', title: 'Mixed', folders: [{
      id: 'f', title: 'Mixed',
      catalogSources: [{ addonId: '', addonUrl: '', catalogId: 'lib-trending_movies', type: 'movie', genre: '' }],
      nativeSources: [{ provider: 'tmdb', tmdbSourceType: 'PERSON', tmdbId: 19292, title: 'Adam Sandler', mediaType: 'MOVIE', sortBy: 'popularity.desc', filters: {} }],
    }],
  }]);
  assert.deepEqual(nuvio[0].folders[0].sources.map((source) => source.provider), ['addon', 'tmdb']);
});

test('the server never forwards a native source Nuvio would reject', () => {
  assert.equal(cloneNativeSource({ provider: 'tmdb', tmdbSourceType: 'PERSON', tmdbId: null }), null, 'person without an id');
  assert.equal(cloneNativeSource({ provider: 'tmdb', tmdbSourceType: 'NOPE', tmdbId: 1 }), null, 'unknown TMDB kind');
  assert.equal(cloneNativeSource({ provider: 'trakt', traktListId: 0 }), null, 'Trakt without a list');
  assert.equal(cloneNativeSource({ provider: 'mdblist', listId: 1 }), null, 'unknown provider');
  // Unknown keys and wrong value types never reach Nuvio's typed parser.
  assert.deepEqual(cloneNativeSource({
    provider: 'tmdb', tmdbSourceType: 'discover', mediaType: 'series', injected: 'x',
    filters: { voteCountGte: '12.7', voteAverageGte: '7.5', withWatchProviders: 8, watchRegion: 'GB', evil: 'y' },
  }), {
    provider: 'tmdb', tmdbSourceType: 'DISCOVER', tmdbId: null, mediaType: 'TV',
    filters: { voteCountGte: 12, voteAverageGte: 7.5, withWatchProviders: '8', watchRegion: 'GB' },
  });
  const { plan, nuvio } = pushed([{ id: 'c', title: 'C', folders: [{ id: 'f', title: 'F', catalogSources: [], nativeSources: [{ provider: 'tmdb', tmdbSourceType: 'LIST' }] }] }]);
  assert.deepEqual(nuvio, [], 'a folder left with no valid source is dropped like any empty folder');
  assert.deepEqual(plan.warnings, ['A TMDB or Trakt folder source Nuvio cannot read was ignored.']);
});

test('Stremio plans leave native sources out and say so once', () => {
  const { plan } = pushed(publicCollections.map(studioDoc), 'stremio');
  for (const collection of plan.collections) for (const folder of collection.folders) assert.deepEqual(folder.nativeSources, []);
  assert.deepEqual(plan.warnings, ['TMDB and Trakt folder sources are available in Nuvio folders only.']);
});

test('the community list counts a folder by its full sources list', () => {
  const compact = community.compactListPayload({ items: [{ public_id: 'x', envelope: { collections: publicCollections } }] });
  const expected = publicCollections.reduce((total, collection) => total + collection.folders.reduce((count, folder) => count + folder.sources.length, 0), 0);
  assert.equal(compact.items[0].stats.sourceCount, expected);
  assert.equal(community.folderSourceCount({ catalogSources: [{}, {}] }), 2, 'older exports without sources');
});
