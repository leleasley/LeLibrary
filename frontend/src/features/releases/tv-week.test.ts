import { describe, expect, it } from 'vitest';
import {
  WEEKDAY_SHORT,
  buildWeekStrip,
  monthShort,
  shortWeekday,
  weekStripDates,
} from '@/features/releases/tv-week';

// 2026-10-12 is a Monday.
const MIN = '2026-10-05';
const MAX = '2026-12-11';

describe('weekStripDates', () => {
  it('covers the Monday to Sunday week around the selected day', () => {
    expect(weekStripDates('2026-10-14', MIN, MAX)).toEqual([
      '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18',
    ]);
  });

  it('stays put while stepping through the same week', () => {
    expect(weekStripDates('2026-10-12', MIN, MAX)).toEqual(weekStripDates('2026-10-18', MIN, MAX));
  });

  it('never offers a day outside the cached window', () => {
    // The last cached day is a Friday, so the week is clipped.
    expect(weekStripDates('2026-12-09', MIN, '2026-12-11')).toEqual([
      '2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11',
    ]);
    expect(weekStripDates('2026-10-06', '2026-10-05', MAX)).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11',
    ]);
  });
});

describe('weekday and month labels', () => {
  it('names the weekday from the date, not the viewer clock', () => {
    expect(shortWeekday('2026-10-12')).toBe('Mon');
    expect(shortWeekday('2026-10-18')).toBe('Sun');
    expect(WEEKDAY_SHORT).toHaveLength(7);
  });

  it('names the month', () => {
    expect(monthShort('2026-10-12')).toBe('Oct');
    expect(monthShort('2026-01-01')).toBe('Jan');
  });
});

describe('buildWeekStrip', () => {
  const dates = weekStripDates('2026-10-14', MIN, MAX);

  it('marks the selected day, today, and fills in the counts', () => {
    const strip = buildWeekStrip(dates, {
      '2026-10-12': { total: 22, premieres: 3 },
      '2026-10-14': { total: 18, premieres: 0 },
    }, '2026-10-14', '2026-10-14');
    expect(strip).toHaveLength(7);
    expect(strip[0]).toMatchObject({ date: '2026-10-12', weekday: 'Mon', day: '12', month: 'Oct', total: 22, premieres: 3, isSelected: false, isToday: false });
    expect(strip[2]).toMatchObject({ date: '2026-10-14', total: 18, isSelected: true, isToday: true });
  });

  it('reads a day with no data as empty rather than missing', () => {
    const strip = buildWeekStrip(dates, {}, '2026-10-14', '2026-10-14');
    for (const cell of strip) {
      expect(cell.total).toBe(0);
      expect(cell.premieres).toBe(0);
    }
    // Only the day being viewed is marked, and nothing is mistaken for today.
    expect(strip.filter((cell) => cell.isSelected).map((cell) => cell.date)).toEqual(['2026-10-14']);
    expect(strip.filter((cell) => cell.isToday)).toHaveLength(1);
  });
});
