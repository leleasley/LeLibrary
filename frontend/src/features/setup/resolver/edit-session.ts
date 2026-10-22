// The edit session token lives in module memory only. Never localStorage, never
// sessionStorage and never a cookie: a reload simply asks for the password
// again, and nothing ambient can be borrowed by another tab or a cross-site
// request.
let token: string | null = null;
let expiresAt = 0;

export function setEditToken(next: string | null, ttlMs?: number): void {
  token = next;
  expiresAt = next && ttlMs ? Date.now() + ttlMs : 0;
}

export function getEditToken(): string | null {
  if (!token) return null;
  if (expiresAt && Date.now() > expiresAt) { token = null; return null; }
  return token;
}

export function clearEditToken(): void {
  token = null;
  expiresAt = 0;
}
