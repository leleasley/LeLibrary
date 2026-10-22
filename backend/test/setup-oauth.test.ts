// @ts-nocheck
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  oauthConfigured,
  callbackUrl,
  authorizeUrl,
  createPendingOAuth,
  consumePendingOAuth,
  popupPage,
  popupPageWithTokens,
} = require('../src/setup/oauth.ts');

test('oauth is configured only for simkl/trakt with both env vars', () => {
  assert.equal(oauthConfigured('github'), false);
  assert.equal(typeof oauthConfigured('simkl'), 'boolean');
  assert.equal(typeof oauthConfigured('trakt'), 'boolean');
});

test('pending states are single-use and expire', () => {
  const now = 1_000_000;
  const { state } = createPendingOAuth('uuid-1', 'simkl', now);
  assert.ok(typeof state === 'string' && state.length > 10);
  assert.deepEqual(consumePendingOAuth(state, now + 1000), { uuid: 'uuid-1', provider: 'simkl' });
  assert.equal(consumePendingOAuth(state, now + 1000), null);
  const late = createPendingOAuth('uuid-2', 'trakt', now);
  assert.equal(consumePendingOAuth(late.state, now + 11 * 60 * 1000), null);
  assert.equal(consumePendingOAuth('bogus', now), null);
  assert.equal(consumePendingOAuth(null, now), null);
});

test('authorize urls point at the providers with the setup callback', () => {
  const simkl = authorizeUrl('simkl', 'state-1', 'https://example.test');
  assert.ok(simkl.startsWith('https://simkl.com/oauth/authorize?'));
  assert.ok(simkl.includes('state-1'));
  assert.ok(simkl.includes(encodeURIComponent('https://example.test/api/setup/oauth/simkl/callback')));
  const trakt = authorizeUrl('trakt', 'state-2', 'https://example.test');
  assert.ok(trakt.startsWith('https://trakt.tv/oauth/authorize?'));
  assert.equal(callbackUrl('trakt', 'https://example.test'), 'https://example.test/api/setup/oauth/trakt/callback');
});

test('popup page signals the opener and closes itself', () => {
  const ok = popupPage('simkl', true, 'done');
  assert.ok(ok.includes('postMessage'));
  assert.ok(ok.includes('window.close'));
  const bad = popupPage('trakt', false, '<oops>');
  assert.ok(bad.includes('&lt;oops&gt;'));
  assert.ok(!bad.includes('<oops>'));
});

test('pre-creation pendings bind no UUID and the token page posts tokens', () => {
  const now = 2_000_000;
  const { state } = createPendingOAuth(null, 'trakt', now);
  assert.deepEqual(consumePendingOAuth(state, now + 1000), { uuid: null, provider: 'trakt' });
  assert.equal(consumePendingOAuth(state, now + 1000), null);
  const page = popupPageWithTokens('trakt', { access_token: 'tok<123>', refresh_token: 'ref', client_id: 'cid' });
  assert.ok(page.includes('lelibraryWatchlistTokens'));
  assert.ok(page.includes('tok\\u003c123'));
  assert.ok(!page.includes('tok<123>'));
  assert.ok(page.includes('window.close'));
});
