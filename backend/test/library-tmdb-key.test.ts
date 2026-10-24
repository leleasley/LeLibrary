const test = require('node:test');
const assert = require('node:assert/strict');
const tmdbKey = require('../src/library/tmdb-key.ts');

test('a missing key is reported without calling TMDB', async () => {
  tmdbKey.reset();
  let calls = 0;
  assert.equal(await tmdbKey.check('', { fetch: async () => { calls++; return 'ok'; } }), 'missing');
  assert.equal(await tmdbKey.check(null), 'missing');
  assert.equal(calls, 0);
});

test('one check per key while cached', async () => {
  tmdbKey.reset();
  let calls = 0;
  const fetch = async () => { calls++; return 'rejected' as const; };
  assert.equal(await tmdbKey.check('synthetic-key-1', { fetch }), 'rejected');
  assert.equal(await tmdbKey.check('synthetic-key-1', { fetch }), 'rejected');
  assert.equal(calls, 1);
});

test('a network error is unknown, never a key problem', async () => {
  tmdbKey.reset();
  assert.equal(await tmdbKey.check('synthetic-key-2', { fetch: async () => { throw new Error('ETIMEDOUT'); } }), 'unknown');
});

test('scope state: only missing and rejected are problems; previous state is returned', () => {
  tmdbKey.reset();
  assert.equal(tmdbKey.noteScope('scope-a', 'rejected'), null);
  assert.equal(tmdbKey.scopeProblem('scope-a'), 'rejected');
  assert.equal(tmdbKey.noteScope('scope-a', 'ok'), 'rejected');
  assert.equal(tmdbKey.scopeProblem('scope-a'), null);
  tmdbKey.noteScope('scope-b', 'unknown');
  assert.equal(tmdbKey.scopeProblem('scope-b'), null);
});
