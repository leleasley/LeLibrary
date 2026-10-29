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

describe('Posters+ preview', () => {
  const lib = {
    validate: () => ({ ok: true as const, value: '', placeholders: [] }),
    resolve: (template: string, media: Record<string, unknown>) => template.replace('{tmdb_id?}', String(media['tmdbId'])),
    apply: (row: unknown) => row,
    fromPostersPlus: (link: string) => (link.startsWith('https://')
      ? { ok: true as const, value: 'https://pp.example/poster?tmdb_id={tmdb_id?}&access_key=k', placeholders: ['tmdb_id?'] }
      : { ok: false as const, error: 'Paste the full Posters+ link (it starts with https://).' }),
  };

  it('asks for the link, then previews the style from it', () => {
    expect(previewUrl(input('postersplus')).note).toBe('Paste your Posters+ link to see your style.');
    const shown = previewUrl({ ...input('postersplus', { postersPlusUrl: 'https://pp.example/poster?x=1' }), posterTemplate: lib });
    expect(shown.url).toBe(`https://pp.example/poster?tmdb_id=${sample.id}&access_key=k`);
    const bad = previewUrl({ ...input('postersplus', { postersPlusUrl: 'nope' }), posterTemplate: lib });
    expect(bad.error).toBe('Paste the full Posters+ link (it starts with https://).');
  });
});
