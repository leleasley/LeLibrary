// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const { compileCollectionPlan } = require('../src/catalog/collection-plan.ts');

// A setup saved before the v3 hub art kept the v2 cover and no focus GIF in its
// own document, so Nuvio never got the animated hub tiles (prod, 2026-10-24).
const oldHub = {
  id: 'collection-lelibrary-hub', title: 'LeLibrary',
  folders: [
    { id: 'folder-lelibrary-hub-movies', title: 'Movies', coverImageUrl: 'https://lelibrary.uk/collection-assets/collections/covers/lelibrary-hub-movies-v2.png?v=2', focusGifUrl: '', focusGifEnabled: false, catalogSources: [{ type: 'movie', catalogId: 'torbox-movies' }] },
    { id: 'folder-lelibrary-hub-shows', title: 'Shows', coverImageUrl: '/collection-assets/collections/covers/lelibrary-hub-shows-v2.png', focusGifUrl: '', focusGifEnabled: false, catalogSources: [{ type: 'series', catalogId: 'torbox-series' }] },
  ],
};
const other = { id: 'pack-x', title: 'Discover', folders: [{ id: 'f1', title: 'Trending', coverImageUrl: '/c.jpg', focusGifUrl: '', focusGifEnabled: false, catalogSources: [{ type: 'movie', catalogId: 'lib-trending_movies' }] }] };

test('the LeLibrary hub folders always carry the current cover and focus GIF', () => {
  const plan = compileCollectionPlan({ collections: [oldHub, other], integration: 'nuvio', manifestId: 'x' });
  const hub = plan.collections.find((c) => c.id === 'collection-lelibrary-hub');
  const movies = hub.folders.find((f) => f.id === 'folder-lelibrary-hub-movies');
  const shows = hub.folders.find((f) => f.id === 'folder-lelibrary-hub-shows');
  assert.equal(movies.coverImageUrl, '/collection-assets/collections/covers/lelibrary-hub-movies-v3.jpg');
  assert.equal(movies.focusGifUrl, '/collection-assets/collections/gifs/lelibrary-hub-movies-focus-v3.gif');
  assert.equal(movies.focusGifEnabled, true);
  assert.equal(shows.focusGifUrl, '/collection-assets/collections/gifs/lelibrary-hub-shows-focus-v3.gif');
  assert.equal(shows.focusGifEnabled, true);
  const trending = plan.collections.find((c) => c.id === 'pack-x').folders[0];
  assert.equal(trending.coverImageUrl, '/c.jpg', 'other folders keep their own art');
  assert.equal(trending.focusGifEnabled, false);
});
