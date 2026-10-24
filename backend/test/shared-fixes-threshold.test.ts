// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const { sharedFixUsable } = require('../src/library/shared-fixes.ts');

// One person's fix must never reach another library on its own (a mistake or
// a deliberate wrong answer would spread). Two agreeing libraries may fill in
// a match that failed; overriding the matcher itself needs three.
test('a single vote is never used for another library', () => {
  assert.equal(sharedFixUsable({ votes: 1 }, 'on-failure'), false);
  assert.equal(sharedFixUsable({ votes: 1 }, 'before-resolver'), false);
});

test('two libraries can fill in a failed match, three can override the matcher', () => {
  assert.equal(sharedFixUsable({ votes: 2 }, 'on-failure'), true);
  assert.equal(sharedFixUsable({ votes: 2 }, 'before-resolver'), false);
  assert.equal(sharedFixUsable({ votes: 3 }, 'before-resolver'), true);
  assert.equal(sharedFixUsable(null, 'on-failure'), false);
});
