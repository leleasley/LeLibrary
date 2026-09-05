const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getConfiguredManifest } = require('../app');

const BASE = 'http://localhost:7860';
const LEGACY = { provider: 'torbox', torboxApiKey: 'tb-test', tmdbApiKey: 'tmdb-test' };
const WIZARD = { ...LEGACY, wizard: true };

function rows(manifest) {
  return manifest.catalogs;
}

test('legacy/self-host manifest keeps library rows visible on Nuvio Home', () => {
  const m = getConfiguredManifest(BASE, LEGACY, { integration: 'nuvio' });
  const lib = rows(m).filter((c) => ['torbox-movies', 'torbox-series'].includes(c.id));
  assert.ok(lib.length >= 2, 'expected library rows to be advertised');
  for (const c of lib) assert.equal(c.showInHome, undefined, `${c.id} must not hide from Home`);
});

test('legacy/self-host collections row is a normal visible row (no required search)', () => {
  for (const integration of ['nuvio', 'stremio']) {
    const m = getConfiguredManifest(BASE, LEGACY, { integration });
    const coll = rows(m).find((c) => c.id === 'torbox-collections');
    assert.ok(coll, `expected torbox-collections on ${integration}`);
    assert.equal(coll.showInHome, undefined, 'must not hide from Home');
    const extras = (coll.extra || []).map((e) => e.name);
    assert.ok(extras.includes('genre'), 'keeps the franchise genre filter');
    assert.ok(!extras.includes('search'), 'no required search extra without folders');
  }
});

test('wizard-managed Nuvio manifest keeps folder-backed rows off Home', () => {
  const m = getConfiguredManifest(BASE, WIZARD, { integration: 'nuvio' });
  const lib = rows(m).filter((c) => ['torbox-movies', 'torbox-series'].includes(c.id));
  assert.ok(lib.length >= 2, 'expected library rows to be advertised');
  for (const c of lib) assert.equal(c.showInHome, false, `${c.id} stays off the managed Home`);
  const coll = rows(m).find((c) => c.id === 'torbox-collections');
  assert.ok(coll, 'expected torbox-collections');
  assert.equal(coll.showInHome, false, 'folder-backed collections row stays off Home');
  const search = (coll.extra || []).find((e) => e.name === 'search');
  assert.ok(search && search.isRequired === true, 'required search extra keeps it out of listings');
});

test('search rows stay out of Home on every install type', () => {
  for (const cfg of [LEGACY, WIZARD]) {
    for (const integration of ['nuvio', 'stremio']) {
      const m = getConfiguredManifest(BASE, cfg, { integration });
      const search = rows(m).filter((c) => String(c.id).startsWith('lelibrary-search-'));
      assert.ok(search.length > 0, 'expected search rows');
      for (const c of search) assert.equal(c.showInHome, false, `${c.id} stays out of Home`);
    }
  }
});
