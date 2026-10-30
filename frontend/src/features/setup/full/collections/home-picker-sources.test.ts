import { describe, expect, it } from 'vitest';
import { homePickerSources, SUGGESTED_GROUP } from '@/features/setup/full/collections/catalog-sources';
import type { BrowserSource } from '@/features/setup/shared/collection-doc';

const row = (catalogId: string, extra: Partial<BrowserSource> = {}): BrowserSource => ({
  id: catalogId, catalogId, name: catalogId, type: 'movie', category: 'Streaming', addonId: '', ...extra,
});

describe('homePickerSources', () => {
  it('hides rows from other regions and keeps the rest', () => {
    const list = homePickerSources([
      row('lib-svc_peacock_movies', { regions: ['US'] }),
      row('lib-svc_itvx_series', { regions: ['GB'] }),
      row('lib-genre_action_movies', { category: 'Genres' }),
    ], 'GB');
    expect(list.map((s) => s.catalogId)).toEqual(['lib-svc_itvx_series', 'lib-genre_action_movies']);
  });

  it('drops the registry copies of the Trending and Popular discovery rows', () => {
    const list = homePickerSources([row('lib-trending_movies'), row('lib-tmdb_popular_series'), row('torbox-trending-movies')], 'GB');
    expect(list.map((s) => s.catalogId)).toEqual(['torbox-trending-movies']);
  });

  it('puts featured rows on the Suggested shelf first, sharing the same source key', () => {
    const list = homePickerSources([row('lib-genre_action_movies'), row('lib-now_playing_movies', { featured: true })], 'GB');
    expect(list[0]).toMatchObject({ category: SUGGESTED_GROUP, catalogId: 'lib-now_playing_movies', type: 'movie' });
    expect(list.filter((s) => s.catalogId === 'lib-now_playing_movies')).toHaveLength(2);
  });

  it('never suggests a row that is not available in the region', () => {
    const list = homePickerSources([row('lib-x', { featured: true, regions: ['US'] })], 'GB');
    expect(list).toEqual([]);
  });
});
