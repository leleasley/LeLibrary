import { describe, expect, it } from 'vitest';
import type { SearchResponse } from '@/api/releases';
import { CLIENT_CACHE_MAX, rememberSearch, searchCacheSize } from '@/features/releases/use-release-search';

const response: SearchResponse = { query: 'q', region: 'GB', source: 'local', results: [] };

describe('release search client cache', () => {
  it('stays under its cap after many searches', () => {
    for (let i = 0; i < CLIENT_CACHE_MAX * 4; i++) rememberSearch(`GB:q${i}`, response, 1000 + i);
    expect(searchCacheSize()).toBe(CLIENT_CACHE_MAX);
  });

  it('sweeps expired entries on insert', () => {
    rememberSearch('GB:fresh', response, 10_000_000);
    expect(searchCacheSize()).toBe(1);
  });
});
