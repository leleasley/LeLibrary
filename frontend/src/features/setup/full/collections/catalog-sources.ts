import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import { watchlistConfig } from '@/features/setup/resolver/api';
import {
  DISCOVERY_ROWS,
  nativeLibraryRows,
  watchlistBrowserRows,
  type BrowserSource,
} from '@/features/setup/shared/collection-doc';

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
    apiClient.get<{ catalogs?: RegistryEntry[] }>('/api/catalog-library')
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
