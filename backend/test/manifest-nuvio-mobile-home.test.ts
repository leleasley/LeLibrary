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
