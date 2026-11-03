import { useRef } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchSearch, type SearchResponse } from '@/api/releases';
import { queryKeys } from '@/api/query-keys';

export interface SearchState {
  status: 'idle' | 'loading' | 'success' | 'error';
  data: SearchResponse | null;
}

// Short-lived client cache so re-typing a query you just searched does not
// spend a rate-limited request. React Query keeps one entry per query and
// drops it a minute after nothing shows it, so the cache stays bounded.
const CLIENT_TTL_MS = 60_000;

/** What the query reports, reduced to the four states the search tab draws. */
export interface SearchQueryView {
  enabled: boolean;
  isError: boolean;
  isSuccess: boolean;
  isPlaceholderData: boolean;
  data: SearchResponse | undefined;
}

// Previous results stay on screen while the next query loads and when it
// fails; a query under two characters clears them.
export function searchStateFrom(view: SearchQueryView, previous: SearchResponse | null): SearchState {
  if (!view.enabled) return { status: 'idle', data: null };
  if (view.isSuccess && !view.isPlaceholderData && view.data) return { status: 'success', data: view.data };
  if (view.isError) return { status: 'error', data: previous };
  return { status: 'loading', data: view.data ?? previous };
}

// One query per region + lower-cased text. React Query aborts a superseded
// request and never lets a late answer overwrite a newer query. Minimum query
// length is enforced by the caller too.
export function useReleaseSearch(region: string, query: string): SearchState {
  const q = query.trim();
  const enabled = q.length >= 2;
  const result = useQuery({
    queryKey: queryKeys.releasesSearch(region, q.toLowerCase()),
    queryFn: ({ signal }) => fetchSearch({ region, q, signal }),
    enabled,
    staleTime: CLIENT_TTL_MS,
    gcTime: CLIENT_TTL_MS,
    retry: false,
    placeholderData: keepPreviousData,
  });
  // The last results shown, so an error keeps them like a slow load does.
  const shown = useRef<SearchResponse | null>(null);
  const state = searchStateFrom({
    enabled,
    isError: result.isError,
    isSuccess: result.isSuccess,
    isPlaceholderData: result.isPlaceholderData,
    data: result.data,
  }, shown.current);
  shown.current = state.data;
  return state;
}
