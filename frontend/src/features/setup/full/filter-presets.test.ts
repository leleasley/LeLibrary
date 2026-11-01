import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER_SETS, FILTER_PRESETS, filterSummaryParts, presetOf } from '@/features/setup/full/FilterSets';

describe('playback filter presets', () => {
  it('a fresh setup is the Everything preset', () => {
    expect(presetOf(EMPTY_FILTER_SETS)).toBe('everything');
  });
  it('every preset is recognised after applying it, and keeps cached-only as it was', () => {
    for (const preset of FILTER_PRESETS) {
      const applied = { ...EMPTY_FILTER_SETS, cachedOnly: true, ...preset.values };
      expect(presetOf(applied)).toBe(preset.id);
      expect(applied.cachedOnly).toBe(true);
    }
  });
  it('any other change shows as custom', () => {
    expect(presetOf({ ...EMPTY_FILTER_SETS, maxSizeGb: '9' })).toBe('custom');
  });
  it('summarises the filters in one line', () => {
    expect(filterSummaryParts(EMPTY_FILTER_SETS)).toEqual(['Any resolution', 'Any quality', 'Any size']);
    const small = FILTER_PRESETS.find((p) => p.id === 'small')!;
    expect(filterSummaryParts({ ...EMPTY_FILTER_SETS, ...small.values, cachedOnly: true })).toEqual(['720p, 1080p, 480p', '7 of 10 qualities', '0-4 GB', 'Cached only']);
  });
});
