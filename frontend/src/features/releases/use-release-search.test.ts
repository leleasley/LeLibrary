import { describe, expect, it } from 'vitest';
import type { SearchResponse } from '@/api/releases';
import { queryKeys } from '@/api/query-keys';
import { searchStateFrom, type SearchQueryView } from '@/features/releases/use-release-search';

const older: SearchResponse = { query: 'du', region: 'GB', source: 'local', results: [] };
const newer: SearchResponse = { query: 'dune', region: 'GB', source: 'tmdb', results: [] };
const view = (over: Partial<SearchQueryView>): SearchQueryView => ({
  enabled: true, isError: false, isSuccess: false, isPlaceholderData: false, data: undefined, ...over,
});

describe('release search state', () => {
  it('is idle and empty under two characters, even with earlier results', () => {
    expect(searchStateFrom(view({ enabled: false, isSuccess: true, data: older }), older)).toEqual({ status: 'idle', data: null });
  });

  it('keeps the previous results while the next query loads', () => {
    expect(searchStateFrom(view({ isSuccess: true, isPlaceholderData: true, data: older }), older)).toEqual({ status: 'loading', data: older });
    expect(searchStateFrom(view({}), null)).toEqual({ status: 'loading', data: null });
  });

  it('shows the answer once it is the current query', () => {
    expect(searchStateFrom(view({ isSuccess: true, data: newer }), older)).toEqual({ status: 'success', data: newer });
  });

  it('keeps the previous results when the query fails', () => {
    expect(searchStateFrom(view({ isError: true }), older)).toEqual({ status: 'error', data: older });
  });

  it('caches by region and lower-cased text', () => {
    expect(queryKeys.releasesSearch('GB', 'dune')).toEqual(['releases', 'search', 'GB', 'dune']);
  });
});
