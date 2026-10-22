import { addDaysIso, clampIso } from '@/features/releases/release-format';

// The Movies tab date range: presets, clamping to the cached window, and the
// browser persistence that keeps the range across reloads. The range lives in
// the URL too, so a view like "what is out in October" is shareable.

export type RangePreset = 'week' | 'month' | 'window';

export interface MovieRange {
  from: string;
  to: string;
}

export interface RangeBounds {
  today: string;
  minDate: string;
  maxDate: string;
}

export const RANGE_PRESETS: ReadonlyArray<{ id: RangePreset; label: string }> = [
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'Next 30 days' },
  { id: 'window', label: 'Full window' },
];

const STORAGE_KEY = 'll_releases_movies_range';
const DEFAULT_PRESET: RangePreset = 'month';
const PRESET_DAYS: Record<Exclude<RangePreset, 'window'>, number> = { week: 7, month: 30 };

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Order the pair and pull both ends inside the cached window.
export function clampRange(range: MovieRange, bounds: Pick<RangeBounds, 'minDate' | 'maxDate'>): MovieRange {
  const low = clampIso(range.from, bounds.minDate, bounds.maxDate);
  const high = clampIso(range.to, bounds.minDate, bounds.maxDate);
  return low <= high ? { from: low, to: high } : { from: high, to: low };
}

export function presetRange(preset: RangePreset, bounds: RangeBounds): MovieRange {
  if (preset === 'window') return { from: bounds.minDate, to: bounds.maxDate };
  return clampRange({ from: bounds.today, to: addDaysIso(bounds.today, PRESET_DAYS[preset]) }, bounds);
}

// Read a range out of URL parameters. Anything malformed is ignored rather than
// guessed at, so a bad link falls back to the saved or default range.
export function normalizeRange(from: string | null, to: string | null, bounds: RangeBounds): MovieRange | null {
  if (!from || !to || !isIsoDate(from) || !isIsoDate(to)) return null;
  return clampRange({ from, to }, bounds);
}

export function activePreset(range: MovieRange, bounds: RangeBounds): RangePreset | null {
  for (const preset of RANGE_PRESETS) {
    const candidate = presetRange(preset.id, bounds);
    if (candidate.from === range.from && candidate.to === range.to) return preset.id;
  }
  return null;
}

function isRange(value: unknown): value is MovieRange {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record['from'] === 'string' && typeof record['to'] === 'string';
}

export function readStoredRange(): MovieRange | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    return isRange(parsed) ? { from: parsed.from, to: parsed.to } : null;
  } catch {
    return null;
  }
}

export function writeStoredRange(range: MovieRange): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(range));
  } catch {
    /* storage disabled; the in-memory range still applies */
  }
}

// The saved range wins while it still overlaps the cached window. Once the
// window has moved past it there is nothing left to show, so start from the
// default preset instead of a collapsed single day.
export function initialRange(bounds: RangeBounds): MovieRange {
  const stored = readStoredRange();
  const overlaps = stored !== null && stored.to >= bounds.minDate && stored.from <= bounds.maxDate;
  if (stored && overlaps) return clampRange(stored, bounds);
  return presetRange(DEFAULT_PRESET, bounds);
}
