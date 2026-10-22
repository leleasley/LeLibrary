// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  toIsoDate,
  isIsoDate,
  addDays,
  daysBetween,
  dateWindow,
  normalizeRegion,
  parseAllowedRegions,
  normalizeQuery,
  normalizeSearchKey,
  parsePage,
} = require('../src/releases/validate.ts');

test('toIsoDate / isIsoDate', () => {
  assert.equal(toIsoDate(new Date('2026-03-05T12:00:00Z')), '2026-03-05');
  assert.equal(isIsoDate('2026-03-05'), true);
  assert.equal(isIsoDate('2026-13-40'), false);
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(isIsoDate('05/03/2026'), false);
  assert.equal(isIsoDate(20260305), false);
});

test('addDays and daysBetween cross month/year and DST-free UTC', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-01-01', '2026-01-08'), 7);
  assert.equal(daysBetween('2026-01-08', '2026-01-01'), -7);
});

test('dateWindow spans the configured past/future', () => {
  assert.deepEqual(dateWindow('2026-06-15', 7, 14), { from: '2026-06-08', to: '2026-06-29' });
  assert.deepEqual(dateWindow('2026-06-15', -7, -14), { from: '2026-06-08', to: '2026-06-29' });
});

test('normalizeRegion is uppercase, two letters and allow-listed', () => {
  assert.equal(normalizeRegion('gb', ['GB', 'US']), 'GB');
  assert.equal(normalizeRegion(' us ', ['GB', 'US']), 'US');
  assert.equal(normalizeRegion('FR', ['GB', 'US']), null);
  assert.equal(normalizeRegion('GBR', ['GB', 'US']), null);
  assert.equal(normalizeRegion('1B', ['GB', 'US']), null);
  assert.equal(normalizeRegion(undefined, ['GB', 'US']), null);
});

test('parseAllowedRegions dedupes, normalises and falls back', () => {
  assert.deepEqual(parseAllowedRegions('gb, us, GB,fr', ['GB']), ['GB', 'US', 'FR']);
  assert.deepEqual(parseAllowedRegions('', ['GB', 'US']), ['GB', 'US']);
  assert.deepEqual(parseAllowedRegions('nonsense', ['GB', 'US']), ['GB', 'US']);
});

test('normalizeQuery trims, collapses and bounds', () => {
  assert.equal(normalizeQuery('  wicked   part  two '), 'wicked part two');
  assert.equal(normalizeQuery('a'), null);
  assert.equal(normalizeQuery(''), null);
  assert.equal(normalizeQuery('x'.repeat(101)), null);
  assert.equal(normalizeQuery('ok'), 'ok');
});

test('normalizeSearchKey is a stable cache key', () => {
  assert.equal(normalizeSearchKey('  The   Matrix '), 'the matrix');
});

test('parsePage defaults, validates and computes offset', () => {
  assert.deepEqual(parsePage(undefined, 24, 20), { page: 1, pageSize: 24, offset: 0, error: null });
  assert.deepEqual(parsePage('3', 24, 20), { page: 3, pageSize: 24, offset: 48, error: null });
  assert.equal(parsePage('0', 24, 20).error !== null, true);
  assert.equal(parsePage('21', 24, 20).error !== null, true);
  assert.equal(parsePage('abc', 24, 20).error !== null, true);
  assert.equal(parsePage('2.5', 24, 20).error !== null, true);
});
