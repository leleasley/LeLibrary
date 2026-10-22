import type { ReleaseListItem } from '@/api/releases';
import { addDaysIso, formatDate } from '@/features/releases/release-format';

// Movies read better as a calendar than as one flat list, so the Movies tab
// groups releases by week. Weeks start on Monday, matching how the guide and
// the rest of the UK-facing surface label dates.

export interface ReleaseGroup {
  key: string;
  label: string;
  items: ReleaseListItem[];
}

const UNKNOWN_KEY = 'unknown';

// The Monday of the week containing an ISO date, in UTC so the result never
// depends on the viewer's clock.
export function weekStartIso(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

export function weekLabel(weekStart: string, today: string): string {
  const currentWeek = weekStartIso(today);
  const es = typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('es');
  if (weekStart === currentWeek) return es ? 'Esta semana' : 'This week';
  if (weekStart === addDaysIso(currentWeek, 7)) return es ? 'La próxima semana' : 'Next week';
  return es ? `Semana del ${formatDate(weekStart)}` : `Week of ${formatDate(weekStart)}`;
}

export function groupByWeek(items: ReleaseListItem[], today: string): ReleaseGroup[] {
  const buckets = new Map<string, ReleaseListItem[]>();
  const undated: ReleaseListItem[] = [];

  for (const item of items) {
    if (!item.date) {
      undated.push(item);
      continue;
    }
    const key = weekStartIso(item.date);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const groups: ReleaseGroup[] = [...buckets.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, groupItems]) => ({ key, label: weekLabel(key, today), items: groupItems }));

  if (undated.length) groups.push({ key: UNKNOWN_KEY, label: typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('es') ? 'Sin fecha' : 'No date yet', items: undated });
  return groups;
}
