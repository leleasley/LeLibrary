// @ts-nocheck
// Background jobs: the runner that finishes work a request cannot.
//
// The concrete need: a Nuvio push whose owned library folders are not built yet
// must not make the person push again in a minute. The push records a
// follow-up job; the runner waits for the projection and replays the publish.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const jobs = require('../src/runtime/jobs.ts');

function freshKind(name) {
  return `test-${name}-${Math.random().toString(36).slice(2, 8)}`;
}

test('a scheduled job runs once and is then gone', async () => {
  const kind = freshKind('once');
  let runs = 0;
  jobs.registerJobHandler(kind, async () => { runs += 1; return 'done'; });
  await jobs.scheduleJob({ kind, id: 'a', payload: {} });
  await jobs.runDueJobs();
  assert.equal(runs, 1);
  assert.equal(jobs.jobState(kind, 'a'), null);
});

test('a job that is not ready yet is retried, not lost', async () => {
  const kind = freshKind('retry');
  let runs = 0;
  jobs.registerJobHandler(kind, async () => {
    runs += 1;
    return runs < 3 ? 'retry' : 'done';
  });
  await jobs.scheduleJob({ kind, id: 'b', payload: {} });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await jobs.runDueJobs(Date.now() + attempt * 10 * 60 * 1000);
  }
  assert.equal(runs, 3);
  assert.equal(jobs.jobState(kind, 'b'), null, 'finished job left queued');
});

test('a throwing handler is retried rather than dropping the work', async () => {
  const kind = freshKind('throw');
  let runs = 0;
  jobs.registerJobHandler(kind, async () => {
    runs += 1;
    if (runs === 1) throw new Error('provider hiccup');
    return 'done';
  });
  await jobs.scheduleJob({ kind, id: 'c', payload: {} });
  await jobs.runDueJobs();
  assert.ok(jobs.jobState(kind, 'c'), 'job was dropped after a transient failure');
  await jobs.runDueJobs(Date.now() + 10 * 60 * 1000);
  assert.equal(runs, 2);
  assert.equal(jobs.jobState(kind, 'c'), null);
});

test('a job is not run before its not-before time', async () => {
  const kind = freshKind('delay');
  let runs = 0;
  jobs.registerJobHandler(kind, async () => { runs += 1; return 'done'; });
  await jobs.scheduleJob({ kind, id: 'd', payload: {}, delayMs: 60_000 });
  await jobs.runDueJobs();
  assert.equal(runs, 0, 'ran before it was due');
  await jobs.runDueJobs(Date.now() + 61_000);
  assert.equal(runs, 1);
});

test('rescheduling the same job does not stack duplicates', async () => {
  const kind = freshKind('dedupe');
  let runs = 0;
  jobs.registerJobHandler(kind, async () => { runs += 1; return 'done'; });
  await jobs.scheduleJob({ kind, id: 'e', payload: { origin: 'first' } });
  await jobs.scheduleJob({ kind, id: 'e', payload: { origin: 'second' }, delayMs: 60_000 });
  const record = jobs.jobState(kind, 'e');
  assert.equal(record.payload.origin, 'second', 'latest schedule should win');
  await jobs.runDueJobs();
  assert.equal(runs, 0, 'the refreshed schedule is not due yet');
  await jobs.runDueJobs(Date.now() + 61_000);
  assert.equal(runs, 1, 'job ran more than once');
});

test('an expired job is dropped instead of running forever', async () => {
  const kind = freshKind('expiry');
  let runs = 0;
  jobs.registerJobHandler(kind, async () => { runs += 1; return 'retry'; });
  await jobs.scheduleJob({ kind, id: 'f', payload: {}, ttlSeconds: 1 });
  await jobs.runDueJobs(Date.now() + 5000);
  assert.equal(runs, 0, 'expired job still ran');
  assert.equal(jobs.jobState(kind, 'f'), null);
});

test('a cancelled job never runs', async () => {
  const kind = freshKind('cancel');
  let runs = 0;
  jobs.registerJobHandler(kind, async () => { runs += 1; return 'done'; });
  await jobs.scheduleJob({ kind, id: 'g', payload: {} });
  await jobs.cancelJob(kind, 'g');
  await jobs.runDueJobs();
  assert.equal(runs, 0);
  assert.equal(jobs.jobState(kind, 'g'), null);
});

test('scheduling an unknown kind fails loudly instead of silently queueing', async () => {
  await assert.rejects(
    () => jobs.scheduleJob({ kind: freshKind('missing'), id: 'h', payload: {} }),
    /No handler registered/,
  );
});

function fakeStore(records) {
  const map = new Map(Object.entries(records));
  return { keys: async () => [...map.keys()], get: async (k) => map.get(k), del: async (k) => { map.delete(k); } };
}

// A job queued by another process (a one-off script, or a second worker) only
// lived in Redis, so this process never ran it until its next restart.
test('jobs queued by another process are picked up without a restart', async () => {
  const kind = freshKind('elsewhere');
  let runs = 0;
  jobs.registerJobHandler(kind, async () => { runs += 1; return 'done'; });
  const store = fakeStore({ [`job:${kind}:x`]: { kind, id: 'x', payload: {}, attempts: 0, notBefore: Date.now() - 1, expiresAt: Date.now() + 60000 } });
  assert.equal(await jobs.syncFromStore(store), 1);
  await jobs.runDueJobs();
  assert.equal(runs, 1);
});

test('re-reading the store never overwrites a job this process already holds', async () => {
  const kind = freshKind('keep');
  jobs.registerJobHandler(kind, async () => 'retry');
  await jobs.scheduleJob({ kind, id: 'y', payload: { mine: true }, delayMs: 60000 });
  const store = fakeStore({ [`job:${kind}:y`]: { kind, id: 'y', payload: { stale: true }, attempts: 9, notBefore: 0, expiresAt: Date.now() + 60000 } });
  assert.equal(await jobs.syncFromStore(store), 0);
  assert.deepEqual(jobs.jobState(kind, 'y').payload, { mine: true });
  await jobs.cancelJob(kind, 'y');
});
