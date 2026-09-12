const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = require('../app');
const { getConfiguredManifest } = app;
const { getClientIntegration, listClientIntegrations, clientInstallUrls } = require('../src/client-integrations');
const { encodeConfig } = require('../website/public/token-map');
const { integrationManifest } = require('../website/public/client-integrations');
const { buildDiscoveryStreams } = require('../src/discovery');

const BASE = 'https://dev.example.invalid';
const CONFIG = {
  provider: 'torbox', torboxApiKey: 'synthetic-key', tmdbApiKey: 'synthetic-tmdb',
  catalogTrendingMovies: true, catalogTrendingSeries: true,
};

function invokeRoute(path, params) {
  const layer = app._router.stack.find(entry => entry.route?.path === path);
  assert.ok(layer, `missing route ${path}`);
  return new Promise((resolve, reject) => {
    const headers = {};
    const req = { params, query: {}, protocol: 'https', headers: {}, get: name => name === 'host' ? 'dev.example.invalid' : '' };
    const res = {
      statusCode: 200,
      setHeader(name, value) { headers[name] = value; },
      status(value) { this.statusCode = value; return this; },
      json(body) { resolve({ status: this.statusCode, body, headers }); return this; },
      send(body) { resolve({ status: this.statusCode, body, headers }); return this; },
    };
    layer.route.stack[0].handle(req, res, reject);
    setTimeout(() => reject(new Error(`route ${path} did not respond`)), 3000).unref();
  });
}

test('client registry exposes explicit supported and testing adapters', () => {
  const rows = listClientIntegrations();
  assert.deepEqual(rows.map(row => row.id), ['generic', 'stremio', 'nuvio', 'strmr', 'fusion', 'vidi', 'wuplay']);
  assert.equal(getClientIntegration('strmr').status, 'testing');
  assert.equal(getClientIntegration('missing', { fallback: false }), null);
  assert.equal(getClientIntegration('missing').id, 'generic');
});

test('shared client integration UI ships local logos and testing action rows', () => {
  const publicDir = path.join(__dirname, '..', 'website', 'public');
  const source = fs.readFileSync(path.join(publicDir, 'client-integrations.js'), 'utf8');
  const configure = fs.readFileSync(path.join(__dirname, '..', 'website', 'configure.html'), 'utf8');
  assert.match(source, /class="client-integration-row"/);
  assert.match(source, /client-status \$\{status\}/);
  assert.match(source, /data-client-message aria-live="polite"/);
  assert.doesNotMatch(configure, /nuvio\.svg/);
  assert.ok(fs.existsSync(path.join(publicDir, 'nuvio.png')));

  for (const [file, signature] of [
    ['strmr.png', '89504e470d0a1a0a'],
    ['vidi.png', '89504e470d0a1a0a'],
    ['wuplay.png', '89504e470d0a1a0a'],
    ['fusion.jpg', 'ffd8ff'],
  ]) {
    const logo = fs.readFileSync(path.join(publicDir, 'client-logos', file));
    assert.equal(logo.subarray(0, signature.length / 2).toString('hex'), signature, `${file} is not the expected image type`);
  }
});

test('client install URLs use a stable path with sibling protocol resources', () => {
  const urls = clientInstallUrls({ origin: `${BASE}/`, token: 'synthetic-token', client: 'strmr' });
  assert.equal(urls.base, `${BASE}/synthetic-token/i/strmr`);
  assert.equal(urls.manifest, `${urls.base}/manifest.json`);
  assert.equal(urls.manifest.includes('?'), false);
  assert.equal(integrationManifest(`${BASE}/synthetic-token/manifest.json?integration=stremio`, 'strmr'), `${BASE}/synthetic-token/i/strmr/manifest.json`);
});

test('STRMR manifest is Stremio-like, movie/series-only, and preserves ID namespaces', () => {
  const raw = getConfiguredManifest(BASE, CONFIG, { token: 'synthetic-token', integration: 'stremio' });
  const projected = getClientIntegration('strmr').manifest({ manifest: raw, context: {} });
  assert.deepEqual(projected.types, ['movie', 'series']);
  assert.deepEqual(projected.idPrefixes, ['torbox:', 'tt']);
  assert.ok(projected.catalogs.some(row => row.id === 'torbox-movies'));
  assert.ok(projected.catalogs.some(row => row.id === 'torbox-trending-movies'));
  assert.equal(projected.catalogs.some(row => row.type === 'anime'), false);
  const stream = projected.resources.find(resource => resource && resource.name === 'stream');
  assert.deepEqual(stream.types, ['movie', 'series']);
  assert.deepEqual(stream.idPrefixes, ['torbox:', 'tt']);
});

test('existing Stremio and Nuvio adapters remain exact pass-through projections', () => {
  const stremioManifest = getConfiguredManifest(BASE, CONFIG, { token: 'synthetic-token', integration: 'stremio' });
  const nuvioManifest = getConfiguredManifest(BASE, CONFIG, { token: 'synthetic-token', integration: 'nuvio' });
  assert.strictEqual(getClientIntegration('stremio').manifest({ manifest: stremioManifest, context: {} }), stremioManifest);
  assert.strictEqual(getClientIntegration('nuvio').manifest({ manifest: nuvioManifest, context: {} }), nuvioManifest);
  assert.deepEqual(getClientIntegration('stremio').capabilities.types, ['movie', 'series', 'anime']);
  assert.equal(getClientIntegration('nuvio').capabilities.nativeFolderPush, true);
});

test('STRMR policy leaves margin below measured client deadlines', () => {
  const policy = getClientIntegration('strmr').requestPolicy;
  assert.ok(policy.catalogMs < 15_000);
  assert.ok(policy.metaMs < 15_000);
  assert.ok(policy.streamMs < 20_000);
  assert.ok(policy.externalMs < policy.streamMs);
});

test('the app registers every sibling client facade route', () => {
  const paths = app._router.stack.map(layer => layer.route?.path).filter(Boolean);
  for (const path of [
    '/:token/i/:client/manifest.json',
    '/:token/i/:client/catalog/:type/:catalogId.json',
    '/:token/i/:client/catalog/:type/:catalogId/:extra.json',
    '/:token/i/:client/meta/:type/:id.json',
    '/:token/i/:client/stream/:type/:id.json',
  ]) assert.ok(paths.includes(path), `missing ${path}`);
});

test('STRMR facade delegates an IMDb stream request to the shared Custom Streams lane', async () => {
  const token = encodeConfig({ provider: 'none', customStreams: [{ name: 'Synthetic', url: 'https://media.invalid/movie.mp4', type: 'movie', ids: ['tt1234567'] }] });
  const response = await invokeRoute('/:token/i/:client/stream/:type/:id.json', {
    token, client: 'strmr', type: 'movie', id: 'tt1234567',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.streams.length, 1);
  assert.equal(response.body.streams[0].url, 'https://media.invalid/movie.mp4');
  assert.match(response.headers['X-LeLibrary-Request-Id'], /^[a-f0-9]{12}$/);
  assert.match(response.headers['Server-Timing'], /config;dur=\d+\.\d, identity;dur=\d+\.\d, stream-bridge;dur=\d+\.\d, handler;dur=\d+\.\d/);
  assert.equal(response.headers['Server-Timing'].includes('synthetic-token'), false);
});

test('STRMR facade serves its projected manifest from the stable client base', async () => {
  const token = encodeConfig({ provider: 'none', customStreams: [{ name: 'Synthetic', url: 'https://media.invalid/movie.mp4', type: 'movie', ids: ['tt1234567'] }] });
  const response = await invokeRoute('/:token/i/:client/manifest.json', { token, client: 'strmr' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.types, ['movie', 'series']);
  assert.deepEqual(response.body.idPrefixes, ['torbox:', 'tt']);
  assert.deepEqual(response.body.catalogs, []);
  assert.equal(response.body.configureUrl.includes('/i/strmr/'), false);
  assert.match(response.headers['Server-Timing'], /config;dur=.*collection-cache;dur=.*account-context;dur=.*projection;dur=.*handler;dur=/);
});

test('STRMR-style tt playback hands an owned movie to the existing torbox bridge first', async () => {
  let call;
  const runtime = {
    imdbToTmdbCached: async (key, imdbId) => ({ tmdbId: 278, imdbId }),
    cache: { makeKey: (...parts) => parts.join(':'), get: async () => null, set: async () => true },
    buildStreams: async (...args) => {
      call = args;
      return [{ name: 'Owned TorBox copy', url: 'https://owned.invalid/movie.mkv' }];
    },
    applyStreamNotices: async streams => streams,
  };
  const result = await buildDiscoveryStreams({
    config: { provider: 'torbox', torboxApiKey: 'synthetic-key' }, tmdbApiKey: 'synthetic-tmdb',
    type: 'movie', id: 'tt0111161', lang: 'en-US', customStreams: [], userKey: 'synthetic-user', externalAddons: [], runtime,
  });
  assert.equal(result.ownedCount, 1);
  assert.equal(result.streams[0].name, 'Owned TorBox copy');
  assert.equal(call[2], 'movie');
  assert.equal(call[3], 278);
  assert.equal(call[9].imdbId, 'tt0111161');
});

test('STRMR-style episode IDs preserve exact season and episode in the owned bridge', async () => {
  let call;
  await buildDiscoveryStreams({
    config: { provider: 'torbox', torboxApiKey: 'synthetic-key' }, tmdbApiKey: 'synthetic-tmdb',
    type: 'series', id: 'tt0096697:12:3', lang: 'en-US', customStreams: [], userKey: 'synthetic-user', externalAddons: [],
    runtime: {
      imdbToTmdbCached: async () => ({ tmdbId: 456 }),
      cache: { makeKey: (...parts) => parts.join(':'), get: async () => null, set: async () => true },
      buildStreams: async (...args) => { call = args; return []; },
      applyStreamNotices: async streams => streams,
    },
  });
  assert.equal(call[2], 'series');
  assert.equal(call[4], '12');
  assert.equal(call[5], '3');
  assert.equal(call[9].imdbId, 'tt0096697');
});

test('a missing owned match still returns external results within the STRMR sub-budget', async () => {
  let externalBudget;
  const result = await buildDiscoveryStreams({
    config: { provider: 'none' }, tmdbApiKey: 'synthetic-tmdb', type: 'movie', id: 'tt7654321',
    lang: 'en-US', customStreams: [], userKey: '', externalAddons: ['synthetic'], requestPolicy: { externalMs: 9000 },
    runtime: {
      imdbToTmdbCached: async () => null,
      fetchExternalStreams: async (ids, config, type, id, budget) => { externalBudget = budget; return [{ name: 'External fallback', url: 'https://external.invalid/movie.mp4' }]; },
      applyStreamNotices: async streams => streams,
    },
  });
  assert.equal(externalBudget, 9000);
  assert.equal(result.ownedCount, 0);
  assert.equal(result.streams.length, 1);
});

test('STRMR search and skip facade paths fail closed without required metadata config', async () => {
  const token = encodeConfig({ provider: 'none', customStreams: [{ name: 'Synthetic', url: 'https://media.invalid/movie.mp4', type: 'movie', ids: ['tt1234567'] }] });
  for (const extra of ['search=matrix', 'skip=20']) {
    const response = await invokeRoute('/:token/i/:client/catalog/:type/:catalogId/:extra.json', {
      token, client: 'strmr', type: 'movie', catalogId: 'lelibrary-search-movies', extra,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.metas, []);
  }
});
