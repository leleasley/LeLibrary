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

import { parsedEpisode } from '@/features/setup/library/library-api';

describe('season and episode from file names', () => {
  it('reads common shapes', () => {
    expect(parsedEpisode('s7-middlemen.1080.mkv')).toEqual({ season: 7, episode: null });
    expect(parsedEpisode('Show.Name.S02E05.1080p.mkv')).toEqual({ season: 2, episode: 5 });
    expect(parsedEpisode('Show Season 3 Complete')).toEqual({ season: 3, episode: null });
    expect(parsedEpisode('show.1x04.hdtv')).toEqual({ season: 1, episode: 4 });
    expect(parsedEpisode('Dune.Part.Two.2024.2160p')).toEqual({ season: null, episode: null });
    expect(parsedEpisode(null, 'Other.S10E12.mkv')).toEqual({ season: 10, episode: 12 });
  });
});
