import { apiErrorCopy } from '@/api/error-copy';
import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/features/setup/shared/Toast';
import {
  disconnectWatchlist,
  startWatchlistOAuth,
  startWatchlistOAuthPublic,
  watchlistConfig,
  watchlistStatus,
  type WatchlistDraftConn,
  type WatchlistDraftMap,
  type WatchlistState,
} from '@/features/setup/resolver/api';

const PROVIDERS = [
  { key: 'simkl', name: 'Simkl', logo: '/logos/simkl.svg', blurb: 'Sync your personal lists and watch history' },
  { key: 'trakt', name: 'Trakt', logo: '/logos/trakt.svg', blurb: 'Sync your personal lists and watch history' },
] as const;

// Accordion copy for the section, shared by Settle In and Move In. Deliberately
// provider-free: the section hides whichever providers this server has no OAuth
// app for, so naming one would promise a connect card that may not render.
export const WATCHLIST_ACCORDION_DESC = 'Sync the lists you keep elsewhere into library rows. Connects seal into the setup at creation.';

type ProviderKey = 'simkl' | 'trakt';

// Providers the server has no OAuth app for are hidden outright ("blanked
// out"): a dead Connect button next to "Not configured on this server"
// reads as broken. While the capability check is still in flight (or post-
// creation while status loads) everything stays visible so the list never
// flashes empty. Pure for unit tests.
export function visibleWatchlistProviders<T extends { key: string }>(
  providers: readonly T[],
  options: {
    precreation: boolean;
    configured: { simkl: boolean; trakt: boolean } | null;
    status: WatchlistState | null | undefined;
    uuid: string | null;
  },
): T[] {
  const { precreation, configured, status, uuid } = options;
  return providers.filter((item) => {
    if (precreation) return configured === null || configured[item.key as ProviderKey] !== false;
    if (uuid === null) return true;
    if (status === undefined) return true;
    const state = status?.[item.key as ProviderKey];
    return state?.configured !== false;
  });
}

// Keep only the token fields the backend seals; anything else the popup
// posts is dropped rather than stored.
function cleanConn(value: unknown): WatchlistDraftConn | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record['access_token'] !== 'string' || !record['access_token']) return null;
  const out: WatchlistDraftConn = { access_token: record['access_token'] };
  if (typeof record['refresh_token'] === 'string') out.refresh_token = record['refresh_token'];
  if (typeof record['expires_at'] === 'number') out.expires_at = record['expires_at'];
  if (typeof record['client_id'] === 'string') out.client_id = record['client_id'];
  return out;
}

// Simkl/Trakt connects. After creation (UUID + edit token) OAuth seals
// straight into the setup row. Before creation the section runs on a draft:
// tokens arrive over postMessage, live in page state (and the page's local
// draft), and seal at creation. Without a draft the cards state the
// requirement instead of failing.
export function WatchlistSection({ uuid, editToken, draft, onDraft }: {
  uuid: string | null;
  editToken: string | null;
  draft?: WatchlistDraftMap | null | undefined;
  onDraft?: ((next: WatchlistDraftMap) => void) | undefined;
}) {
  const precreation = uuid === null && onDraft !== undefined;
  const [status, setStatus] = useState<WatchlistState | null>(null);
  const [configured, setConfigured] = useState<{ simkl: boolean; trakt: boolean } | null>(null);

  const refresh = useCallback(() => {
    if (!uuid || !editToken) return;
    watchlistStatus(uuid, editToken).then(setStatus).catch(() => {});
  }, [uuid, editToken]);

  useEffect(() => {
    setStatus(null);
    if (precreation) {
      watchlistConfig().then(setConfigured).catch(() => {});
      return;
    }
    setConfigured(null);
    refresh();
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
      if (precreation && tokens && (tokens.provider === 'simkl' || tokens.provider === 'trakt')) {
        const conn = cleanConn(tokens.connection);
        if (!conn) {
          toast('Sign-in did not return tokens', 'error');
          return;
        }
        onDraft?.({ ...(draft ?? {}), [tokens.provider]: conn });
        toast(`${tokens.provider === 'simkl' ? 'Simkl' : 'Trakt'} connected — saved with your setup`);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [refresh, precreation, draft, onDraft]);

  async function connect(provider: string) {
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

  async function disconnect(provider: string) {
    if (precreation) {
      const next = { ...(draft ?? {}) };
      delete next[provider as ProviderKey];
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

  const visible = visibleWatchlistProviders(PROVIDERS, { precreation, configured, status, uuid });
  if (visible.length === 0) {
    return (
      <div className="integration-list">
        <p className="setup-note">Watchlist sync isn&apos;t configured on this server.</p>
      </div>
    );
  }

  return (
    <div className="integration-list">
      {visible.map((item) => {
        const key = item.key as ProviderKey;
        const state = status?.[key];
        const connected = precreation ? !!draft?.[key]?.access_token : state?.connected === true;
        const unavailable = precreation
          ? configured !== null && configured[key] === false
          : uuid !== null && state !== undefined && state?.configured === false;
        return (
          <article className={`integration-card${connected ? ' is-connected' : ''}`} key={item.key}>
            <img src={item.logo} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />
            <div>
              <div className="integration-title">
                <strong data-i18n-preserve>{item.name}</strong>
                <span className={`verify-badge ${connected ? 'ok' : 'pending'}`}>
                  {connected ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <p>
                {uuid === null && !precreation
                  ? 'Create this setup first — connects live on the review step.'
                  : unavailable
                    ? 'Not configured on this server'
                    : precreation && connected
                      ? 'Connected — seals into the setup when you create it.'
                      : <span data-i18n-preserve>{item.blurb}</span>}
              </p>
            </div>
            {(uuid !== null || precreation) && (connected ? (
              <button type="button" className="setup-secondary" onClick={() => void disconnect(item.key)}>Disconnect</button>
            ) : (
              <button type="button" className="setup-secondary" disabled={unavailable} onClick={() => void connect(item.key)}>Connect</button>
            ))}
          </article>
        );
      })}
    </div>
  );
}
