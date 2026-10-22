import { describe, expect, it } from 'vitest';
import { normaliseSourceCatalogId, sourceDisplayName } from '@/features/setup/shared/collection-doc';

// Folder sources must always read as a catalogue name. Older saved documents,
// imported community collections and pushes made before the compact route was
// fixed carried an internal routing id, which used to reach the screen raw.
describe('folder source display names', () => {
  it('recovers the catalogue id from a legacy comma-suffixed internal id', () => {
    expect(normaliseSourceCatalogId('lelibrary-curated-movie,lib-trending_movies')).toBe('lib-trending_movies');
    expect(normaliseSourceCatalogId('lib-trending_movies')).toBe('lib-trending_movies');
  });

  it('names a plain library source from the registry when it is known', () => {
    expect(sourceDisplayName({ catalogId: 'lib-trending_movies', genre: '' }, { 'lib-trending_movies': 'Trending' })).toBe('Trending');
    expect(sourceDisplayName({ catalogId: 'lib-trending_movies', genre: '' })).toBe('Trending Movies');
  });

  it('never shows a raw internal id', () => {
    expect(sourceDisplayName({ catalogId: 'lelibrary-curated-movie,lib-trending_movies', genre: 'Trending Movies' }))
      .toBe('Trending Movies');
    expect(sourceDisplayName({ catalogId: 'lelibrary-curated-movie', genre: 'Trending Movies' }))
      .toBe('Trending Movies');
    // A `lib-` genre is the source id, not a label: resolve it to a name.
    expect(sourceDisplayName({ catalogId: 'lelibrary-curated-movie', genre: 'lib-now_playing_movies' }))
      .toBe('Now Playing Movies');
    expect(sourceDisplayName({ catalogId: 'lelibrary-curated-movie', genre: 'lib-now_playing_movies' }, { 'lib-now_playing_movies': 'In Theaters' }))
      .toBe('In Theaters');
  });

  it('prefers a display title the document already carries', () => {
    expect(sourceDisplayName({ catalogId: 'lib-trending_movies', genre: '', title: 'Trending Now' })).toBe('Trending Now');
  });
});
