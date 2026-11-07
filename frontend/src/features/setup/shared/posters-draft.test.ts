import { describe, expect, it } from 'vitest';
import { EMPTY_POSTERS, postersForProvider } from '@/features/setup/shared/PostersSection';
import { isQuickDirty } from '@/features/setup/quick/QuickSetupPage';
import { EMPTY_FORMATTING } from '@/features/setup/shared/FormattingSection';
import { EMPTY_QUICK_EXTRAS } from '@/features/setup/full/MetadataExtras';
import { DEFAULT_BADGE_PACK } from '@/features/setup/shared/BadgePackPicker';

// Poster drafts carry provider-specific extras (custom template). Their
// inputs only render for the provider that owns them, so a
// leftover value would keep the setup flagged "Unsaved changes" with no control
// on screen to clear it. Switching provider must drop what no longer applies.
describe('poster draft provider changes', () => {
  it('clears every extra that the new provider does not use', () => {
    const leftover = {
      provider: '',
      customTemplate: 'https://img.example.com/{tmdbId}.jpg',
    };
    expect(postersForProvider(leftover)).toEqual(EMPTY_POSTERS);
  });

  it('keeps the extras belonging to the selected provider', () => {
    const custom = {
      provider: 'custom',
      customTemplate: 'https://img.example.com/{imdbId}.jpg',
    };
    expect(postersForProvider(custom)).toEqual(custom);
  });

  it('drops the previous provider extras when a new one is picked', () => {
    const next = postersForProvider({
      provider: 'betterposter',
      customTemplate: 'https://img.example.com/{tmdbId}.jpg',
    });
    expect(next).toEqual({ ...EMPTY_POSTERS, provider: 'betterposter' });
  });

  // The regression this guards: a reverted provider used to stay "dirty".
  it('is clean again once the provider goes back to the default', () => {
    const reverted = postersForProvider({
      provider: '',
      customTemplate: 'https://img.example.com/{tmdbId}.jpg',
    });
    expect(isQuickDirty({
      name: '',
      keys: {},
      formatting: EMPTY_FORMATTING,
      posters: reverted,
      badgePack: { pack: DEFAULT_BADGE_PACK, url: '' },
      extras: EMPTY_QUICK_EXTRAS,
    })).toBe(false);
  });
});
