import { WatchlistSection, WATCHLIST_ACCORDION_DESC } from '@/features/setup/full/WatchlistSection';
import type { WatchlistDraftMap } from '@/features/setup/resolver/api';

// The watchlist accordion copy lives with the section so Settle In and Move In
// cannot drift. Re-exported here because both pages already import the section
// from this module.
export { WATCHLIST_ACCORDION_DESC };

// Metadata step extras: language, order, id mode, anime, search scope and
// stream notices. The backend honours every one of these field names on the
// config.
export interface MetadataExtrasDraft {
  lang: string;
  sortBy: string;
  mainMetadata: boolean;
  hideAnime: boolean;
  searchScope: string;
  notices: boolean;
  noticeTypes: string[];
}

export const DEFAULT_NOTICE_TYPES = ['none', 'rateLimit', 'digitalRelease'];

export const EMPTY_METADATA_EXTRAS: MetadataExtrasDraft = {
  lang: 'en-US',
  sortBy: 'data_adicao',
  mainMetadata: false,
  hideAnime: false,
  searchScope: 'combined',
  notices: true,
  noticeTypes: [...DEFAULT_NOTICE_TYPES],
};

export const LANGS: { id: string; name: string }[] = [
  { id: 'en-US', name: 'English' },
  { id: 'pt-BR', name: 'Português (Brasil)' },
  { id: 'es-ES', name: 'Español' },
  { id: 'fr-FR', name: 'Français' },
  { id: 'de-DE', name: 'Deutsch' },
  { id: 'it-IT', name: 'Italiano' },
  { id: 'ja-JP', name: '日本語' },
];

export const SEARCH_SCOPES: { id: string; name: string }[] = [
  { id: 'combined', name: 'Movies & Series + Your Library' },
  { id: 'library', name: 'Only your Library' },
  { id: 'tmdb', name: 'Only Movies & Series from TMDB' },
];

export const NOTICE_TYPES: { id: string; title: string; hint: string }[] = [
  { id: 'none', title: 'No streams found', hint: 'Show a notice when nothing is available for a title.' },
  { id: 'rateLimit', title: 'Provider rate limit', hint: 'Warn when your provider is temporarily rate-limiting playback.' },
  { id: 'digitalRelease', title: 'Digital release not found', hint: 'Note when a film has no digital release listed yet.' },
];

// Stream notices: one master switch plus a dropdown holding a checkbox per
// notice type. Field names are what the backend reads: keep them exact.
export function NoticeDropdown({ notices, noticeTypes, onNotices, onToggleType }: {
  notices: boolean;
  noticeTypes: string[];
  onNotices: (next: boolean) => void;
  onToggleType: (id: string) => void;
}) {
  const onCount = NOTICE_TYPES.filter((notice) => noticeTypes.includes(notice.id)).length;
  return (
    <>
      <label className="switch-row">
        <span><strong>Stream notices</strong><small>Show helpful stream-list messages. Choose which ones below.</small></span>
        <input type="checkbox" checked={notices} onChange={(event) => onNotices(event.target.checked)} />
        <i aria-hidden="true" />
      </label>
      <details className="notice-dropdown" open={notices ? undefined : false}>
        <summary>
          <span>Choose notices</span>
          <span className="notice-count">{notices ? `${onCount} of ${NOTICE_TYPES.length} on` : 'Off'}</span>
        </summary>
        <div className="notice-list">
          {NOTICE_TYPES.map((notice) => (
            <label className="notice-check" key={notice.id}>
              <input
                type="checkbox"
                checked={noticeTypes.includes(notice.id)}
                disabled={!notices}
                onChange={() => onToggleType(notice.id)}
              />
              <span><strong>{notice.title}</strong><small>{notice.hint}</small></span>
            </label>
          ))}
        </div>
      </details>
    </>
  );
}

// The knobs Quick Setup keeps under Advanced: metadata language, notices,
// search scope and anime. Quick Setup uses the isolated library IDs by default.
export interface QuickExtras {
  lang: string;
  notices: boolean;
  noticeTypes: string[];
  searchScope: string;
  hideAnime: boolean;
}

export const EMPTY_QUICK_EXTRAS: QuickExtras = {
  lang: 'en-US',
  notices: true,
  noticeTypes: [...DEFAULT_NOTICE_TYPES],
  searchScope: 'combined',
  hideAnime: false,
};

// Quick Look's summary of these knobs, shown as chips on its options card.
const SEARCH_SHORT: Record<string, string> = { combined: 'Search everything', library: 'Search your library', tmdb: 'Search TMDB only' };
export function quickExtrasChips(draft: QuickExtras): { key: string; text: string; icon?: string; changed?: boolean; off?: boolean; verbatim?: boolean }[] {
  const lang = LANGS.find((option) => option.id === draft.lang)?.name ?? draft.lang;
  return [
    { key: 'lang', icon: '🌐', text: lang, changed: draft.lang !== EMPTY_QUICK_EXTRAS.lang, verbatim: true },
    { key: 'search', icon: '🔎', text: SEARCH_SHORT[draft.searchScope] ?? 'Search everything', changed: draft.searchScope !== EMPTY_QUICK_EXTRAS.searchScope },
    { key: 'notices', icon: '💬', text: draft.notices ? 'Stream notices on' : 'Stream notices off', changed: !draft.notices },
    { key: 'anime', icon: '🍥', text: draft.hideAnime ? 'Anime hidden' : 'Anime shown', changed: draft.hideAnime },
  ];
}

export function QuickExtrasFields({ draft, onChange }: {
  draft: QuickExtras;
  onChange: (next: QuickExtras) => void;
}) {
  function toggleNoticeType(id: string) {
    const has = draft.noticeTypes.includes(id);
    onChange({ ...draft, noticeTypes: has ? draft.noticeTypes.filter((kept) => kept !== id) : [...draft.noticeTypes, id] });
  }

  return (
    <>
      <label className="setup-field">
        <span>Language</span>
        <select value={draft.lang} onChange={(event) => onChange({ ...draft, lang: event.target.value })}>
          {LANGS.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
        <small className="setup-hint">Titles, descriptions and artwork in your library use this language where TMDB has it.</small>
      </label>
      <NoticeDropdown
        notices={draft.notices} noticeTypes={draft.noticeTypes}
        onNotices={(notices) => onChange({ ...draft, notices })}
        onToggleType={toggleNoticeType}
      />
      <label className="setup-field">
        <span>Search</span>
        <select value={draft.searchScope} onChange={(event) => onChange({ ...draft, searchScope: event.target.value })}>
          {SEARCH_SCOPES.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
        <small className="setup-hint">Choose which separate search sections appear.</small>
      </label>
      <label className="switch-row">
        <span><strong>Hide anime</strong><small>Remove only anime sources from the Anime catalogue, library rows and mixed collections. Other sources in those collections stay available.</small></span>
        <input type="checkbox" checked={draft.hideAnime} onChange={(event) => onChange({ ...draft, hideAnime: event.target.checked })} />
        <i aria-hidden="true" />
      </label>
    </>
  );
}

export function MetadataExtras({ draft, onChange }: {
  draft: MetadataExtrasDraft;
  onChange: (next: MetadataExtrasDraft) => void;
}) {
  function toggleNoticeType(id: string) {
    const has = draft.noticeTypes.includes(id);
    onChange({ ...draft, noticeTypes: has ? draft.noticeTypes.filter((kept) => kept !== id) : [...draft.noticeTypes, id] });
  }

  return (
    <>
      <div className="setup-row">
        <label className="setup-field">
          <span>Language</span>
          <select value={draft.lang} onChange={(event) => onChange({ ...draft, lang: event.target.value })}>
            {LANGS.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
        <label className="setup-field">
          <span>Library order</span>
          <select value={draft.sortBy} onChange={(event) => onChange({ ...draft, sortBy: event.target.value })}>
            <option value="data_adicao">Date added</option>
            <option value="data_lancamento">Release date</option>
            <option value="titulo">Title (A-Z)</option>
          </select>
        </label>
      </div>
      <label className="switch-row">
        <span><strong>Use Main Metadata</strong><small>Use IMDb IDs for My Movies, My Shows and LeLibrary Collections. This enables richer client metadata, external streams and scrobbling support.</small></span>
        <input type="checkbox" checked={draft.mainMetadata} onChange={(event) => onChange({ ...draft, mainMetadata: event.target.checked })} />
        <i aria-hidden="true" />
      </label>
      <label className="switch-row">
        <span><strong>Hide anime</strong><small>Remove only anime sources from the Anime catalogue, library rows and mixed collections. Other sources in those collections stay available.</small></span>
        <input type="checkbox" checked={draft.hideAnime} onChange={(event) => onChange({ ...draft, hideAnime: event.target.checked })} />
        <i aria-hidden="true" />
      </label>
      <NoticeDropdown
        notices={draft.notices} noticeTypes={draft.noticeTypes}
        onNotices={(notices) => onChange({ ...draft, notices })}
        onToggleType={toggleNoticeType}
      />
      <label className="setup-field">
        <span>Search</span>
        <select value={draft.searchScope} onChange={(event) => onChange({ ...draft, searchScope: event.target.value })}>
          {SEARCH_SCOPES.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
        <small className="setup-hint">Choose which separate search sections appear. The combined option keeps global Movies and Series separate from My Movies, My Shows and Collections.</small>
      </label>
    </>
  );
}

// Watchlist connects live here in the metadata step. OAuth seals into a
// setup row, so before creation the cards state the requirement; after
// creation (review, or any unlocked editor) they go live.
export function MetadataWatchlists({ uuid, editToken, draft, onDraft }: {
  uuid: string | null;
  editToken: string | null;
  draft?: WatchlistDraftMap | null | undefined;
  onDraft?: ((next: WatchlistDraftMap) => void) | undefined;
}) {
  return <WatchlistSection uuid={uuid} editToken={editToken} draft={draft} onDraft={onDraft} />;
}
