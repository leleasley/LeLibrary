import { addDaysIso } from '@/features/releases/release-format';
import { weekStartIso } from '@/features/releases/release-groups';

// The row of days above the day view. The window is the Monday to Sunday week
// around the selected day, clipped to what the server has actually cached, so
// stepping through a week never changes the strip and never offers a day that
// will come back empty.

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export interface WeekStripCounts {
  total: number;
  premieres: number;
}

export interface WeekStripDay {
  date: string;
  weekday: string;
  day: string;
  month: string;
  total: number;
  premieres: number;
  isSelected: boolean;
  isToday: boolean;
}

// Dates are calendar days, so read and name them in UTC: the label must not
// shift with the viewer's clock.
function weekdayIndex(iso: string): number {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return 0;
  return (date.getUTCDay() + 6) % 7;
}

export function shortWeekday(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const locale = typeof document !== 'undefined' && document.documentElement.lang ? document.documentElement.lang : 'en';
  if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(date).replace('.', '');
  return WEEKDAY_SHORT[weekdayIndex(iso)] ?? '';
}

export function monthShort(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const locale = typeof document !== 'undefined' && document.documentElement.lang ? document.documentElement.lang : 'en';
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(date).replace('.', '');
}

export function weekStripDates(selected: string, minDate: string, maxDate: string): string[] {
  const start = weekStartIso(selected);
  const dates: string[] = [];
  for (let offset = 0; offset < 7; offset++) {
    const date = addDaysIso(start, offset);
    if (date < minDate || date > maxDate) continue;
    dates.push(date);
  }
  return dates;
}

export function buildWeekStrip(
  dates: string[],
  counts: Record<string, WeekStripCounts>,
  selected: string,
  today: string,
): WeekStripDay[] {
  return dates.map((date) => {
    const count = counts[date];
    return {
      date,
      weekday: shortWeekday(date),
      day: date.slice(8, 10),
      month: monthShort(date),
      total: count ? count.total : 0,
      premieres: count ? count.premieres : 0,
      isSelected: date === selected,
      isToday: date === today,
    };
  });
}
