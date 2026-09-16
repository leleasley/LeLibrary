// Opt-in integration test for the index-first store. It runs only when
// LIBRARY_TEST_DATABASE_URL is set (so the default `npm test` stays free of
// databases and network), and it cleans up after itself.
//
//   LIBRARY_TEST_DATABASE_URL=postgres://user:pass@host:port/db \
//     node --test test/library-store.test.js
const test = require('node:test');
const assert = require('node:assert');

const TEST_DB = process.env.LIBRARY_TEST_DATABASE_URL;

test('index store: reconcile, match, catalog and search are incremental', { skip: !TEST_DB && 'LIBRARY_TEST_DATABASE_URL not set' }, async (t) => {
  process.env.DATABASE_URL = TEST_DB;
  process.env.LIBRARY_MATCH_OFFLINE = '1';

  const db = require('../src/library/db');
  const store = require('../src/library/store');
  const matcher = require('../src/library/matcher');
  const catalog = require('../src/library/catalog');
  const { buildRecord, sourceIdOf } = require('../src/library/diff');

  await db.ensureSchema();
  const pool = db.getPool();
  const scopeId = `test_${Date.now().toString(36)}`;

  t.after(async () => {
    await pool.query('DELETE FROM lib_items WHERE scope_id = $1', [scopeId]).catch(() => {});
    await pool.query('DELETE FROM lib_scopes WHERE scope_id = $1', [scopeId]).catch(() => {});
    await db.close();
  });

  const item = (id, name, tmdbId, type, year, title) => ({
    source: 'torrent', id, name, size: 1000, created_at: '2026-01-01T00:00:00Z',
    download_finished: true, files: [{ id: 1, name: `${name}.mkv`, size: 1000 }],
    __match: { tmdbId, type, title: title || name, year, imdbId: `tt${tmdbId}`, poster: `https://image.tmdb.org/t/p/w500/${tmdbId}.jpg` },
  });
  const records = (items) => items.map((it) => buildRecord(it, sourceIdOf(it)));

  const items = [
    item(1, 'Movie.Alpha.2020.1080p', 1001, 'movie', 2020, 'Movie Alpha'),
    item(2, 'Movie.Beta.2021.1080p', 1002, 'movie', 2021, 'Movie Beta'),
    item(3, 'Show.Gamma.S01E01.1080p', 2001, 'series', 2019, 'Show Gamma'),
    item(4, 'Show.Gamma.S01E02.1080p', 2001, 'series', 2019, 'Show Gamma'),
  ];

  let counts = await store.reconcile(scopeId, records(items));
  assert.deepStrictEqual(
    { added: counts.added, changed: counts.changed, removed: counts.removed, unchanged: counts.unchanged },
    { added: 4, changed: 0, removed: 0, unchanged: 0 }
  );

  const matchStats = await matcher.matchScope({ scopeId, config: {}, tmdbApiKey: 'stub', lang: 'en-US' }, { batch: 50, concurrency: 2 });
  assert.strictEqual(matchStats.matched, 4);

  const movieRows = await store.catalogRows(scopeId, 'movie');
  assert.strictEqual(movieRows.length, 2);
  const seriesRows = await store.catalogRows(scopeId, 'series');
  assert.strictEqual(seriesRows.length, 2);

  // Catalog assembly groups the two episodes of Show.Gamma into one card.
  const metas = await catalog.buildFromRows(seriesRows, { userKey: scopeId, type: 'series', sortBy: 'data_adicao' });
  assert.strictEqual(metas.length, 1);
  assert.match(metas[0].name, /Show Gamma/);

  const hits = await store.searchRows(scopeId, 'movie', 'alpha', 50);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual((await store.searchRows(scopeId, 'movie', 'zzzzz', 50)).length, 0);

  // Unchanged resync writes nothing.
  counts = await store.reconcile(scopeId, records(items));
  assert.deepStrictEqual(
    { added: counts.added, changed: counts.changed, removed: counts.removed, unchanged: counts.unchanged },
    { added: 0, changed: 0, removed: 0, unchanged: 4 }
  );

  // A renamed item is detected as changed and re-queued for matching.
  const renamed = [...items];
  renamed[0] = item(1, 'Movie.Alpha.Renamed.2020.2160p', 1001, 'movie', 2020, 'Movie Alpha');
  counts = await store.reconcile(scopeId, records(renamed));
  assert.strictEqual(counts.changed, 1);
  assert.strictEqual(counts.unchanged, 3);

  // A removed item is soft-deleted and disappears from catalog reads.
  counts = await store.reconcile(scopeId, records(items.slice(1)));
  assert.strictEqual(counts.removed, 1);
  assert.strictEqual((await store.catalogRows(scopeId, 'movie')).length, 1);
});
