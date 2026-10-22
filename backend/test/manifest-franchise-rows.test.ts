// @ts-nocheck
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getConfiguredManifest, resolveIntegration } = require('../app.ts');

function fakeReq({ clientIntegration = null, query = {}, userAgent = '' } = {}) {
  return {
    clientIntegration,
    query,
    headers: { 'user-agent': userAgent },
    get: (name) => (String(name).toLowerCase() === 'user-agent' ? userAgent : ''),
  };
}

test('integration resolution prefers explicit signals, then saved player, then UA', () => {
  const stremioFacade = { manifestMode: 'stremio' };
  const nuvioFacade = { manifestMode: 'nuvio' };
  assert.equal(resolveIntegration(fakeReq({ clientIntegration: stremioFacade }), {}), 'stremio');
  assert.equal(resolveIntegration(fakeReq({ clientIntegration: nuvioFacade }), {}), 'nuvio');
  assert.equal(resolveIntegration(fakeReq({ query: { integration: 'stremio' } }), {}), 'stremio');
  assert.equal(resolveIntegration(fakeReq(), { wizardPlatform: 'stremio' }), 'stremio');
  assert.equal(resolveIntegration(fakeReq(), { wizardPlatform: 'nuvio' }), 'nuvio');
  assert.equal(
    resolveIntegration(fakeReq({ userAgent: 'Mozilla/5.0 StremioShell/4.4.165' }), {}),
    'stremio'
  );
  // Doubt defaults to nuvio (today's behavior): unknown agents, and a UA
  // claiming both, never promote.
  assert.equal(resolveIntegration(fakeReq({ userAgent: 'curl/8.0' }), {}), 'nuvio');
  assert.equal(resolveIntegration(fakeReq({ userAgent: 'Stremio Nuvio bridge' }), {}), 'nuvio');
  assert.equal(resolveIntegration(fakeReq(), {}), 'nuvio');
});
const providers = require('../src/providers/index.ts');
const franchise = require('../src/catalog/franchise-collections.ts');

const BASE = 'http://localhost:7860';
const LEGACY = { provider: 'torbox', torboxApiKey: 'tb-franchise-test', tmdbApiKey: 'tmdb-test' };

function seedFranchises() {
  const userKey = providers.getUserKey(LEGACY);
  franchise.cacheCollections(userKey, 'en-US', [
    { id: 'torbox:collection:toy-story-bxgqk', name: 'Toy Story Collection', collectionId: 10194, videos: [] },
    { id: 'torbox:collection:jurassic-park-kqzmt', name: 'Jurassic Park Collection', collectionId: 329, videos: [] },
  ]);
  return userKey;
}

test('stremio manifest advertises one movie catalog per built franchise', () => {
  seedFranchises();
  const m = getConfiguredManifest(BASE, LEGACY, { integration: 'stremio' });
  const ids = m.catalogs.map((c) => c.id);
  assert.ok(ids.includes('torbox-collection-toy-story-bxgqk'), 'toy story franchise row');
  const row = m.catalogs.find((c) => c.id === 'torbox-collection-toy-story-bxgqk');
  assert.equal(row.type, 'movie');
  assert.equal(row.name, 'Toy Story');
  assert.ok(!ids.includes('torbox-collections'), 'single row replaced by per-franchise rows');
});

test('cold stremio manifest falls back to the single collections row', () => {
  const userKey = providers.getUserKey(LEGACY);
  franchise.cacheCollections(userKey, 'en-US', []);
  const m = getConfiguredManifest(BASE, LEGACY, { integration: 'stremio' });
  const ids = m.catalogs.map((c) => c.id);
  assert.ok(ids.includes('torbox-collections'), 'single fallback row present when nothing built');
  assert.ok(!ids.some((id) => String(id).startsWith('torbox-collection-')), 'no per-franchise rows when cold');
});

test('nuvio keeps the single compact row its folders point at', () => {
  seedFranchises();
  const m = getConfiguredManifest(BASE, { ...LEGACY, wizard: true }, { integration: 'nuvio' });
  const ids = m.catalogs.map((c) => c.id);
  assert.ok(ids.includes('torbox-collections'), 'compact row kept for nuvio folders');
  assert.ok(!ids.some((id) => String(id).startsWith('torbox-collection-')), 'no per-franchise rows on nuvio');
});

export interface ManifestFranchiseRowsTestModule {};
