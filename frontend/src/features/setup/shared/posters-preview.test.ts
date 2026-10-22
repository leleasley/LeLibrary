import { describe, expect, it } from 'vitest';
import { POSTER_PAIRS } from '@/features/setup/shared/config-contract';
import { previewUrl } from '@/features/setup/shared/PostersSection';

const sample = POSTER_PAIRS[0]!.movie;

function input(provider: string, keys: Record<string, string> = {}) {
  return {
    provider,
    sample,
    keys,
    customTemplate: '',
    posterTemplate: null,
    tokenMap: null,
    pictoriumOptions: null,
    pictoriumOptionsDraft: {},
    pictoriumUrl: '',
  };
}

describe('poster preview', () => {
  it('asks for the TMDB key instead of showing default posters without one', () => {
    expect(previewUrl(input(''))).toEqual({
      url: null,
      note: 'Add your TMDB key above to see TMDB posters.',
      error: null,
    });
  });

  it('shows the real TMDB poster once the key is present', () => {
    expect(previewUrl(input('', { tmdbApiKey: 'a-key' }))).toEqual({
      url: `https://image.tmdb.org/t/p/w342${sample.posterPath}`,
      note: null,
      error: null,
    });
    expect(previewUrl(input('tmdb', { tmdbApiKey: 'a-key' })).url)
      .toBe(`https://image.tmdb.org/t/p/w342${sample.posterPath}`);
  });

  it('still explains providers that need a round trip', () => {
    expect(previewUrl(input('fanart')).note).toMatch(/per title/i);
    expect(previewUrl(input('custom')).note).toMatch(/template/i);
  });
});
