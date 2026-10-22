// Central browser HTTP client. Every feature talks to the server through this
// so credentials, CSRF, timeouts, JSON parsing and error shape are handled once.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  /** Send the session cookie and the CSRF header. Mutations require both. */
  authenticated?: boolean;
  csrfToken?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
    this.code = code;
  }
}

export const DEFAULT_TIMEOUT_MS = 15_000;

// A CDN/proxy error body is JSON too, and its "detail" reads like a real
// message. Recognise it by its own marker so we never show it to a user.
function isProxyErrorPage(record: Record<string, unknown>): boolean {
  const type = record['type'];
  return typeof type === 'string' && /cloudflare\.com|cloudflare-[0-9]+xx-errors/i.test(type);
}

function extractMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (!isProxyErrorPage(record)) {
      for (const key of ['error', 'message', 'detail']) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
    }
  }
  // A bare string body is sometimes the real message, but an edge/proxy error
  // page is markup and useless in a toast: keep short plain text, drop the rest.
  if (typeof payload === 'string') {
    const text = payload.trim();
    if (text && text.length <= 200 && !text.includes('<')) return text;
  }
  if (status === 401) return 'Not signed in';
  if (status === 403) return 'Not allowed';
  if (status === 429) return 'Too many requests, try again shortly';
  // 5xx from the origin can arrive replaced by the CDN's own error page; say
  // something the user can act on instead of echoing that.
  if (status >= 500) return 'The server could not complete that request. Try again shortly.';
  return `Request failed (${status})`;
}

function extractCode(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object') {
    const code = (payload as Record<string, unknown>)['code'];
    if (typeof code === 'string' && code) return code;
  }
  return undefined;
}

function hasServerMessage(payload: unknown): boolean {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    return !isProxyErrorPage(record) && ['error', 'message', 'detail'].some((key) => {
      const value = record[key];
      return typeof value === 'string' && !!value.trim();
    });
  }
  return typeof payload === 'string' && payload.trim().length > 0 && payload.trim().length <= 200 && !payload.includes('<');
}

async function parsePayload(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    const text = await response.text().catch(() => '');
    return text || null;
  }
  return response.json().catch(() => null);
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, authenticated = false, csrfToken, timeoutMs = DEFAULT_TIMEOUT_MS, signal, headers } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  const finalHeaders: Record<string, string> = { Accept: 'application/json', ...headers };
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
  if (authenticated && method !== 'GET' && csrfToken) finalHeaders['X-CSRF-Token'] = csrfToken;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: finalHeaders,
      credentials: authenticated ? 'same-origin' : 'omit',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('The request timed out', 0, null, 'NETWORK_TIMEOUT');
    }
    throw new ApiError('Could not reach the server', 0, null, 'NETWORK_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }

  const payload = await parsePayload(response);
  if (!response.ok) {
    const code = extractCode(payload) ?? (hasServerMessage(payload) ? undefined : `HTTP_${response.status}`);
    throw new ApiError(extractMessage(payload, response.status), response.status, payload, code);
  }
  return payload as T;
}

export const apiClient = {
  get: <T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) => request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) => request<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) => request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) => request<T>(path, { ...options, method: 'DELETE', body }),
};
