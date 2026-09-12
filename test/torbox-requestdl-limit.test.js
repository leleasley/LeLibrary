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

test('playback cooldown status exposes only provider and rounded retry time', () => {
  assert.deepEqual(__test.normalizePlaybackCooldown(181_001, 1_000), {
    provider: 'torbox',
    rateLimited: true,
    retryAfterSec: 181,
  });
  assert.equal(__test.normalizePlaybackCooldown(1_000, 1_000), null);
});

test('provider rate-limit notices are non-playable, transient and human-readable', () => {
  const { makeProviderRateLimitNotice } = require('../src/builder');
  const notice = makeProviderRateLimitNotice({ label: 'TorBox', retryAfterSec: 121 });
  assert.equal(notice.name, '⏳ TorBox is temporarily rate-limiting playback');
  assert.equal(notice.description, 'Try again in approximately 3 minutes.');
  assert.equal(notice._notice, true);
  assert.equal(notice._transientNotice, true);
  assert.match(notice.url, /\/stream-notice$/);
  assert.equal(JSON.stringify(notice).includes('secret'), false);
});

test('metadata routes no longer prefetch TorBox playback links', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.doesNotMatch(appSource, /prefetchPublicStreams/);
  assert.doesNotMatch(appSource, /streamPrefetch/);
  // The actual tt: bridge remains the stream-route implementation.
  assert.match(appSource, /buildDiscoveryStreams/);
});

test('hollow stream responses advertise the same short TTL used by server cache', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const discoverySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'discovery.js'), 'utf8');
  assert.match(appSource, /function streamResponseTtl\(result\)/);
  assert.match(appSource, /cacheMaxAge: responseTtl, staleRevalidate: responseTtl/);
  assert.match(appSource, /cacheMaxAge: streamTtl, staleRevalidate: streamTtl/);
  assert.match(appSource, /_transientNotice/);
  assert.match(discoverySource, /hasTransientNotice \|\| !hasRealStream \? 60 : TTL_STREAM/);
});

test('owned link generation has per-item and per-request ceilings', () => {
  const builderSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'builder.js'), 'utf8');
  assert.match(builderSource, /MAX_OWNED_LINKS_PER_REQUEST = 8/);
  assert.match(builderSource, /MAX_OWNED_FILES_PER_ITEM = 3/);
  assert.match(builderSource, /remainingOwnedLinkBudget -= 1/);
});

test('concurrent requests for one TorBox file share an in-flight operation', () => {
  const torboxSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'torbox.js'), 'utf8');
  assert.match(torboxSource, /const requestDlInFlight = new Map\(\)/);
  assert.match(torboxSource, /if \(existing\) return existing/);
  assert.match(torboxSource, /requestDlInFlight\.delete\(ck\)/);
});
