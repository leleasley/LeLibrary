// @ts-nocheck
// A Nuvio push must never wait unboundedly for a cold library build. Waiting
// for one is what made the first push time out in the browser while the build
// carried on server-side, so the second push (warm) appeared to be the one that
// "worked". The owned-only collections route now waits a bounded slice via
// settleWithin(), publishes whatever is ready, and lets the build finish in the
// background.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { settleWithin } = require('../src/runtime/refresh.ts');

test('settleWithin reports work that finished inside the budget', async () => {
  assert.equal(await settleWithin(Promise.resolve('built'), 200), true);
});

test('settleWithin gives up at the budget without cancelling the work', async () => {
  let finished = false;
  const slow = new Promise((resolve) => setTimeout(() => { finished = true; resolve('late'); }, 120));
  const started = Date.now();
  assert.equal(await settleWithin(slow, 40), false);
  assert.ok(Date.now() - started < 120, 'returned before the work finished');
  // The build keeps running: the caller only stopped waiting for it.
  await slow;
  assert.equal(finished, true);
});

test('settleWithin treats a failed build as settled instead of throwing', async () => {
  const failed = settleWithin(Promise.reject(new Error('provider exploded')), 200);
  assert.equal(await failed, true);
});

test('settleWithin honours the budget it is given', async () => {
  // Guards the regression that caused the timeout report: an unbounded wait
  // (forever, or far longer than the caller asked for).
  const pending = new Promise(() => {});
  const started = Date.now();
  assert.equal(await settleWithin(pending, 60), false);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 40 && elapsed < 1000, `waited ${elapsed}ms for a 60ms budget`);
});
