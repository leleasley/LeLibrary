// @ts-nocheck
// Opt-in integration test (LIBRARY_TEST_DATABASE_URL, like library-store):
// leaving TorBox torrents out of the library (issue #16) removes them in one
// sync, past the mass-removal guard, and turning them back on restores them.
const test = require('node:test');
const assert = require('node:assert');

const TEST_DB = process.env.LIBRARY_TEST_DATABASE_URL;

test('excluded TorBox kinds leave the index in one sync', { skip: !TEST_DB && 'LIBRARY_TEST_DATABASE_URL not set' }, async (t) => {
  process.env.DATABASE_URL = TEST_DB;
  const db = require('../src/library/db.ts');
  const store = require('../src/library/store.ts');
  const { buildRecord, sourceIdOf } = require('../src/library/diff.ts');

  await db.ensureSchema();
  const pool = db.getPool();
  const scopeId = `test_src_${Date.now().toString(36)}`;
  t.after(async () => {
    await pool.query('DELETE FROM lib_items WHERE scope_id = $1', [scopeId]).catch(() => {});
    await db.close();
    require('../src/runtime/cache.ts').getRedisClient()?.disconnect();
  });

  const item = (source, id) => ({
    source, id, name: `Movie.${source}.${id}.2020.1080p`, size: 1000, created_at: '2026-01-01T00:00:00Z',
    download_finished: true, files: [{ id: 1, name: `Movie.${source}.${id}.2020.1080p.mkv`, size: 1000 }],
  });
  const records = (items) => items.map((it) => buildRecord(it, sourceIdOf(it)));
  const torrents = Array.from({ length: 30 }, (_, i) => item('torrent', i + 1));
  const usenet = [item('usenet', 1), item('usenet', 2)];
  const live = async () => (await pool.query(
    'SELECT source_kind, count(*)::int AS n FROM lib_items WHERE scope_id=$1 AND removed_at IS NULL GROUP BY 1 ORDER BY 1', [scopeId]
  )).rows;

  await store.reconcile(scopeId, records([...torrents, ...usenet]));
  assert.deepStrictEqual(await live(), [{ source_kind: 'torrent', n: 30 }, { source_kind: 'usenet', n: 2 }]);

  // Usenet only: 30 of 32 rows go at once, no strikes.
  const counts = await store.reconcile(scopeId, records(usenet), { excludedKinds: ['torrent', 'webdl'] });
  assert.strictEqual(counts.removed, 30);
  assert.deepStrictEqual(await live(), [{ source_kind: 'usenet', n: 2 }]);

  // Back to every source: the torrents return.
  await store.reconcile(scopeId, records([...torrents, ...usenet]));
  assert.deepStrictEqual(await live(), [{ source_kind: 'torrent', n: 30 }, { source_kind: 'usenet', n: 2 }]);

  // The guard still protects kinds that are not excluded.
  const partial = await store.reconcile(scopeId, records(usenet));
  assert.strictEqual(partial.removed, 0);
  assert.deepStrictEqual(await live(), [{ source_kind: 'torrent', n: 30 }, { source_kind: 'usenet', n: 2 }]);
});
