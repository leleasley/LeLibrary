import { queryKeys } from '@/api/query-keys';
import { forgetSetup, isSetupUuid, type SetupHistoryEntry } from '@/features/setup/shared/setup-history';

// Wire shape of GET /api/setup. Dates arrive as ISO strings and are normalized
// once, so the UI never juggles two date representations.
export interface SavedSetupSummary {
  uuid: string;
  name: string | null;
  tier: string;
  hasPassword: boolean;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  lastUsedAtMs: number | null;
}

export interface SavedSetup {
  uuid: string;
  name: string | null;
  tier: string | null;
  source: 'server' | 'browser';
  updatedAt: number | null;
}

function toMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Tolerate a partial or hostile payload: one bad row must not blank the list.
export function normalizeSetupSummary(row: unknown): SavedSetupSummary | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const uuid = typeof record.uuid === 'string' ? record.uuid.trim().toLowerCase() : '';
  if (!isSetupUuid(uuid)) return null;
  const name = typeof record.name === 'string' && record.name.trim()
    ? record.name.trim().slice(0, 120)
    : null;
  return {
    uuid,
    name,
    tier: typeof record.tier === 'string' && record.tier ? record.tier : 'quick',
    hasPassword: record.hasPassword === true,
    createdAtMs: toMs(record.createdAt),
    updatedAtMs: toMs(record.updatedAt),
    lastUsedAtMs: toMs(record.lastUsedAt),
  };
}

export interface SetupListInvalidator {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown;
}

// Deleting a setup must forget it locally AND refetch the server list, or the
// picker keeps offering it for the query's staleTime and the click 404s.
export function forgetDeletedSetup(uuid: string, client: SetupListInvalidator): void {
  forgetSetup(uuid);
  void client.invalidateQueries({ queryKey: queryKeys.savedSetups });
}

// One list for the picker: server summaries (authoritative name/tier/date) then
// browser-only entries, capped. The server cannot return the install secret, so
// every entry opens the password-gated /{uuid} page.
export function mergeSavedSetups(
  server: SavedSetupSummary[],
  local: SetupHistoryEntry[],
  cap = 10,
): SavedSetup[] {
  const seen = new Set<string>();
  const merged: SavedSetup[] = [];

  for (const entry of server) {
    const uuid = entry.uuid.trim().toLowerCase();
    if (!isSetupUuid(uuid) || seen.has(uuid)) continue;
    seen.add(uuid);
    merged.push({
      uuid,
      name: entry.name,
      tier: entry.tier,
      source: 'server',
      updatedAt: entry.lastUsedAtMs ?? entry.updatedAtMs ?? entry.createdAtMs,
    });
  }

  // Newest first, independent of whatever order localStorage happens to hold.
  const browserOnly = [...local].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  for (const entry of browserOnly) {
    const uuid = entry.uuid.trim().toLowerCase();
    if (!isSetupUuid(uuid) || seen.has(uuid)) continue;
    seen.add(uuid);
    merged.push({
      uuid,
      name: entry.name ?? null,
      tier: entry.tier ?? null,
      source: 'browser',
      updatedAt: entry.savedAt || null,
    });
  }

  return merged.slice(0, Math.max(1, cap));
}
