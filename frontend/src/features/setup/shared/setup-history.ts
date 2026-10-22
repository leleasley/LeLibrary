// Browser-local memory of setups created or unlocked on this instance.
// Self-hosters have no account, so without this the only way back to an
// existing setup is typing /{uuid} by hand (issue #4). Only the UUID plus a
// display label is stored: the UUID alone can neither watch (needs the install
// secret) nor edit (needs the password).
export interface SetupHistoryEntry {
  uuid: string;
  name?: string | null;
  tier?: string | null;
  savedAt: number;
}

const STORAGE_KEY = 'lelibrary.setups.v1';
const MAX_ENTRIES = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSetupUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

// Accepts anything a user is likely to paste: a bare UUID, an install token
// ({uuid}.{secret}), an install link (/{uuid}.{secret}/manifest.json) or an
// edit link (/{uuid}/configure). Returns the UUID, or '' when unusable.
// Always lowercase: the server looks setups up case-sensitively and mints
// lowercase UUIDs, so an uppercase paste must not become a "not found" page.
// The secret in an install link is deliberately discarded and never stored.
export function uuidFromInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (isSetupUuid(trimmed)) return trimmed.toLowerCase();

  // Drop the query/hash, then test every path segment rather than only the
  // last one: "manifest.json" and "configure" are common trailing segments.
  const withoutQuery = trimmed.split(/[?#]/, 1)[0] ?? '';
  const parts = withoutQuery.split('/').filter(Boolean);
  for (const part of parts) {
    if (isSetupUuid(part)) return part.toLowerCase();
    const [uuid] = part.split('.', 1);
    if (uuid && isSetupUuid(uuid)) return uuid.toLowerCase();
  }
  return '';
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function sanitize(value: unknown): SetupHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const out: SetupHistoryEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const uuid = typeof (item as { uuid?: unknown }).uuid === 'string'
      ? (item as { uuid: string }).uuid.trim().toLowerCase()
      : '';
    if (!isSetupUuid(uuid)) continue;
    const rec = item as { name?: unknown; tier?: unknown; savedAt?: unknown };
    out.push({
      uuid,
      name: typeof rec.name === 'string' ? rec.name.slice(0, 80) : null,
      tier: typeof rec.tier === 'string' ? rec.tier.slice(0, 20) : null,
      savedAt: typeof rec.savedAt === 'number' && Number.isFinite(rec.savedAt) ? rec.savedAt : 0,
    });
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

export function loadSetupHistory(): SetupHistoryEntry[] {
  const store = storage();
  if (!store) return [];
  try {
    return sanitize(JSON.parse(store.getItem(STORAGE_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

function persist(entries: SetupHistoryEntry[]): SetupHistoryEntry[] {
  const store = storage();
  if (store) {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch { /* private mode / quota: memory still returns the list */ }
  }
  return entries;
}

export function rememberSetup(entry: { uuid: string; name?: string | null; tier?: string | null }): SetupHistoryEntry[] {
  const uuid = entry.uuid.trim().toLowerCase();
  if (!isSetupUuid(uuid)) return loadSetupHistory();
  const next: SetupHistoryEntry[] = [{
    uuid,
    name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, 80) : null,
    tier: typeof entry.tier === 'string' && entry.tier.trim() ? entry.tier.trim().slice(0, 20) : null,
    savedAt: Date.now(),
  }];
  for (const existing of loadSetupHistory()) {
    if (existing.uuid === uuid) continue;
    next.push(existing);
    if (next.length >= MAX_ENTRIES) break;
  }
  return persist(next);
}

export function forgetSetup(uuid: string): SetupHistoryEntry[] {
  const wanted = uuid.trim().toLowerCase();
  return persist(loadSetupHistory().filter((entry) => entry.uuid.toLowerCase() !== wanted));
}

export function setupLabel(entry: SetupHistoryEntry): string {
  if (entry.name) return entry.name;
  return `Setup ${entry.uuid.slice(0, 8)}…`;
}
