import { useState } from 'react';
import { toast } from '@/features/setup/shared/Toast';
import { FolderArt } from '@/features/setup/full/collections/FolderCard';
import {
  absoluteUrl,
  sourceDisplayName,
  normalizeTileShape,
  type CatalogSourceRef,
  type FolderDoc,
} from '@/features/setup/shared/collection-doc';
import { SourcePickerModal } from '@/features/setup/full/collections/SourcePickerModal';
import { GifPickerModal } from '@/features/setup/full/collections/GifPickerModal';
import { matchingFocusGif, type GifItem } from '@/features/setup/full/collections/curated-packs';

// Quick-add emoji for folder titles.
const EMOJI = ['🎬', '📺', '🍿', '⭐', '🔥', '💜', '✨', '🗂️'];

// Folder editor: name + layout, artwork, catalogue sources. The focus-GIF
// library picker arrives with the Quick Packs stage; until then the animation
// URL is pasted by hand. Validation copies the old saveFolderModal().
export function FolderEditorModal({ folder, gifLibrary, names = {}, onSave, onClose }: {
  folder: FolderDoc;
  gifLibrary: GifItem[];
  names?: Record<string, string>;
  onSave: (next: FolderDoc) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(folder.title);
  const [shape, setShape] = useState(folder.tileShape);
  const [hideTitle, setHideTitle] = useState(folder.hideTitle);
  const [cover, setCover] = useState(folder.coverImageUrl);
  const [backdrop, setBackdrop] = useState(folder.heroBackdropUrl);
  const [gifOn, setGifOn] = useState(folder.focusGifEnabled);
  const [gifUrl, setGifUrl] = useState(folder.focusGifUrl);
  const [sources, setSources] = useState<CatalogSourceRef[]>(folder.catalogSources);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const animated = gifOn && gifUrl.trim() !== '';
  const still = cover.trim() || backdrop.trim();
  const match = matchingFocusGif(sources, gifLibrary);

  function chooseGif(url: string, title: string) {
    setGifUrl(url);
    setGifOn(true);
    setGifPickerOpen(false);
    toast(`${title} animation selected`);
  }

  function insertEmoji(emoji: string) {
    setTitle((prev) => `${prev}${emoji}`.slice(0, 80));
  }

  function removeSource(index: number) {
    setSources((prev) => prev.filter((_, at) => at !== index));
  }

  function save() {
    if (gifOn && gifUrl.trim() === '') {
      toast('Choose a focus animation or turn Focus animation off', 'error');
      return;
    }
    onSave({
      ...folder,
      title: title.trim().slice(0, 80) || folder.title,
      tileShape: normalizeTileShape(shape),
      hideTitle,
      coverImageUrl: absoluteUrl(origin, cover),
      heroBackdropUrl: absoluteUrl(origin, backdrop),
      focusGifEnabled: gifOn,
      focusGifUrl: absoluteUrl(origin, gifUrl),
      catalogSources: sources.filter((source) => String(source.catalogId || '').trim() !== ''),
    });
  }

  return (
    <div
      className="app-modal folder-editor-modal" role="dialog" aria-modal="true"
      aria-label="Make this folder yours"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="app-modal-box folder-editor">
        <div className="app-modal-head folder-editor-head">
          <div>
            <span className="setup-kicker">Folder editor</span>
            <h3>Make this folder yours</h3>
            <p>Choose its name, artwork and the catalogues it opens.</p>
          </div>
          <button type="button" className="eye-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="folder-editor-body">
          <aside className="folder-live-preview">
            <div className="folder-preview-heading">
              <span className="setup-kicker">Live preview</span>
              <small>Updates as you edit</small>
            </div>
            <div className="folder-preview-stage">
              <div className="folder-preview-card">
                <div className={`folder-preview-image${shape === 'PORTRAIT' ? ' portrait' : ''}`}>
                  {backdrop.trim() && (
                    <img className="folder-preview-backdrop" src={backdrop} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />
                  )}
                  <FolderArt key={animated ? gifUrl : still} src={animated ? gifUrl : still} title={hideTitle ? '' : title} />
                  <div className="folder-badges">
                    {animated && <span className="media-badge media-badge-gif">GIF LIVE</span>}
                    <span className="media-badge">{shape}</span>
                  </div>
                </div>
                <div className="folder-preview-copy">
                  <strong>{hideTitle ? 'Title hidden' : title.trim() || 'Folder'}</strong>
                  <small>{animated ? 'Animated focus preview' : backdrop.trim() ? 'Custom hero backdrop' : 'Default backdrop'}</small>
                </div>
              </div>
            </div>
            <div className="folder-preview-note">
              <p>This preview shows the folder tile. The selected catalogues appear after you open it in Nuvio.</p>
            </div>
          </aside>
          <div className="folder-editor-fields">
            <section className="folder-editor-section">
              <div className="folder-editor-section-head"><span className="folder-section-number">1</span><div><h4>Name and layout</h4><p>What people see in the Collections screen.</p></div></div>
              <div>
                <label className="setup-field">
                  <span>Folder title</span>
                  <input type="text" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="For example: Friday night horror" />
                </label>
                <div className="home-row-emoji-picker" aria-label="Add an emoji to this folder">
                  {EMOJI.map((emoji) => (
                    <button key={emoji} type="button" onClick={() => insertEmoji(emoji)}>{emoji}</button>
                  ))}
                </div>
              </div>
              <div className="folder-layout-row">
                <div><span className="setup-hint">Tile shape</span>
                  <div className="segmented-control" role="group" aria-label="Tile shape">
                    {(['LANDSCAPE', 'PORTRAIT'] as const).map((option) => (
                      <button key={option} type="button" data-value={option} className={shape === option ? 'active' : ''} onClick={() => setShape(option)}>
                        {option === 'LANDSCAPE' ? 'Landscape' : 'Poster'}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="switch-row compact-switch">
                  <span><strong>Hide title</strong><small>Show artwork only</small></span>
                  <input type="checkbox" checked={hideTitle} onChange={(event) => setHideTitle(event.target.checked)} />
                  <i aria-hidden="true" />
                </label>
              </div>
            </section>
            <section className="folder-editor-section">
              <div className="folder-editor-section-head"><span className="folder-section-number">2</span><div><h4>Artwork</h4><p>Optional images for the folder tile and detail header.</p></div></div>
              <label className="setup-field">
                <span>Cover artwork URL</span>
                <input type="url" value={cover} onChange={(event) => setCover(event.target.value)} placeholder="https://example.com/cover.jpg" />
                <small className="setup-hint">Used for the folder tile.</small>
              </label>
              <label className="setup-field">
                <span>Hero backdrop URL</span>
                <input type="url" value={backdrop} onChange={(event) => setBackdrop(event.target.value)} placeholder="https://example.com/backdrop.jpg" />
                <small className="setup-hint">Shown behind the folder contents.</small>
              </label>
              <label className="switch-row compact-switch">
                <span><strong>Animated focus artwork</strong><small>Play an animation when this tile is selected.</small></span>
                <input type="checkbox" checked={gifOn} onChange={(event) => setGifOn(event.target.checked)} />
                <i aria-hidden="true" />
              </label>
              {gifOn && (
                <div>
                  <label className="setup-field">
                    <span>Animation URL</span>
                    <input type="url" value={gifUrl} onChange={(event) => setGifUrl(event.target.value)} placeholder="https://example.com/focus.gif" />
                  </label>
                  <div className="gif-field-actions">
                    <button type="button" className="setup-secondary" onClick={() => setGifPickerOpen(true)}>Browse animations</button>
                    {match && (
                      <button type="button" className="setup-secondary" onClick={() => chooseGif(match.url, match.title)}>
                        Use matching GIF: {match.title}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>
            <section className="folder-editor-section folder-sources">
              <div className="folder-editor-section-head">
                <span className="folder-section-number">3</span>
                <div><h4>Catalogue sources</h4><p>Choose what appears when somebody opens this folder.</p></div>
                <button type="button" className="setup-secondary" onClick={() => setPickerOpen(true)}>+ Add sources</button>
              </div>
              <div>
                {sources.length === 0 && <p className="setup-note">No catalogue sources selected yet.</p>}
                {sources.map((source, index) => {
                  const label = sourceDisplayName(source, names);
                  return (
                    <article className="folder-source-summary" key={`${source.catalogId}:${source.type}:${index}`}>
                      <span className="media-type-icon" aria-hidden="true">{source.type === 'series' ? '📺' : '🎬'}</span>
                      <span>
                        <strong data-i18n-preserve>{label}</strong>
                        <small>{source.type === 'series' ? 'Series' : 'Movies'} · <span data-i18n-preserve>{source.addonId || 'LeLibrary'}</span></small>
                      </span>
                      <button type="button" className="eye-btn" aria-label={`Remove ${label}`} onClick={() => removeSource(index)}>✕</button>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
        <div className="app-modal-actions folder-editor-actions">
          <span>Your changes apply when this setup is saved.</span>
          <div>
            <button type="button" className="setup-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="setup-primary" onClick={save}>Save folder</button>
          </div>
        </div>
      </div>
      <SourcePickerModal
        open={pickerOpen}
        selected={sources}
        onApply={(next) => { setSources(next); setPickerOpen(false); }}
        onClose={() => setPickerOpen(false)}
      />
      <GifPickerModal
        open={gifPickerOpen}
        library={gifLibrary}
        onChoose={chooseGif}
        onClose={() => setGifPickerOpen(false)}
      />
    </div>
  );
}
