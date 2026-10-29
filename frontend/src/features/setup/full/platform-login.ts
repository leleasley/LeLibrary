// Browser-to-platform sign-in.
//
// Credentials travel only to the platform's own API; LeLibrary's server
// receives solely the resulting session tokens for sealing. Field names on
// the returned connections are what the server's connection store expects, so they seal
// straight into keys.push without translation.

export const NUVIO_API_BASE = 'https://api.nuvio.tv';
const NUVIO_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgxNTIxMzQ2LCJleHAiOjE5MzkyMDEzNDZ9.tmQaj682pwzehpqlgCDMnySOqiUvpgRbrE43T4VJpDI';
const STREMIO_API = 'https://api.strem.io/api';

export interface NuvioProfileRef {
  profile_index: number;
  name: string;
  uses_primary_addons: boolean;
}

export interface PlatformConnection {
  platform: 'nuvio' | 'stremio';
  stremioAuth?: string | null;
  stremioUser?: unknown;
  nuvioToken?: string | null;
  nuvioRefresh?: string | null;
  nuvioUser?: unknown;
  nuvioProfiles?: NuvioProfileRef[];
  nuvioSelectedProfile?: number | null;
}

async function stremioCall(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch(`${STREMIO_API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 429) throw new Error('Stremio rate limit reached: wait a minute and try again');
  let data: Record<string, unknown> | null = null;
  try { data = await r.json(); } catch { /* fall through */ }
  if (!r.ok || (data as { error?: unknown } | null)?.error) {
    throw new Error(((data?.['error'] as { message?: string } | undefined)?.message) || `Stremio API error (HTTP ${r.status})`);
  }
  return (data || {}) as Record<string, unknown>;
}

export async function loginStremio(email: string, password: string): Promise<PlatformConnection> {
  if (!email || !password) throw new Error('Enter your Stremio email and password');
  const data = await stremioCall('login', { type: 1, email, password });
  const result = (data['result'] || {}) as Record<string, unknown>;
  const authKey = result['authKey'] || result['token'];
  if (!authKey) throw new Error('Stremio did not return a session token');
  return { platform: 'stremio', stremioAuth: String(authKey), stremioUser: result['user'] ?? null };
}

async function nuvioRpc(token: string | null, path: string, body: Record<string, unknown>): Promise<unknown> {
  const r = await fetch(`${NUVIO_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: NUVIO_PUBLISHABLE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(20000),
  });
  let data: unknown = null;
  try { data = await r.json(); } catch { /* fall through */ }
  if (!r.ok) {
    const record = (data || {}) as Record<string, unknown>;
    throw new Error(String(record['msg'] || record['message'] || record['error'] || `Nuvio API error (HTTP ${r.status})`));
  }
  return data;
}

export async function fetchNuvioProfiles(token: string): Promise<NuvioProfileRef[]> {
  const data = await nuvioRpc(token, '/rest/v1/rpc/sync_pull_profiles', {});
  const list = Array.isArray(data) ? data : ((data as { profiles?: unknown })?.profiles || []);
  const seen = new Map<number, NuvioProfileRef>();
  for (const p of Array.isArray(list) ? list : []) {
    const record = (p || {}) as Record<string, unknown>;
    const idx = Math.trunc(Number(record['profile_index'] ?? record['id']));
    if (!Number.isFinite(idx) || idx < 1 || seen.has(idx)) continue;
    seen.set(idx, {
      profile_index: idx,
      name: String(record['name'] || '').trim() || `Profile ${idx}`,
      uses_primary_addons: !!((record['uses_primary_addons'] ?? record['usesPrimaryAddons']) as boolean),
    });
  }
  return [...seen.values()].sort((a, b) => a.profile_index - b.profile_index);
}

export async function loginNuvio(email: string, password: string): Promise<PlatformConnection> {
  if (!email || !password) throw new Error('Enter your Nuvio email and password');
  const r = await fetch(`${NUVIO_API_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: NUVIO_PUBLISHABLE_KEY },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(20000),
  });
  let data: Record<string, unknown> | null = null;
  try { data = await r.json(); } catch { /* fall through */ }
  if (!r.ok || !data?.['access_token']) {
    throw new Error(String((data as Record<string, unknown> | null)?.['msg'] || (data as Record<string, unknown> | null)?.['error_description'] || 'sign-in failed'));
  }
  const token = String(data['access_token']);
  const profiles = await fetchNuvioProfiles(token);
  return {
    platform: 'nuvio',
    nuvioToken: token,
    nuvioRefresh: (data['refresh_token'] as string) || null,
    nuvioUser: (data['user'] as unknown) ?? null,
    nuvioProfiles: profiles,
    nuvioSelectedProfile: profiles.length === 1 ? profiles[0]?.profile_index ?? null : null,
  };
}

// Live profile list for a session we already hold. A connection that arrived by
// importing an old setup carries a profile snapshot that can be any age, so a
// profile created since then would be unpickable (and a renamed or deleted one
// would linger). Refreshing also makes the visible selection honest: a select
// with no value still *looks* like its first option, so default to that option
// rather than pushing somewhere the picker never showed.
export async function refreshNuvioConnection(connection: PlatformConnection): Promise<PlatformConnection> {
  if (connection.platform !== 'nuvio' || !connection.nuvioToken) return connection;
  connection = await ensureFreshNuvio(connection);
  let profiles: NuvioProfileRef[];
  try {
    profiles = await fetchNuvioProfiles(connection.nuvioToken as string);
  } catch (error) {
    // The token can expire between the check above and the call, or carry no
    // readable expiry: renew once on an auth failure and retry.
    if (!connection.nuvioRefresh || !isNuvioAuthError(error)) throw error;
    connection = await renewNuvioSession(connection);
    profiles = await fetchNuvioProfiles(connection.nuvioToken as string);
  }
  const selected = profiles.some((profile) => profile.profile_index === connection.nuvioSelectedProfile)
    ? connection.nuvioSelectedProfile ?? null
    : profiles[0]?.profile_index ?? null;
  return { ...connection, nuvioProfiles: profiles, nuvioSelectedProfile: selected };
}

// Nuvio access tokens are short-lived JWTs. A login imported from an old setup
// is usually long expired, but its refresh token still works, so renew instead
// of surfacing Nuvio's "JWT expired" error.
export function nuvioTokenExpired(token: string | null | undefined, skewSeconds = 60): boolean {
  const part = String(token || '').split('.')[1];
  if (!part) return false;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const exp = Number((JSON.parse(json) as { exp?: unknown }).exp);
    return Number.isFinite(exp) && exp * 1000 <= Date.now() + skewSeconds * 1000;
  } catch {
    return false;
  }
}

function isNuvioAuthError(error: unknown): boolean {
  return /jwt|expired|unauthori[sz]ed|401|invalid token/i.test(String((error as Error)?.message || error));
}

export async function renewNuvioSession(connection: PlatformConnection): Promise<PlatformConnection> {
  if (connection.platform !== 'nuvio' || !connection.nuvioRefresh) {
    throw new Error('Your Nuvio sign-in has expired. Connect Nuvio again in Step 1.');
  }
  const r = await fetch(`${NUVIO_API_BASE}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: NUVIO_PUBLISHABLE_KEY },
    body: JSON.stringify({ refresh_token: connection.nuvioRefresh }),
    signal: AbortSignal.timeout(20000),
  });
  let data: Record<string, unknown> | null = null;
  try { data = await r.json(); } catch { /* fall through */ }
  if (!r.ok || !data?.['access_token']) {
    throw new Error('Your Nuvio sign-in has expired. Connect Nuvio again in Step 1.');
  }
  return {
    ...connection,
    nuvioToken: String(data['access_token']),
    nuvioRefresh: (data['refresh_token'] as string) || connection.nuvioRefresh,
  };
}

// Renew only when the access token has (nearly) expired.
export async function ensureFreshNuvio(connection: PlatformConnection): Promise<PlatformConnection> {
  if (connection.platform !== 'nuvio' || !connection.nuvioToken) return connection;
  if (!nuvioTokenExpired(connection.nuvioToken)) return connection;
  return renewNuvioSession(connection);
}

// ── Creating an account ──────────────────────────────────────────────────
// Runs browser-to-platform exactly like sign-in: the email and password go
// only to Nuvio's or Stremio's own API, LeLibrary's server gets the session
// afterwards and never the password. If the platform turns open sign-ups off
// (or wants an email confirmed first), the person is sent to its own page.

export const SIGNUP_LINKS = {
  nuvio: { terms: 'https://nuvio.tv/terms', privacy: 'https://nuvio.tv/privacy-policy', page: 'https://nuvio.tv/account' },
  stremio: { terms: 'https://www.stremio.com/tos', privacy: 'https://www.stremio.com/privacy', page: 'https://www.stremio.com/register' },
} as const;

export const MIN_PASSWORD = 8;

/** Sign-up is not possible here right now: use the platform's own page. */
export class SignupUnavailableError extends Error {
  readonly platform: 'nuvio' | 'stremio';
  constructor(platform: 'nuvio' | 'stremio', message: string) {
    super(message);
    this.platform = platform;
  }
}

function checkNewAccount(email: string, password: string, agreed: boolean): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address');
  if (password.length < MIN_PASSWORD) throw new Error('Use a password of at least 8 characters');
  if (!agreed) throw new Error('Tick the box to agree to the terms first');
}

const NEW_PROFILE_COLOR = '#1E88E5';

// A brand-new Nuvio account has no profiles until an app creates one: make the
// main profile, named after the setup, so the push has somewhere to land.
async function ensureFirstNuvioProfile(token: string, name: string): Promise<NuvioProfileRef[]> {
  let profiles = await fetchNuvioProfiles(token).catch(() => [] as NuvioProfileRef[]);
  if (profiles.length) return profiles;
  await nuvioRpc(token, '/rest/v1/rpc/sync_push_profiles', {
    p_profiles: [{ profile_index: 1, name: name.trim().slice(0, 40) || 'Main', avatar_color_hex: NEW_PROFILE_COLOR, uses_primary_addons: false, uses_primary_plugins: false }],
    p_client_max_profiles: 6,
    p_origin_client_id: 'lelibrary-web-signup',
  });
  profiles = await fetchNuvioProfiles(token).catch(() => [] as NuvioProfileRef[]);
  return profiles;
}

export async function signupNuvio(email: string, password: string, options: { agreed: boolean; profileName: string }): Promise<PlatformConnection> {
  checkNewAccount(email, password, options.agreed);
  const r = await fetch(`${NUVIO_API_BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: NUVIO_PUBLISHABLE_KEY },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(20000),
  });
  let data: Record<string, unknown> | null = null;
  try { data = await r.json(); } catch { /* fall through */ }
  if (!r.ok) {
    const code = String(data?.['error_code'] || data?.['code'] || '');
    const message = String(data?.['msg'] || data?.['message'] || data?.['error_description'] || '');
    if (code === 'user_already_exists' || /already (registered|exists)/i.test(message)) {
      throw new Error('That email already has a Nuvio account. Sign in instead.');
    }
    if (code === 'signup_disabled' || /signups? (not allowed|disabled)/i.test(message)) {
      throw new SignupUnavailableError('nuvio', 'Nuvio is not taking new accounts here right now. Create one on Nuvio\'s site, then sign in.');
    }
    if (r.status === 429) throw new Error('Too many attempts: wait a minute and try again');
    throw new Error(message || `Nuvio could not create the account (HTTP ${r.status})`);
  }
  // Auto-confirmed accounts come back signed in; anything else needs the
  // person to confirm their email on Nuvio's side first.
  const token = typeof data?.['access_token'] === 'string' ? data['access_token'] as string : '';
  if (!token) {
    throw new SignupUnavailableError('nuvio', 'Nuvio sent you an email to confirm the account. Confirm it, then sign in here.');
  }
  const profiles = await ensureFirstNuvioProfile(token, options.profileName);
  return {
    platform: 'nuvio',
    nuvioToken: token,
    nuvioRefresh: (data?.['refresh_token'] as string) || null,
    nuvioUser: (data?.['user'] as unknown) ?? null,
    nuvioProfiles: profiles,
    nuvioSelectedProfile: profiles[0]?.profile_index ?? null,
  };
}

export async function registerStremio(email: string, password: string, options: { agreed: boolean }): Promise<PlatformConnection> {
  checkNewAccount(email, password, options.agreed);
  let data: Record<string, unknown>;
  try {
    data = await stremioCall('register', {
      type: 'Register',
      email,
      password,
      gdpr_consent: { tos: true, privacy: true, marketing: false, from: 'web' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/already|exists|taken|registered/i.test(message)) throw new Error('That email already has a Stremio account. Sign in instead.');
    throw error;
  }
  const result = (data['result'] || {}) as Record<string, unknown>;
  const authKey = result['authKey'] || result['token'];
  if (!authKey) throw new SignupUnavailableError('stremio', 'Stremio did not sign the new account in. Create it on Stremio\'s site, then sign in.');
  return { platform: 'stremio', stremioAuth: String(authKey), stremioUser: result['user'] ?? null };
}
