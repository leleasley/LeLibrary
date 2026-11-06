import { describe, expect, it, vi } from 'vitest';

// Password-endpoint bot gate (v6). The helper must be inert where Turnstile is
// not configured (self-host, SSR), and the API must only add the token field
// when it has one, so an unconfigured instance sends byte-identical bodies.
const api = vi.hoisted(() => ({
  post: vi.fn(() => Promise.resolve({})), get: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
}));
vi.mock('@/api/client', () => ({ apiClient: api }));

const { turnstileToken } = await import('@/features/setup/shared/turnstile');
const { createSetup, unlockSetup } = await import('@/features/setup/resolver/api');

describe('turnstile token helper', () => {
  it('is inert without a document (SSR, tests) and without a site key', async () => {
    await expect(turnstileToken('unlock')).resolves.toBeNull();
    await expect(turnstileToken('create-setup')).resolves.toBeNull();
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
    expect(body['cf-turnstile-response']).toBe('synthetic-token');
    expect('turnstile' in body).toBe(false);
  });

  it('create without a token sends no token field', async () => {
    api.post.mockClear();
    await createSetup({ tier: 'quick', password: 'a-password', config: {}, keys: {}, turnstile: null });
    const [, body] = api.post.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect('cf-turnstile-response' in body).toBe(false);
  });
});
