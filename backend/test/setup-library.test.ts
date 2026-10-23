'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { mountSetupLibraryRoutes } = require('../src/routes/setup-library.ts');
const { createEditSessionStore } = require('../src/setup/edit-sessions.ts');
const review = require('../src/library/review.ts');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER = '223e4567-e89b-42d3-a456-426614174000';

async function withApp(fn: (base: string, sessions: any) => Promise<void>) {
  const sessions = createEditSessionStore();
  const app = express();
  mountSetupLibraryRoutes(app, { editSessions: sessions });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/setup`;
  try { await fn(base, sessions); } finally { server.close(); }
}

test('resolver failure codes become label keys and never leak detail', () => {
  assert.equal(review.reasonCode('no-candidate [title=Some Show]'), 'no-candidate');
  assert.equal(review.reasonCode('ambiguous-candidate []'), 'ambiguous-candidate');
  assert.equal(review.reasonCode('season-missing [title-downgrade]'), 'season-missing');
  assert.equal(review.reasonCode('ECONNRESET socket hang up'), 'other');
  assert.equal(review.reasonCode(null), null);
});

test('every library route needs this setup\'s own edit token', async () => {
  await withApp(async (base: string, sessions: any) => {
    const other = sessions.issue(OTHER).token;
    const calls = [
      ['GET', `${base}/${UUID}/library`],
      ['GET', `${base}/${UUID}/library/items?view=attention`],
      ['GET', `${base}/${UUID}/library/search?q=x`],
      ['POST', `${base}/${UUID}/library/items/1/fix`],
      ['POST', `${base}/${UUID}/library/items/1/ignore`],
      ['DELETE', `${base}/${UUID}/library/items/1/fix`],
      ['POST', `${base}/${UUID}/library/retry`],
    ];
    for (const [method, url] of calls) {
      const none = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
      assert.equal(none.status, 401, `${method} ${url} without a token`);
      assert.equal(none.headers.get('cache-control'), 'no-store');
      const wrong = await fetch(url, { method, headers: { authorization: `Bearer ${other}`, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
      assert.equal(wrong.status, 401, `${method} ${url} with another setup's token`);
    }
    const bad = await fetch(`${base}/not-a-uuid/library`);
    assert.equal(bad.status, 400);
  });
});

const shared = require('../src/library/shared-fixes.ts');

test('shared fixes are keyed by info hash and exact name, never by a bare hash name', () => {
  const hash = '056a0046e5b742740e1d8175bef66029f257a302';
  assert.deepEqual(shared.releaseKeys({ hash: hash.toUpperCase() }, hash), { hash, name: null });
  assert.deepEqual(shared.releaseKeys({}, '  The.Office.US.S05   1080p '), { hash: null, name: 'the.office.us.s05 1080p' });
  assert.deepEqual(shared.releaseKeys({}, 'x.mkv'), { hash: null, name: null });
});

test('a shared fix needs a strict majority; ties help nobody', () => {
  const fix = (tmdbId: number, votes: number) => ({ tmdbId, mediaType: 'series', season: 7, episode: null, votes });
  assert.equal(shared.chooseConsensus([fix(1, 1)])?.tmdbId, 1);
  assert.equal(shared.chooseConsensus([fix(1, 2), fix(2, 1)])?.tmdbId, 1);
  assert.equal(shared.chooseConsensus([fix(1, 1), fix(2, 1)]), null);
  assert.equal(shared.chooseConsensus([]), null);
});

test('library votes are one-way hashes of the library id', () => {
  const voter = shared.voterFor('451786d00ac7');
  assert.match(voter, /^[a-f0-9]{24}$/);
  assert.ok(!voter.includes('451786d00ac7'));
  assert.equal(voter, shared.voterFor('451786d00ac7'));
});

export interface SetupLibraryTestModule {};
