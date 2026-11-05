import { CONTENT_CATEGORIES, cleanExcludeCategories } from '@/features/setup/shared/content-filters';
import { TorboxSourcesField } from '@/features/setup/full/MetadataExtras';
import type { MetadataExtrasDraft } from '@/features/setup/full/MetadataExtras';

// Content filters (5.9.7): what may appear at all. Everything here is honoured
// by the server on every surface Hide anime already covers: library rows, the
// Hub and collections, Trending / Popular, search, the manifest and pushes.
//
// The Anime checkbox and "Hide anime" are one switch (the server treats them
// that way), so Anime is bound to hideAnime and never stored in
// excludeCategories.
export function ContentFiltersSection({ draft, onChange }: {
  draft: MetadataExtrasDraft;
  onChange: (next: MetadataExtrasDraft) => void;
}) {
  const picked = cleanExcludeCategories(draft.excludeCategories).filter((id) => id !== 'anime');

  function toggleCategory(id: string, on: boolean) {
    const next = on ? [...picked, id] : picked.filter((kept) => kept !== id);
    onChange({ ...draft, excludeCategories: cleanExcludeCategories(next) });
  }

  return (
    <>
      <label className="switch-row">
        <span>
          <strong>Use Main Metadata</strong>
          <small>Use IMDb IDs for My Movies, My Shows and LeLibrary Collections. This enables richer client metadata, external streams and Trakt scrobbling through Nuvio or Stremio (connect Trakt in the player).</small>
        </span>
        <input type="checkbox" checked={draft.mainMetadata} onChange={(event) => onChange({ ...draft, mainMetadata: event.target.checked })} />
        <i aria-hidden="true" />
      </label>
      <p className="cf-disclosure">
        If enabled, your Library folders will bring through the streams you have enabled. Leave this off if you just want to see ONLY YOUR FILES inside the LeLibrary Rows and the LeLibrary Hub.
      </p>
      <label className="switch-row">
        <span><strong>Hide anime</strong><small>Remove only anime sources from the Anime catalogue, library rows and mixed collections. Other sources in those collections stay available.</small></span>
        <input type="checkbox" checked={draft.hideAnime} onChange={(event) => onChange({ ...draft, hideAnime: event.target.checked })} />
        <i aria-hidden="true" />
      </label>
      <label className="switch-row">
        <span><strong>Hide adult content</strong><small>Hide titles TMDB flags as adult or certifies NC-17 or X (films) and TV-MA (shows). Titles with no rating are kept.</small></span>
        <input type="checkbox" checked={draft.hideAdult} onChange={(event) => onChange({ ...draft, hideAdult: event.target.checked })} />
        <i aria-hidden="true" />
      </label>
      <div className="cf-categories">
        <h4>Exclude categories</h4>
        <p className="setup-hint">Titles in any ticked category leave My Movies, My Shows, the Hub, collections and search. A title with several categories is hidden when any of them is ticked. Titles TMDB has not described yet stay visible.</p>
        <div className="cf-grid">
          {CONTENT_CATEGORIES.map((category) => {
            const anime = category.id === 'anime';
            const checked = anime ? draft.hideAnime : picked.includes(category.id);
            return (
              <label className="cf-check" key={category.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    if (anime) onChange({ ...draft, hideAnime: event.target.checked });
                    else toggleCategory(category.id, event.target.checked);
                  }}
                />
                <span>{category.label}</span>
              </label>
            );
          })}
        </div>
      </div>
      <h3 className="qs-sub"><strong>TorBox sources</strong><span>What your library is built from</span></h3>
      <TorboxSourcesField value={draft.torboxSources} onChange={(torboxSources) => onChange({ ...draft, torboxSources })} />
    </>
  );
}
