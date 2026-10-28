// A Nuvio client bound to one setup's sealed connection, for one request.
//
// - One token refresh at a time per setup (Nuvio rotates refresh tokens and
//   reusing an old one can end the session): concurrent callers share the
//   flight, and a caller whose token was already replaced just retries.
// - A request is retried once after a 401 and a refresh.
// - A rotated token is always saved back through the caller's `persist`.
// - Errors never carry a URL, body, token or addon link: only the HTTP status
//   and PostgREST's error code.
//
// Destructive calls this client deliberately does not have: sync_push_addons
// (deletes every row not sent), sync_restore_account_backup (whole account),
// anything on watch history, trackers, provider credentials or PINs.
import type { PushApi, PushConnection } from '../setup/push.ts';

const push = require('../setup/push.ts') as PushApi;

export type BlobPlatform = 'tv' | 'mobile';
const HOME_PLATFORM = 'home_catalog_shared';

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  data?: unknown;
  timeout: number;
}
export interface HttpResponse { status: number; data: unknown }
export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

export interface NuvioClientOptions {
  uuid: string;
  connection: PushConnection;
  // Save a rotated connection (merge into the sealed keys).
  persist?: (connection: PushConnection) => Promise<void>;
  // Re-read the stored connection: another request may already have rotated it.
  reload?: () => Promise<PushConnection | null>;
  http?: HttpTransport;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface Row { [key: string]: unknown }

export interface NuvioClient {
  readonly uuid: string;
  connection: () => PushConnection;
  rpc: (name: string, body?: Record<string, unknown>) => Promise<unknown>;
  rest: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<unknown>;
  ownerId: () => Promise<string>;
  pullProfiles: () => Promise<Row[]>;
  patchProfile: (index: number, patch: ProfilePatch) => Promise<void>;
  createProfile: (input: { name: string; color: string }) => Promise<number>;
  deleteProfile: (index: number) => Promise<void>;
  listAddons: (profileIndex: number) => Promise<Row[]>;
  insertAddon: (profileIndex: number, row: AddonRowInput) => Promise<Row | null>;
  updateAddon: (profileIndex: number, id: string, patch: Partial<AddonRowInput>) => Promise<Row | null>;
  deleteAddon: (profileIndex: number, id: string) => Promise<void>;
  pullCollections: (profileIndex: number) => Promise<{ items: Row[]; updatedAt: string | null }>;
  pushCollections: (profileIndex: number, items: unknown[]) => Promise<void>;
  pullHome: (profileIndex: number) => Promise<{ doc: Row | null; updatedAt: string | null }>;
  pushHome: (profileIndex: number, doc: Row) => Promise<void>;
  pullSettings: (profileIndex: number, platform: BlobPlatform) => Promise<{ blob: Row | null; updatedAt: string | null }>;
  pushSettings: (profileIndex: number, platform: BlobPlatform, blob: Row, expectedUpdatedAt: string | null) => Promise<void>;
  copyProfileSetup: (source: number, target: number) => Promise<unknown>;
}

export interface ProfilePatch { name?: string; color?: string; usesPrimaryAddons?: boolean }
export interface AddonRowInput { url: string; name: string | null; enabled: boolean; sort_order: number }

// HTTP failure from Nuvio, without anything sensitive in it.
class NuvioHttpError extends Error {
  status: number;
  pgCode: string;
  constructor(status: number, pgCode: string) {
    super(`Nuvio request failed (HTTP ${status}${pgCode ? `, ${pgCode}` : ''})`);
    this.name = 'NuvioHttpError';
    this.status = status;
    this.pgCode = pgCode;
  }
}

// What a route turns into `{ error, code }`.
class NuvioManagerError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'NuvioManagerError';
    this.status = status;
    this.code = code;
  }
}

function sessionExpired(): NuvioManagerError {
  return new NuvioManagerError(409, 'nuvio-session-expired', 'Your Nuvio sign-in has expired. Sign in to Nuvio again.');
}

function isMissingRpc(err: unknown): boolean {
  const e = err as NuvioHttpError;
  return e instanceof NuvioHttpError && (e.pgCode === 'PGRST202' || e.status === 404);
}

function isConflict(err: unknown): boolean {
  const e = err as NuvioHttpError;
  return e instanceof NuvioHttpError && (e.status === 409 || e.pgCode === 'PT409');
}

const PROFILE_COLUMNS_NEVER_PUSHED = [
  'id', 'user_id', 'created_at', 'updated_at', 'profile_id',
  'pin_enabled', 'pin_hash', 'pin_updated_at', 'failed_pin_attempts', 'pin_locked_until',
];
const ADDON_COLUMNS = 'id,url,name,enabled,sort_order,profile_id,updated_at';
const MAX_PROFILES = 6;

// A profile row as sync_push_profiles takes it: every pulled field passed
// through, minus ids, timestamps and PIN state (never written by us). The
// avatar_url key makes the server clear avatar_id, so it is only sent when set.
function profilePushEntry(raw: Row): Row {
  const out: Row = { ...raw };
  for (const key of PROFILE_COLUMNS_NEVER_PUSHED) delete out[key];
  const index = Math.trunc(Number(raw['profile_index'] ?? raw['profile_id']));
  out['profile_index'] = index;
  out['name'] = String(raw['name'] ?? '').trim() || `Profile ${index}`;
  out['avatar_color_hex'] = String(raw['avatar_color_hex'] ?? '').trim() || '#1E88E5';
  out['uses_primary_addons'] = index > 1 && raw['uses_primary_addons'] === true;
  out['uses_primary_plugins'] = index > 1 && raw['uses_primary_plugins'] === true;
  if (!String(raw['avatar_url'] ?? '').trim()) delete out['avatar_url'];
  for (const key of ['avatar_id', 'profile_background_id', 'profile_background_url']) {
    if (out[key] === null || out[key] === undefined || out[key] === '') delete out[key];
  }
  return out;
}

function firstRow(data: unknown): Row | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === 'object' && !Array.isArray(row) ? row as Row : null;
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function asObject(raw: unknown): Row | null {
  const parsed = parseJson(raw);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Row : null;
}

function stamp(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function defaultTransport(): HttpTransport {
  const axios = require('axios');
  return async (request) => {
    const response = await axios({
      method: request.method,
      url: request.url,
      headers: request.headers,
      ...(request.data === undefined ? {} : { data: request.data }),
      timeout: request.timeout,
      maxRedirects: 0,
      validateStatus: () => true,
    });
    return { status: Number(response.status), data: response.data };
  };
}

// Setup uuid -> the refresh in progress.
const refreshFlights = new Map<string, Promise<PushConnection | null>>();

function createNuvioClient(options: NuvioClientOptions): NuvioClient {
  const uuid = String(options.uuid).toLowerCase();
  const http = options.http || defaultTransport();
  const baseUrl = options.baseUrl || push.NUVIO_API_BASE;
  const timeout = options.timeoutMs || 20000;
  const originId = push.originClientId(uuid);
  let conn: PushConnection = { ...options.connection };
  let owner: string | null = null;

  async function send(method: string, path: string, body: unknown, headers: Record<string, string>, token: string): Promise<unknown> {
    const response = await http({
      method,
      url: `${baseUrl}${path}`,
      headers: {
        'Content-Type': 'application/json',
        apikey: push.NUVIO_PUBLISHABLE_KEY,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { data: body }),
      timeout,
    });
    if (response.status >= 200 && response.status < 300) return response.data;
    const data = (response.data && typeof response.data === 'object' ? response.data : {}) as Row;
    throw new NuvioHttpError(response.status, typeof data['code'] === 'string' ? data['code'] as string : '');
  }

  async function refresh(failedToken: string): Promise<PushConnection | null> {
    const running = refreshFlights.get(uuid);
    if (running) return running;
    const flight = (async (): Promise<PushConnection | null> => {
      try {
        // Already replaced by another request in this process or elsewhere.
        const stored = options.reload ? await options.reload().catch(() => null) : null;
        const storedToken = stored ? push.savedNuvioAccessToken(stored) : '';
        if (stored && storedToken && storedToken !== failedToken) return stored;
        const base = stored || conn;
        const refreshToken = push.savedNuvioRefreshToken(base);
        if (!refreshToken) return null;
        const response = await http({
          method: 'POST',
          url: `${baseUrl}/auth/v1/token?grant_type=refresh_token`,
          headers: { 'Content-Type': 'application/json', apikey: push.NUVIO_PUBLISHABLE_KEY },
          data: { refresh_token: refreshToken },
          timeout,
        }).catch(() => null);
        const data = (response?.data || {}) as Row;
        if (!response || response.status !== 200 || typeof data['access_token'] !== 'string' || !data['access_token']) return null;
        const next: PushConnection = {
          ...base,
          nuvioToken: data['access_token'] as string,
          nuvioRefresh: typeof data['refresh_token'] === 'string' && data['refresh_token'] ? data['refresh_token'] as string : refreshToken,
        };
        if (options.persist) await options.persist(next).catch(() => {});
        return next;
      } finally {
        refreshFlights.delete(uuid);
      }
    })();
    refreshFlights.set(uuid, flight);
    return flight;
  }

  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<unknown> {
    const token = push.savedNuvioAccessToken(conn);
    if (!token) throw sessionExpired();
    try {
      return await send(method, path, body, headers, token);
    } catch (err) {
      if (!(err instanceof NuvioHttpError) || err.status !== 401) throw err;
    }
    const next = push.savedNuvioAccessToken(conn) !== token ? conn : await refresh(token);
    if (!next) throw sessionExpired();
    conn = next;
    try {
      return await send(method, path, body, headers, push.savedNuvioAccessToken(conn));
    } catch (err) {
      if (err instanceof NuvioHttpError && err.status === 401) throw sessionExpired();
      throw err;
    }
  }

  const rpc = (name: string, body: Record<string, unknown> = {}) => call('POST', `/rest/v1/rpc/${name}`, body);

  async function ownerId(): Promise<string> {
    if (owner) return owner;
    const data = await rpc('get_sync_owner');
    const value = Array.isArray(data) ? data[0] : data;
    const record = (value && typeof value === 'object' ? value : {}) as Row;
    const id = typeof value === 'string' ? value : String(record['get_sync_owner'] || record['owner_id'] || record['id'] || '');
    if (!id) throw new NuvioManagerError(502, 'nuvio-error', 'Nuvio did not say which account this is.');
    owner = id;
    return id;
  }

  async function pullProfiles(): Promise<Row[]> {
    const data = await rpc('sync_pull_profiles');
    const list = Array.isArray(data) ? data : ((data as Row | null)?.['profiles'] as unknown[] | undefined) || [];
    return (Array.isArray(list) ? list : []).filter((row): row is Row => Boolean(row) && typeof row === 'object');
  }

  async function pushProfiles(rows: Row[]): Promise<void> {
    await rpc('sync_push_profiles', {
      p_profiles: rows.map(profilePushEntry),
      p_client_max_profiles: MAX_PROFILES,
      p_origin_client_id: originId,
    });
  }

  // Sparse edit of one profile. When the server has no sync_patch_profile,
  // the whole freshly pulled list goes back with only this profile changed
  // (an older server deleted profiles missing from a push).
  async function patchProfile(index: number, patch: ProfilePatch): Promise<void> {
    try {
      await rpc('sync_patch_profile', {
        p_profile_id: index,
        p_name: patch.name ?? null,
        p_avatar_color_hex: patch.color ?? null,
        p_uses_primary_addons: patch.usesPrimaryAddons ?? null,
        p_uses_primary_plugins: null,
        p_avatar_url: null,
        p_avatar_url_provided: false,
        p_avatar_id: null,
        p_avatar_id_provided: false,
        p_profile_background_id: null,
        p_profile_background_id_provided: false,
        p_profile_background_url: null,
        p_profile_background_url_provided: false,
      });
      return;
    } catch (err) {
      if (!isMissingRpc(err)) throw err;
    }
    const rows = await pullProfiles();
    const target = rows.find((row) => Math.trunc(Number(row['profile_index'])) === index);
    if (!target) throw new NuvioManagerError(404, 'not-found', 'That Nuvio profile no longer exists.');
    await pushProfiles(rows.map((row) => {
      if (row !== target) return row;
      const next: Row = { ...row };
      if (patch.name !== undefined) next['name'] = patch.name;
      if (patch.color !== undefined) next['avatar_color_hex'] = patch.color;
      if (patch.usesPrimaryAddons !== undefined) next['uses_primary_addons'] = patch.usesPrimaryAddons;
      return next;
    }));
  }

  // Full freshly pulled list plus the new profile at the lowest free index
  // 2..6. Returns the new index.
  async function createProfile(input: { name: string; color: string }): Promise<number> {
    const rows = await pullProfiles();
    const used = new Set(rows.map((row) => Math.trunc(Number(row['profile_index']))));
    let index = 0;
    for (let candidate = 2; candidate <= MAX_PROFILES; candidate += 1) {
      if (!used.has(candidate)) { index = candidate; break; }
    }
    if (!index || rows.length >= MAX_PROFILES) {
      throw new NuvioManagerError(409, 'profile-limit', 'Nuvio allows up to 6 profiles.');
    }
    await pushProfiles([...rows, {
      profile_index: index,
      name: input.name,
      avatar_color_hex: input.color,
      uses_primary_addons: false,
      uses_primary_plugins: false,
    }]);
    return index;
  }

  async function deleteProfile(index: number): Promise<void> {
    if (index <= 1) throw new NuvioManagerError(409, 'profile-protected', 'The main profile cannot be deleted.');
    await rpc('sync_delete_profile_data', { p_profile_id: index, p_origin_client_id: originId });
  }

  async function listAddons(profileIndex: number): Promise<Row[]> {
    const data = await call('GET', `/rest/v1/addons?select=${ADDON_COLUMNS}&profile_id=eq.${profileIndex}&order=sort_order.asc`);
    return (Array.isArray(data) ? data : []).filter((row): row is Row => Boolean(row) && typeof row === 'object');
  }

  async function insertAddon(profileIndex: number, row: AddonRowInput): Promise<Row | null> {
    const userId = await ownerId();
    const data = await call('POST', `/rest/v1/addons?select=${ADDON_COLUMNS}`, [{
      user_id: userId,
      profile_id: profileIndex,
      url: row.url,
      name: row.name,
      enabled: row.enabled,
      sort_order: row.sort_order,
    }], { Prefer: 'return=representation' });
    return firstRow(data);
  }

  async function updateAddon(profileIndex: number, id: string, patch: Partial<AddonRowInput>): Promise<Row | null> {
    const body: Row = {};
    for (const key of ['name', 'enabled', 'sort_order'] as const) {
      if (patch[key] !== undefined) body[key] = patch[key];
    }
    const data = await call('PATCH',
      `/rest/v1/addons?id=eq.${encodeURIComponent(id)}&profile_id=eq.${profileIndex}&select=${ADDON_COLUMNS}`,
      body, { Prefer: 'return=representation' });
    return firstRow(data);
  }

  async function deleteAddon(profileIndex: number, id: string): Promise<void> {
    await call('DELETE', `/rest/v1/addons?id=eq.${encodeURIComponent(id)}&profile_id=eq.${profileIndex}`);
  }

  async function pullCollections(profileIndex: number): Promise<{ items: Row[]; updatedAt: string | null }> {
    const row = firstRow(await rpc('sync_pull_collections', { p_profile_id: profileIndex }));
    const list = parseJson(row?.['collections_json']);
    return {
      items: (Array.isArray(list) ? list : []).filter((item): item is Row => Boolean(item) && typeof item === 'object'),
      updatedAt: stamp(row?.['updated_at']),
    };
  }

  async function pushCollections(profileIndex: number, items: unknown[]): Promise<void> {
    await rpc('sync_push_collections', {
      p_profile_id: profileIndex,
      p_collections_json: items,
      p_origin_client_id: originId,
    });
  }

  async function pullHome(profileIndex: number): Promise<{ doc: Row | null; updatedAt: string | null }> {
    const row = firstRow(await rpc('sync_pull_home_catalog_settings', { p_profile_id: profileIndex, p_platform: HOME_PLATFORM }));
    return { doc: asObject(row?.['settings_json']), updatedAt: stamp(row?.['updated_at']) };
  }

  async function pushHome(profileIndex: number, doc: Row): Promise<void> {
    await rpc('sync_push_home_catalog_settings', {
      p_profile_id: profileIndex,
      p_settings_json: doc,
      p_platform: HOME_PLATFORM,
      p_origin_client_id: originId,
    });
  }

  async function pullSettings(profileIndex: number, platform: BlobPlatform): Promise<{ blob: Row | null; updatedAt: string | null }> {
    const row = firstRow(await rpc('sync_pull_profile_settings_blob', { p_profile_id: profileIndex, p_platform: platform }));
    return { blob: asObject(row?.['settings_json']), updatedAt: stamp(row?.['updated_at']) };
  }

  // Guarded write: Nuvio answers 409 when a device saved since we read. A
  // server without the guarded call gets the plain push (last write wins).
  async function pushSettings(profileIndex: number, platform: BlobPlatform, blob: Row, expectedUpdatedAt: string | null): Promise<void> {
    try {
      await rpc('sync_push_profile_settings_blob_guarded', {
        p_profile_id: profileIndex,
        p_settings_json: blob,
        p_platform: platform,
        p_expected_updated_at: expectedUpdatedAt,
      });
      return;
    } catch (err) {
      if (isConflict(err)) {
        throw new NuvioManagerError(409, 'nuvio-conflict', 'These settings changed on a device since they were loaded. Reload and try again.');
      }
      if (!isMissingRpc(err)) throw err;
    }
    await rpc('sync_push_profile_settings_blob', {
      p_profile_id: profileIndex,
      p_settings_json: blob,
      p_platform: platform,
      p_origin_client_id: originId,
    });
  }

  // Server-side copy of the settings blobs. Never provider credentials.
  async function copyProfileSetup(source: number, target: number): Promise<unknown> {
    return rpc('sync_copy_profile_setup', {
      p_source_profile_id: source,
      p_target_profile_id: target,
      p_copy_tv: true,
      p_copy_mobile: true,
      p_copy_desktop: false,
      p_copy_provider_credentials: false,
      p_replace_provider_credentials: false,
      p_origin_client_id: originId,
    });
  }

  return {
    uuid,
    connection: () => conn,
    rpc,
    rest: (method, path, body, headers) => call(method, path, body, headers),
    ownerId,
    pullProfiles,
    patchProfile,
    createProfile,
    deleteProfile,
    listAddons,
    insertAddon,
    updateAddon,
    deleteAddon,
    pullCollections,
    pushCollections,
    pullHome,
    pushHome,
    pullSettings,
    pushSettings,
    copyProfileSetup,
  };
}

export interface NuvioClientApi {
  HOME_PLATFORM: string;
  MAX_PROFILES: number;
  NuvioHttpError: typeof NuvioHttpError;
  NuvioManagerError: typeof NuvioManagerError;
  createNuvioClient: (options: NuvioClientOptions) => NuvioClient;
  profilePushEntry: (raw: Row) => Row;
  isMissingRpc: (err: unknown) => boolean;
  isConflict: (err: unknown) => boolean;
}

module.exports = {
  HOME_PLATFORM,
  MAX_PROFILES,
  NuvioHttpError,
  NuvioManagerError,
  createNuvioClient,
  profilePushEntry,
  isMissingRpc,
  isConflict,
} satisfies NuvioClientApi;
