import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import { watchlistConfig } from '@/features/setup/resolver/api';
import {
  DISCOVERY_ROWS,
  nativeLibraryRows,
  watchlistBrowserRows,
  type BrowserSource,
} from '@/features/setup/shared/collection-doc';

// The catalogue registry is the same for every picker on the page: one
// request, shared (the studio and the source picker each fetched it).
let catalogLibraryShared: Promise<{ catalogs?: unknown[] }> | null = null;
export function fetchCatalogLibrary<T>(): Promise<{ catalogs?: T[] }> {
  if (!catalogLibraryShared) {
    catalogLibraryShared = apiClient.get<{ catalogs?: unknown[] }>('/api/catalog-library')
      .catch((error: unknown) => { catalogLibraryShared = null; throw error; });
  }
  return catalogLibraryShared as Promise<{ catalogs?: T[] }>;
}

interface RegistryEntry {
  catalogId?: string;
  id?: string;
  name?: string;
  title?: string;
  type?: string;
  category?: string;
  group?: string;
  icon?: string;
  available?: boolean;
  regions?: string[];
  requirements?: string[];
  featured?: boolean;
}

// Registry rows the Home picker leaves out: the same Trending and Popular
// rows the discovery rows above already offer.
const HOME_DUPLICATES = new Set([
  'lib-trending_movies', 'lib-trending_series', 'lib-tmdb_popular_movies', 'lib-tmdb_popular_series',
]);

export const SUGGESTED_GROUP = 'Suggested';

// The Home picker's list: rows for this region only, no duplicates of the
// discovery rows, and the featured rows again on a Suggested shelf (same
// key, so ticking either one ticks both).
export function homePickerSources(sources: BrowserSource[], region: string): BrowserSource[] {
  const usable = sources.filter((source) => !HOME_DUPLICATES.has(source.catalogId)
    && (!source.regions || source.regions.includes(region)));
  const suggested = usable.filter((source) => source.featured)
    .map((source) => ({ ...source, id: `suggested-${source.id}`, category: SUGGESTED_GROUP }));
  return [...suggested, ...usable];
}

// Shared catalogue browser list: native library rows, discovery rows,
// watchlist rows, then the shared registry. Custom-stream rows join here
// when their editor section lands.
// Watchlist rows are for the Home picker only (`withWatchlists`).
export function useCatalogSources(prefix: string | null, platform: string, withWatchlists = false): {
  sources: BrowserSource[];
  failed: boolean;
} {
  const [registry, setRegistry] = useState<BrowserSource[]>([]);
  const [failed, setFailed] = useState(false);
  const [watchlists, setWatchlists] = useState({ simkl: false, trakt: false });

  useEffect(() => {
    if (!withWatchlists) return undefined;
    let cancelled = false;
    watchlistConfig()
      .then((available) => { if (!cancelled) setWatchlists({ simkl: available?.simkl === true, trakt: available?.trakt === true }); })
      .catch(() => { /* MDBList rows still show */ });
    return () => { cancelled = true; };
  }, [withWatchlists]);

  useEffect(() => {
    let cancelled = false;
    fetchCatalogLibrary<RegistryEntry>()
      .then((payload) => {
        if (cancelled) return;
        const list = Array.isArray(payload?.catalogs) ? payload.catalogs : [];
        const normalized: BrowserSource[] = [];
        for (const source of list) {
          const catalogId = String(source.catalogId || source.id || '').trim();
          if (!catalogId) continue;
          normalized.push({
            id: String(source.id || catalogId),
            catalogId,
            name: String(source.name || source.title || catalogId.replace(/^lib-/, '')),
            type: source.type === 'series' ? 'series' : 'movie',
            category: String(source.category || source.group || 'Other'),
            addonId: '',
            ...(Array.isArray(source.regions) && source.regions.length ? { regions: source.regions.map(String) } : {}),
            ...(Array.isArray(source.requirements) && source.requirements.includes('mdblistKey') ? { needsMdblistKey: true } : {}),
            ...(source.featured === true ? { featured: true } : {}),
          });
        }
        setRegistry(normalized);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  return useMemo(() => ({
    sources: [...nativeLibraryRows(prefix, platform), ...DISCOVERY_ROWS, ...(withWatchlists ? watchlistBrowserRows(watchlists) : []), ...registry],
    failed,
  }), [registry, prefix, platform, failed, watchlists, withWatchlists]);
}
