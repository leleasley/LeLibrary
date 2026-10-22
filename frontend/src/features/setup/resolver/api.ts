import { apiClient } from '@/api/client';
import { normalizeSetupSummary, type SavedSetupSummary } from '@/features/setup/shared/saved-setups';

export interface SetupSummary {
  uuid: string;
  tier: string;
  name: string | null;
  hasPassword: boolean;
  keyServices: string[];
  updatedAt?: string;
}

export interface CreateSetupResult {
  uuid: string;
  tier: string;
  installToken: string;
  manifestPath: string;
}

export interface UnlockResult extends SetupSummary {
  editToken: string;
  editTokenExpiresAt: number;
  editTokenExpiresInMs: number;
  installToken: string | null;
  // Saved structural config (poster/stream/badge choices). Already filtered
  // server-side: keys are never included.
  config?: Record<string, unknown>;
}

export function createSetup(input: {
  tier: string;
  name?: string;
  password: string;
  config?: Record<string, unknown>;
  keys?: Record<string, unknown>;
}): Promise<CreateSetupResult> {
  return apiClient.post<CreateSetupResult>('/api/setup', input);
}

export function fetchSetup(uuid: string): Promise<SetupSummary> {
  return apiClient.get<SetupSummary>(`/api/setup/${encodeURIComponent(uuid)}`);
}

// Self-host setup list (issue #4). The endpoint 404s when the instance has no
// operator secret and 401s without the access cookie; the caller treats both
// as "not available" and hides the section.
export async function listSetups(): Promise<SavedSetupSummary[]> {
  // authenticated: true keeps credentials same-origin. The gate is the
  // HttpOnly lelibrary_selfhost_access cookie; without it every call is 401.
  // Fetch exactly what the picker renders (SEE saved-setups merge cap).
  const payload = await apiClient.get<{ setups?: unknown }>('/api/setup?limit=10', { authenticated: true });
  const rows = Array.isArray(payload?.setups) ? payload.setups : [];
  return rows
    .map(normalizeSetupSummary)
    .filter((row): row is SavedSetupSummary => row !== null);
}

export function unlockSetup(uuid: string, password: string): Promise<UnlockResult> {
  return apiClient.post<UnlockResult>(`/api/setup/${encodeURIComponent(uuid)}/unlock`, { password });
}

// Mutations carry the bearer token, never a cookie and never the password.
export function saveSetup(uuid: string, body: Record<string, unknown>, editToken: string): Promise<{ ok: boolean }> {
  return apiClient.put<{ ok: boolean }>(`/api/setup/${encodeURIComponent(uuid)}`, body, {
    headers: { Authorization: `Bearer ${editToken}` },
  });
}

// Full erasure: deletes the setup row (config + sealed keys). The install URL
// dies immediately and all edit sessions for the UUID are revoked.
export function deleteSetup(uuid: string, editToken: string): Promise<{ ok: boolean }> {
  return apiClient.delete<{ ok: boolean }>(
    `/api/setup/${encodeURIComponent(uuid)}`,
    undefined,
    bearer(editToken),
  );
}

// Saved structural config for an unlocked editor: pre-fills the pickers so
// an edit starts where the setup left off. Secrets are never included.
export function fetchSetupConfig(uuid: string, editToken: string): Promise<{ config: Record<string, unknown> }> {
  return apiClient.get<{ config: Record<string, unknown> }>(`/api/setup/${encodeURIComponent(uuid)}/config`, {
    headers: { Authorization: `Bearer ${editToken}` },
  });
}

// Reveal one saved key value into an unlocked editor (explicit per-service
// action behind the "Show saved" buttons). The server only serves
// password-protected setups; the value fills the blind input so verify and
// key-dependent previews can run against the saved key.
export function revealSetupKey(uuid: string, service: string, editToken: string): Promise<{ service: string; key: string }> {
  return apiClient.post<{ service: string; key: string }>(
    `/api/setup/${encodeURIComponent(uuid)}/keys/reveal`,
    { service },
    bearer(editToken),
  );
}

export interface AccountSetupSummary {
  idMasked: string;
  label: string | null;
  kind: 'collection' | 'token';
  createdAt: unknown;
  lastUsedAt: unknown;
  enabledKeyServices: string[] | null;
}

export interface AccountLookup {
  setups: AccountSetupSummary[];
  keyServices: string[];
  collections: { contexts: number; collections: number };
}

export interface MigrateResult {
  uuid: string;
  tier: string;
  installToken: string;
  manifestPath: string;
  keyServices: string[];
  collections: { contexts: number; collections: number };
  sourceLabel: string | null;
  purged: string;
}

// Import screen: what an old account email owns (masked ids only, nothing
// secret), then the actual import once the owner pastes a token id.
export function lookupAccount(email: string): Promise<AccountLookup> {
  return apiClient.post<AccountLookup>('/api/setup/migrate/lookup', { email });
}

export function migrateSetup(input: {
  tokenId?: string;
  email?: string;
  idMasked?: string;
  password: string;
  tier?: string;
  purgeToken?: boolean;
}): Promise<MigrateResult> {
  return apiClient.post<MigrateResult>('/api/setup/migrate', input);
}

// Structural preview of an old setup for the import modal: settings without
// secrets, so the page can stage the import visibly before any password
// exists. Secrets never leave regardless.
export interface ImportPreview {
  config: Record<string, unknown>;
  sourceLabel: string | null;
  kind: 'collection' | 'token';
  keyServices: string[];
  watchlist: string[];
  push: string[];
  collections: { contexts: number; collections: number };
}

export function previewImport(input: { email: string; idMasked: string }): Promise<ImportPreview> {
  return apiClient.post<ImportPreview>('/api/setup/migrate/preview', input);
}

// Full old-setup payload for the import modal: decrypted keys, login
// connections and collection documents in one rate-limited call, so picking
// a setup fills the whole page. Secrets included by explicit operator
// decision: the picker selection gates it and values only go to the browser
// that asked for its own account's setup.
export interface OldSetupData {
  keys: Record<string, unknown>;
  watchlist: string[];
  push: string[];
  collections: unknown[];
  homeRows: unknown[];
  context: { integration: string; profileId: string } | null;
  config: Record<string, unknown>;
  sourceLabel: string | null;
  kind: 'collection' | 'token';
}

export function importOldSetup(input: { email: string; idMasked: string }): Promise<OldSetupData> {
  return apiClient.post<OldSetupData>('/api/setup/migrate/data', input);
}

// One-way cleanup after a staged import is created: removes the imported old
// setup, and the whole old account (collections, keys, logins, email) once it
// has no other old setups left to import. Same
// email+mask gate as the import, tight limit, and strictly a background
// best-effort after creation — it can never fail the setup itself.
export function purgeOldAccount(input: { email: string; idMasked: string }): Promise<{ ok: boolean; purged?: 'token' | 'account' }> {
  return apiClient.post<{ ok: boolean; purged?: 'token' | 'account' }>('/api/setup/migrate/purge', input);
}

// Platform push + watchlist connections for a setup. Every call carries the
// bearer edit token; the server only ever returns connection metadata, never
// secrets. Browser-to-platform logins live in full/platform-login.ts.
export interface PushStatus {
  connected: boolean;
  user?: string | null;
  selectedProfile?: number | null;
}

export interface NuvioProfileOption {
  profile_index: number;
  name: string;
  uses_primary_addons: boolean;
}

function bearer(editToken: string): { headers: Record<string, string> } {
  return { headers: { Authorization: `Bearer ${editToken}` } };
}

export function pushStatus(uuid: string, platform: string, editToken: string): Promise<PushStatus> {
  return apiClient.get<PushStatus>(
    `/api/setup/${encodeURIComponent(uuid)}/push-connect/${encodeURIComponent(platform)}`,
    bearer(editToken),
  );
}

export function sealPushConnection(
  uuid: string, platform: string, connection: Record<string, unknown>, editToken: string,
): Promise<{ ok: boolean }> {
  return apiClient.post<{ ok: boolean }>(
    `/api/setup/${encodeURIComponent(uuid)}/push-connect`,
    { platform, connection },
    bearer(editToken),
  );
}

export function setNuvioProfile(uuid: string, profileId: number, editToken: string): Promise<{ ok: boolean }> {
  return apiClient.put<{ ok: boolean }>(
    `/api/setup/${encodeURIComponent(uuid)}/push-connect/nuvio/profile`,
    { profile_id: profileId },
    bearer(editToken),
  );
}

export function disconnectPush(uuid: string, platform: string, editToken: string): Promise<{ ok: boolean }> {
  return apiClient.post<{ ok: boolean }>(
    `/api/setup/${encodeURIComponent(uuid)}/push-connect/${encodeURIComponent(platform)}/disconnect`,
    {},
    bearer(editToken),
  );
}

export function pushProfiles(uuid: string, editToken: string): Promise<{ profiles: NuvioProfileOption[]; selected: number | null }> {
  return apiClient.get<{ profiles: NuvioProfileOption[]; selected: number | null }>(
    `/api/setup/${encodeURIComponent(uuid)}/push-profiles`,
    bearer(editToken),
  );
}

// A push walks the whole player account: token refresh, profiles, the addon
// install, collections, Home order and badges, and it may wait a bounded slice
// for a cold library build. That legitimately takes far longer than a normal
// request, so it gets its own budget instead of the 15s default (which made a
// working first push look like a failure).
const PUSH_TIMEOUT_MS = 90_000;

export function pushSetup(
  uuid: string,
  body: { platform: string; profile_id?: number | string; temporary_connection?: Record<string, unknown> },
  editToken: string,
): Promise<{ ok: boolean; platform?: string; profile_id?: string | null; libraryPending?: boolean }> {
  return apiClient.post<{ ok: boolean; platform?: string; profile_id?: string | null; libraryPending?: boolean }>(
    `/api/setup/${encodeURIComponent(uuid)}/push`,
    body,
    { ...bearer(editToken), timeoutMs: PUSH_TIMEOUT_MS },
  );
}

export interface WatchlistState {
  simkl: { connected: boolean; configured: boolean };
  trakt: { connected: boolean; configured: boolean };
}

export function watchlistStatus(uuid: string, editToken: string): Promise<WatchlistState> {
  return apiClient.get<WatchlistState>(
    `/api/setup/${encodeURIComponent(uuid)}/watchlist`,
    bearer(editToken),
  );
}

export function disconnectWatchlist(uuid: string, provider: string, editToken: string): Promise<{ ok: boolean }> {
  return apiClient.post<{ ok: boolean }>(
    `/api/setup/${encodeURIComponent(uuid)}/watchlist/${encodeURIComponent(provider)}/disconnect`,
    {},
    bearer(editToken),
  );
}

// OAuth starts in a popup (which cannot send headers), so the endpoint
// returns the provider URL as JSON instead of redirecting.
export function startWatchlistOAuth(uuid: string, provider: string, editToken: string): Promise<{ url: string }> {
  return apiClient.get<{ url: string }>(
    `/api/setup/${encodeURIComponent(uuid)}/oauth/${encodeURIComponent(provider)}`,
    bearer(editToken),
  );
}

export interface WatchlistDraftConn {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: number | null;
  client_id?: string | null;
}

export type WatchlistDraftMap = Partial<Record<'simkl' | 'trakt', WatchlistDraftConn>>;

// Pre-creation OAuth start: no row exists yet, so no bearer. The callback
// posts the tokens to the opener instead of sealing them; the page holds
// them in its draft and seals them at creation.
export function startWatchlistOAuthPublic(provider: string): Promise<{ url: string }> {
  return apiClient.get<{ url: string }>(
    `/api/setup/oauth/${encodeURIComponent(provider)}`,
  );
}

// Which providers this server can connect, so pre-creation cards know
// whether Connect is live before any UUID exists.
export function watchlistConfig(): Promise<{ simkl: boolean; trakt: boolean }> {
  return apiClient.get<{ simkl: boolean; trakt: boolean }>('/api/setup/watchlist-config');
}

// Drop empty connects before saving: only real tokens ride into the row.
export function cleanWatchlistDraft(draft: WatchlistDraftMap | null | undefined): Record<string, WatchlistDraftConn> {
  const out: Record<string, WatchlistDraftConn> = {};
  for (const [key, conn] of Object.entries(draft ?? {})) {
    if (conn && typeof conn.access_token === 'string' && conn.access_token) out[key] = conn;
  }
  return out;
}

export interface PublicCollectionItem {
  [key: string]: unknown;
}

export function browsePublicCollections(
  uuid: string, params: { sort?: string; search?: string; limit?: number }, editToken: string,
): Promise<unknown> {
  const query = new URLSearchParams();
  if (params.sort) query.set('sort', params.sort);
  if (params.search) query.set('search', params.search);
  if (params.limit) query.set('limit', String(params.limit));
  const suffix = query.toString();
  return apiClient.get<unknown>(
    `/api/setup/${encodeURIComponent(uuid)}/nuvio-community/collections${suffix ? `?${suffix}` : ''}`,
    bearer(editToken),
  );
}

export function fetchPublicCollection(uuid: string, id: string, editToken: string): Promise<unknown> {
  return apiClient.get<unknown>(
    `/api/setup/${encodeURIComponent(uuid)}/nuvio-community/collections/${encodeURIComponent(id)}`,
    bearer(editToken),
  );
}

// Pre-creation browsing for the collections studio: no setup row exists yet,
// so the public directory is read through the shared website proxy with the
// draft Nuvio session. Same narrow read-only contract (never stored); the
// sealed-row proxy above stays the path once a setup exists.
function nuvioSessionHeaders(nuvioToken: string): { headers: Record<string, string> } {
  return { headers: { 'x-nuvio-access-token': nuvioToken } };
}

export function browsePublicCollectionsBySession(
  nuvioToken: string, params: { sort?: string; search?: string; limit?: number },
): Promise<unknown> {
  const query = new URLSearchParams();
  if (params.sort) query.set('sort', params.sort);
  if (params.search) query.set('search', params.search);
  if (params.limit) query.set('limit', String(params.limit));
  const suffix = query.toString();
  return apiClient.get<unknown>(
    `/api/nuvio-community/collections${suffix ? `?${suffix}` : ''}`,
    nuvioSessionHeaders(nuvioToken),
  );
}

export function fetchPublicCollectionBySession(nuvioToken: string, id: string): Promise<unknown> {
  return apiClient.get<unknown>(
    `/api/nuvio-community/collections/${encodeURIComponent(id)}`,
    nuvioSessionHeaders(nuvioToken),
  );
}

export function clearSetupCache(installToken: string): Promise<{ success?: boolean; error?: string }> {
  return apiClient.post<{ success?: boolean; error?: string }>(
    `/api/clear-cache/${encodeURIComponent(installToken)}`,
    {},
  );
}

// Accepts a pasted install link or a bare token id and returns the id the
// migrate endpoint wants. Handles every old URL shape: bare ids,
// /{id}/manifest.json, /{id}/configure, /accounts/{id}/configure and
// /accounts/collections/{id}/configure (with or without trailing slash,
// query or hash). Previously only manifest.json was unwrapped, so pasting a
// configure URL extracted "configure" and the import always missed.
export function tokenIdFromInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withoutQuery = trimmed.split(/[?#]/, 1)[0] ?? '';
  const parts = withoutQuery.split('/').filter(Boolean);
  if (parts.length === 0) return '';
  // Drop a trailing action segment: the token id is the segment before it.
  // Also tolerate a trailing slash (already filtered) and scheme prefix
  // (https:, lelibrary.uk) by reading from the end, never the start.
  const action = (parts[parts.length - 1] ?? '').toLowerCase();
  if (action === 'manifest.json' || action === 'configure') {
    return parts.length >= 2 ? (parts[parts.length - 2] ?? '') : '';
  }
  return parts[parts.length - 1] ?? '';
}

// Client mirror of the server's picker masking (first 4 + last 3 chars):
// lets the import UI show whether a pasted link matches the selected setup
// without ever holding full ids for unselected rows.
export function maskTokenId(id: string): string {
  return id.length > 7 ? `${id.slice(0, 4)}…${id.slice(-3)}` : '…';
}
