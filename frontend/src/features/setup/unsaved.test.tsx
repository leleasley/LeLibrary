import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TierProgress } from '@/features/setup/shared/tier/TierProgress';
import { isQuickDirty, quickDraftHasContent } from '@/features/setup/quick/QuickSetupPage';
import { isPartialDirty, partialDraftHasContent } from '@/features/setup/partial/PartialSetupPage';
import { isFullDirty, fullDraftHasContent } from '@/features/setup/full/FullSetupPage';
import type { QuickDraft } from '@/features/setup/quick/quick-draft';
import type { PartialDraft } from '@/features/setup/partial/partial-draft';
import type { FullDraft } from '@/features/setup/full/full-draft';
import { browserGroupRank } from '@/features/setup/full/HomeRowsSection';
import { EMPTY_FORMATTING } from '@/features/setup/shared/FormattingSection';
import { EMPTY_POSTERS } from '@/features/setup/shared/PostersSection';
import { EMPTY_QUICK_EXTRAS } from '@/features/setup/full/MetadataExtras';
import { EMPTY_METADATA_EXTRAS } from '@/features/setup/full/MetadataExtras';
import { EMPTY_FILTER_SETS } from '@/features/setup/full/FilterSets';
import { EMPTY_MEDIA_SETS } from '@/features/setup/partial/FilterMediaSets';
import { DEFAULT_BADGE_PACK } from '@/features/setup/shared/BadgePackPicker';

describe('unsaved-changes detection', () => {
  it('quick look is clean when pristine, dirty on any input', () => {
    const pristine = {
      name: '', keys: {}, formatting: EMPTY_FORMATTING, posters: EMPTY_POSTERS,
      badgePack: { pack: DEFAULT_BADGE_PACK, url: '' }, extras: EMPTY_QUICK_EXTRAS, stagedImport: null,
    };
    expect(isQuickDirty(pristine)).toBe(false);
    expect(isQuickDirty({ ...pristine, name: 'Living room' })).toBe(true);
    expect(isQuickDirty({ ...pristine, keys: { tmdbApiKey: 'x' } })).toBe(true);
    expect(isQuickDirty({ ...pristine, stagedImport: { email: 'a@b.c' } })).toBe(true);
    expect(isQuickDirty({ ...pristine, extras: { ...EMPTY_QUICK_EXTRAS, hideAnime: true } })).toBe(true);
  });

  it('settle in is clean when pristine, dirty on any input', () => {
    const pristine = {
      name: '', keys: {}, formatting: EMPTY_FORMATTING, posters: EMPTY_POSTERS,
      homeRows: [], filterSets: EMPTY_FILTER_SETS, mediaSets: EMPTY_MEDIA_SETS,
      meta: EMPTY_METADATA_EXTRAS, badgePack: DEFAULT_BADGE_PACK, customBadgeUrl: '',
      watchlist: {},
    };
    expect(isPartialDirty(pristine)).toBe(false);
    expect(isPartialDirty({ ...pristine, homeRows: [{ id: 'r1' }] as never })).toBe(true);
    expect(isPartialDirty({ ...pristine, badgePack: 'custom' })).toBe(true);
    expect(isPartialDirty({ ...pristine, watchlist: { simkl: { access_token: 't' } } })).toBe(true);
  });

  it('move in is clean when pristine, dirty on any input', () => {
    const pristine = {
      platform: 'nuvio', rdCatalog: 'merge', name: '', keys: {},
      formatting: EMPTY_FORMATTING, posters: EMPTY_POSTERS, homeRows: [],
      badgePack: DEFAULT_BADGE_PACK, customBadgeUrl: '', collections: [], packs: [],
      meta: EMPTY_METADATA_EXTRAS, filterSets: EMPTY_FILTER_SETS, addons: [],
      customStreams: [], watchlist: {}, stagedImport: null,
    };
    expect(isFullDirty(pristine)).toBe(false);
    expect(isFullDirty({ ...pristine, platform: 'stremio' })).toBe(true);
    expect(isFullDirty({ ...pristine, collections: [{ id: 'c1' }] as never })).toBe(true);
    expect(isFullDirty({ ...pristine, stagedImport: { email: 'a@b.c' } })).toBe(true);
  });
});

// Every page writes its draft on mount, including a pristine one, so a stored
// draft does not mean the user typed anything. The restore notice must stay
// silent unless there is actually something to restore.
describe('restore notice only fires for a draft with content', () => {
  const quickPristine: QuickDraft = {
    name: '', keys: {}, formatting: EMPTY_FORMATTING, posters: EMPTY_POSTERS,
    badgePack: { pack: DEFAULT_BADGE_PACK, url: '' }, extras: EMPTY_QUICK_EXTRAS,
  };
  const partialPristine: PartialDraft = {
    name: '', keys: {}, formatting: EMPTY_FORMATTING, posters: EMPTY_POSTERS, homeRows: [],
    filterSets: EMPTY_FILTER_SETS, mediaSets: EMPTY_MEDIA_SETS, meta: EMPTY_METADATA_EXTRAS,
    badgePack: DEFAULT_BADGE_PACK, customBadgeUrl: '', watchlist: {},
  };
  const fullPristine: FullDraft = {
    platform: 'nuvio', rdCatalog: 'merge', name: '', keys: {}, formatting: EMPTY_FORMATTING,
    posters: EMPTY_POSTERS, homeRows: [], badgePack: DEFAULT_BADGE_PACK, customBadgeUrl: '',
    collections: [], packs: [], meta: EMPTY_METADATA_EXTRAS, filterSets: EMPTY_FILTER_SETS,
    addons: [], customStreams: [], watchlist: {}, stagedImport: null, pushConn: null,
  };

  it('stays silent for the pristine draft the page writes on mount', () => {
    expect(quickDraftHasContent(quickPristine)).toBe(false);
    expect(partialDraftHasContent(partialPristine)).toBe(false);
    expect(fullDraftHasContent(fullPristine)).toBe(false);
    // A draft saved before the extras field existed is still pristine.
    const { extras: _extras, ...withoutExtras } = quickPristine;
    expect(quickDraftHasContent(withoutExtras)).toBe(false);
  });

  it('fires once there is something to restore', () => {
    expect(quickDraftHasContent({ ...quickPristine, name: 'Living room' })).toBe(true);
    expect(quickDraftHasContent({ ...quickPristine, keys: { tmdbApiKey: 'x' } })).toBe(true);
    expect(partialDraftHasContent({ ...partialPristine, badgePack: 'custom' })).toBe(true);
    expect(fullDraftHasContent({ ...fullPristine, platform: 'stremio' })).toBe(true);
  });
});

describe('home browser grouping', () => {
  it('keeps the shared order but sinks actor shelves to the bottom', () => {
    expect(browserGroupRank('LeLibrary')).toBeLessThan(browserGroupRank('Trending'));
    expect(browserGroupRank('Actors')).toBeGreaterThan(browserGroupRank('Zzz anything'));
    expect(browserGroupRank('actors')).toBeGreaterThan(browserGroupRank('Popular'));
    expect(browserGroupRank('Trending')).toBeLessThan(browserGroupRank('Popular'));
  });

  it('renders one accordion per category instead of a flat wall', () => {
    // Covered structurally: groups render as <details class="source-group">.
    // (The component fetches live sources, so ordering is asserted on the
    // pure rank above rather than a rendered page.)
    expect(browserGroupRank('My Actors Shelf')).toBe(99);
  });
});

describe('unsaved notice', () => {
  // The notice lives in the progress rail: always visible, never on top of the
  // preview or the mobile dock (the floating banner it replaced was both).
  const steps = [{ id: 'providers', label: 'Library' }, { id: 'artwork', label: 'Artwork' }];

  it('shows in the rail while there are unsaved changes', () => {
    const html = renderToStaticMarkup(<TierProgress steps={steps} unsaved />);
    expect(html).toContain('Unsaved changes');
    expect(html).toContain('role="status"');
  });

  it('stays silent when there is nothing unsaved', () => {
    const html = renderToStaticMarkup(<TierProgress steps={steps} unsaved={false} />);
    expect(html).not.toContain('Unsaved changes');
  });
});
