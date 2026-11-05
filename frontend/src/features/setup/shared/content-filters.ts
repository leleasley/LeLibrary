// Content filters (Settle In / Move In): the setup's own copy of the eleven
// catalogue categories. The server mirror is
// `backend/src/catalog/content-filters.ts`; `content-filters.test.ts` keeps the
// ids, labels and order in agreement, and the slug list is saved in configs, so
// never rename one.

export interface ContentCategoryOption {
  id: string;
  label: string;
}

// The operator's list and order (2026-11-05).
export const CONTENT_CATEGORIES: readonly ContentCategoryOption[] = [
  { id: 'anime', label: 'Anime' },
  { id: 'animation', label: 'Animation' },
  { id: 'reality', label: 'Reality TV' },
  { id: 'talk', label: 'Talk Shows' },
  { id: 'kids', label: 'Kids' },
  { id: 'family', label: 'Family' },
  { id: 'musical', label: 'Musical' },
  { id: 'documentary', label: 'Documentary' },
  { id: 'news', label: 'News' },
  { id: 'soap', label: 'Soap Operas' },
  { id: 'horror', label: 'Horror' },
];

export const EXCLUDE_CATEGORY_IDS: readonly string[] = CONTENT_CATEGORIES.map((category) => category.id);

// Known slugs only, in the list's order, duplicates dropped.
export function cleanExcludeCategories(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  return EXCLUDE_CATEGORY_IDS.filter((id) => raw.includes(id));
}

// The config value: only what differs from the default (nothing hidden).
export function excludeCategoriesForConfig(value: unknown): string[] {
  return cleanExcludeCategories(value);
}

export function contentFilterSummaryParts(draft: { hideAnime: boolean; hideAdult: boolean; excludeCategories: string[] }): string[] {
  const parts: string[] = [];
  if (draft.hideAnime) parts.push('Anime hidden');
  if (draft.hideAdult) parts.push('Adult hidden');
  const categories = cleanExcludeCategories(draft.excludeCategories).filter((id) => id !== 'anime');
  if (categories.length === 1) {
    parts.push(CONTENT_CATEGORIES.find((category) => category.id === categories[0])?.label ?? '1 category hidden');
  } else if (categories.length > 1) {
    parts.push(`${categories.length} categories hidden`);
  }
  return parts.length > 0 ? parts : ['Filters off'];
}
