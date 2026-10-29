import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignupUnavailableError, registerStremio, signupNuvio } from '@/features/setup/full/platform-login';

// Account creation runs browser-to-platform. A fake fetch stands in for Nuvio
// and Stremio: no real account is ever created by these tests.
type Call = { url: string; body: Record<string, unknown> };
function fakeFetch(responses: { match: RegExp; status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    const at = queue.findIndex((r) => r.match.test(url));
    if (at < 0) throw new Error(`unexpected request ${url}`);
    const [next] = queue.splice(at, 1);
    return new Response(JSON.stringify(next!.body), { status: next!.status ?? 200 });
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('creating a Nuvio account', () => {
  it('signs up, makes the first profile named after the setup and comes back connected', async () => {
    const { calls } = fakeFetch([
      { match: /\/auth\/v1\/signup$/, body: { access_token: 'tok', refresh_token: 'ref', user: { email: 'new@example.com' } } },
      { match: /sync_pull_profiles/, body: [] },
      { match: /sync_push_profiles/, body: null },
      { match: /sync_pull_profiles/, body: [{ profile_index: 1, name: 'Living room' }] },
    ]);
    const conn = await signupNuvio('new@example.com', 'longenough', { agreed: true, profileName: 'Living room' });
    expect(conn).toMatchObject({ platform: 'nuvio', nuvioToken: 'tok', nuvioRefresh: 'ref', nuvioSelectedProfile: 1 });
    expect(calls[0]!.body).toEqual({ email: 'new@example.com', password: 'longenough' });
    const pushed = calls.find((c) => /sync_push_profiles/.test(c.url))!.body as { p_profiles: { profile_index: number; name: string }[] };
    expect(pushed.p_profiles).toEqual([expect.objectContaining({ profile_index: 1, name: 'Living room' })]);
  });

  it('names the profile Main when the setup has no name yet, and keeps profiles that exist', async () => {
    const { calls } = fakeFetch([
      { match: /signup$/, body: { access_token: 'tok' } },
      { match: /sync_pull_profiles/, body: [{ profile_index: 1, name: 'Already here' }] },
    ]);
    const conn = await signupNuvio('a@b.co', 'longenough', { agreed: true, profileName: '  ' });
    expect(calls.some((c) => /sync_push_profiles/.test(c.url))).toBe(false);
    expect(conn.nuvioProfiles?.[0]?.name).toBe('Already here');
  });

  it('says to sign in when the email already has an account', async () => {
    fakeFetch([{ match: /signup$/, status: 422, body: { error_code: 'user_already_exists', msg: 'User already registered' } }]);
    await expect(signupNuvio('a@b.co', 'longenough', { agreed: true, profileName: '' }))
      .rejects.toThrow('That email already has a Nuvio account. Sign in instead.');
  });

  it('sends people to Nuvio when sign-ups are off or need an email confirmed', async () => {
    fakeFetch([{ match: /signup$/, status: 422, body: { error_code: 'signup_disabled' } }]);
    await expect(signupNuvio('a@b.co', 'longenough', { agreed: true, profileName: '' })).rejects.toBeInstanceOf(SignupUnavailableError);
    fakeFetch([{ match: /signup$/, body: { id: 'user-without-session', email: 'a@b.co' } }]);
    await expect(signupNuvio('a@b.co', 'longenough', { agreed: true, profileName: '' })).rejects.toBeInstanceOf(SignupUnavailableError);
  });

  it('checks the email, the password length and the agreement before calling Nuvio', async () => {
    const { fn } = fakeFetch([]);
    await expect(signupNuvio('not-an-email', 'longenough', { agreed: true, profileName: '' })).rejects.toThrow('Enter a valid email address');
    await expect(signupNuvio('a@b.co', 'short', { agreed: true, profileName: '' })).rejects.toThrow('Use a password of at least 8 characters');
    await expect(signupNuvio('a@b.co', 'longenough', { agreed: false, profileName: '' })).rejects.toThrow('Tick the box to agree to the terms first');
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('creating a Stremio account', () => {
  it('registers with the consent Stremio asks for and comes back connected', async () => {
    const { calls } = fakeFetch([{ match: /api\.strem\.io\/api\/register$/, body: { result: { authKey: 'auth-1', user: { email: 'new@example.com' } } } }]);
    const conn = await registerStremio('new@example.com', 'longenough', { agreed: true });
    expect(conn).toMatchObject({ platform: 'stremio', stremioAuth: 'auth-1' });
    expect(calls[0]!.body).toEqual({
      type: 'Register', email: 'new@example.com', password: 'longenough',
      gdpr_consent: { tos: true, privacy: true, marketing: false, from: 'web' },
    });
  });

  it('says to sign in when the email is taken', async () => {
    fakeFetch([{ match: /register$/, body: { error: { message: 'User already exists' } } }]);
    await expect(registerStremio('a@b.co', 'longenough', { agreed: true }))
      .rejects.toThrow('That email already has a Stremio account. Sign in instead.');
  });
});

describe('the Destination login is saved with the setup', () => {
  it('adds a usable session to the keys, and nothing otherwise', async () => {
    const { withConnection } = await import('@/features/setup/shared/useCreateSetup');
    const keys = { tmdbApiKey: 'k' };
    expect(withConnection(keys, { platform: 'nuvio', nuvioToken: 't', nuvioSelectedProfile: 2 }))
      .toEqual({ tmdbApiKey: 'k', push: { nuvio: { platform: 'nuvio', nuvioToken: 't', nuvioSelectedProfile: 2 } } });
    expect(withConnection(keys, { platform: 'stremio', stremioAuth: 'a' })).toMatchObject({ push: { stremio: { stremioAuth: 'a' } } });
    expect(withConnection(keys, { platform: 'nuvio', nuvioToken: null })).toBe(keys);
    expect(withConnection(keys, null)).toBe(keys);
  });
});
