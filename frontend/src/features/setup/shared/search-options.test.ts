import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_SEARCH_OPTIONS, cleanSearchOptions, searchOptionsForConfig, searchSummaryParts } from '@/features/setup/shared/search-options';

describe('search options', () => {
  it('an untouched setup saves nothing new', () => {
    expect(searchOptionsForConfig(DEFAULT_SEARCH_OPTIONS)).toBeNull();
    expect(searchOptionsForConfig(undefined)).toBeNull();
    expect(searchOptionsForConfig({ ...DEFAULT_SEARCH_OPTIONS, names: { movies: '   ' } })).toBeNull();
  });

  it('saves only what differs, and reads it back the same', () => {
    const draft = { ...DEFAULT_SEARCH_OPTIONS, people: true, collections: true, order: 'newest' as const, names: { similar: 'More like this' } };
    const saved = searchOptionsForConfig(draft);
    expect(saved).toEqual({ people: true, collections: true, order: 'newest', names: { similar: 'More like this' } });
    expect(cleanSearchOptions(saved)).toEqual(draft);
  });

  it('cleans what the server would reject', () => {
    expect(cleanSearchOptions({ order: 'sideways', enabled: 'no', names: { movies: 7, anime: ' Anime ' } }))
      .toEqual({ ...DEFAULT_SEARCH_OPTIONS, names: { anime: 'Anime' } });
  });

  it('collections search is off by default', () => {
    expect(DEFAULT_SEARCH_OPTIONS.collections).toBe(false);
    expect(cleanSearchOptions({}).collections).toBe(false);
  });

  it('summarises the choice in one line', () => {
    expect(searchSummaryParts('combined', DEFAULT_SEARCH_OPTIONS)).toEqual(['TMDB and your library']);
    expect(searchSummaryParts('tmdb', { ...DEFAULT_SEARCH_OPTIONS, animeRow: true, hideObscure: true, order: 'popular' }))
      .toEqual(['TMDB only', 'Anime row', 'Most popular', 'Little-known hidden']);
    expect(searchSummaryParts('combined', { ...DEFAULT_SEARCH_OPTIONS, enabled: false })).toEqual(['Off']);
  });

  it('matches the server defaults and allowed orders', () => {
    const server = readFileSync(new URL('../../../../../backend/src/media/search.ts', import.meta.url), 'utf8');
    expect(server).toContain("const SEARCH_ORDERS = ['relevance', 'popular', 'newest', 'rating'];");
    expect(server).toContain("const SEARCH_ROW_NAMES = ['movies', 'series', 'anime', 'similar', 'people'];");
  });
});
