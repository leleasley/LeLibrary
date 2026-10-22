import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RANGE_PRESETS,
  activePreset,
  clampRange,
  initialRange,
  normalizeRange,
  presetRange,
  readStoredRange,
  writeStoredRange,
  type RangeBounds,
} from '@/features/releases/movie-range';

// A fixed Monday plus a 7 past / 60 future window, matching the hosted sync.
const TODAY = '2026-10-12';
const BOUNDS: RangeBounds = { today: TODAY, minDate: '2026-10-05', maxDate: '2026-12-11' };

describe('movie range presets', () => {
  it('starts each preset at today and bounds it to the cached window', () => {
    expect(presetRange('week', BOUNDS)).toEqual({ from: TODAY, to: '2026-10-19' });
    expect(presetRange('month', BOUNDS)).toEqual({ from: TODAY, to: '2026-11-11' });
    expect(presetRange('window', BOUNDS)).toEqual({ from: '2026-10-05', to: '2026-12-11' });
  });

  it('never offers a date past the cached window', () => {
    const narrow: RangeBounds = { today: TODAY, minDate: '2026-10-05', maxDate: '2026-10-15' };
    expect(presetRange('week', narrow).to).toBe('2026-10-15');
    expect(presetRange('month', narrow).to).toBe('2026-10-15');
  });

  it('exposes a stable id and label for every preset', () => {
    expect(RANGE_PRESETS.map((preset) => preset.id)).toEqual(['week', 'month', 'window']);
    for (const preset of RANGE_PRESETS) expect(preset.label).not.toBe('');
  });
});

describe('clampRange', () => {
  it('orders a reversed range', () => {
    expect(clampRange({ from: '2026-10-20', to: '2026-10-10' }, BOUNDS)).toEqual({
      from: '2026-10-10',
      to: '2026-10-20',
    });
  });

  it('pulls dates inside the window', () => {
    expect(clampRange({ from: '2020-01-01', to: '2030-01-01' }, BOUNDS)).toEqual({
      from: '2026-10-05',
      to: '2026-12-11',
    });
  });
});

describe('normalizeRange', () => {
  it('rejects a range that is missing or malformed on either side', () => {
    expect(normalizeRange(null, null, BOUNDS)).toBeNull();
    expect(normalizeRange(TODAY, null, BOUNDS)).toBeNull();
    expect(normalizeRange(null, TODAY, BOUNDS)).toBeNull();
    expect(normalizeRange('yesterday', 'today', BOUNDS)).toBeNull();
    expect(normalizeRange('2026-10-12T00:00:00Z', '2026-10-19', BOUNDS)).toBeNull();
  });

  it('accepts and clamps a well formed range', () => {
    expect(normalizeRange(TODAY, '2026-10-19', BOUNDS)).toEqual({ from: TODAY, to: '2026-10-19' });
    expect(normalizeRange('2020-01-01', '2026-10-19', BOUNDS)).toEqual({ from: '2026-10-05', to: '2026-10-19' });
  });
});

describe('activePreset', () => {
  it('names the preset a range matches', () => {
    expect(activePreset(presetRange('week', BOUNDS), BOUNDS)).toBe('week');
    expect(activePreset(presetRange('month', BOUNDS), BOUNDS)).toBe('month');
    expect(activePreset(presetRange('window', BOUNDS), BOUNDS)).toBe('window');
  });

  it('returns null for a hand picked range', () => {
    expect(activePreset({ from: TODAY, to: TODAY }, BOUNDS)).toBeNull();
  });
});

describe('range storage', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function stubStorage(entries: Record<string, string> = {}) {
    const store = new Map(Object.entries(entries));
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
      },
    });
    return store;
  }

  it('is safe where there is no browser storage', () => {
    expect(readStoredRange()).toBeNull();
    expect(() => writeStoredRange({ from: TODAY, to: '2026-10-19' })).not.toThrow();
  });

  it('round-trips a written range', () => {
    stubStorage();
    writeStoredRange({ from: TODAY, to: '2026-10-19' });
    expect(readStoredRange()).toEqual({ from: TODAY, to: '2026-10-19' });
  });

  it('ignores a stored value that is not a range', () => {
    stubStorage({ ll_releases_movies_range: '{"from":"2026-10-12"}' });
    expect(readStoredRange()).toBeNull();
  });

  it('keeps a saved range that still overlaps the cached window', () => {
    stubStorage({ ll_releases_movies_range: JSON.stringify({ from: '2026-11-01', to: '2026-11-20' }) });
    expect(initialRange(BOUNDS)).toEqual({ from: '2026-11-01', to: '2026-11-20' });
  });

  it('falls back to the default preset when the saved range slid out of the window', () => {
    stubStorage({ ll_releases_movies_range: JSON.stringify({ from: '2026-01-01', to: '2026-02-01' }) });
    expect(initialRange(BOUNDS)).toEqual(presetRange('month', BOUNDS));
  });

  it('falls back to the default preset when nothing is stored', () => {
    stubStorage();
    expect(initialRange(BOUNDS)).toEqual(presetRange('month', BOUNDS));
  });
});
