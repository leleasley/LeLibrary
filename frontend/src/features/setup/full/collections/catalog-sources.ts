import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import {
  DISCOVERY_ROWS,
  nativeLibraryRows,
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

// Shared catalogue browser list: native library rows, discovery rows, then
// the shared registry. Watchlist and custom-stream rows join here when their
// stages land (watchlist connects need the UUID-keyed backend; custom
// streams need their editor section).
export function useCatalogSources(prefix: string | null, platform: string): {
  sources: BrowserSource[];
  failed: boolean;
} {
  const [registry, setRegistry] = useState<BrowserSource[]>([]);
  const [failed, setFailed] = useState(false);

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
    sources: [...nativeLibraryRows(prefix, platform), ...DISCOVERY_ROWS, ...registry],
    failed,
  }), [registry, prefix, platform, failed]);
}
