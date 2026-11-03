// @ts-nocheck
// v6 item 9: a Home-managed Nuvio setup (Settle In / Move In) whose folders
// read the shared lelibrary-curated-{movie,series} catalogues no longer
// declares a lib-* row for every pack/folder source. Nuvio counted ~168
// catalogues for such a setup. Stremio, Quick Look and non-Home-managed
// installs are unchanged. The fixture is built exactly as the manifest route
// builds it: the setup's collections document through compileCollectionPlan.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getConfiguredManifest } = require('../app.ts');
const { compileCollectionPlan } = require('../src/catalog/collection-plan.ts');
const { buildCuratedCollections, curatedSourceIds } = require('../src/catalog/curated-collections.ts');

const BASE = 'http://localhost:7860';
const MANIFEST_ID = 'community.lelibrary.selfhosted';
const KEYS = { provider: 'torbox', torboxApiKey: 'tb-test', tmdbApiKey: 'tmdb-test' };
const PACKS = ['lelibrary-special', 'streaming', 'franchises', 'genres', 'actors', 'anime-hub', 'comic-heroes', 'scifi-sagas', 'kids-family', 'moods'];
const HUB = {
  id: 'collection-lelibrary-hub',
  title: 'LeLibrary',
  folders: [
    { id: 'folder-lelibrary-hub-movies', title: 'Movies', catalogSources: [{ addonId: '', catalogId: 'torbox-movies', type: 'movie', genre: '' }] },
    { id: 'folder-lelibrary-hub-shows', title: 'Shows', catalogSources: [{ addonId: '', catalogId: 'torbox-series', type: 'series', genre: '' }] },
  ],
};

function setupConfig(tier, extra = {}) {
  const config = { ...KEYS, nuvioCollectionPacks: PACKS, ...extra };
  Object.defineProperty(config, '__configScope', { value: { type: 'config', uuid: '3f0c1d1e-1111-4222-8333-444455556666', tier }, enumerable: false });
  return config;
}

// What handleConfiguredManifest does for a v5.5 setup.
function manifestFor(config, integration, homeRows = []) {
  const collections = [HUB, ...buildCuratedCollections(PACKS)];
  const plan = compileCollectionPlan({ collections, homeRows, sources: [], manifestId: MANIFEST_ID, integration, hideAnime: false });
  const manifest = getConfiguredManifest(BASE, config, {
    integration,
    collectionRefs: plan.folderLibraryIds,
    // The route's qualityRefsFrom: the Hub's 4K / HDR folders.
    qualityRefs: ['torbox-movies-4k', 'torbox-series-4k', 'torbox-movies-hdr', 'torbox-series-hdr'],
    homeRows: plan.homeRows,
    importedTypes: plan.importedTypes,
  });
  return { manifest, plan };
}

const libRows = (m) => m.catalogs.filter((c) => /^lib-/.test(c.id));
const PICKED = [{ enabled: true, order: 0, source: { addonId: MANIFEST_ID, catalogId: 'lib-trending_movies', type: 'movie' } }];

test('Move In / Settle In on Nuvio: no folder-only lib-* rows, compact routes and picked Home rows kept', () => {
  for (const tier of ['full', 'partial']) {
    const { manifest, plan } = manifestFor(setupConfig(tier), 'nuvio', PICKED);
    assert.ok(plan.folderLibraryIds.length > 100, `fixture is a big pack selection (${plan.folderLibraryIds.length})`);
    const ids = manifest.catalogs.map((c) => c.id);
    assert.ok(ids.includes('lelibrary-curated-movie'), `${tier}: compact movie route`);
    assert.ok(ids.includes('lelibrary-curated-series'), `${tier}: compact series route`);
    assert.deepEqual(libRows(manifest).map((c) => c.id), ['lib-trending_movies'], `${tier}: only the picked Home row`);
    const picked = manifest.catalogs.find((c) => c.id === 'lib-trending_movies');
    assert.notEqual(picked.showInHome, false, 'a picked Home row stays on Home');
    // Hub folders read library rows, not lib-*: they stay declared.
    for (const id of ['torbox-movies', 'torbox-series']) assert.ok(ids.includes(id), `${tier}: ${id}`);
  }
});

test('every folder source the plan pushes is still declared by the smaller manifest', () => {
  const { manifest, plan } = manifestFor(setupConfig('full'), 'nuvio', PICKED);
  const declared = new Set(manifest.catalogs.map((c) => `${c.type}:${c.id}`));
  for (const collection of plan.collections) {
    for (const folder of collection.folders) {
      for (const source of folder.catalogSources) {
        if (source.addonId && source.addonId !== MANIFEST_ID) continue;
        assert.ok(!source.catalogId.startsWith('lib-'), `folder source ${source.catalogId} must be compacted`);
        assert.ok(declared.has(`${source.type}:${source.catalogId}`), `folder source ${source.type}:${source.catalogId} must be declared`);
      }
    }
  }
  // Every picked Home row is declared too (push.ts orders Home by these).
  for (const row of plan.homeRows) assert.ok(declared.has(`${row.source.type}:${row.source.catalogId}`), row.source.catalogId);
});

test('a pack source enabled in libraryCatalogs keeps its row', () => {
  const { manifest } = manifestFor(setupConfig('full', { libraryCatalogs: ['trending_series'] }), 'nuvio');
  assert.deepEqual(libRows(manifest).map((c) => c.id), ['lib-trending_series']);
});

test('Stremio still declares every pack source', () => {
  const { manifest } = manifestFor(setupConfig('full'), 'stremio', PICKED);
  const ids = new Set(libRows(manifest).map((c) => c.id));
  for (const id of curatedSourceIds(PACKS)) assert.ok(ids.has(`lib-${id}`), `stremio lib-${id}`);
  assert.equal(manifest.catalogs.some((c) => c.id.startsWith('lelibrary-curated-')), false);
});

test('Quick Look on Nuvio keeps its pack rows as ordinary rows', () => {
  const { manifest } = manifestFor(setupConfig('quick'), 'nuvio');
  const rows = libRows(manifest);
  assert.equal(rows.length, curatedSourceIds(PACKS).length);
  assert.ok(rows.every((c) => c.showInHome !== false));
});

test('a Home-managed setup without folders keeps its pack rows (off Home)', () => {
  // No collections document: nothing reads the compact routes, so the rows
  // stay exactly as before.
  const m = getConfiguredManifest(BASE, setupConfig('full'), { integration: 'nuvio' });
  assert.equal(libRows(m).length, curatedSourceIds(PACKS).length);
  assert.ok(libRows(m).every((c) => c.showInHome === false));
});

test('catalogue count for a big pack selection drops from hundreds to a handful', () => {
  const after = manifestFor(setupConfig('full'), 'nuvio').manifest.catalogs.length;
  const before = manifestFor(setupConfig('quick'), 'nuvio').manifest.catalogs.length;
  console.log(`[count] ${PACKS.length} packs: ${before} catalogues with pack rows -> ${after} on Move In Nuvio`);
  assert.ok(before > 150, `before ${before}`);
  assert.ok(after < 20, `after ${after}`);
});

export interface ManifestSharedFolderCatalogueTestModule {};
