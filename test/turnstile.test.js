const test = require('node:test');
const assert = require('node:assert/strict');

const {
  checkSiteverifyResult,
  turnstileConfigured,
  turnstileHostnames,
  turnstileSecret,
  turnstileSiteKey,
  MAX_TOKEN_LENGTH,
} = require('../src/turnstile');

function withEnv(vars, fn) {
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
  withEnv({ TURNSTILE_SECRET: 's3cret', TURNSTILE_HOSTNAMES: 'dev.example.com, example.com' }, () => {
    assert.equal(turnstileConfigured(), true);
    assert.deepEqual(turnstileHostnames(), ['dev.example.com', 'example.com']);
  });
  // TURNSTILE_SECRET_KEY is accepted as an alias for existing installs.
  withEnv({ TURNSTILE_SECRET: undefined, TURNSTILE_SECRET_KEY: 'k3y', TURNSTILE_HOSTNAMES: 'example.com' }, () => {
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
  withEnv({ TURNSTILE_SITE_KEY: '0x4AAAAAAEfDZVO9Um6M5eiN' }, () => {
    assert.equal(turnstileSiteKey(), '0x4AAAAAAEfDZVO9Um6M5eiN');
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
