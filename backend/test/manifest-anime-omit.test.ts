// @ts-nocheck
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getConfiguredManifest } = require('../app.ts');

const BASE = 'http://localhost:7860';
const LEGACY = { provider: 'torbox', torboxApiKey: 'tb-test', tmdbApiKey: 'tmdb-test' };

function ids(manifest) {
  return manifest.catalogs.map((c) => c.id);
}

// Stremio fetches every advertised catalog: an anime row for an anime-free
// library is pure waste, so the manifest handler drops it once the local
// index proves the scope holds no anime (omitAnime). The row must stay the
// default whenever the index can't prove that.
test('anime row is advertised by default (unknown library contents)', () => {
  for (const integration of ['nuvio', 'stremio']) {
    const m = getConfiguredManifest(BASE, LEGACY, { integration });
    assert.ok(ids(m).includes('torbox-anime'), `anime row expected on ${integration}`);
  }
});

test('omitAnime drops only the anime row', () => {
  const m = getConfiguredManifest(BASE, LEGACY, { integration: 'stremio', omitAnime: true });
  const list = ids(m);
  assert.ok(!list.includes('torbox-anime'), 'anime row must be omitted');
  assert.ok(list.includes('torbox-movies'), 'movies row must stay');
  assert.ok(list.includes('torbox-series'), 'series row must stay');
  assert.ok(list.includes('torbox-collections'), 'franchise collections row must stay');
});

test('an explicitly enabled anime row survives omitAnime', () => {
  const m = getConfiguredManifest(BASE, { ...LEGACY, catalogAnime: true }, { integration: 'stremio', omitAnime: true });
  assert.ok(ids(m).includes('torbox-anime'), 'explicit choice always wins');
});

test('catalogAnime:false drops the row with or without omitAnime', () => {
  for (const opts of [{ integration: 'stremio' }, { integration: 'stremio', omitAnime: true }]) {
    const m = getConfiguredManifest(BASE, { ...LEGACY, catalogAnime: false }, opts);
    assert.ok(!ids(m).includes('torbox-anime'), `no anime row for ${JSON.stringify(opts)}`);
  }
});

export interface ManifestAnimeOmitTestModule {};
