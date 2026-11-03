import type { SetupKeysDraft } from '@/features/setup/shared/config-contract';
import type { WatchlistDraftMap } from '@/features/setup/resolver/api';
import type { PlatformConnection } from '@/features/setup/full/platform-login';
import { customAddonKeyField, type CustomAddonRef } from '@/features/setup/shared/custom-addons';
import { isRecord } from '@/features/setup/shared/is-record';

// Secrets typed before a setup exists (provider and artwork keys, the
// Posters+ link, your own addon links, WebDAV login, Simkl/Trakt tokens, the
// Nuvio/Stremio session) never touch Web Storage: any same-origin script
// could read them there, and they would outlive the tab on a shared machine.
// The tier drafts persist everything else; the secrets live here, in module
// memory, so moving between pages in the app keeps them and a reload drops
// them. Creation seals them server side.
export interface DraftSecrets {
  keys: SetupKeysDraft;
  watchlist: WatchlistDraftMap;
  pushConn: PlatformConnection | null;
}

// One slot per tier draft (keyed by its storage key).
const held = new Map<string, DraftSecrets>();

export function holdDraftSecrets(slot: string, secrets: DraftSecrets): void {
  held.set(slot, {
    keys: { ...secrets.keys },
    watchlist: { ...secrets.watchlist },
    pushConn: secrets.pushConn ?? null,
  });
}

export function heldDraftSecrets(slot: string): DraftSecrets | null {
  return held.get(slot) ?? null;
}

export function dropDraftSecrets(slot: string): void {
  held.delete(slot);
}

// A login is only a login with its session token: anything less restores as
// "not connected", so a page never shows a connection it cannot use.
export function isPushConn(value: unknown): value is PlatformConnection {
  if (!isRecord(value)) return false;
  if (value['platform'] !== 'nuvio' && value['platform'] !== 'stremio') return false;
  const token = value['platform'] === 'nuvio' ? value['nuvioToken'] : value['stremioAuth'];
  return typeof token === 'string' && token.trim() !== '';
}

// True when a stored draft still carries a secret (drafts written before v6
// did): the loader then rewrites it without them, wiping them from storage.
export function storedDraftHasSecrets(value: object): boolean {
  const record = value as Record<string, unknown>;
  const filled = (entry: unknown) => isRecord(entry) && Object.keys(entry).length > 0;
  return filled(record['keys']) || filled(record['watchlist']) || record['pushConn'] != null;
}

// The storable half of a draft: the same shape with every secret emptied.
export function withoutSecrets<T extends object>(draft: T): T {
  const out: Record<string, unknown> = { ...draft, keys: {} };
  if ('watchlist' in draft) out['watchlist'] = {};
  if ('pushConn' in draft) out['pushConn'] = null;
  return out as T;
}

// Your own addons whose link was not kept (a reload) are dropped with their
// stream-source entry: a named addon without its link would be saved as a
// source that can never answer. Adding it again takes one paste.
export function withoutOrphanAddons(
  customAddons: CustomAddonRef[] | undefined,
  addons: string[] | undefined,
  keys: SetupKeysDraft,
): { customAddons: CustomAddonRef[]; addons: string[] } {
  const kept: CustomAddonRef[] = [];
  const dropped = new Set<string>();
  for (const ref of customAddons ?? []) {
    const field = customAddonKeyField(ref.id);
    const link = field ? keys[field] : undefined;
    if (typeof link === 'string' && link.trim()) kept.push(ref);
    else dropped.add(ref.id);
  }
  return { customAddons: kept, addons: (addons ?? []).filter((id) => !dropped.has(id)) };
}
