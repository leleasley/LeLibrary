// @ts-nocheck
// Audit B15: the settings routes (/api/save-config, /api/config/:token, the
// catalogue picker metadata) used to be registered twice, once in the
// website router and once in settings.ts, and the copies drifted. These tests
// pin the single merged implementation and that nothing registers a second
// copy again. All keys and tokens are synthetic; the config store is a fake.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { mountSettingsRoutes, clientConfig, SETTINGS_ROUTES } = require('../src/routes/settings.ts');

const FAKE_TORBOX = 'synthetic-torbox-key-0000';

function fakeStore() {
  const calls = { save: [], load: [] };
  return {
    calls,
    async saveStreamSettings(config) {
      calls.save.push(config);
      return config.torboxApiKey ? 'userkey123' : null;
    },
    async loadStreamSettings(config) {
      calls.load.push(config);
      return { streamPreset: 'stored' };
    },
  };
}

function scoped(config, scope) {
  Object.defineProperty(config, '__configScope', { value: scope, enumerable: false, configurable: true });
  return config;
}

async function withServer(deps, fn) {
  const app = express();
  mountSettingsRoutes(app, deps);
  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function post(base, body) {
  const res = await fetch(`${base}/api/save-config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(url) {
  const res = await fetch(url);
  return { status: res.status, headers: res.headers, body: await res.json() };
}

// Walk the Express 5 router tree and count [method, path] registrations.
function routeTable(app) {
  const out = [];
  const walk = (stack) => {
    for (const layer of stack || []) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
          for (const p of paths) out.push(`${method} ${p}`);
        }
      } else {
        // app.ts wraps every handler (applyAsyncWrap): look through it.
        const handle = layer.handle && layer.handle._asyncInner ? layer.handle._asyncInner : layer.handle;
        if (handle && Array.isArray(handle.stack)) walk(handle.stack);
      }
    }
  };
  walk(app.router ? app.router.stack : app._router.stack);
  return out;
}

test('each settings route is registered exactly once in the composed app', () => {
  const app = require('../app.ts');
  const table = routeTable(app);
  // Website router routes are nested one level down: the walker must see them.
  assert.ok(table.includes('get /sitemap.xml'));
  for (const [method, path] of SETTINGS_ROUTES) {
    const count = table.filter((entry) => entry === `${method} ${path}`).length;
    assert.equal(count, 1, `${method.toUpperCase()} ${path} registered ${count} times`);
  }
});

test('the website router no longer carries its own copy of any settings route', () => {
  const createWebRoutes = require('../src/routes/website.ts');
  const app = express();
  app.use(createWebRoutes(async () => null));
  const table = routeTable(app);
  // The walker really sees the router's own routes.
  assert.ok(table.includes('get /sitemap.xml'));
  for (const [method, path] of SETTINGS_ROUTES) {
    assert.equal(table.includes(`${method} ${path}`), false, `${path} is back in website.ts`);
  }
});

test('clientConfig drops every __ internal a browser could send', () => {
  const out = clientConfig({ torboxApiKey: FAKE_TORBOX, __configScope: { type: 'config', uuid: 'x' }, __pictoriumToken: 't' });
  assert.deepEqual(out, { torboxApiKey: FAKE_TORBOX });
  assert.equal(clientConfig(null), null);
  assert.equal(clientConfig([1]), null);
  assert.equal(clientConfig('x'), null);
});

test('GET /api/config/:token rejects an unknown token with 400', async () => {
  const store = fakeStore();
  await withServer({ resolveConfig: async () => null, configStore: store }, async (base) => {
    const res = await get(`${base}/api/config/not-a-token`);
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'Invalid token' });
    assert.equal(store.calls.load.length, 0);
  });
});

test('GET /api/config/:token never reads the store for a keyless config without its own scope', async () => {
  const store = fakeStore();
  const resolveConfig = async () => scoped({ lang: 'en-US' }, { type: 'legacy' });
  await withServer({ resolveConfig, configStore: store }, async (base) => {
    const res = await get(`${base}/api/config/legacy-token`);
    assert.equal(res.status, 200);
    assert.equal(res.body, null);
    assert.equal(store.calls.load.length, 0);
  });
});

test('GET /api/config/:token reads a keyless v5.5 setup by its config scope', async () => {
  const store = fakeStore();
  const resolveConfig = async () => scoped({}, { type: 'config', uuid: '00000000-0000-4000-8000-000000000000' });
  await withServer({ resolveConfig, configStore: store }, async (base) => {
    const res = await get(`${base}/api/config/some-setup`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { streamPreset: 'stored' });
    assert.equal(store.calls.load.length, 1);
  });
});

test('GET /api/config/:token returns stored settings for a keyed config', async () => {
  const store = fakeStore();
  await withServer({ resolveConfig: async () => ({ torboxApiKey: FAKE_TORBOX }), configStore: store }, async (base) => {
    const res = await get(`${base}/api/config/keyed`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { streamPreset: 'stored' });
  });
});

test('GET /api/config/:token answers a resolver failure with a JSON 500', async () => {
  const resolveConfig = async () => { throw new Error('db down'); };
  await withServer({ resolveConfig, configStore: fakeStore() }, async (base) => {
    const res = await get(`${base}/api/config/x`);
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: 'db down' });
  });
});

test('POST /api/save-config requires a config object', async () => {
  const store = fakeStore();
  await withServer({ resolveConfig: async () => null, configStore: store }, async (base) => {
    const res = await post(base, {});
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'Missing config' });
    assert.equal(store.calls.save.length, 0);
  });
});

test('POST /api/save-config cannot spoof another setup scope', async () => {
  const store = fakeStore();
  const warmed = [];
  const deps = { resolveConfig: async () => null, configStore: store, warmLibraryCatalogs: async (c) => { warmed.push(c); return null; } };
  await withServer(deps, async (base) => {
    const res = await post(base, {
      config: { torboxApiKey: FAKE_TORBOX, streamPreset: 'x', __configScope: { type: 'config', uuid: '00000000-0000-4000-8000-000000000000' } },
    });
    assert.equal(res.status, 200);
    assert.equal(store.calls.save.length, 1);
    const saved = store.calls.save[0];
    assert.equal(saved.__configScope, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(saved, '__configScope'), false);
    assert.equal(warmed[0].__configScope, undefined);
  });
});

test('POST /api/save-config refuses an unknown install token', async () => {
  const store = fakeStore();
  await withServer({ resolveConfig: async () => null, configStore: store }, async (base) => {
    const res = await post(base, { token: 'deadbeef.notasecret', config: { torboxApiKey: FAKE_TORBOX } });
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: 'Unknown or expired install token' });
    assert.equal(store.calls.save.length, 0);
  });
});

test('POST /api/save-config never writes through a v5.5 install token (read capability only)', async () => {
  const store = fakeStore();
  const resolveConfig = async () => scoped({ torboxApiKey: FAKE_TORBOX }, { type: 'config', uuid: '00000000-0000-4000-8000-000000000000' });
  await withServer({ resolveConfig, configStore: store }, async (base) => {
    const res = await post(base, { token: '00000000-0000-4000-8000-000000000000.synthetic', config: { streamPreset: 'x' } });
    assert.equal(res.status, 403);
    assert.equal(typeof res.body.error, 'string');
    assert.equal(store.calls.save.length, 0);
  });
});

test('POST /api/save-config success shape, with and without waiting for the warm', async () => {
  const store = fakeStore();
  const warmResult = { requested: 1, warmed: 1, failed: 0 };
  const deps = { resolveConfig: async () => null, configStore: store, warmLibraryCatalogs: async () => warmResult };
  await withServer(deps, async (base) => {
    const plain = await post(base, { config: { torboxApiKey: FAKE_TORBOX } });
    assert.equal(plain.status, 200);
    assert.deepEqual(plain.body, { ok: true, userKey: 'userkey123' });
    const waited = await post(base, { config: { torboxApiKey: FAKE_TORBOX }, warmCollections: true });
    assert.deepEqual(waited.body, { ok: true, userKey: 'userkey123', collectionCache: warmResult });
  });
});

test('POST /api/save-config: keyless saves are refused unless self-contained', async () => {
  const store = fakeStore();
  await withServer({ resolveConfig: async () => null, configStore: store, warmLibraryCatalogs: async () => null }, async (base) => {
    const keyless = await post(base, { config: { streamPreset: 'x' } });
    assert.equal(keyless.status, 400);
    assert.deepEqual(keyless.body, { error: 'Config has no usable API keys' });
  });
});

test('picker metadata routes keep their response shapes', async () => {
  await withServer({ resolveConfig: async () => null, configStore: fakeStore() }, async (base) => {
    const library = await get(`${base}/api/catalog-library`);
    assert.equal(library.status, 200);
    assert.ok(Array.isArray(library.body.catalogs) && library.body.catalogs.length > 0);
    assert.equal(typeof library.body.total, 'number');
    assert.match(library.headers.get('cache-control'), /max-age=3600/);

    const picks = await get(`${base}/api/catalog-quick-picks`);
    assert.equal(picks.status, 200);
    assert.ok(Array.isArray(picks.body.quickPicks));

    const curated = await get(`${base}/api/curated-collections`);
    assert.equal(curated.status, 200);
    assert.ok(Array.isArray(curated.body.collections));
    assert.equal(curated.headers.get('cache-control'), 'no-cache');
    const noAnime = await get(`${base}/api/curated-collections?hideAnime=true`);
    assert.equal(noAnime.status, 200);
    assert.ok(noAnime.body.collections.length <= curated.body.collections.length);
  });
});
