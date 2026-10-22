import { describe, expect, it } from 'vitest';
import { forgetDeletedSetup, mergeSavedSetups, normalizeSetupSummary } from '@/features/setup/shared/saved-setups';

const UUID_A = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const UUID_C = '323e4567-e89b-12d3-a456-426614174002';

function serverSummary(uuid: string, name: string | null, lastUsedAtMs: number | null) {
  return {
    uuid,
    name,
    tier: 'quick',
    hasPassword: true,
    createdAtMs: 1_000,
    updatedAtMs: 2_000,
    lastUsedAtMs,
  };
}

describe('normalizeSetupSummary', () => {
  it('converts ISO dates and rejects malformed rows', () => {
    const parsed = normalizeSetupSummary({
      uuid: UUID_A.toUpperCase(),
      name: 'Living room',
      tier: 'full',
      hasPassword: true,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: 'not-a-date',
      lastUsedAt: null,
    });
    expect(parsed).toEqual({
      uuid: UUID_A,
      name: 'Living room',
      tier: 'full',
      hasPassword: true,
      createdAtMs: Date.parse('2026-10-01T10:00:00.000Z'),
      updatedAtMs: null,
      lastUsedAtMs: null,
    });
    expect(normalizeSetupSummary({ uuid: 'nope' })).toBeNull();
    expect(normalizeSetupSummary(null)).toBeNull();
  });

  it('truncates an over-long name', () => {
    const parsed = normalizeSetupSummary({ uuid: UUID_A, name: 'x'.repeat(300) });
    expect(parsed?.name?.length).toBe(120);
  });
});

describe('forgetDeletedSetup', () => {
  it('clears the browser entry and invalidates the server list', () => {
    const calls: unknown[] = [];
    const client = { invalidateQueries: (filters: unknown) => { calls.push(filters); } };
    forgetDeletedSetup(UUID_A, client);
    expect(calls).toEqual([{ queryKey: ['setup', 'saved'] }]);
  });
});

describe('mergeSavedSetups', () => {
  it('keeps server order, then browser-only entries', () => {
    const merged = mergeSavedSetups(
      [serverSummary(UUID_A, 'Server A', 5_000), serverSummary(UUID_B, 'Server B', 4_000)],
      [
        { uuid: UUID_C, name: 'Local C', tier: 'partial', savedAt: 3_000 },
        { uuid: UUID_B, name: 'Local B', tier: 'full', savedAt: 9_000 },
      ],
    );
    expect(merged.map((entry) => [entry.uuid, entry.source])).toEqual([
      [UUID_A, 'server'],
      [UUID_B, 'server'],
      [UUID_C, 'browser'],
    ]);
  });

  it('lets the server win on name, tier and date; dedupes case-insensitively', () => {
    const merged = mergeSavedSetups(
      [serverSummary(UUID_A, 'Server name', 7_000)],
      [{ uuid: UUID_A.toUpperCase(), name: 'Local name', tier: 'full', savedAt: 99_999 }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      uuid: UUID_A,
      name: 'Server name',
      tier: 'quick',
      source: 'server',
      updatedAt: 7_000,
    });
  });

  it('falls back to update/creation time when a server row was never used', () => {
    const merged = mergeSavedSetups([serverSummary(UUID_A, null, null)], []);
    expect(merged[0]?.updatedAt).toBe(2_000);
  });

  it('sorts browser-only entries newest first', () => {
    const merged = mergeSavedSetups([], [
      { uuid: UUID_C, name: 'Older', tier: 'quick', savedAt: 100 },
      { uuid: UUID_B, name: 'Newer', tier: 'quick', savedAt: 900 },
    ]);
    expect(merged.map((entry) => entry.uuid)).toEqual([UUID_B, UUID_C]);
  });

  it('caps the list and drops malformed browser entries', () => {
    const local = Array.from({ length: 20 }, (_, index) => ({
      uuid: `423e4567-e89b-12d3-a456-4266141740${String(index).padStart(2, '0')}`,
      name: `Local ${index}`,
      tier: 'quick',
      savedAt: index,
    }));
    local.push({ uuid: 'not-a-uuid', name: 'Junk', tier: 'quick', savedAt: 1 });
    const merged = mergeSavedSetups([], local, 5);
    expect(merged).toHaveLength(5);
    expect(merged.every((entry) => entry.uuid !== 'not-a-uuid')).toBe(true);
  });
});
