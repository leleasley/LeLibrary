// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  checkSiteverifyResult,
  turnstileConfigured,
  turnstileHostnames,
  turnstileRequestState,
  turnstileSecret,
  turnstileSiteKey,
  turnstileStartupLine,
  turnstileStatus,
  MAX_TOKEN_LENGTH,
} = require('../src/platform/turnstile.ts');

// Cloudflare's documented always-pass test site key (never a real key).
const TEST_SITE_KEY = '1x00000000000000000000AA';
const CLEAN = {
  TURNSTILE_SITE_KEY: undefined,
  TURNSTILE_SECRET: undefined,
  TURNSTILE_SECRET_KEY: undefined,
  TURNSTILE_HOSTNAMES: undefined,
  TURNSTILE_HOSTNAME: undefined,
  TURNSTILE_ENABLED: undefined,
  TURNSTILE_ALLOW_LOCALHOST: undefined,
};

function withEnv(input, fn) {
  const vars = { ...CLEAN, ...input };
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('unconfigured instances report not-configured (self-host safe)', () => {
  withEnv({ TURNSTILE_SECRET: undefined, TURNSTILE_HOSTNAMES: undefined }, () => {
    assert.equal(turnstileConfigured(), false);
    assert.equal(turnstileSecret(), '');
    assert.deepEqual(turnstileHostnames(), []);
  });
  withEnv({ TURNSTILE_SECRET: 's3cret', TURNSTILE_HOSTNAMES: undefined }, () => {
    assert.equal(turnstileConfigured(), false);
  });
  withEnv({ TURNSTILE_SECRET: undefined, TURNSTILE_HOSTNAMES: 'example.com' }, () => {
    assert.equal(turnstileConfigured(), false);
  });
  withEnv({ TURNSTILE_SITE_KEY: TEST_SITE_KEY, TURNSTILE_SECRET: 's3cret', TURNSTILE_HOSTNAMES: 'dev.example.com, example.com' }, () => {
    assert.equal(turnstileConfigured(), true);
    assert.deepEqual(turnstileHostnames(), ['dev.example.com', 'example.com']);
  });
  // TURNSTILE_SECRET_KEY is accepted as an alias for existing installs.
  withEnv({ TURNSTILE_SITE_KEY: TEST_SITE_KEY, TURNSTILE_SECRET: undefined, TURNSTILE_SECRET_KEY: 'k3y', TURNSTILE_HOSTNAMES: 'example.com' }, () => {
    assert.equal(turnstileConfigured(), true);
    assert.equal(turnstileSecret(), 'k3y');
  });
  // TURNSTILE_SECRET wins when both are set.
  withEnv({ TURNSTILE_SECRET: 's3cret', TURNSTILE_SECRET_KEY: 'k3y', TURNSTILE_HOSTNAMES: 'example.com' }, () => {
    assert.equal(turnstileSecret(), 's3cret');
  });
});

test('site key is empty unless set per environment', () => {
  withEnv({ TURNSTILE_SITE_KEY: undefined }, () => {
    assert.equal(turnstileSiteKey(), '');
  });
  withEnv({ TURNSTILE_SITE_KEY: TEST_SITE_KEY }, () => {
    assert.equal(turnstileSiteKey(), TEST_SITE_KEY);
  });
});

test('valid siteverify result passes with matching action and hostname', () => {
  const result = { success: true, action: 'save-config', hostname: 'dev.leleasley.uk' };
  assert.equal(checkSiteverifyResult(result, 'save-config', ['dev.leleasley.uk', 'lelibrary.uk']), true);
});

test('hostname matching is case-insensitive but exact', () => {
  const result = { success: true, action: 'save-config', hostname: 'DEV.LeLeasley.UK' };
  assert.equal(checkSiteverifyResult(result, 'save-config', ['dev.leleasley.uk']), true);
  assert.equal(checkSiteverifyResult(result, 'save-config', ['evil-dev.leleasley.uk']), false);
  assert.equal(checkSiteverifyResult(result, 'save-config', ['leleasley.uk']), false);
});

test('failed or mismatched results are rejected', () => {
  assert.equal(checkSiteverifyResult({ success: false }, 'save-config', ['a.com']), false);
  assert.equal(checkSiteverifyResult(null, 'save-config', ['a.com']), false);
  assert.equal(checkSiteverifyResult('ok', 'save-config', ['a.com']), false);
  // Wrong action (token minted for another surface)
  assert.equal(
    checkSiteverifyResult({ success: true, action: 'login', hostname: 'a.com' }, 'save-config', ['a.com']),
    false
  );
  // Wrong hostname
  assert.equal(
    checkSiteverifyResult({ success: true, action: 'save-config', hostname: 'localhost' }, 'save-config', ['lelibrary.uk']),
    false
  );
  // Missing hostname
  assert.equal(
    checkSiteverifyResult({ success: true, action: 'save-config' }, 'save-config', ['lelibrary.uk']),
    false
  );
  // Error codes from Cloudflare never pass
  assert.equal(
    checkSiteverifyResult({ success: false, 'error-codes': ['invalid-input-response'] }, 'save-config', ['a.com']),
    false
  );
});

test('token length cap matches the enforcement guard', () => {
  assert.equal(MAX_TOKEN_LENGTH, 2048);
  assert.ok('x'.repeat(2048).length <= MAX_TOKEN_LENGTH);
  assert.ok('x'.repeat(2049).length > MAX_TOKEN_LENGTH);
});

test('request state: enforced only for real hosts, with a localhost escape for dev', () => {
  const req = (host) => ({ headers: { host } });
  withEnv({ TURNSTILE_SITE_KEY: TEST_SITE_KEY, TURNSTILE_SECRET: 's3cret', TURNSTILE_HOSTNAMES: 'lelibrary.uk', TURNSTILE_ALLOW_LOCALHOST: undefined }, () => {
    assert.deepEqual(turnstileRequestState(req('lelibrary.uk')).enforced, true);
    assert.deepEqual(turnstileRequestState(req('localhost:7860')).enforced, true, 'no escape unless opted in');
  });
  withEnv({ TURNSTILE_SITE_KEY: TEST_SITE_KEY, TURNSTILE_SECRET: 's3cret', TURNSTILE_HOSTNAMES: 'lelibrary.uk', TURNSTILE_ALLOW_LOCALHOST: 'on' }, () => {
    for (const host of ['localhost:7861', '127.0.0.1:7861', '[::1]:7861']) {
      const state = turnstileRequestState(req(host));
      assert.equal(state.enforced, false, host);
      assert.equal(state.configured, true, host);
      // No widget for an exempt page: its buttons must not wait for a check.
      assert.equal(state.siteKey, '', host);
    }
    assert.equal(turnstileRequestState(req('dev.leleasley.uk')).enforced, true, 'the real domain stays protected');
    assert.equal(turnstileRequestState(req('dev.leleasley.uk')).siteKey, TEST_SITE_KEY);
    assert.equal(turnstileRequestState(req('lelibrary.uk')).enforced, true);
  });
  withEnv({ TURNSTILE_SECRET: undefined, TURNSTILE_HOSTNAMES: undefined, TURNSTILE_ALLOW_LOCALHOST: 'on' }, () => {
    const state = turnstileRequestState(req('lelibrary.uk'));
    assert.equal(state.enforced, false, 'self-host with no app: inert');
    assert.equal(state.configured, false);
    assert.equal(state.siteKey, '');
  });
});

test('configured needs the site key, the secret and hostnames', () => {
  const all = { TURNSTILE_SITE_KEY: TEST_SITE_KEY, TURNSTILE_SECRET: 's3cret', TURNSTILE_HOSTNAMES: 'lelibrary.uk' };
  withEnv(all, () => assert.equal(turnstileConfigured(), true));
  // A missing site key used to enforce anyway and 403 every unlock/create.
  withEnv({ ...all, TURNSTILE_SITE_KEY: undefined }, () => {
    assert.equal(turnstileConfigured(), false);
    assert.equal(turnstileStatus().reason, 'no site key');
    assert.equal(turnstileRequestState({ headers: { host: 'lelibrary.uk' } }).enforced, false);
  });
  withEnv({ ...all, TURNSTILE_SECRET: undefined }, () => assert.equal(turnstileStatus().reason, 'no secret'));
  withEnv({ ...all, TURNSTILE_HOSTNAMES: undefined }, () => assert.equal(turnstileStatus().reason, 'no hostnames'));
});

test('TURNSTILE_HOSTNAME (singular) is an alias; the plural wins', () => {
  const base = { TURNSTILE_SITE_KEY: TEST_SITE_KEY, TURNSTILE_SECRET_KEY: 's3cret' };
  withEnv({ ...base, TURNSTILE_HOSTNAME: 'lelibrary.uk' }, () => {
    assert.equal(turnstileConfigured(), true);
    assert.deepEqual(turnstileHostnames(), ['lelibrary.uk']);
  });
  withEnv({ ...base, TURNSTILE_HOSTNAME: 'lelibrary.uk, www.lelibrary.uk' }, () => {
    assert.deepEqual(turnstileHostnames(), ['lelibrary.uk', 'www.lelibrary.uk']);
  });
  withEnv({ ...base, TURNSTILE_HOSTNAMES: 'dev.example.com', TURNSTILE_HOSTNAME: 'lelibrary.uk' }, () => {
    assert.deepEqual(turnstileHostnames(), ['dev.example.com']);
  });
});

test('TURNSTILE_ENABLED is an optional kill switch', () => {
  const all = { TURNSTILE_SITE_KEY: TEST_SITE_KEY, TURNSTILE_SECRET: 's3cret', TURNSTILE_HOSTNAMES: 'lelibrary.uk' };
  for (const off of ['off', 'false', '0', 'OFF', ' False ']) {
    withEnv({ ...all, TURNSTILE_ENABLED: off }, () => {
      assert.equal(turnstileConfigured(), false, off);
      assert.equal(turnstileStatus().reason, 'disabled', off);
      const state = turnstileRequestState({ headers: { host: 'lelibrary.uk' } });
      assert.equal(state.enforced, false, off);
      assert.equal(state.siteKey, '', off);
    });
  }
  for (const on of ['true', 'on', '1', 'yes', '']) {
    withEnv({ ...all, TURNSTILE_ENABLED: on }, () => assert.equal(turnstileConfigured(), true, on));
  }
  // The switch never turns on an instance that lacks keys.
  withEnv({ TURNSTILE_ENABLED: 'true' }, () => assert.equal(turnstileConfigured(), false));
});

test('startup line says on/off and why, never a value', () => {
  const all = { TURNSTILE_SITE_KEY: TEST_SITE_KEY, TURNSTILE_SECRET: 'synthetic-secret-value', TURNSTILE_HOSTNAMES: 'lelibrary.uk,dev.example.com' };
  withEnv(all, () => {
    const line = turnstileStartupLine();
    assert.equal(line, '[Turnstile] enabled for 2 hostname(s)');
    for (const value of [TEST_SITE_KEY, 'synthetic-secret-value', 'lelibrary.uk']) assert.ok(!line.includes(value));
  });
  withEnv({}, () => assert.equal(turnstileStartupLine(), '[Turnstile] off (no site key)'));
  withEnv({ ...all, TURNSTILE_SECRET: undefined }, () => assert.equal(turnstileStartupLine(), '[Turnstile] off (no secret)'));
  withEnv({ ...all, TURNSTILE_HOSTNAMES: undefined }, () => assert.equal(turnstileStartupLine(), '[Turnstile] off (no hostnames)'));
  withEnv({ ...all, TURNSTILE_ENABLED: 'off' }, () => assert.equal(turnstileStartupLine(), '[Turnstile] off (disabled)'));
});

test('boot data ships the site key only where the gate is enforced', () => {
  const createWebRoutes = require('../src/routes/website.ts');
  const all = { TURNSTILE_SITE_KEY: TEST_SITE_KEY, TURNSTILE_SECRET: 's3cret', TURNSTILE_HOSTNAMES: 'lelibrary.uk', TURNSTILE_ALLOW_LOCALHOST: 'on' };
  withEnv(all, () => {
    assert.equal(createWebRoutes.bootData({ headers: { host: 'lelibrary.uk' } }).features.turnstileSiteKey, TEST_SITE_KEY);
    assert.equal(createWebRoutes.bootData({ headers: { host: 'localhost:7861' } }).features.turnstileSiteKey, '');
  });
  withEnv({ ...all, TURNSTILE_SECRET: undefined }, () => {
    assert.equal(createWebRoutes.bootData({ headers: { host: 'lelibrary.uk' } }).features.turnstileSiteKey, '');
  });
});

export interface TurnstileTestTestModule {};
