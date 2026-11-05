import { describe, expect, it } from 'vitest';
import {
  CONTENT_CATEGORIES,
  cleanExcludeCategories,
  contentFilterSummaryParts,
  excludeCategoriesForConfig,
} from '@/features/setup/shared/content-filters';

describe('content filters', () => {
  it('lists the eleven categories in the operator order', () => {
    expect(CONTENT_CATEGORIES.map((category) => category.id)).toEqual([
      'anime', 'animation', 'reality', 'talk', 'kids', 'family', 'musical', 'documentary', 'news', 'soap', 'horror',
    ]);
    expect(CONTENT_CATEGORIES.find((category) => category.id === 'soap')?.label).toBe('Soap Operas');
  });

  it('cleans saved slugs: known ids only, UI order, no duplicates', () => {
    expect(cleanExcludeCategories(['horror', 'nope', 'horror', 'news'])).toEqual(['news', 'horror']);
    expect(cleanExcludeCategories('horror')).toEqual([]);
    expect(cleanExcludeCategories(undefined)).toEqual([]);
    expect(excludeCategoriesForConfig(['documentary'])).toEqual(['documentary']);
  });

  it('summarises the accordion without repeating Anime twice', () => {
    expect(contentFilterSummaryParts({ hideAnime: false, hideAdult: false, excludeCategories: [] })).toEqual(['Filters off']);
    expect(contentFilterSummaryParts({ hideAnime: true, hideAdult: false, excludeCategories: [] })).toEqual(['Anime hidden']);
    expect(contentFilterSummaryParts({ hideAnime: true, hideAdult: true, excludeCategories: ['anime', 'horror'] }))
      .toEqual(['Anime hidden', 'Adult hidden', 'Horror']);
    expect(contentFilterSummaryParts({ hideAnime: false, hideAdult: false, excludeCategories: ['news', 'horror'] }))
      .toEqual(['2 categories hidden']);
  });
});
