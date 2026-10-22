// Short-lived edit sessions. The unlock endpoint verifies the password once and
// hands back an opaque token, which the browser sends as
// "Authorization: Bearer <token>". It is deliberately NOT a cookie and NOT
// persisted anywhere: a bearer header is not sent ambiently by the browser, so
// a cross-site request cannot borrow it and no CSRF token is required.
const crypto = require('node:crypto') as typeof import('node:crypto');

export interface EditSession {
  token: string;
  expiresAt: number;
  expiresInMs: number;
}

export interface EditSessionStore {
  issue(uuid: string): EditSession;
  verify(token: unknown): { uuid: string } | null;
  revokeUuid(uuid: string): void;
  size(): number;
}

export interface EditSessionOptions {
  ttlMs?: number;
  now?: () => number;
}

interface StoredSession { uuid: string; expiresAt: number }

interface BearerRequest {
  headers?: Record<string, string | string[] | undefined>;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 5000;

function createEditSessionStore(options: EditSessionOptions = {}): EditSessionStore {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const sessions = new Map<string, StoredSession>();

  function prune(): void {
    const timestamp = now();
    for (const [token, session] of sessions) {
      if (session.expiresAt <= timestamp) sessions.delete(token);
    }
  }

  return {
    issue(uuid) {
      prune();
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = now() + ttlMs;
      sessions.set(token, { uuid: String(uuid).toLowerCase(), expiresAt });
      while (sessions.size > MAX_SESSIONS) {
        const oldest = sessions.keys().next().value;
        if (oldest === undefined) break;
        sessions.delete(oldest);
      }
      return { token, expiresAt, expiresInMs: ttlMs };
    },

    verify(token) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
      const session = sessions.get(token);
      if (!session) return null;
      if (session.expiresAt <= now()) { sessions.delete(token); return null; }
      return { uuid: session.uuid };
    },

    revokeUuid(uuid) {
      const id = String(uuid).toLowerCase();
      for (const [token, session] of sessions) {
        if (session.uuid === id) sessions.delete(token);
      }
    },

    size() { return sessions.size; },
  };
}

// Reads "Authorization: Bearer <token>" (case-insensitive scheme).
function bearerToken(req: BearerRequest | null | undefined): string | null {
  const header = req?.headers?.authorization ?? req?.headers?.Authorization ?? '';
  const value = Array.isArray(header) ? header[0] ?? '' : header;
  const match = /^Bearer\s+(.+)$/i.exec(String(value).trim());
  return match?.[1] ? match[1].trim() : null;
}

export interface EditSessionsApi {
  createEditSessionStore: (options?: EditSessionOptions) => EditSessionStore;
  bearerToken: (req: BearerRequest | null | undefined) => string | null;
  DEFAULT_TTL_MS: number;
}
module.exports = { createEditSessionStore, bearerToken, DEFAULT_TTL_MS } satisfies EditSessionsApi;
