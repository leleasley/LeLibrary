import { describe, expect, it } from 'vitest';
import { specialExtras, SPECIAL_PACK_ID } from '@/features/setup/full/collections/pack-picker-model';
import { hubCollection, type CollectionDoc } from '@/features/setup/shared/collection-doc';

const other = { id: 'collection-x', title: 'X', folders: [] } as unknown as CollectionDoc;
const makeHub = () => hubCollection('torbox', 'https://example.test');

describe('LeLibrary Special brings the LeLibrary set', () => {
  it('adds the Hub and turns on the Movie Collections', () => {
    const out = specialExtras({ packId: SPECIAL_PACK_ID, collections: [other], hubOn: false, ownedOn: false, makeHub });
    expect(out.addedHub).toBe(true);
    expect(out.turnOnOwned).toBe(true);
    // The Hub leads by its place, never by pin to top; Movie Collections goes under it.
    expect(out.collections.map((c) => c.id)).toEqual(['collection-lelibrary-hub', 'collection-x']);
    expect(out.collections[0]?.pinToTop).toBe(false);
    expect(out.ownedSlot).toBe(1);
  });

  it('a Hub already there keeps its place; Movie Collections goes under it', () => {
    const hub = makeHub();
    const out = specialExtras({ packId: SPECIAL_PACK_ID, collections: [other, hub], hubOn: true, ownedOn: false, makeHub });
    expect(out.collections).toEqual([other, hub]);
    expect(out.ownedSlot).toBe(2);
  });

  it('never adds a second Hub or toggles what is already on', () => {
    const out = specialExtras({ packId: SPECIAL_PACK_ID, collections: [other], hubOn: true, ownedOn: true, makeHub });
    expect(out).toEqual({ collections: [other], addedHub: false, turnOnOwned: false });
  });

  it('without a debrid provider neither can exist yet, so nothing extra is claimed', () => {
    const out = specialExtras({ packId: SPECIAL_PACK_ID, collections: [], hubOn: false, ownedOn: false, makeHub: null });
    expect(out).toEqual({ collections: [], addedHub: false, turnOnOwned: false });
  });

  it('other packs are untouched', () => {
    expect(specialExtras({ packId: 'genres', collections: [other], hubOn: false, ownedOn: false, makeHub })).toEqual({ collections: [other], addedHub: false, turnOnOwned: false });
  });
});
