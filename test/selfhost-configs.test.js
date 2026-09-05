const { test } = require('node:test');
const assert = require('node:assert/strict');

// No Redis in unit tests: the saved-setups store must round-trip on the
// in-memory fallback (self-hosters without a reachable Redis, and every CI
// run, hit exactly this path).
delete process.env.REDIS_HOST;
delete process.env.REDIS_URL;
delete process.env.UPSTASH_REDIS_URL;

const mod = require('../src/selfhost-configs');
const cache = require('../src/cache');

test('saved setups round-trip without Redis', async () => {
  assert.equal(cache.getRedisClient(), null, 'test must run without Redis');
  const label = 'test-setup-' + Date.now();
  const before = (await mod.list()).map((r) => r.id);
  const { id } = await mod.save({ label, config: { provider: 'torbox', torboxApiKey: 'x' } });
  const rows = await mod.list();
  const found = rows.find((r) => r.id === id);
  assert.ok(found, 'saved setup must be listed');
  assert.equal(found.label, label);
  assert.equal(found.config.provider, 'torbox');
  await mod.remove(id);
  const after = (await mod.list()).map((r) => r.id);
  assert.ok(!after.includes(id), 'removed setup must be gone');
  assert.deepEqual(after.sort(), before.sort(), 'only the test row may change');
});

test('cache.setMem mirrors memory without touching Redis', async () => {
  cache.setMem('selfhost:test-mem', { a: 1 }, 60);
  assert.deepEqual(await cache.get('selfhost:test-mem'), { a: 1 });
  await cache.del('selfhost:test-mem');
  assert.equal(await cache.get('selfhost:test-mem'), null);
});
