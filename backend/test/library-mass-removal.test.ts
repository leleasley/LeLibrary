// @ts-nocheck
// Pure unit tests for the indexed-sync mass-removal guard. No database: the
// decision helper only touches its in-memory strike map.
const test = require('node:test');
const assert = require('node:assert');

const store = require('../src/library/store.ts');

let n = 0;
const scope = () => `massremoval_${Date.now().toString(36)}_${n++}`;

test('small removals apply immediately and clear strikes', () => {
  const s = scope();
  assert.deepEqual(store.massRemovalDecision(s, 5, 1000, 'fp-a'), { apply: true, strikes: 0 });
  assert.deepEqual(store.massRemovalDecision(s, 5, 20, 'fp-a'), { apply: true, strikes: 0 });
  assert.deepEqual(store.massRemovalDecision(s, 0, 1000, 'fp-a'), { apply: true, strikes: 0 });
});

test('below-relative-threshold removals apply even above the absolute floor', () => {
  const s = scope();
  assert.deepEqual(store.massRemovalDecision(s, 11, 1000, 'fp-a'), { apply: true, strikes: 0 });
});

test('mass removal is refused twice then applied on the third identical report', () => {
  const s = scope();
  assert.deepEqual(store.massRemovalDecision(s, 150, 1000, 'fp-a'), { apply: false, strikes: 1 });
  assert.deepEqual(store.massRemovalDecision(s, 150, 1000, 'fp-a'), { apply: false, strikes: 2 });
  assert.deepEqual(store.massRemovalDecision(s, 150, 1000, 'fp-a'), { apply: true, strikes: 3 });
});

test('a changed removal set restarts the strike count', () => {
  const s = scope();
  assert.deepEqual(store.massRemovalDecision(s, 150, 1000, 'fp-a'), { apply: false, strikes: 1 });
  assert.deepEqual(store.massRemovalDecision(s, 160, 1000, 'fp-b'), { apply: false, strikes: 1 });
});

test('strikes reset after a confirmed removal', () => {
  const s = scope();
  store.massRemovalDecision(s, 150, 1000, 'fp-a');
  store.massRemovalDecision(s, 150, 1000, 'fp-a');
  assert.deepEqual(store.massRemovalDecision(s, 150, 1000, 'fp-a'), { apply: true, strikes: 3 });
  assert.deepEqual(store.massRemovalDecision(s, 150, 1000, 'fp-a'), { apply: false, strikes: 1 });
});

test('empty library never triggers the guard', () => {
  const s = scope();
  assert.deepEqual(store.massRemovalDecision(s, 50, 0, 'fp-a'), { apply: true, strikes: 0 });
});
