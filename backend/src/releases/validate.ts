// Pure date / region / query validation and date-window maths shared by the
// Releases router, the sync engine and tests. No I/O, no env reads.
export interface DateWindow {
  from: string;
  to: string;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toIsoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && toIsoDate(date) === value;
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

// Rolling window relative to "today" (an ISO date string).
function dateWindow(today: string, pastDays: number, futureDays: number): DateWindow {
  return {
    from: addDays(today, -Math.abs(pastDays)),
    to: addDays(today, Math.abs(futureDays)),
  };
}

// Region must be two uppercase letters and be in the configured allow-list.
function normalizeRegion(raw: unknown, allowed: string[]): string | null {
  const value = String(raw || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(value)) return null;
  return allowed.includes(value) ? value : null;
}

function parseAllowedRegions(raw: unknown, fallback: string[]): string[] {
  const list = String(raw || '')
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter((part) => /^[A-Z]{2}$/.test(part));
  const unique = [...new Set(list)];
  return unique.length ? unique : fallback;
}

function normalizeQuery(raw: unknown, min = 2, max = 100): string | null {
  const value = String(raw || '').replace(/\s+/g, ' ').trim();
  if (value.length < min || value.length > max) return null;
  return value;
}

function normalizeSearchKey(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface PageInput {
  page: number;
  pageSize: number;
  offset: number;
  error: string | null;
}

function parsePage(raw: unknown, pageSize: number, maxPage: number): PageInput {
  if (raw === undefined || raw === null || raw === '') {
    return { page: 1, pageSize, offset: 0, error: null };
  }
  const page = Number(raw);
  if (!Number.isInteger(page) || page < 1 || page > maxPage) {
    return { page: 1, pageSize, offset: 0, error: `page must be between 1 and ${maxPage}` };
  }
  return { page, pageSize, offset: (page - 1) * pageSize, error: null };
}

module.exports = {
  toIsoDate,
  isIsoDate,
  addDays,
  daysBetween,
  dateWindow,
  normalizeRegion,
  parseAllowedRegions,
  normalizeQuery,
  normalizeSearchKey,
  parsePage,
};
