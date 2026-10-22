// @ts-nocheck
// Phase 2 fix 1: catalog result cache keyed on projection-change fingerprint,
// not lastSyncAt, so unchanged syncs keep serving cached pages.
// Tests: key stability, invalidation on change, user isolation. No DB needed.
const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../src/library/engine.ts');

test('catalog result key is stable for an unchanged projection', () => {
  const a = engine.catalogResultKey('userA', 0, 3, 'fp123');
  const b = engine.catalogResultKey('userA', 0, 3, 'fp123');
  assert.equal(a, b);
});

test('catalog result key changes when the projection changes', () => {
  const before = engine.catalogResultKey('userA', 1000, 3, 'fp123');
  const after = engine.catalogResultKey('userA', 2000, 3, 'fp123');
  assert.notEqual(before, after);
});

test('catalog result key isolates users', () => {
  const a = engine.catalogResultKey('userA', 1000, 3, 'fp123');
  const b = engine.catalogResultKey('userB', 1000, 3, 'fp123');
  assert.notEqual(a, b);
});

test('catalog result key includes the identity version', () => {
  const a = engine.catalogResultKey('userA', 1000, 3, 'fp123');
  const b = engine.catalogResultKey('userA', 1000, 4, 'fp123');
  assert.notEqual(a, b);
});

test('noteProjectionChange bumps the scope fingerprint', () => {
  engine._registry.set('fpscope', { scopeId: 'fpscope', catalogFp: 0 });
  const before = engine.catalogResultKey('fpscope', engine._registry.get('fpscope').catalogFp, 0, 'fp');
  engine.noteProjectionChange('fpscope');
  const rec = engine._registry.get('fpscope');
  assert.ok(rec.catalogFp > 0);
  const after = engine.catalogResultKey('fpscope', rec.catalogFp, 0, 'fp');
  assert.notEqual(before, after);
  engine._registry.delete('fpscope');
});

test('noteProjectionChange on an unknown scope does not throw', () => {
  assert.doesNotThrow(() => engine.noteProjectionChange('no-such-scope'));
});
