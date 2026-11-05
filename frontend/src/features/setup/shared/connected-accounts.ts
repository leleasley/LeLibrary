import { useCallback, useEffect, useState } from 'react';
import { apiErrorCopy } from '@/api/error-copy';
import { toast } from '@/features/setup/shared/Toast';
import {
  disconnectWatchlist,
  startWatchlistOAuth,
  startWatchlistOAuthPublic,
  watchlistConfig,
  watchlistStatus,
  type WatchlistDraftConn,
  type WatchlistDraftMap,
  type WatchlistProvider,
  type WatchlistServerConfig,
  type WatchlistState,
} from '@/features/setup/resolver/api';

export const WATCHLIST_PROVIDER_NAMES: Record<WatchlistProvider, string> = {
  simkl: 'Simkl',
  trakt: 'Trakt',
  anilist: 'AniList',
};

const PROVIDERS: readonly WatchlistProvider[] = ['simkl', 'trakt', 'anilist'];

// Whether this server can connect a provider: true/false once known, null
// while the capability check is in flight (or failed), so a card never
// flashes away. Post-creation the setup's own status answers; before it, the
// public server config does.
export function providerConfigured(
  provider: WatchlistProvider,
  options: { precreation: boolean; config: WatchlistServerConfig | null; status: WatchlistState | null | undefined },
): boolean | null {
  const { precreation, config, status } = options;
  if (!precreation) {
    const state = status?.[provider];
    if (state) return state.configured;
  }
  return config ? config[provider] : null;
}

// Which connect cards show. Providers the server has no OAuth app for are
// hidden outright: a dead Connect button next to "Not configured on this
// server" reads as broken. Trakt is kept only for setups already connected
// once the server marks it legacy (creating a Trakt app needs Trakt VIP), so
// new setups are not offered it. AniList (Connect only since v6, like Simkl)
// shows where the server has an AniList app, where it is connected, or for
// an older setup's saved public AniList name. Pure for unit tests.
export function visibleConnectCards(options: {
  precreation: boolean;
  config: WatchlistServerConfig | null;
  status: WatchlistState | null | undefined;
  connected: (provider: WatchlistProvider) => boolean;
  // An older setup's saved public AniList name (the hook's publicUser).
  publicUser?: (() => string | null) | undefined;
}): WatchlistProvider[] {
  return PROVIDERS.filter((provider) => {
    if (options.connected(provider)) return true;
    if (provider === 'anilist' && options.publicUser?.()) return true;
    if (provider === 'trakt' && (options.config?.traktLegacy === true || options.status?.trakt?.legacy === true)) return false;
    return providerConfigured(provider, options) !== false;
  });
}

// A display name as the server sends it: trimmed, at most 80 characters.
export function cleanAccountName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= 80 ? name : null;
}

// Keep only the token fields the backend seals (plus the display name);
// anything else the popup posts is dropped rather than stored.
export function cleanConn(value: unknown): WatchlistDraftConn | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record['access_token'] !== 'string' || !record['access_token']) return null;
  const out: WatchlistDraftConn = { access_token: record['access_token'] };
  if (typeof record['refresh_token'] === 'string') out.refresh_token = record['refresh_token'];
  if (typeof record['expires_at'] === 'number') out.expires_at = record['expires_at'];
  if (typeof record['client_id'] === 'string') out.client_id = record['client_id'];
  const username = cleanAccountName(record['username']);
  if (username) out.username = username;
  return out;
}

// A pre-creation popup's message (`lelibraryWatchlistTokens`, sent by the
// server's OAuth callback): the draft with that provider's tokens added
// (Simkl, AniList or Trakt), 'no-tokens' when the sign-in returned none, or
// null for any other message. The draft lives in page memory only
// (draft-secrets) and seals at creation as keys.watchlist. Pure for tests.
export function draftFromPopupTokens(
  data: unknown,
  draft: WatchlistDraftMap | null | undefined,
): { next: WatchlistDraftMap; provider: WatchlistProvider } | 'no-tokens' | null {
  if (!data || typeof data !== 'object') return null;
  const tokens = (data as { lelibraryWatchlistTokens?: { provider?: unknown; connection?: unknown; username?: unknown } }).lelibraryWatchlistTokens;
  const provider = tokens?.provider;
  if (!tokens || typeof provider !== 'string' || !(PROVIDERS as readonly string[]).includes(provider)) return null;
  const conn = cleanConn(tokens.connection);
  if (!conn) return 'no-tokens';
  // The account name rides next to the tokens (and inside the connection).
  const username = cleanAccountName(tokens.username) ?? conn.username ?? null;
  if (username) conn.username = username; else delete conn.username;
  const key = provider as WatchlistProvider;
  return { next: { ...(draft ?? {}), [key]: conn }, provider: key };
}

// "Connected as {name}" for one provider. Create mode: the name the popup
// sent (held in the draft next to the token). Edit mode: the name the
// status read reports (stored at connect time, so it shows as soon as the
// popup's message triggers the refresh); the config read's `saved` name is
// the fallback for older connections, unless the provider was connected or
// disconnected on this page (that name may be another account's). Pure.
export function accountIdentity(provider: WatchlistProvider, options: {
  precreation: boolean;
  draft: WatchlistDraftMap | null | undefined;
  status: WatchlistState | null | undefined;
  connected: boolean;
  changed: boolean;
  saved?: string | null | undefined;
}): string | null {
  if (!options.connected) return null;
  const own = options.precreation ? options.draft?.[provider]?.username : options.status?.[provider]?.username;
  const name = cleanAccountName(own);
  if (name) return name;
  return options.precreation || options.changed ? null : cleanAccountName(options.saved);
}

export interface WatchlistConnections {
  precreation: boolean;
  config: WatchlistServerConfig | null;
  status: WatchlistState | null;
  connected: (provider: WatchlistProvider) => boolean;
  // Connected, or (AniList) an older setup's saved public name: the
  // provider's rows are served either way.
  linked: (provider: WatchlistProvider) => boolean;
  // The account name for a connected provider: the popup's (create mode) or
  // the one stored at connect time (edit mode); `saved` (the config read's
  // identities) is the fallback for older connections, unless the provider
  // was connected or disconnected on this page.
  identity: (provider: WatchlistProvider, saved?: string | null) => string | null;
  // An older setup's saved public AniList name (no login), else null.
  publicUser: () => string | null;
  configured: (provider: WatchlistProvider) => boolean | null;
  // Connect needs an unlocked editor after creation (the bearer edit token).
  canConnect: boolean;
  connect: (provider: WatchlistProvider) => Promise<void>;
  disconnect: (provider: WatchlistProvider) => Promise<void>;
}

// Simkl / AniList / Trakt connects. After creation (UUID + edit token) OAuth
// seals straight into the setup row. Before creation the connects run on a
// draft: tokens arrive over postMessage, live in page state (module memory,
// never Web Storage) and seal at creation.
export function useWatchlistConnections({ uuid, editToken, draft, onDraft }: {
  uuid: string | null;
  editToken: string | null;
  draft?: WatchlistDraftMap | null | undefined;
  onDraft?: ((next: WatchlistDraftMap) => void) | undefined;
}): WatchlistConnections {
  const precreation = uuid === null;
  const [status, setStatus] = useState<WatchlistState | null>(null);
  const [config, setConfig] = useState<WatchlistServerConfig | null>(null);
  // Providers connected or disconnected on this page: their names come from
  // the fresh status only, never the config read's older identities.
  const [changed, setChanged] = useState<ReadonlySet<WatchlistProvider>>(() => new Set());
  const markChanged = useCallback((provider: WatchlistProvider) => {
    setChanged((current) => (current.has(provider) ? current : new Set([...current, provider])));
  }, []);

  const refresh = useCallback(() => {
    if (!uuid || !editToken) return;
    // A failed status read keeps the last known state (null on first load =
    // every provider offered); the next refresh or OAuth return tries again.
    watchlistStatus(uuid, editToken).then(setStatus).catch(() => undefined);
  }, [uuid, editToken]);

  useEffect(() => {
    let cancelled = false;
    // Unknown server config (null) offers the providers rather than hiding them.
    watchlistConfig().then((next) => { if (!cancelled) setConfig(next); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setStatus(null);
    if (!precreation) refresh();
  }, [refresh, precreation]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        lelibraryWatchlist?: string;
        ok?: boolean;
        lelibraryWatchlistTokens?: { provider?: unknown; connection?: unknown; username?: unknown };
      } | null;
      if (!data) return;
      if (typeof data.lelibraryWatchlist === 'string') {
        // The popup sealed a connection (with its account name): read the
        // status again so the card says "Connected as ..." at once.
        if (data.ok === true && (PROVIDERS as readonly string[]).includes(data.lelibraryWatchlist)) markChanged(data.lelibraryWatchlist as WatchlistProvider);
        refresh();
        return;
      }
      if (!precreation) return;
      const accepted = draftFromPopupTokens(data, draft);
      if (accepted === 'no-tokens') {
        toast('Sign-in did not return tokens', 'error');
        return;
      }
      if (accepted) {
        onDraft?.(accepted.next);
        toast(`${WATCHLIST_PROVIDER_NAMES[accepted.provider]} connected - saved with your setup`);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [refresh, precreation, draft, onDraft, markChanged]);

  const connected = (provider: WatchlistProvider) => (precreation
    ? Boolean(draft?.[provider]?.access_token)
    : status?.[provider]?.connected === true);

  async function connect(provider: WatchlistProvider) {
    if (!precreation && (!uuid || !editToken)) return;
    try {
      const { url } = precreation
        ? await startWatchlistOAuthPublic(provider)
        : await startWatchlistOAuth(uuid as string, provider, editToken as string);
      if (!url) return;
      window.open(url, '_blank', 'width=560,height=640');
      toast('Complete sign-in in the popup');
      // Fallback for popups that never message back.
      if (!precreation) setTimeout(refresh, 3000);
    } catch (error) {
      toast(apiErrorCopy(error, 'Could not start sign-in'), 'error');
    }
  }

  function publicUser(): string | null {
    return precreation ? null : cleanAccountName(status?.anilist?.publicUser);
  }

  async function disconnect(provider: WatchlistProvider) {
    if (precreation) {
      const next = { ...(draft ?? {}) };
      delete next[provider];
      onDraft?.(next);
      toast('Disconnected');
      return;
    }
    if (!uuid || !editToken) return;
    try {
      await disconnectWatchlist(uuid, provider, editToken);
      markChanged(provider);
      toast('Disconnected');
      refresh();
    } catch {
      toast('Could not disconnect', 'error');
    }
  }

  return {
    precreation,
    config,
    status,
    connected,
    linked: (provider) => connected(provider) || (provider === 'anilist' && publicUser() !== null),
    identity: (provider, saved) => accountIdentity(provider, {
      precreation, draft, status, connected: connected(provider), changed: changed.has(provider), saved,
    }),
    publicUser,
    configured: (provider) => providerConfigured(provider, { precreation, config, status }),
    canConnect: precreation || Boolean(uuid && editToken),
    connect,
    disconnect,
  };
}
