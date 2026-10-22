import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient, request } from '@/api/client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })));
    await expect(apiClient.get<{ ok: boolean }>('/health')).resolves.toEqual({ ok: true });
  });

  it('sends credentials and the CSRF header only when authenticated', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const csrfOf = (init: RequestInit | undefined) =>
      (init?.headers as Record<string, string> | undefined)?.['X-CSRF-Token'];

    await apiClient.post('/api/save-config', { a: 1 });
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe('omit');
    expect(csrfOf(fetchMock.mock.calls[0]?.[1])).toBeUndefined();

    await apiClient.post('/api/save-config', { a: 1 }, { authenticated: true, csrfToken: 'token-value' });
    expect(fetchMock.mock.calls[1]?.[1]?.credentials).toBe('same-origin');
    expect(csrfOf(fetchMock.mock.calls[1]?.[1])).toBe('token-value');
  });

  it('surfaces the server error message and status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Invalid key' }, 400)));
    await expect(apiClient.get('/api/verify/tmdb')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'Invalid key',
    });
  });

  it('reads a code field when the server sends one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'nope', code: 'V4_ACCESS_TOKEN' }, 400)));
    const error = await apiClient.get('/api/verify/tmdb').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('V4_ACCESS_TOKEN');
  });

  it('never echoes an HTML error page, and explains a 5xx instead', async () => {
    // An edge/CDN error page can replace the origin's 5xx body entirely; a
    // Cloudflare sentence in a toast is noise, so 5xx gets a plain message.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>nope</html>', { status: 500 })));
    await expect(apiClient.get('/api/status')).rejects.toThrow('The server could not complete that request. Try again shortly.');
    await expect(apiClient.get('/api/status')).rejects.not.toThrow('<html>');
  });

  it('keeps a short plain-text body, which is sometimes the real message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Nuvio is not connected', { status: 409 })));
    await expect(apiClient.get('/api/status')).rejects.toThrow('Nuvio is not connected');
  });

  it('ignores a JSON proxy error body, which Cloudflare really does send', async () => {
    // Captured from a real 502 through Cloudflare in front of the push route.
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      type: 'https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-502/',
      title: 'Error 502: Bad gateway',
      status: 502,
      detail: 'The origin web server returned an invalid or incomplete response to Cloudflare.',
    }, 502)));
    await expect(apiClient.get('/api/status')).rejects.toThrow('The server could not complete that request. Try again shortly.');
    await expect(apiClient.get('/api/status')).rejects.not.toThrow('Cloudflare');
  });

  it('still shows our own 5xx message, which is the real reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Nuvio rejected this session' }, 502)));
    await expect(apiClient.get('/api/status')).rejects.toThrow('Nuvio rejected this session');
  });

  it('still names the status when there is nothing else to say', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 418 })));
    await expect(apiClient.get('/api/status')).rejects.toThrow('Request failed (418)');
  });

  it('reports a timeout as an ApiError rather than a raw abort', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    await expect(request('/api/status', { timeoutMs: 1 })).rejects.toMatchObject({ status: 0, message: 'The request timed out' });
  });
});
