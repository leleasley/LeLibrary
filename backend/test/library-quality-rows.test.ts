// @ts-nocheck
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLibraryCatalogId, matchesVariant } = require('../src/library/quality-filter.ts');
const { getConfiguredManifest } = require('../app.ts');
const { compileCollectionPlan, withHubExtras } = require('../src/catalog/collection-plan.ts');

test('library catalogue ids parse with and without a quality', () => {
  assert.deepEqual(parseLibraryCatalogId('torbox-movies'), { prefix: 'torbox', kind: 'movies', variant: null });
  assert.deepEqual(parseLibraryCatalogId('rd-series-4k'), { prefix: 'rd', kind: 'series', variant: '4k' });
  assert.deepEqual(parseLibraryCatalogId('torbox-movies-hdr'), { prefix: 'torbox', kind: 'movies', variant: 'hdr' });
  assert.equal(parseLibraryCatalogId('torbox-anime-4k'), null);
  assert.equal(parseLibraryCatalogId('torbox-trending-movies'), null);
  assert.equal(parseLibraryCatalogId('torbox-movies-8k'), null);
});

test('quality comes from the release name or its files', () => {
  assert.equal(matchesVariant({ name: 'Film.2019.2160p.UHD.BluRay.x265' }, '4k'), true);
  assert.equal(matchesVariant({ name: 'Film.2019.1080p.BluRay.x264' }, '4k'), false);
  assert.equal(matchesVariant({ name: 'Show.S01', raw: { files: [{ name: 'Show.S01E01.2160p.WEB-DL.mkv' }] } }, '4k'), true);
  assert.equal(matchesVariant({ name: 'Film.2160p.DV.HDR10.mkv' }, 'hdr'), true);
  assert.equal(matchesVariant({ name: 'Film.2160p.DoVi.mkv' }, 'hdr'), true);
  assert.equal(matchesVariant({ name: 'Film.1080p.HDR10+.mkv' }, 'hdr'), true);
  assert.equal(matchesVariant({ name: 'Film.Dolby.Vision.mkv' }, 'hdr'), true);
  assert.equal(matchesVariant({ name: 'Film.2160p.SDR.x265.mkv' }, 'hdr'), false);
  assert.equal(matchesVariant({ filename: 'Film.4K.mkv' }, '4k'), true, 'legacy provider items');
  assert.equal(matchesVariant({ name: 'Anything' }, null), true);
});

const BASE = 'http://localhost:7860';
const CONFIG = { provider: 'torbox', torboxApiKey: 'tb-test', tmdbApiKey: 'tmdb-test', __configScope: { type: 'config', uuid: '3f0c1d1e-1111-4222-8333-444455556666', tier: 'full' } };
const ids = (m) => m.catalogs.map((c) => c.id);

test('quality rows are declared only when picked or used by a folder', () => {
  assert.equal(ids(getConfiguredManifest(BASE, CONFIG, { integration: 'nuvio' })).some((id) => /-(4k|hdr)$/.test(id)), false);
  const home = getConfiguredManifest(BASE, CONFIG, { integration: 'nuvio', homeRows: [{ enabled: true, source: { id: 'torbox-movies-4k', catalogId: 'torbox-movies-4k', type: 'movie' } }] });
  const row = home.catalogs.find((c) => c.id === 'torbox-movies-4k');
  assert.ok(row);
  assert.equal(row.type, 'movie');
  assert.equal(row.showInHome, undefined, 'a picked row is on Home');
  const folder = getConfiguredManifest(BASE, CONFIG, { integration: 'nuvio', qualityRefs: ['torbox-series-hdr'] });
  const hdr = folder.catalogs.find((c) => c.id === 'torbox-series-hdr');
  assert.equal(hdr.type, 'series');
  assert.equal(hdr.showInHome, false, 'a folder-only row stays off Home');
  const stremio = getConfiguredManifest(BASE, CONFIG, { integration: 'stremio', homeRows: [{ enabled: true, source: { id: 'torbox-series-4k', catalogId: 'torbox-series-4k', type: 'series' } }] });
  assert.ok(ids(stremio).includes('torbox-series-4k'));
});

test('a Hub saved before 5.8 gains the 4K and HDR folders on its own provider', () => {
  const hub = { id: 'collection-lelibrary-hub', title: 'LeLibrary', folders: [
    { id: 'folder-lelibrary-hub-movies', title: 'Movies', catalogSources: [{ catalogId: 'rd-movies', type: 'movie' }] },
    { id: 'folder-lelibrary-hub-shows', title: 'Shows', catalogSources: [{ catalogId: 'rd-series', type: 'series' }] },
  ] };
  const upgraded = withHubExtras(hub);
  assert.deepEqual(upgraded.folders.map((f) => f.id), ['folder-lelibrary-hub-movies', 'folder-lelibrary-hub-shows', 'folder-lelibrary-hub-4k', 'folder-lelibrary-hub-hdr']);
  assert.deepEqual(upgraded.folders[2].catalogSources.map((s) => s.catalogId), ['rd-movies-4k', 'rd-series-4k']);
  assert.equal(withHubExtras(upgraded).folders.length, 4, 'never added twice');
  assert.equal(withHubExtras({ id: 'collection-x', folders: [] }).folders.length, 0, 'other collections untouched');
  const plan = compileCollectionPlan({ collections: [hub], integration: 'nuvio', manifestId: 'community.lelibrary.selfhosted' });
  const folders = plan.collections.find((c) => c.id === 'collection-lelibrary-hub').folders;
  const fourK = folders.find((f) => f.id === 'folder-lelibrary-hub-4k');
  assert.match(fourK.coverImageUrl, /lelibrary-hub-4k-v3\.jpg$/);
  assert.match(fourK.focusGifUrl, /lelibrary-hub-4k-focus-v3\.gif$/);
});

export interface LibraryQualityRowsTestModule {};
