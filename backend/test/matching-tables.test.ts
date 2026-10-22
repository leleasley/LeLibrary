// @ts-nocheck
// Pure unit tests for the matching tables: split-season maps and title
// redirects. No database, no network.
const test = require('node:test');
const assert = require('node:assert');

const tables = require('../src/matching/tables.ts');

test('split seasons map TVDB numbering under both TMDB entries', () => {
  assert.deepEqual(tables.lookupSplitSeason(11294, 8), { tmdbId: 235884, season: 1 });
  assert.deepEqual(tables.lookupSplitSeason(11294, 9), { tmdbId: 235884, season: 2 });
  assert.deepEqual(tables.lookupSplitSeason(11294, 10), { tmdbId: 235884, season: 3 });
  assert.deepEqual(tables.lookupSplitSeason(235884, 8), { tmdbId: 235884, season: 1 });
  assert.deepEqual(tables.lookupSplitSeason(235884, 9), { tmdbId: 235884, season: 2 });
  assert.deepEqual(tables.lookupSplitSeason(235884, 10), { tmdbId: 235884, season: 3 });
  assert.equal(tables.lookupSplitSeason(235884, 2), null);
  assert.equal(tables.lookupSplitSeason(11294, 7), null);
  assert.equal(tables.lookupSplitSeason(999999, 10), null);
  assert.equal(tables.lookupSplitSeason(null, 10), null);
});

test('title redirect catches the Lizzie Borden split entry', () => {
  const hit = tables.lookupTitleRedirect(
    'Monster.S04.The.Lizzie.Borden.Story.Complete.1080p.WEBRip.x265-NeoNoir',
    'Monster',
    4,
  );
  assert.deepEqual(hit, { tmdbId: 299939, season: 1, name: 'Monster: The Lizzie Borden Story' });
  // Full return shape matters: the name patch reads every field.
  assert.equal(typeof hit.name, 'string');
  assert.equal(tables.lookupTitleRedirect('Monster.S03.Complete.1080p', 'Monster', 3), null);
  assert.equal(tables.lookupTitleRedirect('Monster.S04.Something.Else.1080p', 'Monster', 4), null);
  assert.equal(tables.lookupTitleRedirect('Breaking.Bad.S04.1080p', 'Breaking Bad', 4), null);
});

test('table version is a stable short hash', () => {
  assert.match(tables.tableVersion(), /^[0-9a-f]{12}$/);
});

test('MATCH_TABLES env merges per show without wiping built-ins', () => {
  process.env.MATCH_TABLES = JSON.stringify({
    splitSeasons: { 12345: { 2: { tmdbId: 54321, season: 1 } } },
  });
  tables.resetTablesForTests();
  try {
    assert.deepEqual(tables.lookupSplitSeason(12345, 2), { tmdbId: 54321, season: 1 });
    assert.deepEqual(tables.lookupSplitSeason(235884, 10), { tmdbId: 235884, season: 3 });
  } finally {
    delete process.env.MATCH_TABLES;
    tables.resetTablesForTests();
  }
});
