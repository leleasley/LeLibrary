// Cloudflare Turnstile bot protection (managed mode, invisible).
//
// Env-driven so dev and prod carry different widgets:
//   TURNSTILE_SITE_KEY  - public site key, injected into the configure page
//                         (each environment uses its own widget's key)
//   TURNSTILE_SECRET / TURNSTILE_SECRET_KEY - private widget secret,
//                         server-side siteverify only. NEVER exposed to the
//                         browser. Absent = Turnstile is inert (self-hosters
//                         and pre-secret dev are untouched).
//   TURNSTILE_HOSTNAMES - comma-separated frontend hostnames the token must
//                         have been issued for (e.g. "dev.leleasley.uk").
//                         Production must NOT include localhost/127.0.0.1.
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
  return String(process.env.TURNSTILE_HOSTNAMES || '')
    .split(',')
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean);
}

// True when the server can actually verify tokens. Everything else keys off
// this: unconfigured instances skip both the widget (no site key injected)
// and enforcement (requests proceed exactly as before).
function turnstileConfigured() {
  return turnstileSecret().length > 0 && turnstileHostnames().length > 0;
}

// Pure check over a decoded siteverify response. Kept side-effect free so it
// is unit-testable without network access.
function checkSiteverifyResult(result, expectedAction, hostnames) {
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
async function verifyTurnstile(token, { action = '', remoteip = '' } = {}) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, error: 'missing-token' };
  }
  const secret = turnstileSecret();
  const hostnames = turnstileHostnames();
  if (!secret || !hostnames.length) {
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
  turnstileConfigured,
  checkSiteverifyResult,
  verifyTurnstile,
};
