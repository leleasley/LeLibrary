// @ts-nocheck
'use strict';
// Live draft preview (POST /api/setup/preview-draft and /catalog): the same
// builder as the saved Preview, open to anyone, so it must never accept or
// return a key, only build LeLibrary's own catalogue definitions with the
// server's key, answer library rows with a sample, and stay rate limited.
// Synthetic config and keys only; no network (the TMDB builders are stubbed
// or never reached without a server key).
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const SECRET = 'synthetic-install-secret-x9';
const KEYS = { torboxApiKey: 'synthetic-torbox-key-1234', tmdbApiKey: 'synthetic-tmdb-key-5678' };

const homeRow = (catalogId, type, order, title) => ({
  id: `row-${catalogId}`, title: title || catalogId, customTitle: Boolean(title),
  source: { kind: 'catalog', id: catalogId, catalogId, type, addonId: '' }, enabled: true, order,
});

const CONFIG = {
  provider: 'torbox',
  wizardPlatform: 'nuvio',
  collectionHomeRows: [
    homeRow('torbox-movies', 'movie', 1),
    homeRow('torbox-series', 'series', 0, 'My Shows Renamed'),
    homeRow('torbox-trending-movies', 'movie', 2),
  ],
  collections: [{
    id: 'collection-lelibrary-mine',
    title: 'Mine',
    backdropUrl: 'https://image.tmdb.org/t/p/original/backdrop.jpg',
    folders: [
      { id: 'folder-a', title: 'Folder A', coverImageUrl: '/art/folder/folder-a.jpg', catalogSources: [{ addonId: '', catalogId: 'torbox-movies', type: 'movie' }] },
      { id: 'folder-b', title: 'Folder B', coverImageUrl: '/art/folder/folder-b.jpg', catalogSources: [{ addonId: '', catalogId: 'torbox-series', type: 'series' }] },
    ],
  }],
};

const ORIGIN = 'https://lelibrary.test';

function opened(config = CONFIG, tier = 'full') {
  const { normaliseSetupConfigCollections } = require('../src/setup/collections.ts');
  return {
    uuid: UUID, tier, name: null, hasPassword: true,
    config: normaliseSetupConfigCollections(config), keys: KEYS, secret: SECRET, createdAt: null, updatedAt: null,
  };
}

async function startApp() {
  const { mountSetupRoutes } = require('../src/routes/setup.ts');
  const app = express();
  app.set('trust proxy', false);
  mountSetupRoutes(app, { getStore: async () => null, previewDeps: { fetchFranchise: async () => null } });
  app.use(require('../src/middleware/error-handler.ts').errorHandler);
  const server = app.listen(0);
  await once(server, 'listening');
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

const post = (app, path, body, raw) => fetch(`${app.base}/api/setup${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify(body),
});

test('draft layout == the saved builder for the same config and filled keys', async () => {
  const { buildSetupPreview, buildDraftPreview } = require('../src/setup/preview.ts');
  for (const tier of ['quick', 'partial', 'full']) {
    for (const platform of ['nuvio', 'stremio']) {
      const saved = await buildSetupPreview({ opened: opened(CONFIG, tier), platform, origin: ORIGIN }, { fetchFranchise: async () => null });
      const draft = await buildDraftPreview({ tier, platform, config: CONFIG, keyServices: Object.keys(KEYS), origin: ORIGIN });
      assert.deepEqual(draft, saved, `${tier}/${platform}: same payload`);
    }
  }
});

test('draft keys: names only, placeholders never leave, unknown names ignored', async () => {
  const { buildDraftPreview, draftKeyServices } = require('../src/setup/preview.ts');
  assert.deepEqual(draftKeyServices(['torboxApiKey', 'torboxApiKey', 'push', 'webdavPassword', 42, 'tmdbApiKey']), ['torboxApiKey', 'tmdbApiKey']);
  assert.deepEqual(draftKeyServices('torboxApiKey'), []);
  const none = await buildDraftPreview({ tier: 'quick', platform: 'stremio', config: {}, keyServices: [], origin: ORIGIN });
  assert.ok(!none.home.some((row) => row.catalogId === 'torbox-movies'), 'no provider key named: no library row');
  const withKey = await buildDraftPreview({ tier: 'quick', platform: 'stremio', config: {}, keyServices: ['torboxApiKey', 'tmdbApiKey'], origin: ORIGIN });
  assert.ok(withKey.home.some((row) => row.catalogId === 'torbox-movies'), 'a named provider key declares its rows');
  assert.ok(!JSON.stringify(withKey).includes('placeholder'));
});

test('draftConfig drops every key, token, login and credential link, at any depth', () => {
  const { draftConfig } = require('../src/setup/preview.ts');
  const out = draftConfig({
    lang: 'en-US',
    torboxApiKey: 'synthetic-torbox-key-1234',
    keys: { tmdbApiKey: 'x' },
    push: { nuvio: { nuvioToken: 'synthetic-session' } },
    __configScope: { type: 'config', uuid: UUID },
    webdavPassword: 'synthetic-dav-pass',
    customPosterTemplate: 'https://poster.test/p/abc',
    customStreams: [{ url: 'https://cdn.test/file.mkv' }],
    myNewApiKey: 'synthetic-new',
    sessionThing: 'synthetic-session-2',
    collections: [{
      id: 'c', folders: [{ id: 'f', coverImageUrl: 'https://u:p@art.test/x.jpg', heroBackdropUrl: 'https://art.test/x.jpg?apikey=synthetic-art',
        catalogSources: [{ addonId: 'other.addon', addonUrl: 'https://other.test/synthetic-addon-token/manifest.json', catalogId: 'top', type: 'movie' }] }],
    }],
  });
  const raw = JSON.stringify(out);
  for (const leaked of ['synthetic', 'u:p@', 'poster.test', 'cdn.test', 'other.test', 'configScope']) assert.ok(!raw.includes(leaked), `leaked ${leaked}`);
  assert.equal(out.lang, 'en-US');
  assert.deepEqual(out.collections[0].folders[0].catalogSources, [{ addonId: 'other.addon', catalogId: 'top', type: 'movie' }]);
});

test('POST /preview-draft: validates input, never echoes a key sent anyway', async () => {
  const app = await startApp();
  try {
    assert.equal((await post(app, '/preview-draft', { tier: 'nope', platform: 'nuvio', config: {} })).status, 400);
    assert.equal((await post(app, '/preview-draft', { tier: 'full', platform: 'tv', config: {} })).status, 400);
    assert.equal((await post(app, '/preview-draft', { tier: 'full', platform: 'nuvio' })).status, 400);
    assert.equal((await post(app, '/preview-draft', { tier: 'full', platform: 'nuvio', config: [] })).status, 400);
    const sneaky = {
      ...CONFIG, torboxApiKey: 'synthetic-torbox-key-1234', tmdbApiKey: 'synthetic-tmdb-key-5678',
      catNameMovies: 'Films', push: { nuvio: { nuvioToken: 'synthetic-nuvio-session' } },
    };
    const res = await post(app, '/preview-draft', { tier: 'full', platform: 'nuvio', config: sneaky, keys: KEYS, keyServices: ['torboxApiKey'] });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const raw = await res.text();
    for (const secret of ['synthetic-torbox-key-1234', 'synthetic-tmdb-key-5678', 'synthetic-nuvio-session', 'placeholder']) {
      assert.ok(!raw.includes(secret), `leaked ${secret.slice(0, 12)}`);
    }
    assert.ok(!/manifest\.json/i.test(raw));
    const body = JSON.parse(raw);
    assert.deepEqual(Object.keys(body).sort(), ['addonName', 'collections', 'franchisePending', 'hero', 'home', 'platform']);
  } finally { await app.close(); }
});

test('POST /preview-draft: body limit', async () => {
  const app = await startApp();
  try {
    const big = JSON.stringify({ tier: 'full', platform: 'nuvio', config: { filler: 'x'.repeat(300 * 1024) } });
    assert.equal((await post(app, '/preview-draft', null, big)).status, 413);
  } finally { await app.close(); }
});

test('draft catalogue kinds: library rows, own definitions, discovery, anything else unknown', () => {
  const { classifyDraftCatalog } = require('../src/setup/preview.ts');
  const { catalogs } = require('../src/catalog/catalogdefs.ts');
  for (const id of ['torbox-movies', 'rd-series', 'ad-anime', 'pm-movies-4k', 'torbox-series-hdr', 'torbox-movies-g-horror', 'torbox-series-genres', 'torbox-collections', 'collection-645']) {
    assert.equal(classifyDraftCatalog('movie', id).kind, 'library', id);
  }
  // Personal lists (v6) and the old watchlist ids: the setup's own lists.
  assert.deepEqual(classifyDraftCatalog('movie', 'torbox-watchlist-trakt-movie'), { kind: 'personal', service: 'trakt' });
  assert.deepEqual(classifyDraftCatalog('series', 'lelibrary-user-simkl-upnext-series'), { kind: 'personal', service: 'simkl' });
  assert.deepEqual(classifyDraftCatalog('movie', 'lelibrary-user-mdblist-list.123-movie'), { kind: 'personal', service: 'mdblist' });
  assert.deepEqual(classifyDraftCatalog('movie', 'torbox-trending-movies'), { kind: 'discovery', list: 'trending', apiType: 'movie' });
  assert.deepEqual(classifyDraftCatalog('series', 'torbox-popular-series'), { kind: 'discovery', list: 'popular', apiType: 'tv' });
  const [movieId] = Object.entries(catalogs).find(([, def]) => def.type === 'movie' && String(def.handler).startsWith('tmdb_'));
  assert.deepEqual(classifyDraftCatalog('movie', `lib-${movieId}`), { kind: 'lib', libId: movieId });
  assert.equal(classifyDraftCatalog('series', `lib-${movieId}`).kind, 'unknown', 'type must match the definition');
  assert.equal(classifyDraftCatalog('movie', 'lelibrary-curated-movie').kind, 'curated');
  for (const id of ['lib-not_a_real_definition', 'top', 'https://evil.test/manifest.json', 'tmdb.popular']) {
    assert.equal(classifyDraftCatalog('movie', id).kind, 'unknown', id);
  }
});

test('draft catalogue: the server key, plain posters, no user key, display fields, capped', async () => {
  const { buildDraftCatalog, DRAFT_ROW_CAP } = require('../src/setup/preview.ts');
  const { catalogs } = require('../src/catalog/catalogdefs.ts');
  const [movieId] = Object.entries(catalogs).find(([, def]) => def.type === 'movie' && String(def.handler).startsWith('tmdb_') && !def.aliasOf);
  const calls = [];
  const rows = Array.from({ length: 90 }, (_, n) => ({
    id: `tt${n}`, type: 'movie', name: `Film ${n}`, poster: `https://image.tmdb.org/t/p/w500/${n}.jpg`, releaseInfo: '2020',
    secretish: 'drop-me', behaviorHints: { x: 1 },
  }));
  const deps = {
    serverKey: () => 'synthetic-server-key',
    library: async (input) => { calls.push(['library', input]); return rows; },
    discovery: async (input) => { calls.push(['discovery', input]); return rows.slice(0, 3); },
  };
  const out = await buildDraftCatalog({ config: { lang: 'de-DE', hideAnime: true, tmdbApiKey: 'synthetic-user-key' }, type: 'movie', catalogId: `lib-${movieId}` }, deps);
  assert.equal(out.status, 200);
  assert.equal(out.body.metas.length, DRAFT_ROW_CAP);
  assert.deepEqual(Object.keys(out.body.metas[0]).sort(), ['id', 'name', 'poster', 'releaseInfo', 'type']);
  const [, input] = calls[0];
  assert.equal(input.tmdbApiKey, 'synthetic-server-key', 'the server key, never the user one');
  assert.equal(input.userKey, '');
  assert.equal(input.mdblistKey, '');
  assert.deepEqual(input.enhance, {});
  assert.equal(input.posterFp, '');
  assert.equal(input.lang, 'de-DE');
  assert.equal(input.hideAnime, true);
  const disc = await buildDraftCatalog({ config: { lang: 'not a lang' }, type: 'series', catalogId: 'torbox-trending-series' }, deps);
  assert.equal(disc.body.metas.length, 3);
  assert.equal(calls[1][1].apiType, 'tv');
  assert.equal(calls[1][1].lang, 'en-US', 'odd languages fall back (one cache entry per real language)');
  assert.ok(!JSON.stringify(calls).includes('synthetic-user-key'));

  const library = await buildDraftCatalog({ type: 'movie', catalogId: 'torbox-movies' }, deps);
  assert.deepEqual(library, { status: 200, body: { sample: true, reason: 'library' } });
  const noKey = await buildDraftCatalog({ type: 'movie', catalogId: `lib-${movieId}` }, { ...deps, serverKey: () => '' });
  assert.deepEqual(noKey.body, { sample: true, reason: 'unavailable' });
  assert.equal(calls.length, 2, 'library rows and keyless servers fetch nothing');
  for (const bad of [{ type: 'tv', catalogId: 'torbox-movies' }, { type: 'movie', catalogId: '' }, { type: 'movie', catalogId: 'x'.repeat(201) },
    { type: 'movie', catalogId: 'a/b' }, { type: 'movie', catalogId: 'lib-unknown_thing' }, { type: 'movie', catalogId: 'torbox-movies', genre: {} }]) {
    assert.equal((await buildDraftCatalog(bad, deps)).status, 400, JSON.stringify(bad).slice(0, 60));
  }
});

test('POST /preview-draft/catalog: library sample, unknown 400, no fetch without the server key', async () => {
  const saved = { art: process.env.ART_TMDB_API_KEY, rel: process.env.RELEASES_TMDB_API_KEY };
  delete process.env.ART_TMDB_API_KEY;
  delete process.env.RELEASES_TMDB_API_KEY;
  const app = await startApp();
  try {
    const sample = await post(app, '/preview-draft/catalog', { type: 'movie', catalogId: 'torbox-movies', config: {} });
    assert.equal(sample.status, 200);
    assert.deepEqual(await sample.json(), { sample: true, reason: 'library' });
    assert.equal((await post(app, '/preview-draft/catalog', { type: 'movie', catalogId: 'https://evil.test/catalog' })).status, 400);
    assert.equal((await post(app, '/preview-draft/catalog', { type: 'movie', catalogId: 'someone-elses-row' })).status, 400);
    const disc = await post(app, '/preview-draft/catalog', { type: 'movie', catalogId: 'torbox-popular-movies' });
    assert.deepEqual(await disc.json(), { sample: true, reason: 'unavailable' });
  } finally {
    await app.close();
    if (saved.art !== undefined) process.env.ART_TMDB_API_KEY = saved.art;
    if (saved.rel !== undefined) process.env.RELEASES_TMDB_API_KEY = saved.rel;
  }
});

// Last: it spends this process's per-IP buckets.
test('draft routes are rate limited per IP', async () => {
  const { DRAFT_LIMITS } = require('../src/routes/setup.ts');
  assert.deepEqual(DRAFT_LIMITS, { previewPerMinute: 30, catalogPerMinute: 120, body: '256kb' });
  const app = await startApp();
  try {
    let limited = 0;
    for (let n = 0; n < DRAFT_LIMITS.previewPerMinute + 2; n += 1) {
      const res = await post(app, '/preview-draft', { tier: 'bad' });
      if (res.status === 429) limited += 1;
    }
    assert.ok(limited >= 1, 'the layout endpoint answers 429 past its limit');
    limited = 0;
    for (let n = 0; n < DRAFT_LIMITS.catalogPerMinute + 2; n += 1) {
      const res = await post(app, '/preview-draft/catalog', { type: 'movie', catalogId: 'torbox-movies' });
      if (res.status === 429) limited += 1;
    }
    assert.ok(limited >= 1, 'the catalogue endpoint answers 429 past its limit');
  } finally { await app.close(); }
});
