import { useCallback, useEffect, useState } from 'react';
import { apiErrorCopy } from '@/api/error-copy';
import { toast } from '@/features/setup/shared/Toast';
import {
  disconnectWatchlist,
  startWatchlistOAuth,
  startWatchlistOAuthPublic,
  watchlistConfig,
  watchlistStatus,
  type StagedConnection,
  type StagedConnections,
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
// new setups are not offered it. AniList is Connect only (v6): no username
// path exists, so it shows where the server has an AniList app or where it is
// connected. Pure for unit tests.
export function visibleConnectCards(options: {
  precreation: boolean;
  config: WatchlistServerConfig | null;
  status: WatchlistState | null | undefined;
  connected: (provider: WatchlistProvider) => boolean;
  // A connect or disconnect waiting for Save keeps its card in sight (a
  // staged Trakt disconnect must stay undoable).
  staged?: ((provider: WatchlistProvider) => 'connect' | 'remove' | null) | undefined;
}): WatchlistProvider[] {
  return PROVIDERS.filter((provider) => {
    if (options.connected(provider)) return true;
    if (options.staged?.(provider)) return true;
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

// An edit-page popup's message (`lelibraryWatchlistPending`, v6): the
// provider, the server-side pending id and the account name, or null for
// any other message. Never a token. Pure for tests.
export function pendingFromPopup(data: unknown): { provider: WatchlistProvider; pendingId: string; username: string | null } | null {
  if (!data || typeof data !== 'object') return null;
  const pending = (data as { lelibraryWatchlistPending?: { provider?: unknown; pendingId?: unknown; username?: unknown } }).lelibraryWatchlistPending;
  const provider = pending?.provider;
  if (!pending || typeof provider !== 'string' || !(PROVIDERS as readonly string[]).includes(provider)) return null;
  const pendingId = typeof pending.pendingId === 'string' ? pending.pendingId.trim() : '';
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(pendingId)) return null;
  return { provider: provider as WatchlistProvider, pendingId, username: cleanAccountName(pending.username) };
}

// The saved status with the page's staged connects and disconnects laid
// over it, so every reader (cards, summary, "Your lists" shelves, Preview)
// follows what Save will write. Pure for tests.
export function effectiveWatchlistStatus(status: WatchlistState | null, staged: StagedConnections | null | undefined): WatchlistState | null {
  const changes = Object.entries(staged ?? {}).filter(([, change]) => Boolean(change)) as [WatchlistProvider, StagedConnection][];
  if (!changes.length) return status;
  const base: WatchlistState = status ?? { simkl: { connected: false, configured: true }, trakt: { connected: false, configured: true } };
  const next: WatchlistState = { ...base, simkl: { ...base.simkl }, trakt: { ...base.trakt }, ...(base.anilist ? { anilist: { ...base.anilist } } : {}) };
  for (const [provider, change] of changes) {
    const entry = { ...(next[provider] ?? { configured: true }), connected: !('remove' in change) } as { connected: boolean; configured: boolean; username?: string };
    delete entry.username;
    if (!('remove' in change) && change.username) entry.username = change.username;
    (next as unknown as Record<string, unknown>)[provider] = entry;
  }
  return next;
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
  configured: (provider: WatchlistProvider) => boolean | null;
  // Connect needs an unlocked editor after creation (the bearer edit token).
  canConnect: boolean;
  connect: (provider: WatchlistProvider) => Promise<void>;
  disconnect: (provider: WatchlistProvider) => Promise<void>;
  // Edit page (v6): a connect or disconnect waiting for Save, and undoing
  // one. Absent elsewhere (create mode, the Ready page).
  staged?: ((provider: WatchlistProvider) => 'connect' | 'remove' | null) | undefined;
  undo?: ((provider: WatchlistProvider) => void) | undefined;
}

// Simkl / AniList / Trakt connects. Before creation the connects run on a
// draft: tokens arrive over postMessage, live in page state (module memory,
// never Web Storage) and seal at creation. On the edit page (`onStage`, v6)
// they are staged like every other edit: the sign-in waits server-side as a
// pending id, a disconnect is a `{ remove: true }`, and Save commits both.
// The Move In Ready page (UUID + edit token, no `onStage`) seals at once.
export function useWatchlistConnections({ uuid, editToken, draft, onDraft, staged, onStage, revision }: {
  uuid: string | null;
  editToken: string | null;
  draft?: WatchlistDraftMap | null | undefined;
  onDraft?: ((next: WatchlistDraftMap) => void) | undefined;
  staged?: StagedConnections | undefined;
  onStage?: ((provider: WatchlistProvider, change: StagedConnection | null) => void) | undefined;
  // Moves after an edit save: the saved status is read again.
  revision?: number | undefined;
}): WatchlistConnections {
  const precreation = uuid === null;
  const staging = !precreation && Boolean(onStage);
  const [savedStatus, setStatus] = useState<WatchlistState | null>(null);
  const status = staging ? effectiveWatchlistStatus(savedStatus, staged) : savedStatus;
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

  // After a save the staged changes are on the server: read it again.
  useEffect(() => {
    if (revision) refresh();
  }, [revision, refresh]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        lelibraryWatchlist?: string;
        ok?: boolean;
        lelibraryWatchlistTokens?: { provider?: unknown; connection?: unknown; username?: unknown };
      } | null;
      if (!data) return;
      if (staging) {
        const pending = pendingFromPopup(data);
        if (pending) {
          markChanged(pending.provider);
          onStage?.(pending.provider, { pendingId: pending.pendingId, username: pending.username });
          toast(`${WATCHLIST_PROVIDER_NAMES[pending.provider]} connected - save to keep it`);
          return;
        }
      }
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
  }, [refresh, precreation, draft, onDraft, markChanged, staging, onStage]);

  const connected = (provider: WatchlistProvider) => (precreation
    ? Boolean(draft?.[provider]?.access_token)
    : status?.[provider]?.connected === true);

  async function connect(provider: WatchlistProvider) {
    if (!precreation && (!uuid || !editToken)) return;
    try {
      const { url } = precreation
        ? await startWatchlistOAuthPublic(provider)
        : await startWatchlistOAuth(uuid as string, provider, editToken as string, staging ? { stage: true } : {});
      if (!url) return;
      window.open(url, '_blank', 'width=560,height=640');
      toast('Complete sign-in in the popup');
      // Fallback for popups that never message back (a staged connect
      // changes nothing saved, so there is nothing to read).
      if (!precreation && !staging) setTimeout(refresh, 3000);
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
    if (staging) {
      // Staged: a sign-in made on this page is simply dropped; a saved
      // connection is removed on Save.
      const savedLinked = savedStatus?.[provider]?.connected === true;
      markChanged(provider);
      onStage?.(provider, savedLinked ? { remove: true } : null);
      toast(savedLinked ? 'Disconnected - save to apply' : 'Disconnected');
      return;
    }
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
    linked: (provider) => connected(provider),
    identity: (provider, saved) => accountIdentity(provider, {
      precreation, draft, status, connected: connected(provider), changed: changed.has(provider), saved,
    }),
    configured: (provider) => providerConfigured(provider, { precreation, config, status }),
    canConnect: precreation || Boolean(uuid && editToken),
    connect,
    disconnect,
    ...(staging ? {
      staged: (provider: WatchlistProvider) => {
        const change = staged?.[provider];
        return change ? ('remove' in change ? 'remove' as const : 'connect' as const) : null;
      },
      undo: (provider: WatchlistProvider) => { onStage?.(provider, null); },
    } : {}),
  };
}
