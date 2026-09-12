const test = require('node:test');
const assert = require('node:assert/strict');
const { __test: { createDataClient, createRequestDlLimiter, retryAfterMs, fetchDownloadSources } } = require('../src/torbox');
const { cachedRows } = require('../src/catalog-cache');
const { createFanartLookup } = require('../src/artwork-cache');
const { tmdbPosterPath } = require('../src/libcatalog');

function memoryCache() {
  const values = new Map();
  const ttls = new Map();
  return { values, ttls, makeKey: (...parts) => parts.join(':'),
    get: async key => values.has(key) ? structuredClone(values.get(key)) : null,
    set: async (key, value, ttl) => { values.set(key, structuredClone(value)); ttls.set(key, ttl); },
    del: async key => values.delete(key),
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('TorBox resolved 429 opens only this account and endpoint cooldown', async () => {
  let calls = 0;
  let held = 0;
  const client = createDataClient({ enter: async () => { held++; }, leave: () => { held--; },
    request: async () => { calls++; return { status: 429, headers: { 'retry-after': '60' }, data: { success: false } }; },
  });
  assert.equal((await client('GET', '/torrents/mylist', 'synthetic-account-a')).status, 429);
  assert.equal((await client('GET', '/torrents/mylist', 'synthetic-account-a')).status, 429);
  assert.equal(calls, 1);
  await client('GET', '/torrents/mylist', 'synthetic-account-b');
  await client('GET', '/usenet/mylist', 'synthetic-account-a');
  assert.equal(calls, 3);
  assert.equal(held, 0);
});

test('TorBox rejects HTTP failures and unsuccessful API envelopes without exposing provider text', async () => {
  for (const response of [
    { status: 401, data: { detail: 'private-value' } },
    { status: 503, data: {} },
    { status: 200, data: { success: false, detail: 'private-value' } },
  ]) {
    const client = createDataClient({ request: async () => response, enter: async () => {}, leave: () => {} });
    const result = await client('GET', '/torrents/mylist', 'synthetic-account-a');
    assert.ok(result.error);
    assert.equal(JSON.stringify(result).includes('private-value'), false);
  }
});

test('TorBox request exceptions release slots and parse both Retry-After formats', async () => {
  let releases = 0;
  const client = createDataClient({ request: async () => { throw new Error('timeout'); }, enter: async () => {}, leave: () => releases++ });
  assert.ok((await client('GET', '/torrents/mylist', 'synthetic-account-a')).error);
  assert.equal(releases, 1);
  assert.equal(retryAfterMs('12', 0), 12000);
  assert.equal(retryAfterMs('Thu, 01 Jan 1970 00:01:00 GMT', 0), 60000);
  assert.equal(retryAfterMs('invalid', 0), 300000);
});

test('TorBox source scans overlap, preserve failed sources, and accept successful empty lists', async () => {
  const store = memoryCache();
  const gate = deferred();
  let started = 0;
  const args = ['synthetic-account-a', {}, { store, paginate: async path => {
    started++;
    await gate.promise;
    return { data: { data: [{ id: path }] }, status: 200 };
  } }];
  const pending = fetchDownloadSources(...args);
  await tick();
  assert.equal(started, 3);
  gate.resolve();
  assert.equal((await pending).length, 3);
  const rows = await fetchDownloadSources(args[0], {}, { store, paginate: async path => path.includes('usenet')
    ? { error: 'temporary', status: 503 } : { data: { data: [] }, status: 200 } });
  assert.deepEqual(rows.map(row => row.source), ['usenet']);
  await assert.rejects(fetchDownloadSources('synthetic-new-account', {}, { store, paginate: async () => ({ error: 'temporary', status: 503 }) }));
  await assert.rejects(fetchDownloadSources(args[0], {}, { store, paginate: async () => ({ error: 'denied', status: 401 }) }), /authentication/);
});

test('stale catalogue returns before refresh and concurrent readers share a refresh', async () => {
  const store = memoryCache();
  await store.set('rows:stale', [{ id: 'old' }]);
  const gate = deferred();
  let calls = 0;
  const options = { store, key: 'rows', ttl: 100, load: async () => { calls++; await gate.promise; return [{ id: 'new' }]; } };
  const [a, b] = await Promise.all([cachedRows(options), cachedRows(options)]);
  assert.equal(a[0].id, 'old');
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  gate.resolve();
  await tick();
  assert.equal((await cachedRows(options))[0].id, 'new');
});

test('protected stale data waits for validation and revoked access invalidates stale rows', async () => {
  const store = memoryCache();
  await store.set('rows:stale', [{ id: 'private' }]);
  await assert.rejects(cachedRows({ store, key: 'rows', ttl: 100, allowStale: false,
    load: async () => { throw Object.assign(new Error('revoked'), { status: 403 }); } }), /revoked/);
  assert.equal(await store.get('rows:stale'), null);
});

test('temporary catalogue failures retain stale rows with a short retry delay', async () => {
  const store = memoryCache();
  await store.set('rows:stale', [{ id: 'old' }]);
  const rows = await cachedRows({ store, key: 'rows', ttl: 100, allowStale: false, load: async () => { throw new Error('timeout'); } });
  assert.equal(rows[0].id, 'old');
  assert.equal(store.ttls.get('rows'), 30);
});

test('TMDB poster paths survive helper calls and concurrent requests coalesce', async () => {
  const store = memoryCache();
  const gate = deferred();
  let calls = 0;
  const runtime = { cache: store, request: async () => { calls++; await gate.promise; return { data: { poster_path: '/synthetic.jpg' } }; } };
  const a = tmdbPosterPath('synthetic', 'movie', 1, runtime);
  const b = tmdbPosterPath('synthetic', 'movie', 1, runtime);
  await tick();
  assert.equal(calls, 1);
  gate.resolve();
  assert.deepEqual(await Promise.all([a, b]), ['/synthetic.jpg', '/synthetic.jpg']);
  assert.equal(await tmdbPosterPath('synthetic', 'movie', 1, { cache: store, request: () => { throw new Error('must use cache'); } }), '/synthetic.jpg');
  assert.equal(JSON.stringify([...store.values]).includes('api_key'), false);
});

test('missing posters have a short cache lifetime but failed lookups do not persist absence', async () => {
  const store = memoryCache();
  await tmdbPosterPath('synthetic', 'movie', 1, { cache: store, request: async () => ({ data: { poster_path: null } }) });
  assert.equal(store.ttls.get('artwork:tmdb-path-v1:movie:1'), 300);
  await tmdbPosterPath('synthetic', 'movie', 2, { cache: store, request: async () => { throw new Error('timeout'); } });
  assert.equal(store.values.has('artwork:tmdb-path-v1:movie:2'), false);
});

test('Fanart background calls return immediately and requests obey the concurrency cap', async () => {
  const store = memoryCache();
  const gate = deferred();
  let calls = 0;
  const lookup = createFanartLookup({ store, concurrency: 2, request: async () => {
    calls++;
    await gate.promise;
    return { data: { movieposter: [{ url: 'https://example.test/poster.jpg' }] } };
  } });
  assert.deepEqual(await Promise.all([1, 2, 3, 1].map(id => lookup('synthetic', id, 'movie', { background: true }))), [null, null, null, null]);
  await tick();
  assert.equal(calls, 2);
  gate.resolve();
  await tick();
  assert.equal(calls, 3);
  assert.equal((await lookup('synthetic', 1, 'movie')).poster, 'https://example.test/poster.jpg');
});

test('TorBox pagination completes all pages and rejects malformed or failed pages', async () => {
  const { torboxPaginate } = require('../src/torbox').__test;
  const offsets = [];
  const result = await torboxPaginate('/torrents/mylist', 'synthetic-account', {}, 2, async (_path, _key, params) => {
    offsets.push(params.offset);
    return { status: 200, data: { data: params.offset === 0 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }] } };
  });
  assert.deepEqual(offsets, [0, 2]);
  assert.equal(result.data.data.length, 3);
  const malformed = await torboxPaginate('/torrents/mylist', 'synthetic-account', {}, 2, async () => ({ status: 200, data: {} }));
  assert.ok(malformed.error);
  const failed = await torboxPaginate('/torrents/mylist', 'synthetic-account', {}, 2, async (_p, _k, params) => params.offset
    ? { status: 429, error: 'limited' } : { status: 200, data: { data: [{ id: 1 }, { id: 2 }] } });
  assert.equal(failed.status, 429);
  assert.equal(failed.data, undefined);
});

test('one TorBox account shares a scan across simultaneous profile requests', async () => {
  const store = memoryCache();
  const gate = deferred();
  let calls = 0;
  const deps = { store, paginate: async () => { calls++; await gate.promise; return { data: { data: [] }, status: 200 }; } };
  const a = fetchDownloadSources('synthetic-account', {}, deps);
  const b = fetchDownloadSources('synthetic-account', {}, deps);
  await tick();
  assert.equal(calls, 3);
  gate.resolve();
  assert.deepEqual(await Promise.all([a, b]), [[], []]);
});
