// @ts-nocheck
'use strict';
// The report-only CSP must allow Turnstile on the pages that show it (the
// tier pages and the /{uuid} edit page), and must stay report-only: the only
// enforced directive is frame-ancestors (test/csp-headers.test.ts).
const test = require('node:test');
const assert = require('node:assert/strict');
const { CSP_DIRECTIVES, REPORT_ONLY_POLICY, FRAME_ANCESTORS_POLICY } = require('../src/middleware/security-headers.ts');

test('the policy lists Cloudflare Turnstile for scripts and frames', () => {
  const script = CSP_DIRECTIVES.find((d) => d.startsWith('script-src '));
  const frame = CSP_DIRECTIVES.find((d) => d.startsWith('frame-src '));
  assert.ok(script.split(' ').includes('https://challenges.cloudflare.com'));
  assert.ok(frame.split(' ').includes('https://challenges.cloudflare.com'));
  assert.ok(REPORT_ONLY_POLICY.includes("script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com"));
});

test('the enforced policy is anti-framing only', () => {
  assert.equal(FRAME_ANCESTORS_POLICY, "frame-ancestors 'self'");
});

export interface SecurityHeadersTurnstileTestModule {};
