import { describe, expect, it } from 'vitest';
import {
  CATALOGUE_META,
  CATALOGUE_PREVIEW_MAP,
  DEFAULT_CAT_NAMES,
  DEFAULT_CAT_ORDER,
  SPECIAL_HOME_IDS,
  catalogDisplayName,
  groupIcon,
  groupPriority,
  isDefaultCatOrder,
} from '@/features/setup/shared/home-model';

describe('home model', () => {
  it('keeps the eight legacy rows with their enable flags', () => {
    expect(Object.keys(CATALOGUE_META)).toEqual([
      'trendingMovies', 'trendingSeries', 'popularMovies', 'popularSeries',
      'movies', 'series', 'anime', 'franchises',
    ]);
    expect(DEFAULT_CAT_ORDER).toHaveLength(8);
    expect(isDefaultCatOrder([...DEFAULT_CAT_ORDER])).toBe(true);
    expect(isDefaultCatOrder(['movies', ...DEFAULT_CAT_ORDER])).toBe(false);
  });

  it('maps every legacy row to a preview pipeline', () => {
    for (const key of DEFAULT_CAT_ORDER) {
      const pair = CATALOGUE_PREVIEW_MAP[key];
      expect(Array.isArray(pair)).toBe(true);
      expect(['movie', 'series']).toContain(pair?.[0]);
    }
    expect(CATALOGUE_PREVIEW_MAP['franchises']).toEqual(['movie', 'torbox-collections']);
  });

  it('names catalogues with custom names first, then derived names', () => {
    expect(catalogDisplayName({ id: 'x', name: 'X' }, { x: 'Mine' })).toBe('Mine');
    expect(catalogDisplayName({ id: 'genre_action_movies', name: 'Action', type: 'movie' })).toBe('Action · Movies');
    expect(catalogDisplayName({ id: 'streaming_top10_netflix', name: 'Netflix', type: 'series' }))
      .toBe('Netflix · Series · Top 10');
    expect(DEFAULT_CAT_NAMES['movies']).toBe('🎬 My Movies');
  });

  it('ranks and icons browser groups', () => {
    expect(groupPriority('Trending')).toBe(0);
    expect(groupPriority('Streaming')).toBe(1);
    expect(groupPriority('Genres')).toBe(2);
    expect(groupPriority('Anime')).toBe(5);
    expect(groupPriority('Other')).toBe(6);
    expect(groupIcon('Genres')).toBe('🎭');
    expect(groupIcon('Unknown')).toBe('📁');
  });

  it('keeps the special quick-add list intact', () => {
    expect(SPECIAL_HOME_IDS).toHaveLength(24);
    expect(SPECIAL_HOME_IDS).toContain('trending_movies');
    expect(SPECIAL_HOME_IDS).toContain('collection_lord_of_the_rings');
  });
});
