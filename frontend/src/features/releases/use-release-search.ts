import { useEffect, useRef, useState } from 'react';
import { fetchSearch, type SearchResponse } from '@/api/releases';

export interface SearchState {
  status: 'idle' | 'loading' | 'success' | 'error';
  data: SearchResponse | null;
}

// Short-lived client cache so re-typing a query you just searched does not
// spend a rate-limited request.
const cache = new Map<string, { data: SearchResponse; ts: number }>();
const CLIENT_TTL_MS = 60_000;

// Search with an AbortController per query, an out-of-order sequence guard, and
// previous results retained while loading. Minimum query length is enforced by
// the caller.
export function useReleaseSearch(region: string, query: string): SearchState {
  const [state, setState] = useState<SearchState>({ status: 'idle', data: null });
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      seq.current++;
      setState({ status: 'idle', data: null });
      return;
    }
    const key = `${region}:${q.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < CLIENT_TTL_MS) {
      setState({ status: 'success', data: hit.data });
      return;
    }
    const controller = new AbortController();
    const id = ++seq.current;
    setState((previous) => ({ status: 'loading', data: previous.data }));
    fetchSearch({ region, q, signal: controller.signal })
      .then((data) => {
        cache.set(key, { data, ts: Date.now() });
        if (seq.current === id) setState({ status: 'success', data });
      })
      .catch(() => {
        if (controller.signal.aborted || seq.current !== id) return;
        setState((previous) => ({ status: 'error', data: previous.data, }));
      });
    return () => controller.abort();
  }, [region, query]);

  return state;
}
