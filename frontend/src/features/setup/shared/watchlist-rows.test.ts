import { describe, expect, it } from 'vitest';
import { homeCategoryRank, homeRowFromSource, watchlistBrowserRows } from '@/features/setup/shared/collection-doc';

describe('watchlist rows in the Home picker', () => {
  it('lists Simkl and Trakt only when the server can connect them; MDBList always', () => {
    expect(watchlistBrowserRows({ simkl: false, trakt: false }).map((row) => row.catalogId)).toEqual([
      'torbox-watchlist-mdblist-movie', 'torbox-watchlist-mdblist-series',
    ]);
    expect(watchlistBrowserRows({ simkl: true, trakt: false }).map((row) => row.catalogId)).toEqual([
      'torbox-watchlist-simkl-movie', 'torbox-watchlist-simkl-series',
      'torbox-watchlist-mdblist-movie', 'torbox-watchlist-mdblist-series',
    ]);
  });

  it('a picked watchlist becomes a Home row keyed by the manifest catalogue id', () => {
    const [simkl] = watchlistBrowserRows({ simkl: true, trakt: true });
    const row = homeRowFromSource(simkl!, 3);
    expect(row.source.id).toBe('torbox-watchlist-simkl-movie');
    expect(row.source.addonId).toBe('');
    expect(row).not.toHaveProperty('provider');
    expect(homeCategoryRank('Watchlists')).toBeLessThan(homeCategoryRank('Genres'));
  });
});
