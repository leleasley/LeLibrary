import { describe, expect, it } from 'vitest';
import { queryKeys } from '@/api/query-keys';

describe('query keys', () => {
  it('folds the TV calendar filters into the day and week keys', () => {
    const filters = { notable: true, types: ['Scripted', 'Reality'], language: 'en', sort: 'name' };
    expect(queryKeys.releasesDay('GB', '2026-11-03', filters))
      .toEqual(['releases', 'day', 'GB', '2026-11-03', true, 'Scripted|Reality', 'en', 'name']);
    // The strip ignores sort, so re-sorting the list never refetches it.
    expect(queryKeys.releasesWeek('GB', '2026-11-02', filters))
      .toEqual(['releases', 'week', 'GB', '2026-11-02', true, 'Scripted|Reality', 'en']);
  });

  it('keeps the banner status apart from the Status page query', () => {
    expect(queryKeys.statusPill).not.toEqual(queryKeys.status);
  });
});
