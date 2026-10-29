import { useEffect, useState } from 'react';
import { fetchCatalogLibrary } from '@/features/setup/full/collections/catalog-sources';
import { sourceKey, type CatalogSourceRef } from '@/features/setup/shared/collection-doc';

interface RegistrySource {
  catalogId?: string;
  id?: string;
  name?: string;
  title?: string;
  type?: string;
  category?: string;
  group?: string;
  icon?: string;
}

interface PickerSource {
  key: string;
  catalogId: string;
  title: string;
  mediaType: 'movie' | 'series';
  category: string;
  icon: string;
}

// Catalogue source picker for the folder editor. Lists the shared catalogue
// registry (/api/catalog-library). Native library and discovery rows join
// this picker with the home-rows stage, which owns their definitions.
export function SourcePickerModal({ open, selected, onApply, onClose }: {
  open: boolean;
  selected: CatalogSourceRef[];
  onApply: (sources: CatalogSourceRef[]) => void;
  onClose: () => void;
}) {
  const [sources, setSources] = useState<PickerSource[]>([]);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setFailed(false);
    setChosen(new Set(selected.map(sourceKey)));
    let cancelled = false;
    fetchCatalogLibrary<RegistrySource>()
      .then((payload) => {
        if (cancelled) return;
        const list = Array.isArray(payload?.catalogs) ? payload.catalogs : [];
        const normalized: PickerSource[] = [];
        for (const source of list) {
          const catalogId = String(source.catalogId || source.id || '').trim();
          if (!catalogId) continue;
          const mediaType = source.type === 'series' ? 'series' : 'movie';
          normalized.push({
            key: sourceKey({ addonId: '', catalogId, type: mediaType }),
            catalogId,
            title: String(source.name || source.title || catalogId.replace(/^lib-/, '')),
            mediaType,
            category: String(source.category || source.group || 'Other'),
            icon: String(source.icon || (mediaType === 'series' ? '📺' : '🎬')),
          });
        }
        setSources(normalized);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
    // Selected is snapshotted on open by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? sources.filter((source) => `${source.title} ${source.category} ${source.mediaType}`.toLowerCase().includes(needle))
    : sources;
  const groups = new Map<string, PickerSource[]>();
  for (const source of visible) {
    const rows = groups.get(source.category) ?? [];
    rows.push(source);
    groups.set(source.category, rows);
  }

  function toggle(key: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function apply() {
    const picked = sources
      .filter((source) => chosen.has(source.key))
      .map((source): CatalogSourceRef => ({
        addonId: '',
        addonUrl: '',
        catalogId: source.catalogId,
        type: source.mediaType,
        genre: '',
        // Display only: the server derives the transport label from the id.
        title: source.title,
      }));
    onApply(picked);
  }

  return (
    <div
      className="app-modal source-picker-modal" role="dialog" aria-modal="true"
      aria-label="Add catalogue sources"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="app-modal-box source-picker">
        <div className="app-modal-head">
          <div>
            <span className="setup-kicker">Catalogue sources</span>
            <h3>Add catalogue sources</h3>
            <p>Pick the live catalogues that should populate this folder.</p>
          </div>
          <button type="button" className="eye-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="source-picker-toolbar">
          <div className="search-control">
            <input
              type="search" placeholder="Search catalogues" aria-label="Search catalogue sources"
              value={query} onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <span className="result-count">{chosen.size} selected</span>
        </div>
        {failed ? (
          <p className="setup-error">Could not load catalogues.</p>
        ) : (
          <div className="source-picker-list">
            {[...groups].map(([category, rows], index) => {
              const selectedCount = rows.filter((source) => chosen.has(source.key)).length;
              return (
                <details className="folder-source-group" key={category} open={needle !== '' || index === 0}>
                  <summary>
                    <span><strong>{category}</strong><small>{rows.length} catalogue{rows.length === 1 ? '' : 's'}</small></span>
                    <span className="folder-source-group-count">{selectedCount} / {rows.length}</span>
                  </summary>
                  <div className="folder-source-options">
                    {rows.map((source) => {
                      const active = chosen.has(source.key);
                      return (
                        <button
                          key={source.key} type="button"
                          className={`folder-source-choice${active ? ' selected' : ''}`}
                          aria-pressed={active} onClick={() => toggle(source.key)}
                        >
                          <span className="media-type-icon" aria-hidden="true">{source.icon}</span>
                          <span><strong data-i18n-preserve>{source.title}</strong><small>LeLibrary · {source.mediaType === 'series' ? 'Series' : 'Movies'}</small></span>
                          <span aria-hidden="true">{active ? '✓' : '+'}</span>
                        </button>
                      );
                    })}
                  </div>
                </details>
              );
            })}
            {visible.length === 0 && <p className="setup-note">No catalogues match that search.</p>}
          </div>
        )}
        <div className="app-modal-actions">
          <button type="button" className="setup-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="setup-primary" onClick={apply}>Add selected sources</button>
        </div>
      </div>
    </div>
  );
}
