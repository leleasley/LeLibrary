import type { FormattingDraft } from '@/features/setup/shared/FormattingSection';
import type { LibraryRowsDraft } from '@/features/setup/shared/library-rows';
import type { CustomAddonRef } from '@/features/setup/shared/custom-addons';
import type { PostersDraft } from '@/features/setup/shared/PostersSection';
import type { MetadataExtrasDraft } from '@/features/setup/full/MetadataExtras';
import type { FilterSetsDraft } from '@/features/setup/full/FilterSets';
import type { CollectionDoc, HomeRowDoc } from '@/features/setup/shared/collection-doc';
import type { CustomStreamRow, SetupKeysDraft } from '@/features/setup/shared/config-contract';
import type { WatchlistDraftMap } from '@/features/setup/resolver/api';
import type { PlatformConnection } from '@/features/setup/full/platform-login';
import {
  cleanNuvioPlayback,
  type NuvioPlaybackDraft,
} from '@/features/setup/shared/nuvio-playback';
import {
  cleanNuvioHideUnreleased,
  type NuvioHideUnreleased,
} from '@/features/setup/shared/nuvio-library';

// Session draft: everything typed on the Move In flow survives a refresh,
// exactly like the Quick flow's draft. Nothing leaves the browser; a
// successful create or an explicit reset wipes it. TTL keeps a stale tab
// from resurrecting ancient input. The platform session (pushConn) rides
// along too: without it, an imported login evaporates on the first refresh
// while everything else restores, which reads as a failed import. It holds
// the same class of secret the key drafts already persist, so this changes
// nothing about what the browser stores.
// Watchlist tokens ride along and seal at creation like every other secret.
const DRAFT_KEY = 'lelibrary_full_draft';
const DRAFT_TTL_MS = 24 * 3600000;

export interface StagedImport {
  email: string;
  idMasked: string;
  label: string | null;
  kind: 'collection' | 'token';
  // What the import brought in, for the banner. The values themselves live
  // in the page draft from the moment of import (keys filled, docs merged).
  // `services` names the server-filled key fields so inputs keep their
  // "Saved" tags across reloads: users see the data is there but came from
  // the server.
  keyCount: number;
  collectionCount: number;
  homeRowCount: number;
  hasLogin: boolean;
  services: string[];
}

export interface FullDraft {
  platform: 'nuvio' | 'stremio';
  rdCatalog: string;
  name: string;
  keys: SetupKeysDraft;
  formatting: FormattingDraft;
  posters: PostersDraft;
  homeRows: HomeRowDoc[];
  badgePack: string;
  customBadgeUrl: string;
  collections: CollectionDoc[];
  packs: string[];
  meta: MetadataExtrasDraft;
  filterSets: FilterSetsDraft;
  addons: string[];
  customStreams: CustomStreamRow[];
  watchlist: WatchlistDraftMap;
  // Opt-in Nuvio player choices. Absent in older drafts; that reads as off.
  nuvioPlayback?: NuvioPlaybackDraft;
  // Three-way Nuvio unreleased choice; absent reads as "leave unchanged".
  nuvioHideUnreleased?: NuvioHideUnreleased;
  // Library row names (absent in older drafts).
  libraryRows?: LibraryRowsDraft;
  // Names of the user's own stream addons (links travel with the keys).
  customAddons?: CustomAddonRef[];
  stagedImport: StagedImport | null;
  pushConn: PlatformConnection | null;
}

interface StoredDraft extends FullDraft {
  savedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPushConn(value: unknown): value is PlatformConnection {
  if (!isRecord(value)) return false;
  if (value['platform'] !== 'nuvio' && value['platform'] !== 'stremio') return false;
  const token = value['platform'] === 'nuvio' ? value['nuvioToken'] : value['stremioAuth'];
  return typeof token === 'string' && token.trim() !== '';
}

function isStagedImport(value: unknown): value is StagedImport {
  if (!isRecord(value)) return false;
  return (
    typeof value['email'] === 'string' &&
    typeof value['idMasked'] === 'string' &&
    (value['label'] === null || typeof value['label'] === 'string') &&
    (value['kind'] === 'collection' || value['kind'] === 'token') &&
    typeof value['keyCount'] === 'number' &&
    typeof value['collectionCount'] === 'number' &&
    typeof value['homeRowCount'] === 'number' &&
    typeof value['hasLogin'] === 'boolean' &&
    Array.isArray(value['services']) &&
    value['services'].every((service: unknown) => typeof service === 'string')
  );
}

function isDraft(value: unknown): value is StoredDraft {
  if (!isRecord(value)) return false;
  return (
    typeof value['savedAt'] === 'number' &&
    (value['platform'] === 'nuvio' || value['platform'] === 'stremio') &&
    typeof value['rdCatalog'] === 'string' &&
    typeof value['name'] === 'string' &&
    isRecord(value['keys']) &&
    isRecord(value['formatting']) &&
    isRecord(value['posters']) &&
    Array.isArray(value['homeRows']) &&
    typeof value['badgePack'] === 'string' &&
    typeof value['customBadgeUrl'] === 'string' &&
    Array.isArray(value['collections']) &&
    Array.isArray(value['packs']) &&
    isRecord(value['meta']) &&
    isRecord(value['filterSets']) &&
    Array.isArray(value['addons']) &&
    Array.isArray(value['customStreams']) &&
    isRecord(value['watchlist'] ?? {}) &&
    (value['nuvioPlayback'] == null || isRecord(value['nuvioPlayback'])) &&
    (value['nuvioHideUnreleased'] == null || typeof value['nuvioHideUnreleased'] === 'string') &&
    (value['stagedImport'] == null || isStagedImport(value['stagedImport'])) &&
    (value['pushConn'] == null || isPushConn(value['pushConn']))
  );
}

export function loadFullDraft(): FullDraft | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isDraft(parsed)) {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    const { savedAt: _savedAt, ...draft } = parsed;
    return {
      ...draft,
      nuvioPlayback: cleanNuvioPlayback(draft.nuvioPlayback ?? null),
      nuvioHideUnreleased: cleanNuvioHideUnreleased(draft.nuvioHideUnreleased),
    };
  } catch {
    return null;
  }
}

export function saveFullDraft(draft: FullDraft): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // Private mode / quota: the setup flow still works, it just won't resume.
  }
}

export function clearFullDraft(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}
