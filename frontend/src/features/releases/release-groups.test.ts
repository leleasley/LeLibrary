import { describe, expect, it } from 'vitest';
import type { ReleaseListItem } from '@/api/releases';
import { groupByWeek, weekLabel, weekStartIso } from '@/features/releases/release-groups';

function movie(id: number, date: string | null): ReleaseListItem {
  return {
    type: 'movie',
    id,
    title: `Film ${id}`,
    poster: null,
    backdrop: null,
    genres: [],
    year: 2026,
    status: 'upcoming',
    date,
    releaseDate: date,
    digitalDate: date,
    theatricalDate: null,
    physicalDate: null,
    firstAirDate: null,
    nextEpisode: null,
    enriched: false,
  };
}

// 2026-10-12 is a Monday; 2026-10-18 is the Sunday that closes that week.
const TODAY = '2026-10-12';

describe('weekStartIso', () => {
  it('snaps any day of the week back to its Monday', () => {
    expect(weekStartIso('2026-10-12')).toBe('2026-10-12');
    expect(weekStartIso('2026-10-15')).toBe('2026-10-12');
    expect(weekStartIso('2026-10-18')).toBe('2026-10-12');
    expect(weekStartIso('2026-10-19')).toBe('2026-10-19');
  });
});

describe('weekLabel', () => {
  it('names the week the reader is in', () => {
    expect(weekLabel('2026-10-12', TODAY)).toBe('This week');
  });

  it('names the following week', () => {
    expect(weekLabel('2026-10-19', TODAY)).toBe('Next week');
  });

  it('dates every other week from its Monday', () => {
    const label = weekLabel('2026-11-02', TODAY);
    expect(label.startsWith('Week of')).toBe(true);
    expect(label).toContain('2026');
  });
});

describe('groupByWeek', () => {
  it('groups releases by week in date order', () => {
    const groups = groupByWeek(
      [movie(1, '2026-10-13'), movie(2, '2026-10-19'), movie(3, '2026-10-14')],
      TODAY,
    );
    expect(groups.map((group) => group.key)).toEqual(['2026-10-12', '2026-10-19']);
    expect(groups[0]?.label).toBe('This week');
    expect(groups[1]?.label).toBe('Next week');
    // Items keep their relative order inside a week.
    expect(groups[0]?.items.map((item) => item.id)).toEqual([1, 3]);
  });

  it('puts undated titles in a trailing group', () => {
    const groups = groupByWeek([movie(1, null), movie(2, '2026-10-13')], TODAY);
    expect(groups.map((group) => group.key)).toEqual(['2026-10-12', 'unknown']);
    expect(groups[1]?.label).toBe('No date yet');
    expect(groups[1]?.items.map((item) => item.id)).toEqual([1]);
  });

  it('returns nothing for an empty list', () => {
    expect(groupByWeek([], TODAY)).toEqual([]);
  });
});
