// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert');
const diff = require('../src/library/diff.ts');

function movie(id, name, extra = {}) {
  return { source: 'torrent', id, name, size: 1000, updated_at: '2026-01-01T00:00:00Z', ...extra };
}

test('itemContentHash is stable for identical items and changes on rename/size/files', () => {
  const a = movie(1, 'Inception.2010.1080p.BluRay.x264-GROUP');
  const b = movie(1, 'Inception.2010.1080p.BluRay.x264-GROUP');
  assert.strictEqual(diff.itemContentHash(a), diff.itemContentHash(b));

  assert.notStrictEqual(diff.itemContentHash(a), diff.itemContentHash(movie(1, 'Inception.2010.2160p.WEB-DL')));
  assert.notStrictEqual(diff.itemContentHash(a), diff.itemContentHash(movie(1, a.name, { size: 2000 })));
  assert.notStrictEqual(
    diff.itemContentHash(a),
    diff.itemContentHash(movie(1, a.name, { files: [{ id: 5, name: 'ep1.mkv', size: 10 }] }))
  );
});

test('itemContentHash ignores seeding upload progress (total_downloaded)', () => {
  // TorBox bumps total_downloaded on every poll while seeding. If it fed the
  // hash, the whole library re-pended (and every match was wiped) on every
  // 2-minute sync, starving version-stale re-resolves and invalidating every
  // catalog projection incl. rendered Pictorium posters.
  const a = movie(1, 'Show.S01E01.1080p.WEB', { total_downloaded: 1000 });
  const b = movie(1, 'Show.S01E01.1080p.WEB', { total_downloaded: 987654321 });
  assert.strictEqual(diff.itemContentHash(a), diff.itemContentHash(b));
});

test('deriveMediaType routes movies, series and anime to one namespace each', () => {
  assert.strictEqual(diff.deriveMediaType(movie(1, 'Inception.2010.1080p.BluRay.x264')), 'movie');
  assert.strictEqual(diff.deriveMediaType(movie(2, 'Breaking.Bad.S01E01.1080p.WEB')), 'series');
  assert.strictEqual(diff.deriveMediaType(movie(3, '[SubsPlease] Frieren - 01 (1080p) [GROUP]')), 'anime');
});

test('buildSearchText includes the parsed title, raw name and file names', () => {
  const item = { source: 'torrent', id: 7, name: 'Breaking.Bad.S01E01.1080p.WEB', files: [{ name: 'Breaking.Bad.S01E01.Pilot.mkv' }] };
  const parsed = diff.parsedFields(item);
  const text = diff.buildSearchText(item, parsed);
  assert.match(text, /breaking bad/);
  assert.match(text, /pilot/);
});

test('diffRecords reports added/changed/unchanged/removed without touching unchanged rows', () => {
  const existing = new Map([
    ['torbox\u00011', { content_hash: diff.itemContentHash(movie(1, 'Same.2020.1080p')), removed: false }],
    ['torbox\u00012', { content_hash: 'stale-hash', removed: false }],
    ['torbox\u00013', { content_hash: 'old-hash', removed: false }],
  ]);
  const incoming = [
    diff.buildRecord(movie(1, 'Same.2020.1080p'), '1'),   // unchanged
    diff.buildRecord(movie(2, 'Changed.2021.1080p'), '2'), // changed
    diff.buildRecord(movie(4, 'Brand.New.2024.1080p'), '4'), // added
  ];
  const result = diff.diffRecords(existing, incoming, diff.recordKey);
  assert.deepStrictEqual(result.counts, { scanned: 3, added: 1, changed: 1, unchanged: 1, removed: 1 });
  assert.strictEqual(result.toWrite.length, 2);
  const written = result.toWrite.map((r) => r.source_id).sort();
  assert.deepStrictEqual(written, ['2', '4']);
  assert.deepStrictEqual(result.removedKeys, ['torbox\u00013']);
});

test('a previously removed item that reappears is re-written (not left removed)', () => {
  const record = diff.buildRecord(movie(9, 'Back.Again.2020.1080p'), '9');
  const existing = new Map([['torbox\u00019', { content_hash: record.content_hash, removed: true }]]);
  const result = diff.diffRecords(existing, [record], diff.recordKey);
  assert.strictEqual(result.counts.changed, 1);
  assert.strictEqual(result.counts.removed, 0);
  assert.strictEqual(result.toWrite.length, 1);
});

test('indexed engine is the default core and only activates with a database', () => {
  const engine = require('../src/library/engine.ts');
  const savedEngine = process.env.LIBRARY_ENGINE;
  const savedDb = process.env.DATABASE_URL;
  try {
    delete process.env.LIBRARY_ENGINE;
    delete process.env.DATABASE_URL;
    assert.strictEqual(engine.mode(), 'indexed', 'default mode is indexed');
    assert.strictEqual(engine.isIndexed(), false, 'no database falls back to the legacy path');

    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/lelibrary';
    assert.strictEqual(engine.isIndexed(), true, 'a database is enough to select the index by default');

    process.env.LIBRARY_ENGINE = 'legacy';
    assert.strictEqual(engine.isIndexed(), false, 'explicit legacy opts out even with a database');
  } finally {
    if (savedEngine === undefined) delete process.env.LIBRARY_ENGINE; else process.env.LIBRARY_ENGINE = savedEngine;
    if (savedDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = savedDb;
  }
});

export interface LibraryIndexTestTestModule {};
