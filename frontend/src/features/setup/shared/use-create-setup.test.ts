import { describe, expect, it } from 'vitest';
import { createKeyError } from '@/features/setup/shared/useCreateSetup';

// TMDB is marked required in every tier and enforced by POST /api/setup. The
// client must refuse before it sends an incomplete setup.
describe('createKeyError', () => {
  it('asks for a provider when nothing is filled', () => {
    expect(createKeyError({})).toBe('provider');
  });

  it('requires TMDB even when a debrid key is present', () => {
    expect(createKeyError({ torboxApiKey: 'tb-key' })).toBe('tmdb');
    expect(createKeyError({ torboxApiKey: 'tb-key', tmdbApiKey: '   ' })).toBe('tmdb');
  });

  it('passes when TMDB is filled', () => {
    expect(createKeyError({ torboxApiKey: 'tb-key', tmdbApiKey: 'tmdb-key' })).toBe(null);
  });
});
