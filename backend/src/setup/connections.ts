// Platform + watchlist credentials inside a v5.5 config row.
//
// The row has exactly one encryption mechanism (seal.js, AES-256-GCM, server
// key) for every secret type. Platform credentials are sealed — never hashed,
// because a push must read them back — under `keys.push.{stremio,nuvio}` and
// watchlist tokens under `keys.watchlist.{simkl,trakt}`. The setup password
// stays a one-way hash gating edits and has nothing to do with these.
import type { OpenedConfig } from './config-store.ts';
import type { PushApi, PushConnection } from './push.ts';

const axios = require('axios');
const { refreshNuvioToken } = require('./push.ts') as PushApi;

export type WatchlistProvider = 'simkl' | 'trakt';

export interface WatchlistConn {
  access_token?: string;
  refresh_token?: string | null;
  expires_at?: number | null;
  client_id?: string;
  [key: string]: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

// The store type without importing pg typings: only what this module calls.
export interface SetupStoreLike {
  resolveByToken: (token: unknown) => Promise<OpenedConfig | null>;
  resolveByUuid: (uuid: unknown) => Promise<OpenedConfig | null>;
  save: (uuid: unknown, input: { keys?: Record<string, unknown> }) => Promise<unknown>;
}

function readPush(opened: OpenedConfig | null, platform: string): PushConnection | null {
  const envelope = asRecord(asRecord(opened?.keys)['push']);
  const conn = asRecord(envelope[platform]);
  if (!conn || Object.keys(conn).length === 0) return null;
  return conn as PushConnection;
}

function readWatchlist(opened: OpenedConfig | null, provider: string): WatchlistConn | null {
  const envelope = asRecord(asRecord(opened?.keys)['watchlist']);
  const conn = asRecord(envelope[provider]);
  if (!conn || typeof conn['access_token'] !== 'string' || !conn['access_token']) return null;
  return conn as WatchlistConn;
}

// Shape check before anything is sealed. Supersets are fine (user, profiles).
function validatePushConnection(platform: string, data: unknown): string | null {
  const conn = asRecord(data);
  if (platform === 'stremio') {
    return typeof conn['stremioAuth'] === 'string' && (conn['stremioAuth'] as string).trim()
      ? null
      : 'Stremio did not return a session token';
  }
  if (platform === 'nuvio') {
    return typeof conn['nuvioToken'] === 'string' && (conn['nuvioToken'] as string).trim()
      ? null
      : 'Nuvio did not return a session token';
  }
  return 'Unknown platform';
}

function mergePushKeys(
  current: Record<string, unknown>,
  platform: string,
  connection: Record<string, unknown>,
): Record<string, unknown> {
  return { ...current, push: { ...asRecord(current['push']), [platform]: connection } };
}

function mergeWatchlistKeys(
  current: Record<string, unknown>,
  provider: string,
  connection: Record<string, unknown>,
): Record<string, unknown> {
  return { ...current, watchlist: { ...asRecord(current['watchlist']), [provider]: connection } };
}

function dropEnvelopeKey(
  current: Record<string, unknown>,
  envelope: string,
  key: string,
): Record<string, unknown> {
  const next = { ...asRecord(current[envelope]) };
  delete next[key];
  return { ...current, [envelope]: next };
}

// Trakt refresh single-flight per setup: a reused/rotated refresh token kills
// the connection, so concurrent catalog opens must not race the rotation.
const traktRefreshInFlight = new Map<string, Promise<WatchlistConn | null>>();

async function refreshTraktForSetup(store: SetupStoreLike, uuid: string, conn: WatchlistConn): Promise<WatchlistConn | null> {
  const flightKey = `${uuid}:trakt`;
  const running = traktRefreshInFlight.get(flightKey);
  if (running) return running;
  const flight = (async (): Promise<WatchlistConn | null> => {
    try {
      const refreshed = await axios.post('https://api.trakt.tv/oauth/token', {
        refresh_token: conn.refresh_token,
        client_id: process.env['TRAKT_CLIENT_ID'],
        client_secret: process.env['TRAKT_CLIENT_SECRET'],
        redirect_uri: oauthCallbackUrl('trakt'),
        grant_type: 'refresh_token',
      }, { timeout: 15000 });
      const data = (refreshed.data || {}) as Record<string, unknown>;
      if (typeof data['access_token'] !== 'string' || !data['access_token']) {
        throw new Error('Trakt refresh returned no access token');
      }
      const expiresIn = Number(data['expires_in'] || 0);
      const createdAt = Number(data['created_at'] || Math.floor(Date.now() / 1000));
      const next: WatchlistConn = {
        access_token: data['access_token'] as string,
        refresh_token: (data['refresh_token'] as string) || (conn.refresh_token as string),
        expires_at: expiresIn ? (createdAt + expiresIn) * 1000 : null,
        client_id: process.env['TRAKT_CLIENT_ID'],
      };
      const opened = await store.resolveByUuid(uuid).catch(() => null);
      if (opened) await store.save(uuid, { keys: mergeWatchlistKeys(asRecord(opened.keys), 'trakt', next) }).catch(() => {});
      return next;
    } catch {
      // Another concurrent refresh may have just rotated the stored token —
      // re-read it before declaring the connection dead.
      try {
        const reread = await store.resolveByUuid(uuid).catch(() => null);
        const current = readWatchlist(reread, 'trakt');
        if (current && current.refresh_token && current.refresh_token !== conn.refresh_token &&
          current.expires_at && Number(current.expires_at) > Date.now()) return current;
      } catch { /* fall through */ }
      return null;
    } finally {
      traktRefreshInFlight.delete(flightKey);
    }
  })();
  traktRefreshInFlight.set(flightKey, flight);
  return flight;
}

function baseOrigin(): string {
  return (process.env['BASE_URL'] || '').replace(/\/+$/, '');
}

function oauthCallbackUrl(provider: string): string {
  return `${baseOrigin()}/api/setup/oauth/${provider}/callback`;
}

// Server-side read path for addon serving: resolve an install token to its
// stored watchlist connection. Trakt tokens refresh here, where the row is
// already open, so users never reconnect just because a catalogue opened
// after the token lifetime.
async function setupWatchlistConn(
  store: SetupStoreLike,
  installToken: unknown,
  provider: string,
): Promise<WatchlistConn | null> {
  const opened = await store.resolveByToken(installToken).catch(() => null);
  if (!opened) return null;
  const conn = readWatchlist(opened, provider);
  if (!conn) return null;
  if (provider === 'trakt' && conn.refresh_token && conn.expires_at && Number(conn.expires_at) <= Date.now() + 60000) {
    return refreshTraktForSetup(store, opened.uuid, conn);
  }
  return conn;
}

export interface ConnectionsApi {
  readPush: (opened: OpenedConfig | null, platform: string) => PushConnection | null;
  readWatchlist: (opened: OpenedConfig | null, provider: string) => WatchlistConn | null;
  validatePushConnection: (platform: string, data: unknown) => string | null;
  mergePushKeys: (current: Record<string, unknown>, platform: string, connection: Record<string, unknown>) => Record<string, unknown>;
  mergeWatchlistKeys: (current: Record<string, unknown>, provider: string, connection: Record<string, unknown>) => Record<string, unknown>;
  dropEnvelopeKey: (current: Record<string, unknown>, envelope: string, key: string) => Record<string, unknown>;
  setupWatchlistConn: (store: SetupStoreLike, installToken: unknown, provider: string) => Promise<WatchlistConn | null>;
  refreshNuvioToken: PushApi['refreshNuvioToken'];
}

module.exports = {
  readPush,
  readWatchlist,
  validatePushConnection,
  mergePushKeys,
  mergeWatchlistKeys,
  dropEnvelopeKey,
  setupWatchlistConn,
  refreshNuvioToken,
} satisfies ConnectionsApi;
