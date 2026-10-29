import { useState } from 'react';
import { artThumb, sourceDisplayName, type FolderDoc } from '@/features/setup/shared/collection-doc';

// Folder artwork, or a designed empty tile when there is none (or the link is
// broken): a folder glyph and the folder's title instead of the site logo.
// Covers load as their small tile copy (artThumb); if that copy is missing the
// full cover is tried before the empty tile.
export function FolderArt({ src, title, className = '' }: { src: string; title: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const thumb = artThumb(src);
  const shown = full === src ? src : thumb;
  if (!src.trim() || failed === src) {
    return (
      <span className={`folder-art-empty ${className}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2h8.8A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
        </svg>
        <strong data-i18n-preserve={title.trim() ? true : undefined}>{title.trim() || 'New folder'}</strong>
        <small>No artwork yet</small>
      </span>
    );
  }
  return (
    <img className={className} src={shown} alt="" loading="lazy" decoding="async"
      onError={() => { if (shown !== src) setFull(src); else setFailed(src); }} />
  );
}

// One folder tile in the studio grid. Markup mirrors the old
// renderFolderCard(): animated art wins, then cover, then hero, then the
// designed empty tile; badges name the tile state.
export function FolderCard({ folder, names = {}, onEdit, onRemove }: {
  folder: FolderDoc;
  names?: Record<string, string>;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const animated = folder.focusGifEnabled && folder.focusGifUrl.trim() !== '';
  const still = folder.coverImageUrl || folder.heroBackdropUrl || '';
  // Like Nuvio, the animation plays only on focus: a grid of GIFs is tens of
  // megabytes, a grid of stills a few hundred kilobytes.
  const [focused, setFocused] = useState(false);
  const image = animated && (focused || !still) ? folder.focusGifUrl : still;
  const sources = folder.catalogSources || [];
  const types = [...new Set(sources.map((source) => (source.type === 'series' ? 'Series' : 'Movies')))];
  const shape = folder.tileShape === 'PORTRAIT' ? 'PORTRAIT' : 'LANDSCAPE';

  return (
    <article className="folder-card" onMouseEnter={() => setFocused(true)} onMouseLeave={() => setFocused(false)}
      onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
      <div className={`folder-art${shape === 'PORTRAIT' ? ' portrait' : ''}`}>
        <FolderArt key={image} src={image} title={folder.title} />
        <div className="folder-badges">
          {animated && <span className="media-badge media-badge-gif">GIF</span>}
          {folder.hideTitle && <span className="media-badge">Title hidden</span>}
          <span className="media-badge">{shape}</span>
        </div>
      </div>
      <div className="folder-card-body">
        <strong data-i18n-preserve>{folder.title || 'Folder'}</strong>
        <p>{types.join(' + ') || 'No media'} · {sources.length} source{sources.length === 1 ? '' : 's'}</p>
        {sources.length > 0 && (
          <p className="folder-card-sources" data-i18n-preserve>{sources.map((source) => sourceDisplayName(source, names)).join(' · ')}</p>
        )}
        <div className="folder-card-actions">
          <button type="button" className="setup-secondary" onClick={onEdit}>Edit folder</button>
          <button type="button" className="setup-secondary" aria-label={`Remove ${folder.title || 'folder'}`} onClick={onRemove}>Remove</button>
        </div>
      </div>
    </article>
  );
}
