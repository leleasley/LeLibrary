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

test('search scope advertises separate global and owned result rows in order', () => {
  const expected = {
    combined: ['lelibrary-search-movies', 'lelibrary-search-series', 'lelibrary-search-my-movies', 'lelibrary-search-my-series', 'lelibrary-search-collections'],
    library: ['lelibrary-search-my-movies', 'lelibrary-search-my-series', 'lelibrary-search-collections'],
    tmdb: ['lelibrary-search-movies', 'lelibrary-search-series'],
  };
  for (const [scope, ids] of Object.entries(expected)) {
    const manifest = getConfiguredManifest(BASE, { ...LEGACY, searchScope: scope }, { integration: 'stremio' });
    const searchRows = rows(manifest).filter((row) => String(row.id).startsWith('lelibrary-search-'));
    assert.deepEqual(searchRows.map((row) => row.id), ids, scope);
    for (const row of searchRows) {
      assert.equal(row.showInHome, false);
      assert.equal(row.extra?.[0]?.name, 'search');
      assert.equal(row.extra?.[0]?.isRequired, true);
    }
  }
});

test('global search labels never imply that owned results are merged', () => {
  const manifest = getConfiguredManifest(BASE, { ...LEGACY, searchScope: 'combined' }, { integration: 'nuvio' });
  const searchRows = rows(manifest).filter((row) => ['lelibrary-search-movies', 'lelibrary-search-series'].includes(row.id));
  assert.deepEqual(searchRows.map((row) => row.name), ['LeLibrary · Movies', 'LeLibrary · Series']);
});

test('Custom Streams advertise deduplicated movie and series Home rows', () => {
  const customStreams = [
    { name: 'Movie one', url: 'https://example.com/one.mp4', type: 'movie', ids: ['tt123'] },
    { name: 'Movie two', url: 'https://example.com/two.mp4', type: 'movie', ids: ['tt123'] },
    { name: 'Episode', url: 'https://example.com/e1.mp4', type: 'series', ids: ['tt456:1:1'] },
  ];
  const legacy = getConfiguredManifest(BASE, { ...LEGACY, customStreams }, { integration: 'nuvio' });
  const legacyRows = rows(legacy).filter(row => row.id.startsWith('custom-stream-'));
  assert.deepEqual(legacyRows.map(row => row.id), ['custom-stream-movies', 'custom-stream-series']);
  assert.ok(legacyRows.every(row => row.showInHome === undefined));

  const hidden = getConfiguredManifest(BASE, { ...WIZARD, customStreams }, { integration: 'nuvio', homeRows: [] });
  assert.ok(rows(hidden).filter(row => row.id.startsWith('custom-stream-')).every(row => row.showInHome === false));

  const selected = getConfiguredManifest(BASE, { ...WIZARD, customStreams }, {
    integration: 'nuvio',
    homeRows: [{ enabled: true, source: { id: 'custom-stream-movies', type: 'movie' } }],
  });
  assert.equal(rows(selected).find(row => row.id === 'custom-stream-movies').showInHome, undefined);
  assert.equal(rows(selected).find(row => row.id === 'custom-stream-series').showInHome, false);
});
