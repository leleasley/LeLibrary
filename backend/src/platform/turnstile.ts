// Cloudflare Turnstile bot protection (managed widget, shown on the password
// screens).
//
// Scope (v6): the password-bearing endpoints, POST /api/setup/:uuid/unlock and
// POST /api/setup (create). The old /api/save-config gate stays for legacy
// clients. The 20/min per-IP and 5-wrong-per-setup lockout remain underneath,
// so a blocked bot check never replaces them.
//
// Env-driven so dev and prod carry different widgets:
//   TURNSTILE_SITE_KEY  - public site key, shipped in the page boot data so the
//                         configure/edit pages can render the widget
//   TURNSTILE_SECRET / TURNSTILE_SECRET_KEY - private widget secret,
//                         server-side siteverify only. NEVER exposed to the
//                         browser. Absent = Turnstile is inert (self-hosters
//                         and pre-secret dev are untouched).
//   TURNSTILE_HOSTNAMES - comma-separated frontend hostnames the token must
//                         have been issued for (e.g. "dev.leleasley.uk").
//                         TURNSTILE_HOSTNAME (singular) is accepted as an
//                         alias; the plural wins when both are set.
//                         Production must NOT include localhost/127.0.0.1.
//   TURNSTILE_ENABLED   - optional kill switch: off/false/0 turns Turnstile
//                         fully off (no widget, no check). Anything else, or
//                         absent, means on whenever the three values above
//                         are present.
//   TURNSTILE_ALLOW_LOCALHOST - DEV/TEST ONLY: requests whose Host is
//                         localhost/127.0.0.1 skip enforcement. Never on a
//                         shared instance.
//
// Contract (mirrors developers.cloudflare.com/turnstile/spin): the browser
// gets a token from the managed widget and POSTs it as `cf-turnstile-response`;
// the existing handler calls verifyTurnstile() BEFORE its own logic and
// requires success + expected action + approved hostname. Tokens are
// single-use: the frontend resets its widget after every attempt.
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;

function turnstileSecret() {
  // Accept TURNSTILE_SECRET_KEY as well: existing installs already carry the
  // secret under that name. TURNSTILE_SECRET wins when both are set.
  const secret = String(process.env.TURNSTILE_SECRET || process.env.TURNSTILE_SECRET_KEY || '').trim();
  return secret || '';
}

function turnstileSiteKey() {
  const key = String(process.env.TURNSTILE_SITE_KEY || '').trim();
  return key || '';
}

function turnstileHostnames() {
  return String(process.env.TURNSTILE_HOSTNAMES || process.env.TURNSTILE_HOSTNAME || '')
    .split(',')
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean);
}

function turnstileKillSwitch() {
  const value = String(process.env.TURNSTILE_ENABLED ?? '').trim().toLowerCase();
  return value === 'off' || value === 'false' || value === '0';
}

// Why Turnstile is on or off, without any values. The site key is required
// too: without it the page cannot render a widget, so enforcing would refuse
// every unlock and create.
function turnstileStatus(): { enabled: boolean; reason: string; hostnames: number } {
  const hostnames = turnstileHostnames().length;
  let reason = '';
  if (turnstileKillSwitch()) reason = 'disabled';
  else if (!turnstileSiteKey()) reason = 'no site key';
  else if (!turnstileSecret()) reason = 'no secret';
  else if (!hostnames) reason = 'no hostnames';
  return { enabled: !reason, reason, hostnames };
}

// True when the page can render the widget AND the server can verify its
// tokens. Everything else keys off this: unconfigured instances skip both the
// widget (no site key shipped) and enforcement (requests proceed exactly as
// before).
function turnstileConfigured() {
  return turnstileStatus().enabled;
}

// The one startup line: state and hostname count, never a key or hostname.
function turnstileStartupLine() {
  const status = turnstileStatus();
  return status.enabled
    ? `[Turnstile] enabled for ${status.hostnames} hostname(s)`
    : `[Turnstile] off (${status.reason})`;
}

// Local/test escape hatch (TURNSTILE_ALLOW_LOCALHOST=on, DEV ONLY): requests
// whose Host is localhost/127.0.0.1 skip enforcement, so Playwright and
// curl against localhost:7861 work while the real domain stays protected.
// Production must never set it: direct Host-header spoofing would bypass the
// gate if the app port is reachable.
function turnstileAllowLocalhost() {
  return String(process.env.TURNSTILE_ALLOW_LOCALHOST || '').toLowerCase() === 'on';
}

function isLocalHostRequest(req: any): boolean {
  // The raw Host header, not req.hostname: this decision must not depend on
  // the trust-proxy setting, and it is the browser-visible host either way.
  const raw = String(req?.headers?.host || req?.hostname || '').toLowerCase();
  const host = raw.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

// Per-request answer for the password endpoints: is the gate active here, and
// which public site key should the page render? `enforced` is false for the
// localhost escape and when Turnstile is not configured at all. The site key
// is only shipped where the gate is enforced, so a localhost-exempt page (dev
// Playwright) shows no widget and its submit buttons stay enabled.
function turnstileRequestState(req: any) {
  const configured = turnstileConfigured();
  const localExempt = configured && turnstileAllowLocalhost() && isLocalHostRequest(req);
  return {
    configured,
    enforced: configured && !localExempt,
    siteKey: configured && !localExempt ? turnstileSiteKey() : '',
  };
}

// Pure check over a decoded siteverify response. Kept side-effect free so it
// is unit-testable without network access.
function checkSiteverifyResult(result: any, expectedAction: string, hostnames: string[]) {
  if (!result || typeof result !== 'object') return false;
  if (result.success !== true) return false;
  if (typeof expectedAction === 'string' && expectedAction) {
    if (result.action !== expectedAction) return false;
  }
  if (Array.isArray(hostnames) && hostnames.length) {
    const hostname = String(result.hostname || '').trim().toLowerCase();
    if (!hostname || !hostnames.includes(hostname)) return false;
  }
  return true;
}

// Canonical server-side siteverify. Never called from the browser.
// Returns { ok: true } or { ok: false, error } (error is a safe short code,
// never the raw provider payload).
async function verifyTurnstile(token: unknown, { action = '', remoteip = '' }: { action?: string; remoteip?: string } = {}) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, error: 'missing-token' };
  }
  const secret = turnstileSecret();
  const hostnames = turnstileHostnames();
  if (!turnstileConfigured() || !secret || !hostnames.length) {
    return { ok: false, error: 'not-configured' };
  }
  let result;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteip) body.set('remoteip', String(remoteip).slice(0, 128));
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10000),
      body,
    });
    if (!response.ok) return { ok: false, error: 'verify-unreachable' };
    result = await response.json();
  } catch {
    return { ok: false, error: 'verify-unreachable' };
  }
  if (!checkSiteverifyResult(result, action, hostnames)) {
    return { ok: false, error: 'invalid-token' };
  }
  return { ok: true };
}

module.exports = {
  SITEVERIFY_URL,
  MAX_TOKEN_LENGTH,
  turnstileSecret,
  turnstileSiteKey,
  turnstileHostnames,
  turnstileStatus,
  turnstileConfigured,
  turnstileStartupLine,
  turnstileAllowLocalhost,
  turnstileRequestState,
  checkSiteverifyResult,
  verifyTurnstile,
};
