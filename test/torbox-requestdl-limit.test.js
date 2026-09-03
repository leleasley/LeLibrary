const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { __test } = require('../src/torbox');

test('requestdl limiter throttles an account without delaying another account', async () => {
  let clock = 0;
  const waits = [];
  const limiter = __test.createRequestDlLimiter({
    ratePerMinute: 60,
    burst: 1,
    maxConcurrent: 1,
    now: () => clock,
    sleep: async ms => { waits.push(ms); clock += ms; },
  });

  assert.equal(await limiter.acquire('account-a'), true);
  limiter.release('account-a');
  assert.equal(await limiter.acquire('account-b'), true);
  limiter.release('account-b');

  // Account A has spent its one-token burst and waits for its own refill.
  assert.equal(await limiter.acquire('account-a'), true);
  assert.deepEqual(waits, [1000]);
  limiter.release('account-a');
});

test('requestdl 429 cooldown applies only to the affected account', async () => {
  let clock = 0;
  const limiter = __test.createRequestDlLimiter({
    ratePerMinute: 60,
    burst: 2,
    now: () => clock,
    sleep: async () => { throw new Error('cooldown must not queue'); },
  });

  limiter.cooldown('account-a', 120_000);
  assert.equal(await limiter.acquire('account-a'), false);
  assert.equal(await limiter.acquire('account-b'), true);
  limiter.release('account-b');

  clock = 120_000;
  assert.equal(await limiter.acquire('account-a'), true);
  limiter.release('account-a');
});

test('requestdl account identities are non-reversible hashes', () => {
  const identity = __test.requestDlIdentity('synthetic-secret-key');
  assert.match(identity, /^[a-f0-9]{16}$/);
  assert.notEqual(identity, 'synthetic-secret-key');
});

test('metadata routes no longer prefetch TorBox playback links', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.doesNotMatch(appSource, /prefetchPublicStreams/);
  assert.doesNotMatch(appSource, /streamPrefetch/);
  // The actual tt: bridge remains the stream-route implementation.
  assert.match(appSource, /buildDiscoveryStreams/);
});
