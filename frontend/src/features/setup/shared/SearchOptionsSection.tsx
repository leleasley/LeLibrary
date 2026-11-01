import { SEARCH_SCOPES } from '@/features/setup/full/MetadataExtras';
import {
  SEARCH_ORDERS,
  SEARCH_ROW_NAMES,
  cleanSearchOptions,
  type SearchOptionsDraft,
  type SearchOrder,
  type SearchRowName,
} from '@/features/setup/shared/search-options';

// The Setup page's Search accordion (Settle In and Move In): which search
// rows LeLibrary adds to Nuvio or Stremio, how they are ordered and named.
// Everything here works without AI: plain TMDB search, recommendations and
// person credits.
export function SearchOptionsSection({ scope, onScope, value, onChange, hideAnime }: {
  scope: string;
  onScope: (next: string) => void;
  value: SearchOptionsDraft;
  onChange: (next: SearchOptionsDraft) => void;
  // Hide anime (Preferences) wins over the anime row.
  hideAnime: boolean;
}) {
  const options = cleanSearchOptions(value);
  const set = (patch: Partial<SearchOptionsDraft>) => onChange({ ...options, ...patch });
  const setName = (id: SearchRowName, name: string) => {
    const names = { ...options.names };
    if (name) names[id] = name.slice(0, 60);
    else delete names[id];
    onChange({ ...options, names });
  };
  const tmdbRows = scope !== 'library';
  const libraryRows = scope !== 'tmdb';
  const shownNames = SEARCH_ROW_NAMES.filter((row) =>
    row.id === 'movies' || row.id === 'series'
    || (row.id === 'anime' && options.animeRow && !hideAnime)
    || (row.id === 'similar' && options.similar)
    || (row.id === 'people' && options.people));

  const toggle = (key: 'animeRow' | 'similar' | 'people' | 'collections' | 'hideObscure', title: string, hint: string, disabled = false) => (
    <label className={`switch-row${disabled ? ' is-disabled' : ''}`}>
      <span><strong>{title}</strong><small>{hint}</small></span>
      <input type="checkbox" checked={options[key]} disabled={disabled} onChange={(event) => set({ [key]: event.target.checked })} />
      <i aria-hidden="true" />
    </label>
  );

  return (
    <div className="search-options">
      <label className="switch-row">
        <span><strong>Include LeLibrary in search</strong><small>Adds LeLibrary's search rows to Nuvio and Stremio search. Turn it off to search with your other addons only.</small></span>
        <input type="checkbox" checked={options.enabled} onChange={(event) => set({ enabled: event.target.checked })} />
        <i aria-hidden="true" />
      </label>

      {options.enabled && (
        <>
          <label className="setup-field">
            <span>What to search</span>
            <select value={scope} onChange={(event) => onScope(event.target.value)}>
              {SEARCH_SCOPES.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
            <small className="setup-hint">Movies and Series from TMDB and your own library always come as separate rows.</small>
          </label>

          {tmdbRows && (
            <>
              <div className="setup-row">
                <label className="setup-field">
                  <span>Order results by</span>
                  <select value={options.order} onChange={(event) => set({ order: event.target.value as SearchOrder })}>
                    {SEARCH_ORDERS.map((order) => <option key={order.id} value={order.id}>{order.name}</option>)}
                  </select>
                </label>
              </div>
              {toggle('hideObscure', 'Hide little-known results', 'Leaves out titles hardly anyone has rated. A title you type in full always shows.')}
              {toggle('animeRow', 'Anime in its own row', hideAnime
                ? 'Off while Hide anime is on (Preferences).'
                : 'Anime gets its own search row and leaves the Series row.', hideAnime)}
              {toggle('similar', 'Similar titles row', 'Search a title and get a row of titles people who liked it also watched.')}
              {toggle('people', 'People row', 'Search an actor and get a row of their films and shows.')}
            </>
          )}
          {libraryRows && toggle('collections', 'Search your collections', 'Adds a row for films in your LeLibrary Collections. They are already in My Movies, so they can show twice.')}

          <details className="pf-fold">
            <summary><strong>Rename rows</strong><small>Change what a search row is called in your player.</small></summary>
            <div className="pf-fold-body search-names">
              {tmdbRows ? shownNames.map((row) => (
                <label className="setup-field" key={row.id}>
                  <span>{row.label}</span>
                  <input
                    type="text" maxLength={60} placeholder={row.placeholder} data-i18n-preserve
                    value={options.names[row.id] ?? ''}
                    onChange={(event) => setName(row.id, event.target.value)}
                  />
                </label>
              )) : <p className="setup-hint">Library search rows use the names of your library rows.</p>}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
