// @ts-nocheck
'use strict';
// The self-host access gate is shared by the legacy saved-configs routes and
// the v5.5 setup list. It is env-driven at call time so tests and restarts see
// the current secret, and the cookie value is derived (never stored).
const test = require('node:test');
const assert = require('node:assert/strict');

const access = require('../src/platform/selfhost-access.ts');

function withEnv(vars, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('unset secret disables the gate and the list', () => {
  withEnv({ SELFHOST_CONFIGS_SECRET: undefined, SELFHOST_LIST_SETUPS: undefined }, () => {
    assert.equal(access.configured(), false);
    assert.equal(access.listEnabled(), false);
    assert.equal(access.cookieValue(), '');
    assert.equal(access.authorized({ get: () => undefined }), false);
  });
});

test('SELFHOST_LIST_SETUPS=off keeps the gate but hides the list', () => {
  withEnv({ SELFHOST_CONFIGS_SECRET: 'test-secret', SELFHOST_LIST_SETUPS: 'off' }, () => {
    assert.equal(access.configured(), true);
    assert.equal(access.listEnabled(), false);
  });
  withEnv({ SELFHOST_CONFIGS_SECRET: 'test-secret', SELFHOST_LIST_SETUPS: undefined }, () => {
    assert.equal(access.listEnabled(), true);
  });
});

test('header and cookie authorize, wrong values do not', () => {
  withEnv({ SELFHOST_CONFIGS_SECRET: 'test-secret', SELFHOST_LIST_SETUPS: 'on' }, () => {
    const byHeader = access.authorized({
      get: (name) => (name === 'x-selfhost-secret' ? 'test-secret' : undefined),
    });
    assert.equal(byHeader, true);

    const cookie = `other=1; ${access.COOKIE_NAME}=${access.cookieValue()}`;
    const byCookie = access.authorized({
      get: (name) => (name === 'cookie' ? cookie : undefined),
    });
    assert.equal(byCookie, true);

    assert.equal(access.authorized({ get: () => 'nope' }), false);
    assert.equal(
      access.authorized({ get: (name) => (name === 'x-selfhost-secret' ? 'wrong-secret' : undefined) }),
      false,
    );
  });
});

test('the cookie value is derived from the secret, not a constant', () => {
  const first = withEnv({ SELFHOST_CONFIGS_SECRET: 'one' }, () => access.cookieValue());
  const second = withEnv({ SELFHOST_CONFIGS_SECRET: 'two' }, () => access.cookieValue());
  assert.notEqual(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});

export interface SelfhostAccessTestModule {}
