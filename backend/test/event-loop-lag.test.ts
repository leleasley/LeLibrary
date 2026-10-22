// @ts-nocheck
// Task 4: sampled event-loop lag probe. Failing-first test: start collects
// samples, getLagStats returns numeric p50/p95, stop halts the timer.
const test = require('node:test');
const assert = require('node:assert/strict');

const lag = require('../src/runtime/event-loop-lag.ts');

test('probe collects samples and reports numeric p50/p95', async () => {
  lag.stopLagProbe();
  lag.startLagProbe({ intervalMs: 10 });
  await new Promise((r) => setTimeout(r, 60));
  const stats = lag.getLagStats();
  lag.stopLagProbe();
  assert.ok(stats.samples >= 1, `expected samples, got ${stats.samples}`);
  assert.equal(typeof stats.p50, 'number');
  assert.equal(typeof stats.p95, 'number');
  assert.equal(typeof stats.max, 'number');
});

test('stop halts sampling', async () => {
  lag.stopLagProbe();
  lag.startLagProbe({ intervalMs: 10 });
  await new Promise((r) => setTimeout(r, 30));
  lag.stopLagProbe();
  const before = lag.getLagStats().samples;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(lag.getLagStats().samples, before);
});
