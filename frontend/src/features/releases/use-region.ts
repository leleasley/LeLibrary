import { useCallback, useState } from 'react';

export const RELEASE_REGIONS = ['GB', 'US'] as const;
export type RegionCode = (typeof RELEASE_REGIONS)[number];
const STORAGE_KEY = 'll_releases_region';
const DEFAULT_REGION: RegionCode = 'GB';

function isRegion(value: unknown): value is RegionCode {
  return value === 'GB' || value === 'US';
}

// Map a browser locale tag onto a supported release region. Anything we cannot
// map confidently returns null so the caller keeps its own default rather than
// showing a region the viewer did not ask for.
export function regionFromLocale(locale: string | null | undefined): RegionCode | null {
  if (!locale) return null;
  const parts = locale.replace('_', '-').split('-');
  const candidate = (parts[1] ?? parts[0] ?? '').toUpperCase();
  return isRegion(candidate) ? candidate : null;
}

function browserLocales(): string[] {
  if (typeof navigator === 'undefined') return [];
  const languages = navigator.languages;
  if (languages && languages.length) return [...languages];
  return navigator.language ? [navigator.language] : [];
}

function readStoredRegion(): RegionCode {
  if (typeof window === 'undefined') return DEFAULT_REGION;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isRegion(stored)) return stored;
  } catch {
    /* storage disabled; fall through to the browser locale */
  }
  for (const locale of browserLocales()) {
    const mapped = regionFromLocale(locale);
    if (mapped) return mapped;
  }
  return DEFAULT_REGION;
}

// Region choice is a personal display preference, not user data sent to TMDB;
// it is persisted in localStorage only. First visit seeds it from the browser
// locale so a US viewer does not start on the UK calendar.
export function useRegion() {
  const [region, setRegionState] = useState<RegionCode>(readStoredRegion);
  const setRegion = useCallback((next: RegionCode) => {
    setRegionState(next);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage disabled; the in-memory choice still applies */
    }
  }, []);
  return { region, setRegion, regions: RELEASE_REGIONS };
}
