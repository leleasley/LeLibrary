import { describe, expect, it } from 'vitest';
import {
  clearFullDraft,
  loadFullDraft,
  saveFullDraft,
  type FullDraft,
} from '@/features/setup/full/full-draft';
import {
  clearPartialDraft,
  loadPartialDraft,
  savePartialDraft,
  type PartialDraft,
} from '@/features/setup/partial/partial-draft';
import { EMPTY_METADATA_EXTRAS } from '@/features/setup/full/MetadataExtras';
import { EMPTY_FILTER_SETS } from '@/features/setup/full/FilterSets';
import { EMPTY_MEDIA_SETS } from '@/features/setup/partial/FilterMediaSets';
import { EMPTY_FORMATTING } from '@/features/setup/shared/FormattingSection';
import { EMPTY_POSTERS } from '@/features/setup/shared/PostersSection';

function stubStorage() {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
  };
  return () => { delete (globalThis as any).localStorage; };
}

const PARTIAL: PartialDraft = {
  name: 'Living room',
  keys: { torboxApiKey: 'tb-x' },
  formatting: EMPTY_FORMATTING,
  posters: EMPTY_POSTERS,
  homeRows: [],
  filterSets: EMPTY_FILTER_SETS,
  mediaSets: EMPTY_MEDIA_SETS,
  meta: EMPTY_METADATA_EXTRAS,
  badgePack: 'nard-full',
  customBadgeUrl: '',
  watchlist: { simkl: { access_token: 'simkl-tok' } },
};

const FULL: FullDraft = {
  ...PARTIAL,
  platform: 'nuvio',
  rdCatalog: 'merge',
  homeRows: [],
  collections: [],
  packs: [],
  addons: [],
  customStreams: [],
  stagedImport: null,
  pushConn: null,
};

describe('setup drafts', () => {
  it('round-trips the partial draft through local storage', () => {
    const unstub = stubStorage();
    try {
      expect(loadPartialDraft()).toBe(null);
      savePartialDraft(PARTIAL);
      const restored = loadPartialDraft();
      expect(restored?.name).toBe('Living room');
      expect(restored?.keys).toEqual({ torboxApiKey: 'tb-x' });
      expect(restored?.badgePack).toBe('nard-full');
      expect(restored?.watchlist).toEqual({ simkl: { access_token: 'simkl-tok' } });
      clearPartialDraft();
      expect(loadPartialDraft()).toBe(null);
    } finally {
      unstub();
    }
  });

  it('round-trips the full draft through local storage', () => {
    const unstub = stubStorage();
    try {
      expect(loadFullDraft()).toBe(null);
      saveFullDraft({
        ...FULL,
        pushConn: { platform: 'nuvio', nuvioToken: 'tok', nuvioSelectedProfile: 2 },
      });
      const restored = loadFullDraft();
      expect(restored?.platform).toBe('nuvio');
      expect(restored?.meta.notices).toBe(true);
      expect(restored?.filterSets.cachedOnly).toBe(false);
      // A restored login survives a mistaken refresh instead of evaporating.
      expect(restored?.pushConn?.platform).toBe('nuvio');
      expect(restored?.pushConn?.nuvioSelectedProfile).toBe(2);
      clearFullDraft();
      expect(loadFullDraft()).toBe(null);
    } finally {
      unstub();
    }
  });

  it('rejects a tokenless connection instead of restoring it', () => {
    const unstub = stubStorage();
    try {
      saveFullDraft({ ...FULL, pushConn: { platform: 'nuvio' } as never });
      expect(loadFullDraft()).toBe(null);
    } finally {
      unstub();
    }
  });

  it('rejects corrupt drafts instead of restoring them', () => {
    const unstub = stubStorage();
    try {
      (globalThis as any).localStorage.setItem('lelibrary_partial_draft', '{"name":123}');
      expect(loadPartialDraft()).toBe(null);
      (globalThis as any).localStorage.setItem('lelibrary_full_draft', 'not json');
      expect(loadFullDraft()).toBe(null);
    } finally {
      unstub();
    }
  });
});
