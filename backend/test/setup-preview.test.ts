// @ts-nocheck
'use strict';
// Setup Preview (GET /api/setup/:uuid/preview): same authority as the editor
// config, display data only, and the Nuvio Home order is the push's own.
// Synthetic setup and keys; the real manifest builder and collection plan run,
// only the Movie Collections loopback fetch is stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const OTHER = '223e4567-e89b-12d3-a456-426614174000';
const SECRET = 'synthetic-install-secret-x9';
const TOKEN = `${UUID}.${SECRET}`;
const KEYS = {
  torboxApiKey: 'synthetic-torbox-key-1234',
  tmdbApiKey: 'synthetic-tmdb-key-5678',
  push: { nuvio: { nuvioToken: 'synthetic-nuvio-session-abc', nuvioRefresh: 'synthetic-nuvio-refresh-def' } },
};

const homeRow = (catalogId, type, order, title) => ({
  id: `row-${catalogId}`, title: title || catalogId, customTitle: Boolean(title),
  source: { kind: 'catalog', id: catalogId, catalogId, type, addonId: '' }, enabled: true, order,
});

// Settle In / Move In style: rows picked in a deliberate order (series first).
const CONFIG = {
  provider: 'torbox',
  platform: 'nuvio',
  collectionHomeRows: [
    homeRow('torbox-movies', 'movie', 1),
    homeRow('torbox-series', 'series', 0, 'My Shows Renamed'),
  ],
  collections: [{
    id: 'collection-lelibrary-mine',
    title: 'Mine',
    backdropUrl: `https://image.tmdb.org/t/p/original/backdrop.jpg`,
    folders: [
      {
        id: 'folder-a', title: 'Folder A',
        coverImageUrl: `https://example.test/${TOKEN}/poster.jpg`,
        catalogSources: [{ addonId: '', catalogId: 'torbox-movies', type: 'movie' }],
      },
      {
        id: 'folder-b', title: 'Folder B', coverImageUrl: '/art/folder/folder-b.jpg',
        catalogSources: [{ addonId: '', catalogId: 'torbox-series', type: 'series' }],
      },
      { id: 'folder-empty', title: 'Empty', catalogSources: [] },
    ],
  }],
};

function opened(uuid = UUID, overrides = {}) {
  return {
    uuid, tier: 'full', name: 'Living room', hasPassword: true,
    config: CONFIG, keys: KEYS, secret: SECRET, createdAt: null, updatedAt: null,
    ...overrides,
  };
}

async function startApp({ setup = opened(), previewDeps } = {}) {
  const { mountSetupRoutes } = require('../src/routes/setup.ts');
  const { createEditSessionStore } = require('../src/setup/edit-sessions.ts');
  const sessions = createEditSessionStore();
  const app = express();
  app.set('trust proxy', false);
  mountSetupRoutes(app, {
    editSessions: sessions,
    previewDeps: previewDeps || { fetchFranchise: async () => null },
    getStore: async () => ({
      resolveByUuid: async (uuid) => (uuid === UUID ? setup : uuid === OTHER ? opened(OTHER) : null),
      resolveByToken: async (token) => (token === TOKEN ? setup : null),
      checkPassword: async () => false,
    }),
  });
  const server = app.listen(0);
  await once(server, 'listening');
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    sessions,
    close: () => new Promise((r) => server.close(r)),
  };
}

const get = (app, path, bearer) => fetch(`${app.base}/api/setup${path}`, bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : {});

test('preview needs this setup\'s edit token', async () => {
  const app = await startApp();
  try {
    assert.equal((await get(app, `/${UUID}/preview?platform=nuvio`)).status, 401, 'no token');
    assert.equal((await get(app, `/${UUID}/preview?platform=nuvio`, 'not-a-real-token')).status, 401, 'garbage token');
    const other = app.sessions.issue(OTHER).token;
    assert.equal((await get(app, `/${UUID}/preview?platform=nuvio`, other)).status, 401, 'another setup\'s token');
    const mine = app.sessions.issue(UUID).token;
    assert.equal((await get(app, `/${UUID}/preview?platform=tv`, mine)).status, 400, 'unknown platform');
    const ok = await get(app, `/${UUID}/preview?platform=nuvio`, mine);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
  } finally { await app.close(); }
});

test('preview carries no key, token, install link or link with a token', async () => {
  const app = await startApp();
  try {
    const mine = app.sessions.issue(UUID).token;
    for (const platform of ['nuvio', 'stremio']) {
      const raw = await (await get(app, `/${UUID}/preview?platform=${platform}`, mine)).text();
      for (const secret of [SECRET, TOKEN, KEYS.torboxApiKey, KEYS.tmdbApiKey, KEYS.push.nuvio.nuvioToken, KEYS.push.nuvio.nuvioRefresh, mine]) {
        assert.ok(!raw.includes(secret), `${platform}: leaked ${secret.slice(0, 12)}`);
      }
      assert.ok(!/manifest\.json/i.test(raw), `${platform}: no manifest link`);
      assert.ok(!/apikey|token|password|secret/i.test(Object.keys(flatKeys(JSON.parse(raw))).join(' ')), `${platform}: no key-shaped fields`);
    }
  } finally { await app.close(); }
});

function flatKeys(value, out = {}) {
  if (Array.isArray(value)) value.forEach((v) => flatKeys(v, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out[k] = true; flatKeys(v, out); }
  return out;
}

test('Nuvio preview: collections lead, rows follow in the push\'s Home order', async () => {
  const { buildSetupPreview } = require('../src/setup/preview.ts');
  const push = require('../src/setup/push.ts');
  const { buildConfiguredManifest } = require('../src/routes/manifest.ts');
  const { compileCollectionPlan } = require('../src/catalog/collection-plan.ts');
  const { setupEngineConfig } = require('../src/config/resolve-config.ts');
  const { toEngineConfig } = require('../src/setup/config-store.ts');
  const origin = 'https://lelibrary.test';
  const preview = await buildSetupPreview({ opened: opened(), platform: 'nuvio', origin }, { fetchFranchise: async () => null });

  // What the push would send for a fresh profile, built independently.
  const config = setupEngineConfig(toEngineConfig(opened()), opened(), TOKEN);
  const manifest = await buildConfiguredManifest(config, TOKEN, 'nuvio', origin);
  const plan = compileCollectionPlan({ collections: CONFIG.collections, homeRows: CONFIG.collectionHomeRows, sources: [], externalSources: [], manifestId: manifest.id, integration: 'nuvio' });
  const collections = push.nuvioCollectionsFromPlan(plan.collections, manifest.id, origin);
  const items = push.planNuvioHomeItems({ items: [], manifest, homeRows: plan.homeRows, collections, franchiseSlot: null })
    .filter((item) => item.enabled !== false)
    .map((item) => (item.is_collection ? `collection:${item.collection_id}` : `row:${item.type}:${item.catalog_id}`));
  const seen = preview.home.map((entry) => (entry.kind === 'collection' ? `collection:${entry.id}` : `row:${entry.type}:${entry.catalogId}`));
  assert.deepEqual(seen, items, 'same order as the push');
  assert.deepEqual(seen, ['collection:collection-lelibrary-mine', 'row:series:torbox-series', 'row:movie:torbox-movies']);
  const series = preview.home.find((entry) => entry.catalogId === 'torbox-series');
  assert.equal(series.name, 'My Shows Renamed', 'a renamed row keeps its custom title');

  const mine = preview.collections.find((c) => c.id === 'collection-lelibrary-mine');
  assert.deepEqual(mine.folders.map((f) => f.id), ['folder-a', 'folder-b'], 'empty folders are dropped like the push');
  assert.equal(mine.folders[0].cover, '', 'an art link that carries the install token is dropped');
  assert.equal(mine.folders[1].cover, `${origin}/art/folder/folder-b.jpg`, 'relative art becomes a full link');
  assert.equal(mine.backdrop, 'https://image.tmdb.org/t/p/original/backdrop.jpg');
  assert.deepEqual(mine.folders[1].sources.map((s) => [s.type, s.catalogId]), [['series', 'torbox-series']]);
});

test('Nuvio preview: hero sources, addon name, folder art and pinned collections', async () => {
  const { buildSetupPreview } = require('../src/setup/preview.ts');
  const origin = 'https://lelibrary.test';
  const out = await buildSetupPreview({ opened: opened(), platform: 'nuvio', origin }, { fetchFranchise: async () => null });
  assert.ok(out.addonName.length > 0, 'the addon name is carried for subtitles');
  // The hero follows Home order: the first two Home catalogues.
  assert.deepEqual(out.hero.map((row) => row.catalogId), ['torbox-series', 'torbox-movies']);
  assert.equal(out.hero[0].custom, true, 'a renamed row is flagged custom');
  const folder = out.collections[0].folders[1];
  assert.equal(folder.focusGif, '', 'no animated cover unless enabled');
  assert.equal(folder.sources[0].catalogName.length > 0, true, 'sources carry their catalogue name');
  assert.equal(out.collections[0].pinToTop, false);

  const pinned = {
    ...CONFIG,
    collections: [
      CONFIG.collections[0],
      {
        id: 'collection-lelibrary-pinned', title: 'Pinned', pinToTop: true,
        folders: [{
          id: 'folder-gif', title: 'Gif', coverImageUrl: '/art/folder/gif.jpg', focusGifUrl: '/art/folder/gif.gif', focusGifEnabled: true,
          catalogSources: [{ addonId: '', catalogId: 'torbox-movies', type: 'movie' }],
        }],
      },
    ],
  };
  const second = await buildSetupPreview({ opened: opened(UUID, { config: pinned }), platform: 'nuvio', origin }, { fetchFranchise: async () => null });
  assert.equal(second.home[0].kind, 'collection');
  assert.equal(second.home[0].id, 'collection-lelibrary-pinned', 'a pinned collection leads Home');
  const gif = second.collections.find((c) => c.id === 'collection-lelibrary-pinned').folders[0];
  assert.equal(gif.focusGif, `${origin}/art/folder/gif.gif`);
});

test('Movie Collections lands at its slot; pending when the library is not built', async () => {
  const { buildSetupPreview } = require('../src/setup/preview.ts');
  const withFranchise = { ...CONFIG, collectionHomeRows: [...CONFIG.collectionHomeRows, { ...homeRow('torbox-collections', 'movie', 9), _nativeFranchiseCollection: true, collectionSlot: 1 }] };
  const franchise = {
    id: 'collection-lelibrary-franchises', title: 'Movie Collections',
    folders: [{ id: 'f-bond', title: 'James Bond', coverImageUrl: 'https://image.tmdb.org/t/p/w500/bond.jpg', sources: [{ addonId: '', catalogId: 'collection-645', type: 'movie', genre: '' }] }],
  };
  const out = await buildSetupPreview({ opened: opened(UUID, { config: withFranchise }), platform: 'nuvio', origin: 'https://lelibrary.test' }, { fetchFranchise: async () => franchise });
  assert.deepEqual(out.collections.map((c) => c.id), ['collection-lelibrary-mine', 'collection-lelibrary-franchises']);
  assert.deepEqual(out.home.filter((e) => e.kind === 'collection').map((e) => e.id), ['collection-lelibrary-mine', 'collection-lelibrary-franchises']);
  assert.equal(out.franchisePending, false);
  const pending = await buildSetupPreview({ opened: opened(UUID, { config: withFranchise }), platform: 'nuvio', origin: 'https://lelibrary.test' }, { fetchFranchise: async () => null });
  assert.equal(pending.franchisePending, true);
  assert.deepEqual(pending.collections.map((c) => c.id), ['collection-lelibrary-mine']);
});

test('Stremio preview: board rows in manifest order, no collections', async () => {
  const { buildSetupPreview } = require('../src/setup/preview.ts');
  const { buildConfiguredManifest } = require('../src/routes/manifest.ts');
  const { setupEngineConfig } = require('../src/config/resolve-config.ts');
  const { toEngineConfig } = require('../src/setup/config-store.ts');
  const origin = 'https://lelibrary.test';
  const stremio = await buildSetupPreview({ opened: opened(), platform: 'stremio', origin });
  const nuvio = await buildSetupPreview({ opened: opened(), platform: 'nuvio', origin }, { fetchFranchise: async () => null });
  assert.equal(stremio.collections.length, 0);
  assert.ok(stremio.home.every((e) => e.kind === 'row'));
  const manifest = await buildConfiguredManifest(setupEngineConfig(toEngineConfig(opened()), opened(), TOKEN), TOKEN, 'stremio', origin);
  const board = manifest.catalogs
    .filter((c) => !(c.extra || []).some((e) => e.isRequired) && !(c.extraRequired || []).length)
    .map((c) => `${c.type}:${c.id}`);
  assert.deepEqual(stremio.home.map((e) => `${e.type}:${e.catalogId}`), board);
  assert.ok(nuvio.collections.length > 0, 'Nuvio has the collection');
  assert.notDeepEqual(stremio.home.map((e) => e.catalogId), nuvio.home.filter((e) => e.kind === 'row').map((e) => e.catalogId), 'Stremio ignores the Nuvio Home order');
});

test('scrubPreview drops any string carrying a secret', () => {
  const { scrubPreview, secretsOf } = require('../src/setup/preview.ts');
  const secrets = secretsOf(opened());
  assert.ok(secrets.includes(SECRET) && secrets.includes(KEYS.push.nuvio.nuvioToken));
  const out = scrubPreview({ a: `x${KEYS.tmdbApiKey}y`, b: ['ok', `/${TOKEN}/`], c: { d: 'fine' } }, secrets);
  assert.deepEqual(out, { a: '', b: ['ok', ''], c: { d: 'fine' } });
});
