import { describe, expect, it, vi } from 'vitest';

// Password-endpoint bot gate (v6). The helpers must be inert where Turnstile
// is not configured (self-host, SSR), the visible widget must be asked for
// the right shape, a token must be required, cleared on expiry and reset
// after every submit, and the API must only add the token field when it has
// one, so an unconfigured instance sends byte-identical bodies.
const api = vi.hoisted(() => ({
  post: vi.fn(() => Promise.resolve({})), get: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
}));
vi.mock('@/api/client', () => ({ apiClient: api }));

const turnstile = await import('@/features/setup/shared/turnstile');
const { createSetup, unlockSetup } = await import('@/features/setup/resolver/api');
const { createBlocker } = await import('@/features/setup/shared/tier/shell-model');

// Cloudflare's documented always-pass test site key (never a real key).
const TEST_SITE_KEY = '1x00000000000000000000AA';

function control(token: string | null, enabled = true) {
  const reset = vi.fn();
  const state = enabled
    ? { phase: token ? 'solved' as const : 'waiting' as const, token, errorCode: null }
    : turnstile.initialTurnstileState(false);
  return { enabled, state, slotRef: () => {}, reset };
}

describe('turnstile helpers', () => {
  it('reads no site key without a document (SSR, tests)', () => {
    expect(turnstile.turnstileSiteKey()).toBe('');
  });

  it('asks for the visible managed widget with the server-checked action', () => {
    const handlers = { onToken: vi.fn(), onExpired: vi.fn(), onError: vi.fn(), onTimeout: vi.fn() };
    const options = turnstile.turnstileWidgetOptions(TEST_SITE_KEY, 'unlock', handlers);
    expect(options).toMatchObject({ sitekey: TEST_SITE_KEY, action: 'unlock', appearance: 'always', theme: 'dark', size: 'flexible' });
    (options['callback'] as (token: string) => void)('tok');
    expect(handlers.onToken).toHaveBeenCalledWith('tok');
    expect((options['error-callback'] as (code: string) => boolean)('110200')).toBe(true);
    expect(handlers.onError).toHaveBeenCalledWith('110200');
    (options['expired-callback'] as () => void)();
    expect(handlers.onExpired).toHaveBeenCalled();
    (options['timeout-callback'] as () => void)();
    expect(handlers.onTimeout).toHaveBeenCalled();
    expect(turnstile.turnstileWidgetOptions(TEST_SITE_KEY, 'create-setup', handlers)['action']).toBe('create-setup');
  });

  it('needs a token, loses it on expiry or error, and keeps the code out of sight', () => {
    const { turnstileReducer: step, initialTurnstileState } = turnstile;
    let state = initialTurnstileState(true);
    expect(state.phase).toBe('loading');
    state = step(state, { type: 'rendered' });
    expect(state).toMatchObject({ phase: 'waiting', token: null });
    state = step(state, { type: 'token', token: 'tok' });
    expect(state).toMatchObject({ phase: 'solved', token: 'tok' });
    state = step(state, { type: 'expired' });
    expect(state).toMatchObject({ phase: 'expired', token: null });
    state = step(state, { type: 'token', token: 'tok-2' });
    state = step(state, { type: 'error', code: '300030' });
    expect(state).toMatchObject({ phase: 'error', token: null, errorCode: '300030' });
    state = step(state, { type: 'reset' });
    expect(state).toMatchObject({ phase: 'waiting', token: null, errorCode: null });
    // Unconfigured never changes.
    const off = initialTurnstileState(false);
    expect(step(off, { type: 'token', token: 'x' })).toBe(off);
  });

  it('ready only with a token when enabled; always ready when off', () => {
    expect(turnstile.turnstileReady(control(null))).toBe(false);
    expect(turnstile.turnstileReady(control('tok'))).toBe(true);
    expect(turnstile.turnstileReady(control(null, false))).toBe(true);
    expect(turnstile.turnstileReady(turnstile.TURNSTILE_OFF)).toBe(true);
    expect(turnstile.turnstileReady(undefined)).toBe(true);
  });

  it('resets the widget after a successful submit and after a rejected one', async () => {
    const solved = control('tok');
    await expect(turnstile.submitWithTurnstile(solved, async (token) => token)).resolves.toBe('tok');
    expect(solved.reset).toHaveBeenCalledTimes(1);

    const wrongPassword = control('tok');
    await expect(turnstile.submitWithTurnstile(wrongPassword, async () => { throw new Error('Setup not found or password incorrect'); }))
      .rejects.toThrow('password incorrect');
    expect(wrongPassword.reset).toHaveBeenCalledTimes(1);
  });

  it('refuses to submit without a token, and sends none when unconfigured', async () => {
    const waiting = control(null);
    const send = vi.fn(async () => 'sent');
    await expect(turnstile.submitWithTurnstile(waiting, send)).rejects.toThrow(turnstile.TURNSTILE_HINT);
    expect(send).not.toHaveBeenCalled();

    const off = control(null, false);
    await expect(turnstile.submitWithTurnstile(off, async (token) => token)).resolves.toBeNull();
    expect(off.reset).not.toHaveBeenCalled();
  });

  it('the footer finish is blocked with the hint until the check is done', () => {
    const keys = { keys: { torboxApiKey: 'synthetic-torbox', tmdbApiKey: 'synthetic-tmdb' } };
    const password = { value: 'a-password', confirmation: 'a-password' };
    expect(createBlocker(keys, password)).toBeNull();
    expect(createBlocker(keys, password, false)).toBe('Complete the check above');
    // Earlier reasons still win.
    expect(createBlocker(keys, { value: 'a-password', confirmation: 'other' }, false)).toBe('Both passwords must match');
  });
});

describe('password requests carry the token only when there is one', () => {
  it('unlock sends the token field beside the password', async () => {
    api.post.mockClear();
    await unlockSetup('00000000-0000-4000-8000-000000000000', 'a-password', 'synthetic-token');
    expect(api.post).toHaveBeenCalledWith(
      '/api/setup/00000000-0000-4000-8000-000000000000/unlock',
      { password: 'a-password', 'cf-turnstile-response': 'synthetic-token' },
    );
  });

  it('unlock without a token sends exactly the old body', async () => {
    api.post.mockClear();
    await unlockSetup('00000000-0000-4000-8000-000000000000', 'a-password', null);
    expect(api.post).toHaveBeenCalledWith(
      '/api/setup/00000000-0000-4000-8000-000000000000/unlock',
      { password: 'a-password' },
    );
  });

  it('create sends the token and never leaves it in the setup payload', async () => {
    api.post.mockClear();
    await createSetup({ tier: 'quick', password: 'a-password', config: {}, keys: {}, turnstile: 'synthetic-token' });
    const [path, body] = api.post.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(path).toBe('/api/setup');
    expect(body[turnstile.TURNSTILE_FIELD]).toBe('synthetic-token');
    expect('turnstile' in body).toBe(false);
  });

  it('create without a token sends no token field', async () => {
    api.post.mockClear();
    await createSetup({ tier: 'quick', password: 'a-password', config: {}, keys: {}, turnstile: null });
    const [, body] = api.post.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect('cf-turnstile-response' in body).toBe(false);
  });
});
