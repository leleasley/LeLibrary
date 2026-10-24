// @ts-nocheck
// A small durable background job runner.
//
// Why this exists: some work cannot be finished inside a request. Building a
// library projection for a big account takes minutes, and a Nuvio push that
// needs those folders used to make the browser wait, give up, and tell the
// person to "push again in a minute". Work like that belongs to a worker that
// keeps trying on its own:
//
//   - bounded concurrency, so two pushes never fight over the same provider
//   - retry with backoff, because the thing it waits for is another build
//   - the queue lives in Redis, so a restart picks the work back up
//   - handlers are registered by the feature that owns them (no cycle back
//     into the push module, which requires this one)
//
// It is deliberately not a general workflow engine: one record per job id, a
// handler that answers 'done' or 'retry', and a hard expiry so abandoned work
// cannot run forever.

const cache = require('./cache.ts');

const TICK_MS = Math.max(1000, parseInt(process.env.JOBS_TICK_MS, 10) || 5000);
const CONCURRENCY = Math.max(1, parseInt(process.env.JOBS_CONCURRENCY, 10) || 2);
const KEY_PREFIX = 'job:';
// Bounded, because the condition a job waits for is a library build that may
// take minutes; after the last step it keeps retrying at that cadence.
const BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 300_000];
const DEFAULT_TTL_SECONDS = 6 * 3600;
const MAX_ATTEMPTS = 40;

// id -> record. The in-process view; Redis is the durable copy.
const queue = new Map();
// ids currently running, so a slow job is never started twice.
const running = new Set();
const handlers = new Map();
let ticking = false;
let timer = null;

function jobKey(kind, id) {
  return `${KEY_PREFIX}${kind}:${id}`;
}

function backoffFor(attempts) {
  const index = Math.max(0, Math.min(BACKOFF_MS.length - 1, attempts - 1));
  return BACKOFF_MS[index];
}

function registerJobHandler(kind, handler) {
  handlers.set(kind, handler);
}

// Queue work. Re-scheduling the same kind + id refreshes the record instead of
// stacking duplicates: the job is "make sure X is true", not "do X once".
async function scheduleJob({ kind, id, payload = {}, delayMs = 0, ttlSeconds = DEFAULT_TTL_SECONDS }) {
  if (!handlers.has(kind)) throw new Error(`No handler registered for job kind ${kind}`);
  const key = jobKey(kind, id);
  const existing = queue.get(key);
  const record = {
    kind,
    id,
    payload,
    attempts: existing ? existing.attempts : 0,
    notBefore: Date.now() + Math.max(0, delayMs),
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
  queue.set(key, record);
  await cache.set(key, record, ttlSeconds);
  return record;
}

async function cancelJob(kind, id) {
  const key = jobKey(kind, id);
  queue.delete(key);
  await cache.del(key);
}

function jobState(kind, id) {
  return queue.get(jobKey(kind, id)) || null;
}

// Run every job that is due. Exported so tests can drive the runner without
// timers; the tick below is just this on an interval.
async function runDueJobs(now = Date.now()) {
  const due = [...queue.values()].filter((record) => (
    record.notBefore <= now && !running.has(jobKey(record.kind, record.id))
  ));
  const batch = due.slice(0, CONCURRENCY);
  await Promise.all(batch.map((record) => runJob(record, now)));
  return batch.length;
}

async function runJob(record, now) {
  const key = jobKey(record.kind, record.id);
  const handler = handlers.get(record.kind);
  if (!handler) { await cancelJob(record.kind, record.id); return; }
  if (record.expiresAt <= now) {
    console.log(`[Jobs] ${record.kind} ${record.id} expired after ${record.attempts} attempts; dropping it`);
    await cancelJob(record.kind, record.id);
    return;
  }
  running.add(key);
  try {
    const outcome = await handler(record.payload, { attempts: record.attempts, id: record.id });
    if (outcome === 'retry') {
      record.attempts += 1;
      if (record.attempts >= MAX_ATTEMPTS) {
        console.log(`[Jobs] ${record.kind} ${record.id} gave up after ${record.attempts} attempts`);
        await cancelJob(record.kind, record.id);
        return;
      }
      const wait = backoffFor(record.attempts);
      record.notBefore = Date.now() + wait;
      await cache.set(key, record, Math.max(60, Math.ceil((record.expiresAt - Date.now()) / 1000)));
      console.log(`[Jobs] ${record.kind} ${record.id} not ready (attempt ${record.attempts}); retrying in ${Math.round(wait / 1000)}s`);
      return;
    }
    console.log(`[Jobs] ${record.kind} ${record.id} finished`);
    await cancelJob(record.kind, record.id);
  } catch (error) {
    // A throwing handler is a transient failure (network, provider): retry it
    // like an unready job rather than losing the work.
    record.attempts += 1;
    record.notBefore = Date.now() + backoffFor(record.attempts);
    await cache.set(key, record, Math.max(60, Math.ceil((record.expiresAt - Date.now()) / 1000)));
    console.warn(`[Jobs] ${record.kind} ${record.id} failed (attempt ${record.attempts}):`, error?.message || error);
  } finally {
    running.delete(key);
  }
}

// Add jobs that exist in the store but not in this process: queued by another
// process (a one-off script, another worker). A job this process already holds
// is never overwritten, so its attempts and schedule stay authoritative.
async function syncFromStore(store = cache) {
  const keys = await store.keys(`${KEY_PREFIX}*`);
  let added = 0;
  for (const key of keys) {
    if (queue.has(key) || running.has(key)) continue;
    const record = await store.get(key);
    if (!record || typeof record !== 'object' || !record.kind || !record.id) continue;
    if (!handlers.has(record.kind)) continue;
    if (record.expiresAt <= Date.now()) { await store.del(key); continue; }
    queue.set(key, record);
    added += 1;
  }
  return added;
}

// Pick up whatever the previous process left queued.
async function resumeJobs() {
  const keys = await cache.keys(`${KEY_PREFIX}*`);
  let restored = 0;
  for (const key of keys) {
    const record = await cache.get(key);
    if (!record || typeof record !== 'object' || !record.kind || !record.id) continue;
    if (!handlers.has(record.kind)) continue;
    if (record.expiresAt <= Date.now()) { await cache.del(key); continue; }
    queue.set(key, record);
    restored += 1;
  }
  if (restored) console.log(`[Jobs] Resumed ${restored} background job(s)`);
  return restored;
}

// Re-read the store about once a minute (not every tick: it is a key scan).
const STORE_SYNC_MS = 60_000;
let lastStoreSync = 0;

function startJobs() {
  if (timer) return;
  lastStoreSync = Date.now();
  timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    const sync = Date.now() - lastStoreSync >= STORE_SYNC_MS
      ? (lastStoreSync = Date.now(), syncFromStore().catch(() => 0))
      : Promise.resolve(0);
    sync.then(() => runDueJobs())
      .catch((error) => console.warn('[Jobs] tick failed:', error?.message || error))
      .finally(() => { ticking = false; });
  }, TICK_MS);
  timer.unref?.();
  resumeJobs().catch((error) => console.warn('[Jobs] resume failed:', error?.message || error));
  console.log(`[Jobs] Worker started: concurrency=${CONCURRENCY}, tick=${TICK_MS}ms`);
}

function stopJobs() {
  if (timer) clearInterval(timer);
  timer = null;
}

export interface JobsApi {
  registerJobHandler: any;
  scheduleJob: any;
  cancelJob: any;
  jobState: any;
  runDueJobs: any;
  resumeJobs: any;
  syncFromStore: any;
  startJobs: any;
  stopJobs: any;
}

module.exports = {
  registerJobHandler,
  scheduleJob,
  cancelJob,
  jobState,
  runDueJobs,
  resumeJobs,
  syncFromStore,
  startJobs,
  stopJobs,
} satisfies JobsApi;
