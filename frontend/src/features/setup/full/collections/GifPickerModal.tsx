import { useState } from 'react';
import type { GifItem } from '@/features/setup/full/collections/curated-packs';

// Bundled focus animations. Sent through in the folder configuration, so the
// folder keeps working even if the library changes later.
export function GifPickerModal({ open, library, onChoose, onClose }: {
  open: boolean;
  library: GifItem[];
  onChoose: (url: string, title: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  if (!open) return null;

  const needle = query.trim().toLowerCase();
  const items = needle
    ? library.filter((item) => `${item.title} ${item.pack}`.toLowerCase().includes(needle))
    : library;

  return (
    <div
      className="app-modal gif-picker-modal" role="dialog" aria-modal="true"
      aria-label="Choose a focus animation"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="app-modal-box gif-picker">
        <div className="app-modal-head">
          <div>
            <span className="setup-kicker">Focus artwork</span>
            <h3>Choose a focus animation</h3>
            <p>These animations are bundled with LeLibrary and are sent through in the folder configuration.</p>
          </div>
          <button type="button" className="eye-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="source-picker-toolbar">
          <div className="search-control">
            <input
              type="search" placeholder="Search animations" aria-label="Search focus animations"
              value={query} onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <span className="result-count">{items.length} animations</span>
        </div>
        <div className="gif-picker-grid">
          {items.map((item) => (
            <button
              key={item.url} type="button" className="gif-picker-card"
              onClick={() => onChoose(item.url, item.title)}
            >
              <span className="gif-picker-art">
                <img
                  src={item.url} alt="" loading="lazy"
                  onError={(event) => { event.currentTarget.src = item.cover; }}
                />
                <span>GIF</span>
              </span>
              <strong data-i18n-preserve>{item.title}</strong>
              <small data-i18n-preserve>{item.pack}</small>
            </button>
          ))}
          {items.length === 0 && <p className="setup-note">No focus animations match that search.</p>}
        </div>
        <div className="app-modal-actions">
          <button type="button" className="setup-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
