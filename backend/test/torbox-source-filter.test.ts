// @ts-nocheck
// Issue #16: `torboxSources` limits the library to some TorBox download kinds
// (torrents, usenet, web downloads). Absent means all three, unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');

const providers = require('../src/providers/index.ts');
const { encodeConfig, normalizeConfig } = require('../src/config/token-map.ts');
const { excludedTorboxKinds } = require('../src/library/sync.ts');

const ALL = ['torrent', 'usenet', 'webdl'];

test('no selection, an empty one or junk keeps every TorBox source', () => {
  assert.deepEqual(providers.torboxSources({}), ALL);
  assert.deepEqual(providers.torboxSources({ torboxSources: [] }), ALL);
  assert.deepEqual(providers.torboxSources({ torboxSources: ['nzb', 42, null] }), ALL);
  assert.deepEqual(providers.torboxSources({ torboxSources: { usenet: true } }), ALL);
  assert.equal(providers.torboxSourcesKey({}), '');
  assert.equal(providers.torboxSourcesKey({ torboxSources: ALL }), '');
});

test('a selection keeps only known sources, in a stable order', () => {
  assert.deepEqual(providers.torboxSources({ torboxSources: ['usenet'] }), ['usenet']);
  assert.deepEqual(providers.torboxSources({ torboxSources: ['webdl', 'bogus', 'usenet'] }), ['usenet', 'webdl']);
  assert.deepEqual(providers.torboxSources({ torboxSources: 'webdl,torrent' }), ['torrent', 'webdl']);
  assert.equal(providers.torboxSourcesKey({ torboxSources: ['webdl', 'usenet'] }), 'usenet,webdl');
});

test('unselected TorBox sources are dropped, other providers pass through', () => {
  const downloads = [
    { id: 1, source: 'torrent' },
    { id: 2, source: 'usenet' },
    { id: 3, source: 'webdl' },
    { id: 4, source: 'realdebrid' },
    { id: 5, source: 'webdav' },
  ];
  Object.defineProperty(downloads, 'failedProviders', { value: ['alldebrid'], enumerable: false });
  const out = providers.filterTorboxSources({ torboxSources: ['usenet'] }, downloads);
  assert.deepEqual(out.map((d) => d.id), [2, 4, 5]);
  assert.deepEqual(out.failedProviders, ['alldebrid']);
  assert.equal(providers.filterTorboxSources({}, downloads), downloads);
});

test('fetchDownloads applies the selection to a cached snapshot too', async () => {
  const base = { provider: 'torbox', torboxApiKey: `synthetic-${Date.now()}` };
  const snapshot = [
    { id: 1, source: 'torrent', name: 'Movie.One.2020.mkv' },
    { id: 2, source: 'usenet', name: 'Movie.Two.2021.mkv' },
  ];
  await providers.setCachedDownloads(base, snapshot);
  const all = await providers.fetchDownloads(base);
  assert.deepEqual(all.map((d) => d.id), [1, 2]);
  // A limited selection has its own snapshot: a sync seeds it with an already
  // filtered list, which must never be served to an all-sources config.
  const usenetOnly = { ...base, torboxSources: ['usenet'] };
  await providers.setCachedDownloads(usenetOnly, [{ id: 3, source: 'usenet', name: 'Movie.Three.2022.mkv' }]);
  assert.deepEqual((await providers.fetchDownloads(usenetOnly)).map((d) => d.id), [3]);
  assert.deepEqual((await providers.fetchDownloads(base)).map((d) => d.id), [1, 2]);
});

test('the selection survives the compact config token', () => {
  const token = encodeConfig({ provider: 'torbox', torboxSources: ['usenet', 'webdl'] });
  const decoded = normalizeConfig(JSON.parse(Buffer.from(token, 'base64url').toString('utf8')));
  assert.deepEqual(decoded.torboxSources, ['usenet', 'webdl']);
  const short = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  assert.equal(short.tbs, 'usenet,webdl');
});

test('a library sync removes only the kinds a TorBox config leaves out', () => {
  const torbox = { provider: 'torbox', torboxApiKey: 'synthetic' };
  assert.deepEqual(excludedTorboxKinds(torbox), []);
  assert.deepEqual(excludedTorboxKinds({ ...torbox, torboxSources: ['usenet'] }), ['torrent', 'webdl']);
  // Without TorBox the setting has nothing to act on.
  assert.deepEqual(excludedTorboxKinds({ provider: 'realdebrid', rdApiKey: 'x', torboxSources: ['usenet'] }), []);
});
