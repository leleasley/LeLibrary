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
  const profiles = await fetchNuvioProfiles(connection.nuvioToken);
  const selected = profiles.some((profile) => profile.profile_index === connection.nuvioSelectedProfile)
    ? connection.nuvioSelectedProfile ?? null
    : profiles[0]?.profile_index ?? null;
  return { ...connection, nuvioProfiles: profiles, nuvioSelectedProfile: selected };
}
