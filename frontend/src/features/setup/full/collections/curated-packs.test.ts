import { describe, expect, it } from 'vitest';
import {
  addPackToCollections,
  focusGifLibrary,
  matchingFocusGif,
  normalizePack,
  packCollections,
  removePackFromCollections,
  type CuratedPack,
} from '@/features/setup/full/collections/curated-packs';
import type { CollectionDoc } from '@/features/setup/shared/collection-doc';

const FOLDERS = [
  {
    id: 'folder-a', title: 'A', tileShape: 'LANDSCAPE', hideTitle: false,
    coverImageUrl: 'https://img/a.png', focusGifEnabled: true, focusGifUrl: 'https://img/a.gif',
    heroBackdropUrl: '', catalogSources: [{ catalogId: 'lib-genre_action_movies', type: 'movie' }],
  },
  {
    id: 'folder-b', title: 'B', tileShape: 'PORTRAIT', hideTitle: true,
    coverImageUrl: '', focusGifEnabled: false, focusGifUrl: '',
    heroBackdropUrl: '', catalogSources: [{ catalogId: 'lib-genre_comedy_movies', type: 'movie' }],
  },
];

function pack(overrides: Partial<CuratedPack> = {}): CuratedPack {
  const normalized = normalizePack({
    id: 'test-pack', title: 'Test Pack', description: 'd', category: 'Themes',
    icon: '✨', refresh: 'live', coverImageUrl: '', backdropUrl: '', folders: FOLDERS, sections: [],
    ...overrides,
  });
  if (!normalized) throw new Error('fixture pack did not normalize');
  return normalized;
}

describe('curated packs', () => {
  it('compiles a section-less pack into one collection', () => {
    const [collection] = packCollections(pack());
    expect(collection?.id).toBe('pack-test-pack');
    expect(collection?.title).toBe('Test Pack');
    expect(collection?.folders.map((folder) => folder.id)).toEqual(['folder-a', 'folder-b']);
    expect(collection?.folders[1]?.tileShape).toBe('PORTRAIT');
    expect(collection?.folders[1]?.hideTitle).toBe(true);
  });

  it('splits sectioned packs per section', () => {
    const [one, two] = packCollections(pack({
      sections: [
        { id: 's1', title: 'First', folders: ['folder-a'] },
        { id: 's2', title: 'Second', folders: ['folder-b'] },
      ],
    }));
    expect(one?.id).toBe('pack-test-pack-s1');
    expect(one?.folders.map((folder) => folder.id)).toEqual(['folder-a']);
    expect(two?.id).toBe('pack-test-pack-s2');
  });

  it('adds and removes packs without touching other collections', () => {
    const mine: CollectionDoc = {
      id: 'coll-1', title: 'Mine', tileShape: 'LANDSCAPE', pinToTop: false,
      focusGlowEnabled: true, showAllTab: true, viewMode: 'TABBED_GRID',
      backdropUrl: '', hideTitle: false, folders: [],
    };
    const added = addPackToCollections([mine], [], pack());
    expect(added.packs).toEqual(['test-pack']);
    expect(added.collections.map((collection) => collection.id)).toEqual(['coll-1', 'pack-test-pack']);
    expect(added.openedId).toBe('pack-test-pack');
    // Re-adding never duplicates the generated collections.
    const again = addPackToCollections(added.collections, added.packs, pack());
    expect(again.collections.filter((collection) => collection.id.startsWith('pack-test-pack'))).toHaveLength(1);
    const removed = removePackFromCollections(again.collections, again.packs, 'test-pack');
    expect(removed.packs).toEqual([]);
    expect(removed.collections.map((collection) => collection.id)).toEqual(['coll-1']);
  });

  it('builds the animation library with the hub first', () => {
    const library = focusGifLibrary([pack()]);
    expect(library[0]?.title).toBe('LeLibrary Hub');
    expect(library.map((item) => item.title)).toContain('A');
    expect(library.map((item) => item.title)).not.toContain('B');
  });

  it('matches animations by catalogue source', () => {
    const library = focusGifLibrary([pack()]);
    expect(matchingFocusGif([{ catalogId: 'lib-genre_action_movies' }], library)?.title).toBe('A');
    expect(matchingFocusGif([{ catalogId: 'lib-unknown' }], library)).toBe(null);
  });
});
