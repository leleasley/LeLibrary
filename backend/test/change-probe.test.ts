// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const probe = require('../src/library/change-probe.ts');

const row = (id, state = 'completed', finished = true) => ({ id, download_state: state, download_finished: finished, active: !finished, progress: finished ? 1 : 0.4 });
function fakeTorbox(lists, { fail = false } = {}) {
  const calls = [];
  return {
    calls,
    get: async (family, { limit, offset }) => {
      calls.push([family, limit, offset]);
      if (fail) throw new Error('429');
      return (lists[family] || []).slice(offset, offset + limit);
    },
  };
}
const cachedFrom = (lists) => async (family) => lists[family];

test('TorBox: nothing changed when count, newest items and their status match', async () => {
  const now = { torrents: [row(9), row(8), row(7), row(6), row(5), row(4), row(3)], usenet: [], webdl: [] };
  const fake = fakeTorbox(now);
  assert.equal(await probe.probeTorbox({ get: fake.get, cached: cachedFrom(now) }), false);
  assert.ok(fake.calls.length <= 4, `cheap: ${fake.calls.length} requests`);
});

test('TorBox: a new download, a deletion or a finished download is a change', async () => {
  const before = { torrents: [row(9), row(8), row(7)], usenet: [], webdl: [] };
  const added = { ...before, torrents: [row(10), ...before.torrents] };
  assert.equal(await probe.probeTorbox({ get: fakeTorbox(added).get, cached: cachedFrom(before) }), true);
  const deleted = { ...before, torrents: [row(9), row(7)] };
  assert.equal(await probe.probeTorbox({ get: fakeTorbox(deleted).get, cached: cachedFrom(before) }), true);
  const downloading = { torrents: [row(9, 'downloading', false), row(8), row(7)], usenet: [], webdl: [] };
  const finished = { ...downloading, torrents: [row(9), row(8), row(7)] };
  assert.equal(await probe.probeTorbox({ get: fakeTorbox(finished).get, cached: cachedFrom(downloading) }), true);
  const firstUsenet = { ...before, usenet: [row(50)] };
  assert.equal(await probe.probeTorbox({ get: fakeTorbox(firstUsenet).get, cached: cachedFrom(before) }), true);
});

test('TorBox: download progress alone is not a change', async () => {
  const before = { torrents: [row(9, 'downloading', false), row(8)], usenet: [], webdl: [] };
  const later = { ...before, torrents: [{ ...row(9, 'downloading', false), progress: 0.9 }, row(8)] };
  assert.equal(await probe.probeTorbox({ get: fakeTorbox(later).get, cached: cachedFrom(before) }), false);
});

test('TorBox: a failed request or no cached listing is unknown, never "unchanged"', async () => {
  const lists = { torrents: [row(1)], usenet: [], webdl: [] };
  assert.equal(await probe.probeTorbox({ get: fakeTorbox(lists, { fail: true }).get, cached: cachedFrom(lists) }), null);
  assert.equal(await probe.probeTorbox({ get: fakeTorbox(lists).get, cached: async () => undefined }), null);
});

test('Real-Debrid token: total, newest item and active count', async () => {
  const get = async (path) => path === '/torrents'
    ? { data: [{ id: 'AB', status: 'downloaded' }], headers: { 'x-total-count': '120' } }
    : { data: { nb: 2 }, headers: {} };
  assert.equal(await probe.realDebridToken({ get }), '120|AB:downloaded|2');
  assert.equal(await probe.realDebridToken({ get: async () => { throw new Error('x'); } }), null);
});

test('combining providers: any change wins, all unchanged is unchanged, else unknown', () => {
  assert.equal(probe.combine([false, true, null]), true);
  assert.equal(probe.combine([false, false]), false);
  assert.equal(probe.combine([false, null]), null);
  assert.equal(probe.combine([]), null);
});

test('decideSync policy', () => {
  const MIN = 60_000;
  const base = { now: 100 * MIN, intervalMs: 2 * MIN, fullResyncMs: 10 * MIN, activeProbeMs: 30_000 };
  assert.equal(probe.decideSync({ ...base, rec: {} }), 'full', 'never synced');
  assert.equal(probe.decideSync({ ...base, rec: { lastSyncAt: 89 * MIN } }), 'full', 'safety resync');
  const active = { lastSyncAt: 99 * MIN, lastProbeAt: 99.9 * MIN, lastRequestAt: 99 * MIN };
  assert.equal(probe.decideSync({ ...base, rec: active }), 'skip', 'probe not due');
  assert.equal(probe.decideSync({ ...base, rec: { ...active, lastProbeAt: 99 * MIN } }), 'probe', 'active library probes every 30s');
  const idle = { lastSyncAt: 99 * MIN, lastProbeAt: 99 * MIN, lastRequestAt: 10 * MIN };
  assert.equal(probe.decideSync({ ...base, rec: idle }), 'skip', 'idle library probes on the normal interval');
  assert.equal(probe.decideSync({ ...base, rec: { ...idle, lastProbeAt: 97 * MIN } }), 'probe');
  assert.equal(probe.afterProbe({ ...base, rec: { lastSyncAt: 99 * MIN }, changed: true }), 'full');
  assert.equal(probe.afterProbe({ ...base, rec: { lastSyncAt: 99 * MIN }, changed: false }), 'skip');
  assert.equal(probe.afterProbe({ ...base, rec: { lastSyncAt: 99 * MIN }, changed: null }), 'skip', 'unknown waits for the normal interval');
  assert.equal(probe.afterProbe({ ...base, rec: { lastSyncAt: 97 * MIN }, changed: null }), 'full');
});

test('probeScope asks each provider; Real-Debrid compares with the last token', async () => {
  process.env.WEBDAV_SOURCE = '';
  const lists = { torrents: [row(2), row(1)], usenet: [], webdl: [] };
  let rdTotal = '5';
  const deps = {
    torboxPage: async (_key, family, { limit, offset }) => (lists[family] || []).slice(offset, offset + limit),
    torboxCached: async (_key, family) => lists[family],
    rdGet: async (_key, path) => (path === '/torrents' ? { data: [{ id: 'X', status: 'downloaded' }], headers: { 'x-total-count': rdTotal } } : { data: { nb: 0 }, headers: {} }),
  };
  const rec = { config: { torboxApiKey: 'tb', rdApiKey: 'rd' } };
  const first = await probe.probeScope(rec, deps);
  assert.equal(first.changed, null, 'no Real-Debrid token yet: unknown');
  rec.probeTokens = first.tokens;
  assert.equal((await probe.probeScope(rec, deps)).changed, false);
  rdTotal = '6';
  assert.equal((await probe.probeScope(rec, deps)).changed, true);
  const tbOnly = { config: { torboxApiKey: 'tb' } };
  assert.equal((await probe.probeScope(tbOnly, deps)).changed, false);
  const withAd = { config: { torboxApiKey: 'tb', adApiKey: 'ad' } };
  assert.equal((await probe.probeScope(withAd, deps)).changed, null, 'AllDebrid has no probe');
});
