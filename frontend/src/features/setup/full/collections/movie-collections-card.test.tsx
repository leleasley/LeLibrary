import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CollectionStudio } from '@/features/setup/full/collections/CollectionStudio';
import { HomeRowsSection } from '@/features/setup/full/HomeRowsSection';
import {
  collectionDefault,
  collectionEntries,
  moveCollectionEntry,
  normalizeHomeOrder,
  ownedFranchiseMarker,
  slotAfterRemoving,
  type HomeRowDoc,
} from '@/features/setup/shared/collection-doc';

const A = { ...collectionDefault(), id: 'a', title: 'Alpha' };
const B = { ...collectionDefault(), id: 'b', title: 'Bravo' };

describe('Movie Collections slot among the collections', () => {
  it('sits at its slot (default first, clamped to the end)', () => {
    expect(collectionEntries(2, null)).toEqual([{ kind: 'collection', index: 0 }, { kind: 'collection', index: 1 }]);
    expect(collectionEntries(2, 0)[0]).toEqual({ kind: 'owned' });
    expect(collectionEntries(2, 9)[2]).toEqual({ kind: 'owned' });
  });

  it('moves like any card and lets collections move past it', () => {
    // [Owned, A, B] -> owned down -> [A, Owned, B]
    expect(moveCollectionEntry([A, B], 0, 0, 1)).toEqual({ collections: [A, B], slot: 1 });
    // [A, Owned, B] -> B up -> [A, B, Owned]
    expect(moveCollectionEntry([A, B], 1, 2, -1)).toEqual({ collections: [A, B], slot: 2 });
    // [A, Owned, B] -> A down -> [Owned, A, B]
    expect(moveCollectionEntry([A, B], 1, 0, 1)).toEqual({ collections: [A, B], slot: 0 });
    // Out of range: unchanged.
    expect(moveCollectionEntry([A, B], 0, 0, -1)).toEqual({ collections: [A, B], slot: 0 });
    // No Movie Collections: plain collection moves.
    expect(moveCollectionEntry([A, B], null, 0, 1)).toEqual({ collections: [B, A], slot: null });
  });

  it('keeps its neighbours when a collection above it goes', () => {
    expect(slotAfterRemoving(2, 0, 2)).toBe(1);
    expect(slotAfterRemoving(1, 1, 2)).toBe(1);
    expect(slotAfterRemoving(null, 0, 2)).toBeNull();
  });
});

describe('Movie Collections on the Collections page (Nuvio)', () => {
  const studio = (overrides: Partial<Parameters<typeof CollectionStudio>[0]> = {}) => renderToStaticMarkup(
    <CollectionStudio
      collections={[A, B]} onChange={() => {}} providerPrefix="torbox" platform="nuvio"
      packs={[]} onPacks={() => {}} ownedOn onToggleOwned={() => {}}
      owned={{ slot: 1, title: '' }} onOwned={() => {}}
      {...overrides}
    />,
  );

  it('is a card in the list at its slot, with move, rename and remove only', () => {
    const html = studio();
    const alpha = html.indexOf('value="Alpha"');
    const owned = html.indexOf('collection-card-owned');
    const bravo = html.indexOf('value="Bravo"');
    expect(alpha).toBeGreaterThan(-1);
    expect(alpha).toBeLessThan(owned);
    expect(owned).toBeLessThan(bravo);
    const card = html.slice(owned, bravo);
    expect(card).toContain('placeholder="LeLibrary Collections"');
    expect(card).toContain('Move collection up');
    expect(card).toContain('Remove');
    expect(card).not.toContain('Edit collection');
  });

  it('offers a switch when it is off', () => {
    const html = studio({ ownedOn: false, owned: null });
    expect(html).not.toContain('collection-card-owned');
    expect(html).toContain('LeLibrary Movie Collections');
  });
});

describe('Home rows list and the Movie Collections marker', () => {
  const movies: HomeRowDoc = {
    id: 'r1', title: 'My Movies', enabled: true, limit: 20, order: 0, customTitle: false,
    source: { kind: 'catalog', id: 'torbox-movies', catalogId: 'torbox-movies', type: 'movie', addonId: '', addonUrl: '' },
  };

  it('keeps the marker last on Nuvio so it never takes a Home row place', () => {
    const rows = normalizeHomeOrder([ownedFranchiseMarker(0, 2), movies], 'nuvio');
    expect(rows.map((row) => row.id)).toEqual(['r1', 'native-franchise-collection']);
    expect(rows[1]?.collectionSlot).toBe(2);
  });

  it('never lists the marker as a row on Nuvio; Move In has no switch there', () => {
    const render = (ownedInCollections: boolean) => renderToStaticMarkup(
      <HomeRowsSection rows={[movies, ownedFranchiseMarker(1)]} onChange={() => {}} platform="nuvio" prefix="torbox" ownedInCollections={ownedInCollections} />,
    );
    const moveIn = render(true);
    expect(moveIn).toContain('My Movies');
    expect(moveIn).not.toContain('LeLibrary Movie Collections');
    const settleIn = render(false);
    expect(settleIn).toContain('On Nuvio it shows above your Home rows.');
    expect(settleIn.match(/LeLibrary Movie Collections/g)?.length).toBe(1);
  });
});
