// @ts-nocheck
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readPush,
  readWatchlist,
  validatePushConnection,
  mergePushKeys,
  mergeWatchlistKeys,
  dropEnvelopeKey,
  setupWatchlistConn,
} = require('../src/setup/connections.ts');

function openedWith(keys) {
  return { uuid: 'uuid-1', tier: 'full', name: null, config: {}, keys, hasPassword: false, secret: null, createdAt: null, updatedAt: null };
}

test('push and watchlist envelopes read back what was sealed', () => {
  const opened = openedWith({
    push: { nuvio: { nuvioToken: 'tok', nuvioSelectedProfile: 2 } },
    watchlist: { simkl: { access_token: 'simkl-token' } },
  });
  assert.deepEqual(readPush(opened, 'nuvio'), { nuvioToken: 'tok', nuvioSelectedProfile: 2 });
  assert.equal(readPush(opened, 'stremio'), null);
  assert.deepEqual(readWatchlist(opened, 'simkl'), { access_token: 'simkl-token' });
  assert.equal(readWatchlist(opened, 'trakt'), null);
  assert.equal(readPush(null, 'nuvio'), null);
  assert.equal(readWatchlist(openedWith({}), 'simkl'), null);
});

test('connections validate by platform', () => {
  assert.equal(validatePushConnection('stremio', { stremioAuth: 'key' }), null);
  assert.equal(validatePushConnection('stremio', {}), 'Stremio did not return a session token');
  assert.equal(validatePushConnection('nuvio', { nuvioToken: 'tok' }), null);
  assert.equal(validatePushConnection('nuvio', { nuvioToken: '  ' }), 'Nuvio did not return a session token');
  assert.equal(validatePushConnection('plex', {}), 'Unknown platform');
});

test('envelope merges keep the other platform/provider', () => {
  const current = { push: { stremio: { stremioAuth: 'a' } }, watchlist: { simkl: { access_token: 's' } } };
  const merged = mergePushKeys(current, 'nuvio', { nuvioToken: 'n' });
  assert.deepEqual(merged.push.stremio, { stremioAuth: 'a' });
  assert.deepEqual(merged.push.nuvio, { nuvioToken: 'n' });
  const mergedWl = mergeWatchlistKeys(current, 'trakt', { access_token: 't' });
  assert.deepEqual(mergedWl.watchlist.simkl, { access_token: 's' });
  assert.deepEqual(mergedWl.watchlist.trakt, { access_token: 't' });
  const dropped = dropEnvelopeKey(merged, 'push', 'nuvio');
  assert.deepEqual(dropped.push, { stremio: { stremioAuth: 'a' } });
});

test('setup watchlist reads resolve install tokens without network', async () => {
  const store = {
    async resolveByToken(token) {
      if (token === 'uuid.secret') return openedWith({ watchlist: { simkl: { access_token: 'live' } } });
      return null;
    },
    async resolveByUuid() { return null; },
    async save() { return null; },
  };
  assert.deepEqual(await setupWatchlistConn(store, 'uuid.secret', 'simkl'), { access_token: 'live' });
  assert.equal(await setupWatchlistConn(store, 'uuid.secret', 'trakt'), null);
  assert.equal(await setupWatchlistConn(store, 'nope', 'simkl'), null);
});
