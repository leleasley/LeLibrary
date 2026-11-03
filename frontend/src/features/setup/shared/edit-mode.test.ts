import { describe, expect, it } from 'vitest';
import { createSnapshotTracker, emptySnapshot, type TierSnapshot } from '@/features/setup/shared/edit-mode';

// A section that counts how often it is serialized.
function counted<T extends object>(value: T): { value: T; count: () => number } {
  let n = 0;
  const wrapped = { ...value, toJSON() { n += 1; return value; } } as T;
  return { value: wrapped, count: () => n };
}

describe('useEditSnapshot change tracking', () => {
  it('reports the first snapshot as a change', () => {
    expect(createSnapshotTracker()(emptySnapshot())).toBe(true);
  });

  it('agrees with a whole-snapshot JSON compare', () => {
    const track = createSnapshotTracker();
    const base = emptySnapshot();
    track(base);
    // New objects, same content: not a change.
    expect(track({ ...base, keys: { ...base.keys }, homeRows: [...base.homeRows] })).toBe(false);
    // A real edit is a change, and the same edit again is not.
    const named: TierSnapshot = { ...base, name: 'Living room' };
    expect(track(named)).toBe(true);
    expect(track({ ...named })).toBe(false);
    // An edit inside a section is a change; undoing it is a change back.
    const posters = { ...named, posters: { ...named.posters, provider: 'rpdb' } } as TierSnapshot;
    expect(track(posters)).toBe(true);
    expect(track(named)).toBe(true);
  });

  it('does not re-serialize a section that is the same object as last time', () => {
    const track = createSnapshotTracker();
    const big = counted({ rows: Array.from({ length: 50 }, (_, i) => ({ id: `c${i}` })) });
    const base = { ...emptySnapshot(), collections: big.value as unknown as TierSnapshot['collections'] };
    track(base);
    const before = big.count();
    for (const name of ['L', 'Li', 'Liv']) expect(track({ ...base, name })).toBe(true);
    expect(big.count()).toBe(before);
  });

  it('treats a missing snapshot (not editing) as no content', () => {
    const track = createSnapshotTracker();
    expect(track(null)).toBe(true);
    expect(track(null)).toBe(false);
    expect(track(emptySnapshot())).toBe(true);
  });
});
