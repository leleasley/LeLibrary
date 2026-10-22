import { describe, expect, it } from 'vitest';
import { regionFromLocale } from '@/features/releases/use-region';

describe('regionFromLocale', () => {
  it('reads a supported region out of a full locale tag', () => {
    expect(regionFromLocale('en-GB')).toBe('GB');
    expect(regionFromLocale('en-US')).toBe('US');
    expect(regionFromLocale('en-gb')).toBe('GB');
    expect(regionFromLocale('GB')).toBe('GB');
  });

  it('declines to guess when the locale has no supported region', () => {
    expect(regionFromLocale('en')).toBeNull();
    expect(regionFromLocale('fr-FR')).toBeNull();
    expect(regionFromLocale('en-CA')).toBeNull();
    expect(regionFromLocale('')).toBeNull();
    expect(regionFromLocale(null)).toBeNull();
    expect(regionFromLocale(undefined)).toBeNull();
  });
});
