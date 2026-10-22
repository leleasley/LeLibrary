import type { FormattingDraft } from '@/features/setup/shared/FormattingSection';
import type { LibraryRowsDraft } from '@/features/setup/shared/library-rows';
import type { CustomAddonRef } from '@/features/setup/shared/custom-addons';
import type { PostersDraft } from '@/features/setup/shared/PostersSection';
import type { MetadataExtrasDraft } from '@/features/setup/full/MetadataExtras';
import type { FilterSetsDraft } from '@/features/setup/full/FilterSets';
import type { MediaSetsDraft } from '@/features/setup/partial/FilterMediaSets';
import type { SetupKeysDraft, CustomStreamRow } from '@/features/setup/shared/config-contract';
import type { WatchlistDraftMap } from '@/features/setup/resolver/api';
import type { HomeRowDoc } from '@/features/setup/shared/collection-doc';
import type { PlatformConnection } from '@/features/setup/full/platform-login';
import type { StagedImport } from '@/features/setup/full/full-draft';
import {
  cleanNuvioPlayback,
  type NuvioPlaybackDraft,
} from '@/features/setup/shared/nuvio-playback';
import {
  cleanNuvioHideUnreleased,
  type NuvioHideUnreleased,
} from '@/features/setup/shared/nuvio-library';

// Session draft: everything typed on the Settle In flow survives a refresh,
// exactly like the Quick flow's draft. Nothing leaves the browser; a
// successful create or an explicit reset wipes it. TTL keeps a stale tab
// from resurrecting ancient input. Watchlist tokens ride along and seal at
// creation like every other secret.
const DRAFT_KEY = 'lelibrary_partial_draft';
const DRAFT_TTL_MS = 24 * 3600000;

export interface PartialDraft {
  name: string;
  keys: SetupKeysDraft;
  formatting: FormattingDraft;
  posters: PostersDraft;
  homeRows: HomeRowDoc[];
  filterSets: FilterSetsDraft;
  mediaSets: MediaSetsDraft;
  meta: MetadataExtrasDraft;
  badgePack: string;
  customBadgeUrl: string;
  watchlist: WatchlistDraftMap;
  // Stream sources: the same two lists Move In collects. Without them a Settle
  // In setup has no external streams at all, so every row would be empty for
  // anyone without a debrid library.
  addons?: string[];
  customStreams?: CustomStreamRow[];
  // Nuvio player choices (opt-in). Tolerated when absent: drafts predate it.
  nuvioPlayback?: NuvioPlaybackDraft;
  // Three-way Nuvio unreleased choice; absent reads as "leave unchanged".
  nuvioHideUnreleased?: NuvioHideUnreleased;
  // Library row names (absent in older drafts).
  libraryRows?: LibraryRowsDraft;
  // Names of the user's own stream addons (links travel with the keys).
  customAddons?: CustomAddonRef[];
  // The player chosen on the publish desk, and the login that push uses.
  platform?: 'nuvio' | 'stremio';
  pushConn?: PlatformConnection | null;
  // A staged old-setup import, the same shape Move In stages.
  stagedImport?: StagedImport | null;
}

interface StoredDraft extends PartialDraft {
  savedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isDraft(value: unknown): value is StoredDraft {
  if (!isRecord(value)) return false;
  return (
    typeof value['savedAt'] === 'number' &&
    typeof value['name'] === 'string' &&
    isRecord(value['keys']) &&
    isRecord(value['formatting']) &&
    isRecord(value['posters']) &&
    Array.isArray(value['homeRows']) &&
    isRecord(value['filterSets']) &&
    isRecord(value['mediaSets']) &&
    isRecord(value['meta']) &&
    typeof value['badgePack'] === 'string' &&
    typeof value['customBadgeUrl'] === 'string' &&
    isRecord(value['watchlist'] ?? {}) &&
    // Stream lists arrived after the first drafts: tolerate their absence
    // instead of discarding a draft someone is halfway through.
    (value['addons'] == null || Array.isArray(value['addons'])) &&
    (value['customStreams'] == null || Array.isArray(value['customStreams'])) &&
    (value['nuvioPlayback'] == null || isRecord(value['nuvioPlayback'])) &&
    (value['nuvioHideUnreleased'] == null || typeof value['nuvioHideUnreleased'] === 'string') &&
    (value['platform'] == null || value['platform'] === 'nuvio' || value['platform'] === 'stremio') &&
    (value['stagedImport'] == null || isRecord(value['stagedImport']))
  );
}

export function loadPartialDraft(): PartialDraft | null {
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
      addons: Array.isArray(draft.addons) ? draft.addons : [],
      customStreams: Array.isArray(draft.customStreams) ? draft.customStreams : [],
      nuvioPlayback: cleanNuvioPlayback(draft.nuvioPlayback ?? null),
      nuvioHideUnreleased: cleanNuvioHideUnreleased(draft.nuvioHideUnreleased),
      platform: draft.platform === 'stremio' ? 'stremio' : 'nuvio',
      pushConn: draft.pushConn ?? null,
      stagedImport: (draft.stagedImport as StagedImport | null | undefined) ?? null,
    };
  } catch {
    return null;
  }
}

export function savePartialDraft(draft: PartialDraft): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // Private mode / quota: the setup flow still works, it just won't resume.
  }
}

export function clearPartialDraft(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}
