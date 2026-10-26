import { apiErrorCopy } from '@/api/error-copy';
import { useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import { toast } from '@/features/setup/shared/Toast';
import {
  homeCategoryRank,
  homeRowFromSource,
  normalizeHomeOrder,
  ownedFranchiseMarker,
  sourceKey,
  type BrowserSource,
  type HomeRowDoc,
} from '@/features/setup/shared/collection-doc';
import { useCatalogSources } from '@/features/setup/full/collections/catalog-sources';

// Group rank for the Home catalogue browser: the shared rank first, except
// actor shelves always sink to the bottom no matter what else is installed.
export function browserGroupRank(category: string): number {
  if (/actor/i.test(String(category || ''))) return 99;
  return homeCategoryRank(category);
}

// Quick-add emoji for renaming a row.
const RENAME_EMOJI = ['🔥', '🍿', '⭐', '🎬', '📺', '💜', '🌙', '✨'];

function browserKey(source: BrowserSource): string {
  return sourceKey({ addonId: source.addonId || '', catalogId: source.catalogId, type: source.type });
}

// A small glyph per catalogue shelf so the long accordion list scans quickly.
function groupIcon(group: string): string {
  const name = group.toLowerCase();
  if (name.includes('lelibrary')) return '📚';
  if (name.includes('watchlist')) return '🔖';
  if (/trend|hot/.test(name)) return '🔥';
  if (/popular|top|rated/.test(name)) return '⭐';
  if (/stream|service|network|provider/.test(name)) return '📡';
  if (/genre/.test(name)) return '🎭';
  if (/franchise|collection|saga/.test(name)) return '🎞️';
  if (/studio/.test(name)) return '🏛️';
  if (/actor|people|cast/.test(name)) return '👤';
  if (/anime/.test(name)) return '🌸';
  if (/kid|family/.test(name)) return '🧸';
  if (/import/.test(name)) return '🔗';
  if (/season|holiday|christmas|halloween/.test(name)) return '🗓️';
  return '▦';
}

// Home builder: catalogue browser on the left, ordered Home rows on the
// right, plus the owned-franchise toggle and manifest import. The rename and
// import modals live here with them.
export function HomeRowsSection({ rows, onChange, platform, prefix }: {
  rows: HomeRowDoc[];
  onChange: (next: HomeRowDoc[]) => void;
  platform: 'nuvio' | 'stremio';
  prefix: string | null;
}) {
  const { sources: base, failed } = useCatalogSources(prefix, platform, true);
  const [query, setQuery] = useState('');
  const [imported, setImported] = useState<BrowserSource[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [renameIndex, setRenameIndex] = useState<number | null>(null);
  const [renameTitle, setRenameTitle] = useState('');

  const browser = useMemo(() => [...base, ...imported], [base, imported]);
  const chosen = useMemo(
    () => new Set(rows.filter((row) => row.enabled !== false).map((row) => sourceKey(row.source))),
    [rows],
  );
  // Nuvio strips franchise rows from state on every change (normalize), so
  // the display filter below only guards rows that predate it.
  const displayRows = platform === 'nuvio'
    ? rows.filter((row) => row._nativeFranchiseCollection === true || String(row.source?.catalogId || '') !== 'torbox-collections')
    : rows;
  const ownedOn = rows.some((row) => row._nativeFranchiseCollection === true);

  function commit(next: HomeRowDoc[]) {
    onChange(normalizeHomeOrder(next, platform));
  }

  function toggleByKey(key: string) {
    const source = browser.find((item) => browserKey(item) === key);
    if (!source) return;
    const at = rows.findIndex((row) => sourceKey(row.source) === key);
    if (at >= 0) {
      commit(rows.filter((_, index) => index !== at));
    } else {
      commit([...rows, homeRowFromSource(source, rows.length)]);
    }
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = rows.slice();
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    commit(next);
  }

  function drop(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return;
    const next = rows.slice();
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    commit(next);
  }

  function remove(index: number) {
    commit(rows.filter((_, at) => at !== index));
  }

  function openRename(index: number) {
    const row = rows[index];
    if (!row) return;
    setRenameIndex(index);
    setRenameTitle(row.title || '');
  }

  function saveRename() {
    if (renameIndex === null) return;
    const row = rows[renameIndex];
    const title = renameTitle.trim().slice(0, 80);
    if (!row || !title) {
      toast('Give this row a name', 'error');
      return;
    }
    const next = rows.slice();
    next[renameIndex] = { ...row, title, customTitle: true };
    commit(next);
    setRenameIndex(null);
    toast('Home row name updated');
  }

  function toggleOwned(on: boolean) {
    if (on) {
      if (!prefix) {
        toast('Connect a debrid provider to build owned movie collections', 'error');
        return;
      }
      if (!ownedOn) commit([...rows, ownedFranchiseMarker(rows.length)]);
    } else {
      commit(rows.filter((row) => row._nativeFranchiseCollection !== true));
    }
  }

  async function doImport() {
    const url = importUrl.trim();
    if (!url) {
      toast('Paste a manifest.json link', 'error');
      return;
    }
    setImporting(true);
    try {
      const manifest = await apiClient.get<{ id?: string; name?: string; catalogs?: { id?: string; type?: string; name?: string }[] }>(
        `/api/import-json?url=${encodeURIComponent(url)}`,
      );
      if (!manifest || !Array.isArray(manifest.catalogs)) {
        throw new Error('That URL does not contain a valid addon manifest.');
      }
      const addonId = String(manifest.id || '');
      const found: BrowserSource[] = [];
      for (const catalog of manifest.catalogs) {
        if (!catalog || !catalog.id || (catalog.type !== 'movie' && catalog.type !== 'series')) continue;
        found.push({
          id: `import-${addonId}-${catalog.type}-${catalog.id}`,
          catalogId: String(catalog.id),
          name: String(catalog.name || catalog.id),
          type: catalog.type,
          category: `Imported · ${manifest.name || addonId || 'Addon'}`,
          addonId,
          addonUrl: url,
        });
      }
      if (!found.length) throw new Error('No movie or series catalogue rows were found.');
      const knownSources = new Set(browser.map(browserKey));
      const knownRows = new Set(rows.map((row) => sourceKey(row.source)));
      const freshSources = found.filter((source) => !knownSources.has(browserKey(source)));
      const freshRows = found
        .filter((source) => !knownRows.has(browserKey(source)))
        .map((source, offset) => homeRowFromSource(source, rows.length + offset));
      setImported((prev) => [...prev, ...freshSources]);
      commit([...rows, ...freshRows]);
      setImportUrl('');
      setImportOpen(false);
      toast(`${found.length} rows imported`);
    } catch (error) {
      toast(apiErrorCopy(error, 'Could not import manifest'), 'error');
    } finally {
      setImporting(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? browser.filter((source) => `${source.name} ${source.category} ${source.addonId} ${source.type}`.toLowerCase().includes(needle))
    : browser;
  const groups = new Map<string, BrowserSource[]>();
  for (const source of filtered) {
    const rowsForGroup = groups.get(source.category || 'Other') ?? [];
    rowsForGroup.push(source);
    groups.set(source.category || 'Other', rowsForGroup);
  }
  const orderedGroups = [...groups].sort(
    ([a], [b]) => browserGroupRank(a) - browserGroupRank(b) || a.localeCompare(b),
  );
  // Category accordions: the first group starts open, the rest stay shut so
  // a 600-row library reads as a neat shelf list. Searching opens everything
  // with matches. Fully controlled (native toggle suppressed) so a re-render
  // from toggling a row can never collapse what the user opened.
  const [openGroups, setOpenGroups] = useState<string[] | null>(null);
  function toggleGroup(group: string) {
    setOpenGroups((prev) => {
      const base = prev ?? (orderedGroups[0] ? [orderedGroups[0][0]] : []);
      return base.includes(group) ? base.filter((name) => name !== group) : [...base, group];
    });
  }
  function groupOpen(group: string, index: number): boolean {
    if (needle) return true;
    if (openGroups !== null) return openGroups.includes(group);
    return index === 0;
  }

  return (
    <div className="home-builder hr">
      <section className="home-browser hr-browser" aria-label="Catalogue library">
        <header className="hr-head">
          <div>
            <span className="hr-kicker">Catalogue library</span>
            <strong>Add rows to your Home</strong>
          </div>
          <button type="button" className="hr-import" onClick={() => setImportOpen(true)}>
            <span aria-hidden="true">＋</span> Import
          </button>
        </header>
        <label className="hr-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <input
            type="search" placeholder="Search the catalog library…" aria-label="Search catalogues"
            value={query} onChange={(event) => setQuery(event.target.value)}
          />
          <span className="hr-search-count">{filtered.length} available</span>
        </label>
        {failed && <p className="setup-error">Could not load available catalogues</p>}
        <div className="home-source-list">
          {orderedGroups.map(([group, items], groupIndex) => {
            const added = items.filter((source) => chosen.has(browserKey(source))).length;
            const open = groupOpen(group, groupIndex);
            return (
              <details className="source-group hr-group" key={group} open={open}>
                <summary
                  className="source-group-head"
                  onClick={(event) => { event.preventDefault(); toggleGroup(group); }}
                  aria-expanded={open}
                >
                  <span className="hr-group-icon" aria-hidden="true">{groupIcon(group)}</span>
                  <span className="hr-group-title">
                    <h3 data-i18n-preserve>{group}</h3>
                    <small>{added > 0 && <b>{added} added · </b>}{items.length} rows</small>
                  </span>
                  <span className="source-group-chevron" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                  </span>
                </summary>
                <div className="source-group-items">
                  {items.map((source) => {
                    const key = browserKey(source);
                    const active = chosen.has(key);
                    return (
                      <button
                        key={key} type="button"
                        className={`home-source-card${active ? ' selected' : ''}`}
                        aria-pressed={active} onClick={() => toggleByKey(key)}
                      >
                        <span className={`hr-type is-${source.type === 'series' ? 'series' : 'movie'}`}>{source.type === 'series' ? 'Series' : 'Movies'}</span>
                        <span className="hr-source-text">
                          <strong data-i18n-preserve>{source.name}</strong>
                          <small data-i18n-preserve>{source.addonId || 'LeLibrary'}</small>
                        </span>
                        <span className="add-row-mark" aria-hidden="true">
                          {active
                            ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 10 17.5 19 7" /></svg>
                            : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </details>
            );
          })}
          {filtered.length === 0 && <div className="selected-empty">No catalogues match your search.</div>}
        </div>
      </section>

      <section className="selected-home hr-order" aria-label="Home screen order">
        <header className="hr-head">
          <div>
            <span className="hr-kicker">Your Home</span>
            <strong>Home screen order</strong>
            <small>Top of this list appears first in Nuvio / Stremio.</small>
          </div>
          <span className="hr-count">{displayRows.length}</span>
        </header>
        <label className="switch-row hr-owned">
          <span><strong>LeLibrary Movie Collections</strong><small>Your owned films, automatically grouped into franchise folders.</small></span>
          <input type="checkbox" checked={ownedOn} onChange={(event) => toggleOwned(event.target.checked)} />
          <i aria-hidden="true" />
        </label>
        {displayRows.length === 0 && (
          <div className="hr-empty">
            <span className="hr-empty-art" aria-hidden="true"><i /><i /><i /></span>
            <strong>Your Home is empty</strong>
            <small>Select catalogues on the left to build your Home.</small>
          </div>
        )}
        <ol className="hr-rows">
          {displayRows.map((row, index) => (
            <li
              key={row.id} className="selected-row" draggable
              onDragStart={(event) => { event.dataTransfer.setData('text/plain', String(index)); }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); drop(Number(event.dataTransfer.getData('text/plain')), index); }}
            >
              <span className="drag-handle" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
              </span>
              <span className="row-order">{String(index + 1).padStart(2, '0')}</span>
              <span className="hr-row-text">
                <strong>{row.title}</strong>
                <small>
                  <span className={`hr-type is-${row.source?.type === 'series' ? 'series' : 'movie'}`}>{row.source?.type === 'series' ? 'Series' : 'Movies'}</span>
                  <span data-i18n-preserve>{row.source?.addonId || 'LeLibrary'}</span>
                </small>
              </span>
              <span className="row-move-controls">
                <button type="button" className="eye-btn" aria-label={`Move ${row.title} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                <button type="button" className="eye-btn" aria-label={`Move ${row.title} down`} disabled={index === displayRows.length - 1} onClick={() => move(index, 1)}>↓</button>
                <button type="button" className="eye-btn" aria-label={`Rename ${row.title}`} onClick={() => openRename(index)}>✎</button>
                <button type="button" className="eye-btn is-remove" aria-label={`Remove ${row.title}`} onClick={() => remove(index)}>✕</button>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {renameIndex !== null && (
        <div className="app-modal" role="dialog" aria-modal="true" aria-label="Name this row" onClick={(event) => { if (event.target === event.currentTarget) setRenameIndex(null); }}>
          <div className="app-modal-box home-row-editor">
            <div className="app-modal-head">
              <div><span className="setup-kicker">Home row</span><h3>Name this row</h3></div>
              <button type="button" className="eye-btn" aria-label="Close" onClick={() => setRenameIndex(null)}>✕</button>
            </div>
            <p>Use a clear name, add an emoji, or both. The catalogue source and its content stay exactly the same.</p>
            <label className="setup-field">
              <span>Row name</span>
              <input
                type="text" maxLength={80} autoComplete="off" value={renameTitle}
                placeholder="For example: 🍿 Friday night movies"
                onChange={(event) => setRenameTitle(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveRename(); } }}
              />
            </label>
            <div className="home-row-emoji-picker" aria-label="Add an emoji">
              {RENAME_EMOJI.map((emoji) => (
                <button key={emoji} type="button" onClick={() => setRenameTitle((prev) => `${prev}${emoji}`.slice(0, 80))}>{emoji}</button>
              ))}
            </div>
            <div className="app-modal-actions">
              <button type="button" className="setup-secondary" onClick={() => setRenameIndex(null)}>Cancel</button>
              <button type="button" className="setup-primary" onClick={saveRename}>Save name</button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="app-modal" role="dialog" aria-modal="true" aria-label="Add rows from a Stremio addon" onClick={(event) => { if (event.target === event.currentTarget) setImportOpen(false); }}>
          <div className="app-modal-box">
            <div className="app-modal-head">
              <div><span className="setup-kicker">Import catalogue</span><h3>Add rows from a Stremio addon</h3></div>
              <button type="button" className="eye-btn" aria-label="Close" onClick={() => setImportOpen(false)}>✕</button>
            </div>
            <p>Paste a manifest.json URL. Movie and series catalogues will be added to Your Home.</p>
            <label className="setup-field">
              <span>Manifest URL</span>
              <input type="url" value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder="https://example.com/manifest.json" />
            </label>
            <div className="app-modal-actions">
              <button type="button" className="setup-secondary" onClick={() => setImportOpen(false)}>Cancel</button>
              <button type="button" className="setup-primary" disabled={importing} onClick={() => void doImport()}>
                {importing ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
