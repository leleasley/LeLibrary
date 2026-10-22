// @ts-nocheck
'use strict';
// Token-scoped /:token/configure links (Stremio/Nuvio Configure buttons on
// older cached manifests) must land on the setup's own UUID page — password
// gate plus tier surface — never the generic picker.
const test = require('node:test');
const assert = require('node:assert/strict');

const { configureRedirectTarget } = require('../src/routes/website.ts');

function tagged(scope) {
  const config = { provider: 'torbox' };
  Object.defineProperty(config, '__configScope', { value: scope });
  return config;
}

test('v5.5 setups redirect to their own uuid page', () => {
  assert.equal(
    configureRedirectTarget(tagged({ type: 'config', uuid: '74f4acea-c1b3-4591-8a8e-c486aa819c91', tier: 'quick' })),
    '/74f4acea-c1b3-4591-8a8e-c486aa819c91',
  );
});

test('legacy configs fall through to the setup flow', () => {
  assert.equal(configureRedirectTarget(tagged({ type: 'legacy' })), '/configure');
  assert.equal(configureRedirectTarget({ provider: 'torbox' }), '/configure');
});

test('unresolvable tokens get null so the caller can 400', () => {
  assert.equal(configureRedirectTarget(null), null);
  assert.equal(configureRedirectTarget(undefined), null);
  assert.equal(configureRedirectTarget('bogus'), null);
});

test('malformed scopes never produce a uuid link', () => {
  assert.equal(configureRedirectTarget(tagged({ type: 'config' })), '/configure');
  assert.equal(configureRedirectTarget(tagged({ type: 'config', uuid: 42 })), '/configure');
  assert.equal(configureRedirectTarget(tagged(null)), '/configure');
});
