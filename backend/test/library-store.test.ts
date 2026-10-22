// @ts-nocheck
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

  const db = require('../src/library/db.ts');
  const store = require('../src/library/store.ts');
  const matcher = require('../src/library/matcher.ts');
  const catalog = require('../src/library/catalog.ts');
  const { buildRecord, sourceIdOf } = require('../src/library/diff.ts');

  await db.ensureSchema();
  const pool = db.getPool();
  const scopeId = `test_${Date.now().toString(36)}`;

  t.after(async () => {
    await pool.query('DELETE FROM lib_items WHERE scope_id = $1', [scopeId]).catch(() => {});
    await pool.query('DELETE FROM lib_scopes WHERE scope_id = $1', [scopeId]).catch(() => {});
    await db.close();
    require('../src/runtime/cache.ts').getRedisClient()?.disconnect();
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

  // A successful match may canonicalize indexed title fields beyond the
  // provider parser. Replaying the unchanged source snapshot must not write
  // those fields back or count the row as changed on every provider poll.
  await pool.query('UPDATE lib_items SET norm_title = $1 WHERE scope_id = $2 AND source_id = $3', [
    'canonical movie alpha', scopeId, String(items[0].id),
  ]);
  counts = await store.reconcile(scopeId, records(items));
  assert.deepStrictEqual(
    { changed: counts.changed, unchanged: counts.unchanged, matchPreserved: counts.matchPreserved },
    { changed: 0, unchanged: 4, matchPreserved: 1 }
  );
  const preserved = await pool.query(
    'SELECT match_status, tmdb_id, norm_title FROM lib_items WHERE scope_id = $1 AND source_id = $2',
    [scopeId, String(items[0].id)]
  );
  assert.strictEqual(preserved.rows[0].match_status, 'matched');
  assert.strictEqual(Number(preserved.rows[0].tmdb_id), 1001);
  assert.strictEqual(preserved.rows[0].norm_title, 'canonical movie alpha');

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

  // A matching-code retry-version change must wake failed rows even when
  // their exponential retry deadline is still in the future. The engine's
  // drain loop gates claims through counts(), so both must agree.
  const retryVersion = require('../src/matching/resolve.ts').retryVersion();
  await pool.query(
    `UPDATE lib_items SET match_status = 'failed', match_version = $1,
        match_next_retry_at = now() + interval '7 days'
      WHERE scope_id = $2 AND source_id = $3`,
    [`old-${retryVersion}`, scopeId, String(items[1].id)]
  );
  const beforeRetry = await store.counts(scopeId);
  assert.strictEqual(beforeRetry.retryable_count, 1);
  const claimed = await store.claimMatchJobs(scopeId, 1);
  assert.strictEqual(claimed.length, 1);
  assert.strictEqual(claimed[0].source_id, String(items[1].id));

  const { MAX_MATCH_ATTEMPTS } = require('../src/matching/resolve.ts');
  const target = await pool.query(
    `SELECT id FROM lib_items WHERE scope_id=$1 AND source_id=$2`,
    [scopeId, String(items[2].id)]
  );
  const targetId = target.rows[0].id;
  await pool.query(`UPDATE lib_items SET match_status='matching', match_attempts=$2 WHERE id=$1`, [targetId, MAX_MATCH_ATTEMPTS]);
  await store.saveMatch(targetId, {
    status: 'failed', error: 'no-candidate [synthetic-test]', version: retryVersion,
  });
  let terminal = await pool.query(`SELECT match_status,match_attempts,match_error,match_version,match_next_retry_at
    FROM lib_items WHERE id=$1`, [targetId]);
  assert.strictEqual(terminal.rows[0].match_status, 'skipped');
  assert.strictEqual(Number(terminal.rows[0].match_attempts), MAX_MATCH_ATTEMPTS);
  assert.match(terminal.rows[0].match_error, /^no-candidate/);
  assert.strictEqual(terminal.rows[0].match_next_retry_at, null);
  assert.strictEqual(terminal.rows[0].match_version, retryVersion);
  const second = await pool.query(`SELECT id FROM lib_items WHERE scope_id=$1 AND source_id=$2`, [scopeId, String(items[3].id)]);
  await pool.query(`UPDATE lib_items SET match_status='failed', match_attempts=$2,
      match_error='season-related [synthetic-test]', match_version='r5' WHERE id=$1`,
    [second.rows[0].id, MAX_MATCH_ATTEMPTS]);
  assert.strictEqual(await store.terminalizeExhaustedMatches(scopeId), 1);
  const migratedTerminal = await pool.query(`SELECT match_status,match_error,match_version
    FROM lib_items WHERE id=$1`, [second.rows[0].id]);
  assert.strictEqual(migratedTerminal.rows[0].match_status, 'skipped');
  assert.match(migratedTerminal.rows[0].match_error, /^season-related/);
  assert.strictEqual(migratedTerminal.rows[0].match_version, retryVersion);
  let queue = await store.counts(scopeId);
  assert.strictEqual(queue.failed_count, 2);
  assert.strictEqual(queue.retryable_count, 0);
  // A real claim pass cannot hand terminal rows to the matcher, so a cycle
  // with only these failures performs no resolver/TMDB work.
  assert.deepStrictEqual(await store.claimMatchJobs(scopeId, 10), []);
  let visible = await store.failedMatchRows(scopeId);
  assert.ok(visible.some((row) => String(row.id) === String(targetId)
    && row.reason === 'no-candidate' && row.terminal === true));
  assert.ok(visible.some((row) => String(row.id) === String(second.rows[0].id)
    && row.reason === 'season-related' && row.terminal === true));

  // Operators can explicitly requeue one internal row; reason is retained
  // during the retry, and attempt budget is reset for the requested retry.
  assert.strictEqual(await store.requeueFailedMatches(scopeId, String(targetId)), 1);
  terminal = await pool.query(`SELECT match_status,match_attempts,match_error FROM lib_items WHERE id=$1`, [targetId]);
  assert.strictEqual(terminal.rows[0].match_status, 'pending');
  assert.strictEqual(Number(terminal.rows[0].match_attempts), 0);
  assert.match(terminal.rows[0].match_error, /^no-candidate/);
  const manualClaim = await store.claimMatchJobs(scopeId, 1);
  assert.ok(manualClaim.some((row) => String(row.id) === String(targetId)));
  terminal = await pool.query(`SELECT match_attempts FROM lib_items WHERE id=$1`, [targetId]);
  assert.strictEqual(Number(terminal.rows[0].match_attempts), 1);
  await store.saveMatch(targetId, {
    status: 'failed', error: 'no-candidate [synthetic-test]', version: retryVersion,
  });
  terminal = await pool.query(`SELECT match_status,match_next_retry_at > now() AS future
    FROM lib_items WHERE id=$1`, [targetId]);
  assert.strictEqual(terminal.rows[0].match_status, 'failed');
  assert.strictEqual(terminal.rows[0].future, true);

  // A parser-only version change wakes terminal rows without changing the
  // match/cache version used to decide whether successful identities are stale.
  const [retryPolicyVersion, , resolverAndTableVersion] = retryVersion.split(':');
  const previousParserVersion = `${retryPolicyVersion}:p1:${resolverAndTableVersion}`;
  assert.notStrictEqual(previousParserVersion, retryVersion);
  await pool.query(`UPDATE lib_items SET match_status='skipped', match_attempts=$2,
      match_error='ambiguous-candidate [synthetic-test]', match_version=$3,
      match_next_retry_at=NULL WHERE id=$1`, [targetId, MAX_MATCH_ATTEMPTS, previousParserVersion]);
  queue = await store.counts(scopeId);
  assert.strictEqual(queue.failed_count, 2);
  assert.strictEqual(queue.retryable_count, 1);
  const versionClaim = await store.claimMatchJobs(scopeId, 1);
  assert.ok(versionClaim.some((row) => String(row.id) === String(targetId)));
  terminal = await pool.query(`SELECT match_status,match_attempts FROM lib_items WHERE id=$1`, [targetId]);
  assert.strictEqual(terminal.rows[0].match_status, 'matching');
  assert.strictEqual(Number(terminal.rows[0].match_attempts), 1);

  // Exhaust the fresh budget without changing either version. The row must
  // return to terminal state and remain unclaimable until a later rule change
  // or explicit manual requeue.
  // The matcher increments the claim count before saveMatch records the final
  // failed result, so model the eighth claimed attempt here.
  await pool.query(`UPDATE lib_items SET match_attempts=$2 WHERE id=$1`, [targetId, MAX_MATCH_ATTEMPTS]);
  await store.saveMatch(targetId, {
    status: 'failed', error: 'ambiguous-candidate [synthetic-test]', version: retryVersion,
  });
  terminal = await pool.query(`SELECT match_status,match_attempts,match_version FROM lib_items WHERE id=$1`, [targetId]);
  assert.strictEqual(terminal.rows[0].match_status, 'skipped');
  assert.strictEqual(Number(terminal.rows[0].match_attempts), MAX_MATCH_ATTEMPTS);
  assert.strictEqual(terminal.rows[0].match_version, retryVersion);
  queue = await store.counts(scopeId);
  assert.strictEqual(queue.failed_count, 2);
  assert.strictEqual(queue.retryable_count, 0);
  assert.deepStrictEqual(await store.claimMatchJobs(scopeId, 10), []);

  await pool.query(`UPDATE lib_items SET match_status='skipped', match_attempts=$2,
      match_error='unparseable [synthetic-test]', match_version=$3 WHERE id=$1`,
    [targetId, MAX_MATCH_ATTEMPTS, retryVersion]);
  await pool.query(`UPDATE lib_items SET match_status='skipped', match_attempts=$2,
      match_error='unparseable [synthetic-test]', match_version=$3 WHERE id=$1`,
    [second.rows[0].id, MAX_MATCH_ATTEMPTS, retryVersion]);
  assert.strictEqual(await store.requeueFailedMatches(scopeId), 2);
  const requeued = await pool.query(`SELECT count(*)::int AS rows,
      count(*) FILTER (WHERE match_attempts=0)::int AS reset,
      count(*) FILTER (WHERE match_error LIKE 'unparseable%')::int AS reasons_preserved
    FROM lib_items WHERE scope_id=$1 AND id=ANY($2::bigint[]) AND match_status='pending'`,
    [scopeId, [targetId, second.rows[0].id]]);
  assert.deepStrictEqual(requeued.rows[0], { rows: 2, reset: 2, reasons_preserved: 2 });
});

export interface LibraryStoreTestTestModule {};
