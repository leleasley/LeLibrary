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
// new setups are not offered it. AniList always shows: its username field
// works without any server app. Pure for unit tests.
export function visibleConnectCards(options: {
  precreation: boolean;
  config: WatchlistServerConfig | null;
  status: WatchlistState | null | undefined;
  connected: (provider: WatchlistProvider) => boolean;
}): WatchlistProvider[] {
  return PROVIDERS.filter((provider) => {
    if (provider === 'anilist') return true;
    if (options.connected(provider)) return true;
    if (provider === 'trakt' && options.config?.traktLegacy === true) return false;
    return providerConfigured(provider, options) !== false;
  });
}

// Keep only the token fields the backend seals; anything else the popup
// posts is dropped rather than stored.
export function cleanConn(value: unknown): WatchlistDraftConn | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record['access_token'] !== 'string' || !record['access_token']) return null;
  const out: WatchlistDraftConn = { access_token: record['access_token'] };
  if (typeof record['refresh_token'] === 'string') out.refresh_token = record['refresh_token'];
  if (typeof record['expires_at'] === 'number') out.expires_at = record['expires_at'];
  if (typeof record['client_id'] === 'string') out.client_id = record['client_id'];
  return out;
}

export interface WatchlistConnections {
  precreation: boolean;
  config: WatchlistServerConfig | null;
  status: WatchlistState | null;
  connected: (provider: WatchlistProvider) => boolean;
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
        lelibraryWatchlistTokens?: { provider?: unknown; connection?: unknown };
      } | null;
      if (!data) return;
      if (typeof data.lelibraryWatchlist === 'string') {
        refresh();
        return;
      }
      const tokens = data.lelibraryWatchlistTokens;
      const provider = tokens?.provider;
      if (precreation && tokens && typeof provider === 'string' && (PROVIDERS as readonly string[]).includes(provider)) {
        const conn = cleanConn(tokens.connection);
        if (!conn) {
          toast('Sign-in did not return tokens', 'error');
          return;
        }
        const key = provider as WatchlistProvider;
        onDraft?.({ ...(draft ?? {}), [key]: conn });
        toast(`${WATCHLIST_PROVIDER_NAMES[key]} connected - saved with your setup`);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [refresh, precreation, draft, onDraft]);

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
    configured: (provider) => providerConfigured(provider, { precreation, config, status }),
    canConnect: precreation || Boolean(uuid && editToken),
    connect,
    disconnect,
  };
}
