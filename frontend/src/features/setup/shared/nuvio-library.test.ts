import { describe, expect, it } from 'vitest';
import {
  cleanNuvioHideUnreleased,
  nuvioHideUnreleasedForConfig,
} from '@/features/setup/shared/nuvio-library';

describe('cleanNuvioHideUnreleased', () => {
  it('maps a saved boolean to the three-way choice', () => {
    expect(cleanNuvioHideUnreleased(true)).toBe('hide');
    expect(cleanNuvioHideUnreleased(false)).toBe('show');
    expect(cleanNuvioHideUnreleased(undefined)).toBe('inherit');
    expect(cleanNuvioHideUnreleased('nope')).toBe('inherit');
  });
});

describe('nuvioHideUnreleasedForConfig', () => {
  it('writes only an explicit hide or show choice', () => {
    expect(nuvioHideUnreleasedForConfig('hide')).toBe(true);
    expect(nuvioHideUnreleasedForConfig('show')).toBe(false);
    expect(nuvioHideUnreleasedForConfig('inherit')).toBe(null);
  });
});
