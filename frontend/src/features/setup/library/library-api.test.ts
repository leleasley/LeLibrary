import { describe, expect, it } from 'vitest';
import { episodeLabel, formatSize, searchSeed } from '@/features/setup/library/library-api';

describe('library page helpers', () => {
  it('starts the fix search from the parsed title, never from a bare hash', () => {
    expect(searchSeed({ guess: 'the office us', title: null })).toBe('the office us');
    expect(searchSeed({ guess: '3f9a1c0b7e2d4a6f8b9c0d1e2f3a4b5c6d7e8f90', title: null })).toBe('');
    expect(searchSeed({ guess: null, title: 'Dune: Part Two' })).toBe('Dune: Part Two');
  });

  it('labels episodes, seasons and season ranges', () => {
    expect(episodeLabel({ season: 2, episode: 7, seasonStart: null, seasonEnd: null })).toBe('S02E07');
    expect(episodeLabel({ season: 5, episode: null, seasonStart: null, seasonEnd: null })).toBe('S05');
    expect(episodeLabel({ season: 1, episode: null, seasonStart: 1, seasonEnd: 3 })).toBe('S01-S03');
    expect(episodeLabel({ season: null, episode: null, seasonStart: null, seasonEnd: null })).toBeNull();
  });

  it('formats sizes for the visitor language', () => {
    expect(formatSize(9876543210, 'en')).toBe('9.2 GB');
    expect(formatSize(0, 'en')).toBeNull();
  });
});
