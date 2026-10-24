// @ts-nocheck
// Nuvio Mobile/Desktop ignore `showInHome` and fill the hero from the first two
// catalogues without a required extra (hero choices are device-local, never in
// the synced Home settings). Rows a setup keeps off Home must therefore carry a
// required `genre` extra on the Nuvio manifest; folders still load them.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getConfiguredManifest } = require('../app.ts');

const BASE = 'http://localhost:7860';
const KEYS = { provider: 'torbox', torboxApiKey: 'tb-test', tmdbApiKey: 'tmdb-test' };

function setup(tier) {
  const config = { ...KEYS };
  Object.defineProperty(config, '__configScope', { value: { type: 'config', uuid: '3f0c1d1e-1111-4222-8333-444455556666', tier }, enumerable: false });
  return config;
}
const lib = (m) => m.catalogs.filter((c) => ['torbox-movies', 'torbox-series'].includes(c.id));
const offMobileHome = (c) => (c.extra || []).some((e) => e.isRequired === true);

test('Move In and Settle In keep unpicked library rows off Nuvio Home and hero', () => {
  for (const tier of ['full', 'partial']) {
    const rows = lib(getConfiguredManifest(BASE, setup(tier), { integration: 'nuvio' }));
    assert.equal(rows.length, 2);
    for (const c of rows) {
      assert.equal(c.showInHome, false, `${tier} ${c.id}: hidden for Nuvio TV`);
      const genre = c.extra.find((e) => e.name === 'genre');
      assert.ok(genre && genre.isRequired === true && genre.options.length > 0, `${tier} ${c.id}: required genre for Mobile/Desktop`);
      assert.ok(c.extra.some((e) => e.name === 'skip'), 'paging still works');
      assert.ok(!c.extra.some((e) => e.name === 'search'), 'never becomes a search source');
    }
  }
});

test('a library row picked as a Home row stays a normal Home row', () => {
  const homeRows = [{ enabled: true, source: { id: 'torbox-movies', type: 'movie' } }];
  const rows = lib(getConfiguredManifest(BASE, setup('full'), { integration: 'nuvio', homeRows }));
  const movies = rows.find((c) => c.id === 'torbox-movies');
  const series = rows.find((c) => c.id === 'torbox-series');
  assert.equal(movies.showInHome, undefined);
  assert.equal(offMobileHome(movies), false, 'picked row stays eligible for Home and hero');
  assert.equal(series.showInHome, false);
  assert.equal(offMobileHome(series), true);
});

test('Quick Look has no Home picker: library rows stay visible', () => {
  for (const c of lib(getConfiguredManifest(BASE, setup('quick'), { integration: 'nuvio' }))) {
    assert.equal(c.showInHome, undefined);
    assert.equal(offMobileHome(c), false);
  }
});

test('Stremio manifests are untouched', () => {
  for (const c of lib(getConfiguredManifest(BASE, setup('full'), { integration: 'stremio' }))) {
    assert.equal(c.showInHome, undefined);
    assert.equal(offMobileHome(c), false);
  }
});

test('every catalogue hidden from Nuvio Home is also off Mobile Home', () => {
  const m = getConfiguredManifest(BASE, { ...KEYS, wizard: true, nuvioCollectionPacks: ['genres'] }, { integration: 'nuvio' });
  const hidden = m.catalogs.filter((c) => c.showInHome === false);
  assert.ok(hidden.length > 3);
  for (const c of hidden) assert.ok(offMobileHome(c), `${c.id} must carry a required extra`);
});

test('the shared extras array is never mutated across rows', () => {
  const m = getConfiguredManifest(BASE, setup('full'), { integration: 'nuvio', homeRows: [{ enabled: true, source: { id: 'torbox-movies', type: 'movie' } }] });
  const movies = m.catalogs.find((c) => c.id === 'torbox-movies');
  assert.deepEqual(movies.extra, [{ name: 'skip' }]);
});

// Main2 on prod (2026-10-24): a Move In setup with a collection pack. Its
// folders read the compact curated catalogues, but every pack source was also
// a visible lib-* catalogue, so Nuvio put the whole pack on Home as rows.
function setupWith(tier, extra) {
  const config = { ...KEYS, ...extra };
  Object.defineProperty(config, '__configScope', { value: { type: 'config', uuid: '3f0c1d1e-1111-4222-8333-444455556666', tier }, enumerable: false });
  return config;
}
const packRows = (m) => m.catalogs.filter((c) => /^lib-/.test(c.id));

test('Move In and Settle In collection packs stay in their folders, not on Nuvio Home', () => {
  for (const tier of ['full', 'partial']) {
    const m = getConfiguredManifest(BASE, setupWith(tier, { nuvioCollectionPacks: ['lelibrary-special'] }), { integration: 'nuvio' });
    const rows = packRows(m);
    assert.ok(rows.length > 20, `${tier}: pack sources still listed for folders (${rows.length})`);
    for (const c of rows) {
      assert.equal(c.showInHome, false, `${tier} ${c.id}: off Nuvio TV Home`);
      assert.ok(offMobileHome(c), `${tier} ${c.id}: off Nuvio Mobile/Desktop Home`);
    }
  }
});

test('a pack source picked as a Home row stays on Home', () => {
  const homeRows = [{ enabled: true, source: { id: 'lib-trending_movies', type: 'movie' } }];
  const m = getConfiguredManifest(BASE, setupWith('full', { nuvioCollectionPacks: ['lelibrary-special'] }), { integration: 'nuvio', homeRows });
  const picked = m.catalogs.find((c) => c.id === 'lib-trending_movies');
  assert.notEqual(picked.showInHome, false);
  assert.equal(offMobileHome(picked), false);
});

test('Quick Look and Stremio keep pack sources as ordinary rows', () => {
  const quick = packRows(getConfiguredManifest(BASE, setupWith('quick', { nuvioCollectionPacks: ['lelibrary-special'] }), { integration: 'nuvio' }));
  assert.ok(quick.length > 0 && quick.every((c) => c.showInHome !== false));
  const stremio = packRows(getConfiguredManifest(BASE, setupWith('full', { nuvioCollectionPacks: ['lelibrary-special'] }), { integration: 'stremio' }));
  assert.ok(stremio.every((c) => c.showInHome !== false));
});
