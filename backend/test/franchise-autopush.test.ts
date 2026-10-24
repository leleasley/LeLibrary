// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const auto = require('../src/setup/franchise-autopush.ts');
const { LIBRARY_COLLECTION_ID } = require('../src/catalog/nuvio-library-collections.ts');

function memoryStore() {
  const m = new Map();
  return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); }, map: m };
}

test('the fingerprint depends only on which franchises are owned', () => {
  const a = auto.fingerprint([{ collectionId: 9485 }, { collectionId: 10 }]);
  assert.equal(a, auto.fingerprint([{ collectionId: 10 }, { collectionId: 9485 }, { collectionId: 10 }]));
  assert.notEqual(a, auto.fingerprint([{ collectionId: 10 }]));
  assert.equal(auto.fingerprint([]), auto.fingerprint([{ name: 'no id' }]));
});

test('a new franchise queues one update per setup; the same set queues nothing', async () => {
  const store = memoryStore();
  const scheduled = [];
  const jobs = { scheduleJob: async (job) => { scheduled.push(job); } };
  const now = 1_000_000_000;
  await auto.noteProjection(['u1', 'u2'], [{ collectionId: 1 }], { store, jobs, now: () => now });
  assert.deepEqual(scheduled.map((j) => j.id), ['u1', 'u2']);
  assert.ok(scheduled.every((j) => j.kind === auto.JOB_KIND && j.delayMs >= 5 * 60 * 1000));

  scheduled.length = 0;
  await store.set('nuviofr:u1', { fp: auto.fingerprint([{ collectionId: 1 }]), at: now - 10 * 60 * 1000 });
  await auto.noteProjection(['u1'], [{ collectionId: 1 }], { store, jobs, now: () => now });
  assert.equal(scheduled.length, 0, 'unchanged set');

  await auto.noteProjection(['u1'], [{ collectionId: 1 }, { collectionId: 2 }], { store, jobs, now: () => now });
  assert.equal(scheduled.length, 1);
  assert.ok(scheduled[0].delayMs >= 50 * 60 * 1000, 'at most once an hour per setup');
});

test('only the LeLibrary Collections collection is replaced; everything else is kept as it was', () => {
  const mine = { id: 'my-own', title: 'Mine', folders: [{ id: 'f' }], pinToTop: true };
  const other = { id: 'collection-lelibrary-pack-x', title: 'Discover', folders: [] };
  const oldOwned = { id: LIBRARY_COLLECTION_ID, title: 'LeLibrary Collections', folders: [{ id: 'a' }], pinToTop: false };
  const fresh = { id: LIBRARY_COLLECTION_ID, title: 'LeLibrary Collections', folders: [{ id: 'a' }, { id: 'b' }], pinToTop: true };
  const next = auto.replaceOwnedCollection([mine, oldOwned, other], fresh);
  assert.deepEqual(next.map((c) => c.id), ['my-own', LIBRARY_COLLECTION_ID, 'collection-lelibrary-pack-x']);
  assert.equal(next[0], mine);
  assert.equal(next[2], other);
  assert.equal(next[1].folders.length, 2);
  assert.equal(next[1].pinToTop, false, 'keeps its place instead of floating to the top');
  const emptied = auto.replaceOwnedCollection([mine, oldOwned], { ...fresh, folders: [] });
  assert.deepEqual(emptied.map((c) => c.id), ['my-own'], 'no franchises left: the empty collection is removed');
  assert.equal(auto.replaceOwnedCollection([mine], fresh), null, 'not in Nuvio yet: needs a full push');
});

function deps(over = {}) {
  const calls = { pushed: null, saved: null, full: 0 };
  const base = {
    calls,
    store: memoryStore(),
    openSetup: async () => ({ uuid: 'u1', secret: 's', config: {}, keys: {} }),
    readNuvio: () => ({ nuvioToken: 't', nuvioSelectedProfile: 1 }),
    ownedCollectionEnabled: () => true,
    origin: () => 'https://lelibrary.example',
    fetchOwned: async () => ({ id: LIBRARY_COLLECTION_ID, title: 'LeLibrary Collections', folders: [{ id: 'a' }, { id: 'b' }] }),
    nuvio: {
      refresh: async (conn) => ({ data: { ...conn, nuvioToken: 't2' }, refreshed: true }),
      profileIndex: async () => 1,
      pull: async () => [{ id: 'mine', folders: [] }, { id: LIBRARY_COLLECTION_ID, folders: [{ id: 'a' }] }],
      push: async (_t, _p, collections) => { calls.pushed = collections; },
    },
    saveConnection: async (_uuid, conn) => { calls.saved = conn; },
    fullPush: async () => { calls.full += 1; return { ok: true }; },
  };
  return { ...base, ...over, nuvio: { ...base.nuvio, ...(over.nuvio || {}) } };
}

test('the background update pushes only the owned collection and keeps the session fresh', async () => {
  const d = deps();
  assert.equal(await auto.runUpdate({ uuid: 'u1' }, d), 'done');
  assert.deepEqual(d.calls.pushed.map((c) => c.id), ['mine', LIBRARY_COLLECTION_ID]);
  assert.equal(d.calls.pushed[1].folders.length, 2);
  assert.equal(d.calls.saved.nuvioToken, 't2', 'a refreshed Nuvio session is saved');
  assert.ok((await d.store.get('nuviofr:u1')).fp, 'remembers what it pushed');
});

test('setups that never connected Nuvio, or turned the collection off, are left alone', async () => {
  const off = deps({ readNuvio: () => null });
  assert.equal(await auto.runUpdate({ uuid: 'u1' }, off), 'done');
  assert.equal(off.calls.pushed, null);
  const disabled = deps({ ownedCollectionEnabled: () => false });
  assert.equal(await auto.runUpdate({ uuid: 'u1' }, disabled), 'done');
  assert.equal(disabled.calls.pushed, null);
});

test('when Nuvio has no owned collection yet, a full push is done instead', async () => {
  const d = deps({ nuvio: { pull: async () => [{ id: 'mine', folders: [] }] } });
  assert.equal(await auto.runUpdate({ uuid: 'u1' }, d), 'done');
  assert.equal(d.calls.full, 1);
  assert.equal(d.calls.pushed, null);
});

test('a library still building is retried later', async () => {
  const d = deps({ fetchOwned: async () => null });
  assert.equal(await auto.runUpdate({ uuid: 'u1' }, d), 'retry');
});
