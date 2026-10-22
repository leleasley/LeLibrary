import { useState } from 'react';
import { HUB_COVER } from '@/features/setup/shared/collection-doc';
import {
  HUB_SYSTEM_COVER,
  type CuratedPack,
} from '@/features/setup/full/collections/curated-packs';

function packCategory(pack: CuratedPack): string {
  return pack.category || 'More picks';
}

function isCollectionPack(pack: CuratedPack): boolean {
  return (pack.folderCount || pack.folders.length) > 1;
}

// Quick Pack library: ready-made collections first, focused single-folder
// starters below, LeLibrary essentials at the bottom. One click adds the
// complete pack; every folder stays editable afterwards.
export function PackLibraryModal({ open, onClose, curated, failed, selectedIds, ownedOn, hubOn, platform, onTogglePack, onToggleOwned, onToggleHub }: {
  open: boolean;
  onClose: () => void;
  curated: CuratedPack[];
  failed: boolean;
  selectedIds: string[];
  ownedOn: boolean;
  hubOn: boolean;
  platform: 'nuvio' | 'stremio';
  onTogglePack: (id: string) => void;
  onToggleOwned: (on: boolean) => void;
  onToggleHub: () => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');

  if (!open) return null;

  const showNuvioPacks = platform !== 'stremio';
  const categories = [...new Set(curated.map(packCategory).concat(showNuvioPacks ? ['LeLibrary'] : []))].sort();
  const needle = query.trim().toLowerCase();
  const visible = curated.filter((pack) => {
    if (category && packCategory(pack) !== category) return false;
    if (!needle) return true;
    return [pack.title, pack.description, packCategory(pack)]
      .concat(pack.folders.map((folder) => folder.title))
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });
  const collectionPacks = visible.filter(isCollectionPack);
  const starters = visible.filter((pack) => !isCollectionPack(pack));
  // System cards stay visible while the search text is part of this phrase.
  const systemQuery = 'lelibrary movie collections hub your library franchises movies shows';
  const showSystemCards = showNuvioPacks
    && (!category || category === 'LeLibrary')
    && (!needle || systemQuery.includes(needle));
  const selectedCount = selectedIds.length + (ownedOn ? 1 : 0) + (hubOn ? 1 : 0);

  // One wide hero per card. Pack covers first, then the first landscape
  // backdrop, then a portrait cover as a last resort. Never a multi-slice
  // collage: portrait slices cropped baked-in titles and logos into each
  // other ("TRENDING" over "POPULAR", giant cut-off service logos).
  function packHero(pack: CuratedPack): string | null {
    if (pack.coverImageUrl) return pack.coverImageUrl;
    const folders = pack.folders || [];
    for (const folder of folders) {
      if (folder.heroBackdropUrl) return folder.heroBackdropUrl;
    }
    for (const folder of folders) {
      if (folder.coverImageUrl) return folder.coverImageUrl;
    }
    return null;
  }

  function packCard(pack: CuratedPack) {
    const selected = selectedIds.includes(pack.id);
    const folders = pack.folders || [];
    const folderCount = pack.folderCount || folders.length;
    const hero = packHero(pack);
    return (
      <article className={`pack-card${selected ? ' selected' : ''}`} key={pack.id}>
        <div className="pack-card-art">
          {hero ? (
            <img key={hero} src={hero} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} />
          ) : (
            <span className="pack-card-fallback" aria-hidden="true">{pack.icon || '✨'}</span>
          )}
          <span className="pack-refresh-badge">{pack.refresh === 'daily' ? 'Fresh daily' : 'Live sources'}</span>
          <span className="pack-folders-chip">{folderCount === 1 ? 'Focused folder' : `${folderCount} folders`}</span>
        </div>
        <div className="pack-card-body">
          <div className="pack-card-copy">
            <span className="pack-card-category">{packCategory(pack)}</span>
            <strong data-i18n-preserve>{pack.title}</strong>
            <small data-i18n-preserve>{pack.description}</small>
          </div>
          <div className="pack-card-footer">
            <button
              type="button" className={`pack-card-action${selected ? ' is-selected' : ''}`}
              onClick={() => onTogglePack(pack.id)}
              aria-pressed={selected}
            >
              {selected ? '✓' : '+'}
              <span>{selected ? 'Added' : 'Add pack'}</span>
            </button>
          </div>
        </div>
      </article>
    );
  }

  function systemCard(kind: 'owned' | 'hub') {
    const on = kind === 'owned' ? ownedOn : hubOn;
    const image = kind === 'owned' ? HUB_SYSTEM_COVER : HUB_COVER;
    const title = kind === 'owned' ? 'LeLibrary Movie Collections' : 'LeLibrary Hub';
    const description = kind === 'owned'
      ? 'Automatically groups your owned films into franchise folders.'
      : 'Keeps My Movies and My Shows together in two simple folders.';
    return (
      <article className={`pack-card pack-card-owned${on ? ' selected' : ''}`} key={kind}>
        <div className="pack-card-art">
          <img src={image} alt="" loading="lazy" />
          <span className="pack-refresh-badge">Bottom of Collections</span>
          <span className="pack-folders-chip">Your library</span>
        </div>
        <div className="pack-card-body">
          <div className="pack-card-copy">
            <span className="pack-card-category">LeLibrary essential</span>
            <strong data-i18n-preserve>{title}</strong>
            <small>{description}</small>
            {kind === 'owned' && (
              <small className="pack-home-row-note">Also adds a Home row — it acts like a Home row on your home screen.</small>
            )}
          </div>
          <div className="pack-card-footer">
            <button
              type="button" className={`pack-card-action${on ? ' is-selected' : ''}`}
              onClick={() => { if (kind === 'owned') onToggleOwned(!on); else onToggleHub(); }}
              aria-pressed={on}
            >
              {on ? '✓' : '+'}
              <span>{on ? 'Added' : 'Add pack'}</span>
            </button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <div
      className="app-modal quick-pack-library-modal" role="dialog" aria-modal="true"
      aria-label="Find your next collection"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="app-modal-box quick-pack-library">
        <div className="app-modal-head quick-pack-library-head">
          <div>
            <span className="setup-kicker">Collection library</span>
            <h3>Find your next collection</h3>
            <p>One click adds the complete pack. You can customise every folder afterwards.</p>
          </div>
          <button type="button" className="eye-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="quick-pack-library-toolbar">
          <div className="search-control">
            <input
              type="search" placeholder="Search genres, moods, services or franchises"
              aria-label="Search Quick Packs"
              value={query} onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="quick-pack-category-chips" role="group" aria-label="Filter Quick Packs">
            {['', ...categories].map((entry) => (
              <button
                key={entry || 'all'} type="button"
                className={`quick-pack-category${entry === category ? ' active' : ''}`}
                aria-pressed={entry === category}
                onClick={() => setCategory(entry)}
              >
                {entry || 'All packs'}
              </button>
            ))}
          </div>
          <span className="result-count">{visible.length + (showSystemCards ? 2 : 0)} packs</span>
        </div>
        {failed ? (
          <p className="setup-error">Could not load Quick Packs.</p>
        ) : (
          <div className="quick-pack-library-scroll">
            <div className="quick-pack-results-head">
              <div><span className="setup-kicker">Collection packs</span><strong>Ready-made collections</strong></div>
              <span>Live sources stay up to date automatically</span>
            </div>
            <div className="quick-pack-library-grid">
              {collectionPacks.map(packCard)}
              {collectionPacks.length === 0 && starters.length === 0 && (
                <div className="quick-pack-empty">
                  <strong>No matching packs</strong>
                  <span>Try another theme or choose a different category.</span>
                </div>
              )}
            </div>
            {starters.length > 0 && (
              <details className="quick-pack-starters" open={collectionPacks.length === 0 || needle !== ''}>
                <summary>
                  <span><strong>Focused single-folder starters</strong><small>Small, specific additions when you only want one new shelf.</small></span>
                  <span>{starters.length} starter{starters.length === 1 ? '' : 's'}</span>
                </summary>
                <div className="quick-pack-library-grid quick-pack-starter-grid">
                  {starters.map(packCard)}
                </div>
              </details>
            )}
            {showSystemCards && (
              <section className="quick-pack-system-section">
                <div className="quick-pack-results-head">
                  <div><span className="setup-kicker">Your library</span><strong>LeLibrary essentials</strong></div>
                  <span>Always kept together at the bottom of Nuvio Collections</span>
                </div>
                <div className="quick-pack-system-grid">
                  {systemCard('owned')}
                  {systemCard('hub')}
                </div>
              </section>
            )}
          </div>
        )}
        <div className="app-modal-actions quick-pack-library-actions">
          <span><b>{selectedCount}</b> pack{selectedCount === 1 ? '' : 's'} selected</span>
          <button type="button" className="setup-primary" onClick={onClose}>Done choosing packs</button>
        </div>
      </div>
    </div>
  );
}
