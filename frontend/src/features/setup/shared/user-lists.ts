import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '@/api/client';
import type { WatchlistDraftMap, WatchlistState } from '@/features/setup/resolver/api';
import { normalizeAnilistUser } from '@/features/setup/shared/config-contract';
import {
  mdblistListRows,
  userListBrowserRows,
  type BrowserSource,
  type MdblistListSummary,
  type UserListServices,
} from '@/features/setup/shared/collection-doc';

// "Your lists" (v6) for the Home rows picker and the folder source picker:
// which services this setup has (in the draft or saved), and the person's
// own and liked MDBList lists. The MDBList key never leaves the server for a
// saved setup; a key typed on the page (not saved yet) is sent once in the
// body of the lists request, never stored.

export interface UserListsInput {
  // Edit mode: the saved setup (connections and the saved key live there).
  savedSetup?: { uuid: string; editToken: string | null } | null;
  savedServices?: readonly string[];
  // Create mode (or unsaved edits): connects held by the page.
  watchlistDraft?: WatchlistDraftMap | null;
  // Edit mode: the saved connections' status, from the page's one
  // connections hook (useSetupConnections), so a connect or disconnect on
  // the API keys card shows or hides its shelf at once.
  status?: Partial<WatchlistState> | null;
  // The MDBList key typed on the page ('' when none).
  mdblistKey?: string;
  // The page's AniList username, when it has one.
  anilistUser?: string | null;
}

export interface UserListsContext {
  services: UserListServices;
  // Where the MDBList lists come from: a typed key, the saved setup, or none.
  mdblistSource: { kind: 'typed'; key: string } | { kind: 'saved'; uuid: string; editToken: string } | null;
}

const NONE: UserListServices = { simkl: false, mdblist: false, anilist: false, trakt: false };

// Pure: the services from what the page knows plus the saved connection
// status (edit mode). Trakt only for a setup that is already connected.
export function userListServicesFrom(input: UserListsInput, status: Partial<WatchlistState> | null): UserListServices {
  const draft = input.watchlistDraft ?? {};
  const typedKey = (input.mdblistKey ?? '').trim();
  const draftConn = (name: string) => Boolean((draft as Record<string, { access_token?: string } | undefined>)[name]?.access_token);
  return {
    simkl: draftConn('simkl') || status?.simkl?.connected === true,
    mdblist: Boolean(typedKey) || Boolean(input.savedServices?.includes('mdblistKey')),
    anilist: Boolean(normalizeAnilistUser(input.anilistUser)) || draftConn('anilist') || status?.anilist?.connected === true,
    trakt: status?.trakt?.connected === true,
  };
}

export function mdblistSourceFrom(input: UserListsInput): UserListsContext['mdblistSource'] {
  const typedKey = (input.mdblistKey ?? '').trim();
  if (typedKey) return { kind: 'typed', key: typedKey };
  if (input.savedSetup?.editToken && input.savedServices?.includes('mdblistKey')) {
    return { kind: 'saved', uuid: input.savedSetup.uuid, editToken: input.savedSetup.editToken };
  }
  return null;
}

export function useUserLists(input: UserListsInput): UserListsContext {
  const services = userListServicesFrom(input, input.status ?? null);
  const source = mdblistSourceFrom(input);
  const sourceKey = source ? (source.kind === 'typed' ? `typed:${source.key}` : `saved:${source.uuid}:${source.editToken}`) : '';
  // Stable objects so pickers only re-render when something changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableServices = useMemo(() => services, [services.simkl, services.mdblist, services.anilist, services.trakt]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableSource = useMemo(() => source, [sourceKey]);
  return useMemo(() => ({ services: stableServices, mdblistSource: stableSource }), [stableServices, stableSource]);
}

export function fetchMdblistLists(source: NonNullable<UserListsContext['mdblistSource']>, refresh = false): Promise<{ lists?: MdblistListSummary[] }> {
  if (source.kind === 'typed') {
    return apiClient.post<{ lists?: MdblistListSummary[] }>('/api/setup/mdblist/lists', { key: source.key, ...(refresh ? { refresh: true } : {}) });
  }
  return apiClient.get<{ lists?: MdblistListSummary[] }>(
    `/api/setup/${encodeURIComponent(source.uuid)}/mdblist/lists${refresh ? '?refresh=1' : ''}`,
    { headers: { Authorization: `Bearer ${source.editToken}` } },
  );
}

export type MdblistListsState = 'idle' | 'loading' | 'ready' | 'error';

// The MDBList lists, loaded once `enabled` (the picker is open) and again on
// `reload` (the refresh button, which also skips the server's short cache).
export function useMdblistLists(source: UserListsContext['mdblistSource'], enabled: boolean): {
  state: MdblistListsState;
  lists: MdblistListSummary[];
  reload: () => void;
} {
  const [state, setState] = useState<MdblistListsState>('idle');
  const [lists, setLists] = useState<MdblistListSummary[]>([]);
  const loadedFor = useRef<unknown>(null);
  const run = useCallback((refresh: boolean) => {
    if (!source) return () => undefined;
    let cancelled = false;
    setState('loading');
    fetchMdblistLists(source, refresh)
      .then((out) => {
        if (cancelled) return;
        setLists(Array.isArray(out?.lists) ? out.lists : []);
        setState('ready');
      })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [source]);
  useEffect(() => {
    if (!source) { setLists([]); setState('idle'); loadedFor.current = null; return undefined; }
    if (!enabled || loadedFor.current === source) return undefined;
    loadedFor.current = source;
    return run(false);
  }, [source, enabled, run]);
  const reload = useCallback(() => { run(true); }, [run]);
  return { state, lists, reload };
}

// Every "Your lists" row for a picker: the fixed rows, then the lists.
export function userListPickerRows(services: UserListServices, lists: MdblistListSummary[]): BrowserSource[] {
  return [...userListBrowserRows(services), ...(services.mdblist ? mdblistListRows(lists) : [])];
}

export const NO_USER_LISTS: UserListsContext = { services: NONE, mdblistSource: null };
