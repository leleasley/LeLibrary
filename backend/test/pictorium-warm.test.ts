// @ts-nocheck
// The Pictorium warm queue has two classes of work: bulk warm (nobody is
// waiting) and an interactive render (someone has that poster on screen).
// Before priority, opening a 40-poster grid meant the poster you were looking
// at could be render #39 behind the whole page, which is what made posters feel
// slow to arrive.
//
// Concurrency means the first few enqueues start rendering immediately, so
// ordering is only observable in the queued tail: these tests fill past the
// concurrency limit first.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const warm = require('../src/runtime/pictorium-warm.ts');

let counter = 0;
function path(name) {
  counter += 1;
  return `/${name}-${counter}/pictorium/movie/${counter}.jpg`;
}

// More than the warm concurrency, so some entries are genuinely still queued.
const BULK_BATCH = 12;

test('bulk warm work keeps its arrival order in the queued tail', () => {
  const mine = Array.from({ length: BULK_BATCH }, (_, index) => path(`bulk${index}`));
  warm.enqueue(mine);
  const queued = warm.pending().filter((p) => mine.includes(p));
  assert.ok(queued.length > 0, 'expected work still queued past the concurrency limit');
  assert.deepEqual(queued, mine.filter((p) => queued.includes(p)), 'bulk order preserved');
});

test('an interactive render jumps ahead of everything still queued', () => {
  warm.enqueue(Array.from({ length: BULK_BATCH }, (_, index) => path(`ahead${index}`)));
  const urgent = path('on-screen');
  warm.enqueue(urgent, { priority: true });
  assert.equal(warm.pending()[0], urgent, 'the poster someone is waiting for must render next');
});

test('an already-queued render is promoted instead of being skipped', () => {
  // The client first-view path enqueues the same path the bulk run already
  // queued; without promotion it would wait behind the whole bulk run and time
  // out into a fallback redirect.
  const bulk = Array.from({ length: BULK_BATCH }, (_, index) => path(`late${index}`));
  warm.enqueue(bulk);
  const queued = warm.pending().filter((p) => bulk.includes(p));
  assert.ok(queued.length > 1, 'expected several still queued');
  const mine = queued[queued.length - 1];
  assert.equal(warm.enqueue(mine, { priority: true }), 0, 'a known path is not counted as new work');
  assert.equal(warm.pending()[0], mine, 'promoted to the front');
});

test('dedupe still suppresses repeat bulk enqueues', () => {
  const p = path('dedupe');
  assert.equal(warm.enqueue(p), 1);
  assert.equal(warm.enqueue(p), 0, 'bulk re-enqueue is deduped');
});

test('stats reports the queue depth', () => {
  const stats = warm.stats();
  assert.equal(typeof stats.queued, 'number');
  assert.equal(typeof stats.active, 'number');
  assert.ok(stats.concurrency >= 1);
});
