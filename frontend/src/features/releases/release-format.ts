import type { ReleaseStatus } from '@/api/releases';

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function preferredLocale(): string {
  return typeof document !== 'undefined' && document.documentElement.lang
    ? document.documentElement.lang
    : typeof navigator !== 'undefined' ? navigator.language : 'en';
}

export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatDate(value: string | null): string {
  if (!value) return 'Date unknown';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(preferredLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatAirDate(value: string | null): string {
  if (!value) return 'Unknown';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(preferredLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
}

export function daysUntil(date: string, from: string = todayIso()): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const target = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(target)) return Number.NaN;
  return Math.round((target - start) / 86400000);
}

// A title whose primary date is today is out today, whichever status the API
// derived. This is the one badge and the one card treatment worth calling out.
export function isOutToday(status: ReleaseStatus, date: string | null): boolean {
  if (status === 'releasing_today') return true;
  return date !== null && daysUntil(date) === 0;
}

// Friendly status text. A title out today is called out by name; the rest of
// the past reads as Released. The near future is spelled out relative to today.
export function releaseLabel(status: ReleaseStatus, date: string | null): string {
  const es = preferredLocale().toLowerCase().startsWith('es');
  if (status === 'unknown') return es ? 'Fecha desconocida' : 'Date unknown';
  if (isOutToday(status, date)) return es ? 'Se estrena hoy' : 'Out today';
  if (status === 'released') return es ? 'Estrenado' : 'Released';
  if (!date) return es ? 'Próximamente' : 'Upcoming';
  const delta = daysUntil(date);
  if (!Number.isFinite(delta)) return es ? 'Próximamente' : 'Upcoming';
  if (delta <= 0) return es ? 'Estrenado' : 'Released';
  if (delta === 1) return es ? 'Se estrena mañana' : 'Releasing tomorrow';
  if (delta <= 13) return es ? `Se estrena en ${delta} días` : `Releasing in ${delta} days`;
  return es ? 'Próximamente' : 'Upcoming';
}

export function isNearRelease(status: ReleaseStatus, date: string | null): boolean {
  if (status !== 'upcoming' || !date) return false;
  const delta = daysUntil(date);
  return Number.isFinite(delta) && delta >= 1 && delta <= 6;
}

// Short human relative phrase for a date, or '' when it is far away.
export function relativeDay(date: string | null): string {
  if (!date) return '';
  const delta = daysUntil(date);
  if (!Number.isFinite(delta)) return '';
  const es = preferredLocale().toLowerCase().startsWith('es');
  if (delta === 0) return es ? 'hoy' : 'today';
  if (delta === 1) return es ? 'mañana' : 'tomorrow';
  if (delta === -1) return es ? 'ayer' : 'yesterday';
  if (delta < 0) return es ? `hace ${-delta} días` : `${-delta} days ago`;
  if (delta <= 60) return es ? `en ${delta} días` : `in ${delta} days`;
  return '';
}

// Keep a YYYY-MM-DD value inside [min, max]. ISO dates compare correctly as
// strings. Empty input snaps to the lower bound.
export function clampIso(value: string, min: string, max: string): string {
  if (!value) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// Card-ready form of relativeDay: capitalised, and empty for far or missing
// dates so a card never claims a distance it does not know.
export function relativeWhen(date: string | null): string {
  const base = relativeDay(date);
  return base ? `${base.charAt(0).toUpperCase()}${base.slice(1)}` : '';
}

