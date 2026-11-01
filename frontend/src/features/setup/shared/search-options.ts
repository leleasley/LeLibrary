// Search options (config.searchOptions), Settle In and Move In. Mirrors
// normalizeSearchOptions in backend/src/media/search.ts: anything at its
// default is left out of the saved config, so an untouched setup keeps the
// exact config (and search) it had before 5.9.

export type SearchOrder = 'relevance' | 'popular' | 'newest' | 'rating';
export type SearchRowName = 'movies' | 'series' | 'anime' | 'similar' | 'people';

export interface SearchOptionsDraft {
  enabled: boolean;
  animeRow: boolean;
  similar: boolean;
  people: boolean;
  collections: boolean;
  order: SearchOrder;
  hideObscure: boolean;
  names: Partial<Record<SearchRowName, string>>;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptionsDraft = {
  enabled: true,
  animeRow: false,
  similar: false,
  people: false,
  collections: false,
  order: 'relevance',
  hideObscure: false,
  names: {},
};

export const SEARCH_ORDERS: { id: SearchOrder; name: string }[] = [
  { id: 'relevance', name: 'Best match' },
  { id: 'popular', name: 'Most popular' },
  { id: 'newest', name: 'Newest first' },
  { id: 'rating', name: 'Highest rated' },
];

// The row names a person can change, with what the player shows by default.
// Similar titles and People come as a Movies and a Series row each, so their
// name is the start of both ("Similar titles · Movies").
export const SEARCH_ROW_NAMES: { id: SearchRowName; label: string; placeholder: string }[] = [
  { id: 'movies', label: 'Movies row', placeholder: 'LeLibrary · Movies' },
  { id: 'series', label: 'Series row', placeholder: 'LeLibrary · Series' },
  { id: 'anime', label: 'Anime row', placeholder: 'LeLibrary · Anime' },
  { id: 'similar', label: 'Similar titles rows', placeholder: 'Similar titles' },
  { id: 'people', label: 'People rows', placeholder: 'People' },
];

const ORDER_IDS = new Set<string>(SEARCH_ORDERS.map((order) => order.id));
const NAME_IDS = SEARCH_ROW_NAMES.map((row) => row.id);

export function cleanSearchOptions(raw: unknown): SearchOptionsDraft {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const rawNames = value['names'] && typeof value['names'] === 'object' ? value['names'] as Record<string, unknown> : {};
  const names: Partial<Record<SearchRowName, string>> = {};
  for (const id of NAME_IDS) {
    const name = typeof rawNames[id] === 'string' ? (rawNames[id] as string).trim().slice(0, 60) : '';
    if (name) names[id] = name;
  }
  const order = typeof value['order'] === 'string' && ORDER_IDS.has(value['order']) ? value['order'] as SearchOrder : 'relevance';
  return {
    enabled: value['enabled'] !== false,
    animeRow: value['animeRow'] === true,
    similar: value['similar'] === true,
    people: value['people'] === true,
    collections: value['collections'] === true,
    order,
    hideObscure: value['hideObscure'] === true,
    names,
  };
}

// Only what differs from the defaults; null when nothing does.
export function searchOptionsForConfig(draft: SearchOptionsDraft | undefined): Record<string, unknown> | null {
  const clean = cleanSearchOptions(draft);
  const out: Record<string, unknown> = {};
  if (!clean.enabled) out['enabled'] = false;
  if (clean.animeRow) out['animeRow'] = true;
  if (clean.similar) out['similar'] = true;
  if (clean.people) out['people'] = true;
  if (clean.collections) out['collections'] = true;
  if (clean.order !== 'relevance') out['order'] = clean.order;
  if (clean.hideObscure) out['hideObscure'] = true;
  if (Object.keys(clean.names).length > 0) out['names'] = { ...clean.names };
  return Object.keys(out).length > 0 ? out : null;
}

const SCOPE_SHORT: Record<string, string> = { combined: 'TMDB and your library', library: 'Your library only', tmdb: 'TMDB only' };

// The Search accordion's one-line summary.
export function searchSummaryParts(scope: string, draft: SearchOptionsDraft): string[] {
  const options = cleanSearchOptions(draft);
  if (!options.enabled) return ['Off'];
  const parts = [SCOPE_SHORT[scope] ?? SCOPE_SHORT['combined']!];
  const extras = [
    options.animeRow ? 'Anime row' : null,
    options.similar ? 'Similar titles' : null,
    options.people ? 'People' : null,
    options.collections ? 'Collections' : null,
  ].filter((part): part is string => part !== null);
  parts.push(...extras);
  if (options.order !== 'relevance') parts.push(SEARCH_ORDERS.find((order) => order.id === options.order)!.name);
  if (options.hideObscure) parts.push('Little-known hidden');
  return parts;
}
