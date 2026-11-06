// @ts-nocheck
'use strict';
// The report-only CSP must allow Turnstile on the pages that show it (the
// tier pages and the /{uuid} edit page), and must stay report-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { securityHeaders, CSP_DIRECTIVES } = require('../src/middleware/security-headers.ts');

function run(path, accept = 'text/html') {
  const headers = {};
  const req = { method: 'GET', path, headers: { accept } };
  const res = { setHeader: (name, value) => { headers[name] = value; } };
  let nexted = false;
  securityHeaders(req, res, () => { nexted = true; });
  assert.equal(nexted, true);
  return headers;
}

test('the policy lists Cloudflare Turnstile for scripts and frames', () => {
  const script = CSP_DIRECTIVES.find((d) => d.startsWith('script-src '));
  const frame = CSP_DIRECTIVES.find((d) => d.startsWith('frame-src '));
  assert.ok(script.split(' ').includes('https://challenges.cloudflare.com'));
  assert.ok(frame.split(' ').includes('https://challenges.cloudflare.com'));
});

test('report-only on the password screens, never enforcing, never on addon JSON', () => {
  for (const path of ['/configure', '/configure/quick', '/123e4567-e89b-12d3-a456-426614174000']) {
    const headers = run(path);
    assert.ok(headers['Content-Security-Policy-Report-Only'], path);
    assert.equal(headers['Content-Security-Policy'], undefined, path);
  }
  assert.equal(run('/123e4567-e89b-12d3-a456-426614174000/manifest.json', 'application/json')['Content-Security-Policy-Report-Only'], undefined);
  assert.equal(run('/not-a-setup')['Content-Security-Policy-Report-Only'], undefined);
});

export interface SecurityHeadersTurnstileTestModule {};
