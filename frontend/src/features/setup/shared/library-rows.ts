// Library row names and visibility (My Movies / My Series / LeLibrary Anime).
// The backend already reads these config fields: catNameMovies/Series/Anime
// rename the rows, catalogMovies/Series/Anime === false drop them from the
// manifest (a row picked as a Home row on Settle In / Move In stays).

export type LibraryRowId = 'movies' | 'series' | 'anime';

export interface LibraryRowDraft {
  name: string;
  show: boolean;
}

export type LibraryRowsDraft = Record<LibraryRowId, LibraryRowDraft>;

export const LIBRARY_ROWS: { id: LibraryRowId; label: string; defaultName: string; icon: string; nameField: string; showField: string }[] = [
  { id: 'movies', label: 'Movies', defaultName: 'My Movies', icon: '🎬', nameField: 'catNameMovies', showField: 'catalogMovies' },
  { id: 'series', label: 'Series', defaultName: 'My Series', icon: '📺', nameField: 'catNameSeries', showField: 'catalogSeries' },
  { id: 'anime', label: 'Anime', defaultName: 'LeLibrary Anime', icon: '🍥', nameField: 'catNameAnime', showField: 'catalogAnime' },
];

export const LIBRARY_ROW_NAME_MAX = 40;

export const EMPTY_LIBRARY_ROWS: LibraryRowsDraft = {
  movies: { name: '', show: true },
  series: { name: '', show: true },
  anime: { name: '', show: true },
};

function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, LIBRARY_ROW_NAME_MAX) : '';
}

export function libraryRowsFromConfig(config: unknown): LibraryRowsDraft {
  const c = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  const out = { ...EMPTY_LIBRARY_ROWS };
  for (const row of LIBRARY_ROWS) {
    out[row.id] = { name: cleanName(c[row.nameField]), show: c[row.showField] !== false };
  }
  return out;
}

// Fields for a new setup: only what differs from the defaults.
export function libraryRowsToConfig(rows: LibraryRowsDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of LIBRARY_ROWS) {
    const draft = rows[row.id];
    const name = cleanName(draft?.name);
    if (name) out[row.nameField] = name;
    if (draft && draft.show === false) out[row.showField] = false;
  }
  return out;
}

// Fields for an edit: only what changed. The setup store merges, so null
// removes a previously saved name or switch.
export function libraryRowsEditConfig(current: LibraryRowsDraft, saved: LibraryRowsDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of LIBRARY_ROWS) {
    const now = current[row.id];
    const before = saved[row.id];
    if (cleanName(now.name) !== cleanName(before.name)) out[row.nameField] = cleanName(now.name) || null;
    if (now.show !== before.show) out[row.showField] = now.show ? null : false;
  }
  return out;
}

// Settle In / Move In: names only (visibility comes from their Home rows).
export function withLibraryRowNames(rows: LibraryRowsDraft, config: Record<string, unknown>): Record<string, unknown> {
  const names = libraryRowsToConfig({
    movies: { ...rows.movies, show: true },
    series: { ...rows.series, show: true },
    anime: { ...rows.anime, show: true },
  });
  return { ...config, ...names };
}
