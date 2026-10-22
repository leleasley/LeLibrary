import { normalizeTileShape, normalizeViewMode, type CollectionDoc, type FolderDoc } from '@/features/setup/shared/collection-doc';
import { FolderCard } from '@/features/setup/full/collections/FolderCard';

// One collection in the studio. Closed it is a hero (artwork, inline title,
// summary, actions); open it exposes the Nuvio presentation settings and the
// folder grid. Copy and control order mirror the old renderCollection().
export function CollectionCard({ collection, open, system, names = {}, disableUp, disableDown, onToggle, onTitle, onRemove, onMove, onField, onBool, onAddFolder, onEditFolder, onRemoveFolder, onMoveFolder }: {
  collection: CollectionDoc;
  open: boolean;
  system: boolean;
  names?: Record<string, string>;
  disableUp: boolean;
  disableDown: boolean;
  onToggle: () => void;
  onTitle: (title: string) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
  onField: (field: 'tileShape' | 'viewMode', value: string) => void;
  onBool: (field: 'pinToTop' | 'focusGlowEnabled' | 'showAllTab' | 'hideTitle') => void;
  onAddFolder: () => void;
  onEditFolder: (index: number) => void;
  onRemoveFolder: (index: number) => void;
  onMoveFolder: (from: number, to: number) => void;
}) {
  const folders = collection.folders || [];
  const sourceCount = folders.reduce((total, folder) => total + (folder.catalogSources || []).length, 0);
  const title = collection.title.trim() || 'Imported collection';

  function dropFolder(from: number, to: number) {
    if (from === to) return;
    onMoveFolder(from, to);
  }

  return (
    <article className={`collection-card${open ? ' collection-card-expanded' : ' collection-card-collapsed'}${system ? ' collection-card-system' : ''}`}>
      <div className="collection-hero">
        {collection.backdropUrl && <img className="collection-hero-image" src={collection.backdropUrl} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}
        <button
          type="button" className="collection-hero-click" aria-expanded={open}
          aria-label={`${open ? 'Collapse ' : 'Expand '}${title}`} onClick={onToggle}
        />
        <div className="collection-hero-content collection-hero-visible">
          <div className="collection-hero-copy">
            <input
              className="collection-title-input" aria-label="Collection title"
              value={collection.title}
              onChange={(event) => onTitle(event.target.value.slice(0, 80))}
              onClick={(event) => event.stopPropagation()}
            />
            <div className="collection-summary">
              {system && <span className="collection-system-label">LeLibrary essential · </span>}
              {folders.length} folders · {sourceCount} live sources · {collection.tileShape === 'PORTRAIT' ? 'Poster' : 'Landscape'}
            </div>
          </div>
          <div className="collection-hero-actions">
            {!system && (
              <span className="collection-order-controls">
                <button type="button" className="eye-btn" aria-label="Move collection up" disabled={disableUp} onClick={(event) => { event.stopPropagation(); onMove(-1); }}>↑</button>
                <button type="button" className="eye-btn" aria-label="Move collection down" disabled={disableDown} onClick={(event) => { event.stopPropagation(); onMove(1); }}>↓</button>
              </span>
            )}
            <button type="button" className="collection-expand-button" aria-expanded={open} onClick={(event) => { event.stopPropagation(); onToggle(); }}>
              {open ? 'Collapse' : 'Edit collection'}
            </button>
            {!system && (
              <button type="button" className="btn-danger" onClick={(event) => { event.stopPropagation(); onRemove(); }}>Remove</button>
            )}
          </div>
        </div>
      </div>
      {open && (
        <div className="collection-editor-body">
          <div className="collection-settings">
            <div className="display-controls">
              <div>
                <span className="setup-hint">Default tile style</span>
                <div className="segmented-control" role="group" aria-label="Default tile style">
                  {(['LANDSCAPE', 'PORTRAIT'] as const).map((option) => (
                    <button key={option} type="button" data-value={option} className={collection.tileShape === option ? 'active' : ''} onClick={() => onField('tileShape', option)}>
                      {option === 'LANDSCAPE' ? 'Landscape' : 'Poster'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="setup-hint">View</span>
                <div className="segmented-control" role="group" aria-label="View">
                  <button type="button" className={collection.viewMode === 'TABBED_GRID' ? 'active' : ''} onClick={() => onField('viewMode', 'TABBED_GRID')}>Tabbed grid</button>
                  <button type="button" className={collection.viewMode === 'FOLLOW_LAYOUT' ? 'active' : ''} onClick={() => onField('viewMode', 'FOLLOW_LAYOUT')}>Horizontal</button>
                </div>
              </div>
            </div>
            <div className="collection-switches">
              <label className="switch-row">
                <span><strong>Pin to top</strong><small>Keep this collection above regular Home rows.</small></span>
                <input type="checkbox" checked={collection.pinToTop} onChange={() => onBool('pinToTop')} />
                <i aria-hidden="true" />
              </label>
              <label className="switch-row">
                <span><strong>Focus glow</strong><small>Show a glow around the selected folder.</small></span>
                <input type="checkbox" checked={collection.focusGlowEnabled !== false} onChange={() => onBool('focusGlowEnabled')} />
                <i aria-hidden="true" />
              </label>
              <label className="switch-row">
                <span><strong>Show “All” tab</strong><small>Include one tab containing every folder.</small></span>
                <input type="checkbox" checked={collection.showAllTab !== false} onChange={() => onBool('showAllTab')} />
                <i aria-hidden="true" />
              </label>
              <label className="switch-row">
                <span><strong>Hide collection title</strong><small>Let the artwork carry the identity.</small></span>
                <input type="checkbox" checked={!!collection.hideTitle} onChange={() => onBool('hideTitle')} />
                <i aria-hidden="true" />
              </label>
            </div>
          </div>
          <div className="folder-section">
            <div className="folder-section-head">
              <div><h3>Folders</h3><p>Drag to reorder. Artwork and sources stay attached.</p></div>
              <button type="button" className="setup-secondary" onClick={onAddFolder}>Add folder</button>
            </div>
            <div className="folder-grid">
              {folders.length === 0 && <div className="folder-empty">No folders yet. Add one to get started.</div>}
              {folders.map((folder: FolderDoc, index: number) => (
                <div
                  key={folder.id}
                  draggable
                  onDragStart={(event) => { event.dataTransfer.setData('text/plain', String(index)); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => { event.preventDefault(); dropFolder(Number(event.dataTransfer.getData('text/plain')), index); }}
                >
                  <FolderCard folder={folder} names={names} onEdit={() => onEditFolder(index)} onRemove={() => onRemoveFolder(index)} />
                </div>
              ))}
              <button type="button" className="folder-add-tile" onClick={onAddFolder}>
                <span aria-hidden="true">+</span>
                <strong>New folder</strong>
                <small>Artwork, sources and tile style</small>
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

export function applyCollectionField(collection: CollectionDoc, field: 'tileShape' | 'viewMode', value: string): CollectionDoc {
  if (field === 'tileShape') {
    const shape = normalizeTileShape(value);
    return { ...collection, tileShape: shape, folders: collection.folders.map((folder) => ({ ...folder, tileShape: shape })) };
  }
  return { ...collection, viewMode: normalizeViewMode(value) };
}
