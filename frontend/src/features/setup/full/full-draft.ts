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
import { isRecord } from '@/features/setup/shared/is-record';
import {
  dropDraftSecrets,
  heldDraftSecrets,
  holdDraftSecrets,
  isPushConn,
  storedDraftHasSecrets,
  withoutOrphanAddons,
  withoutSecrets,
} from '@/features/setup/shared/draft-secrets';

// Session draft: every non-secret choice on the Move In flow survives a
// refresh, exactly like the Quick flow's draft. Nothing leaves the browser; a
// successful create or an explicit reset wipes it. TTL keeps a stale tab
// from resurrecting ancient input. The secrets (keys, your own addon links,
// watchlist tokens, the Nuvio/Stremio login) are never stored: they are held
// in memory (shared/draft-secrets.ts), so they survive moving around the app
// and a reload asks for them again.
const DRAFT_KEY = 'lelibrary_full_draft';
const DRAFT_TTL_MS = 24 * 3600000;

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
  pushConn: PlatformConnection | null;
}

interface StoredDraft extends FullDraft {
  savedAt: number;
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
    // The login is never restored from storage (see below), so an old
    // draft's leftover, valid or not, must not discard the whole draft.
    (value['pushConn'] == null || isRecord(value['pushConn']))
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
      dropDraftSecrets(DRAFT_KEY);
      return null;
    }
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      localStorage.removeItem(DRAFT_KEY);
      dropDraftSecrets(DRAFT_KEY);
      return null;
    }
    // Drafts from before v6 may still carry the removed old-setup import
    // (`stagedImport`): drop it so it is never restored or saved again.
    const { savedAt, stagedImport, ...stored } = parsed as StoredDraft & { stagedImport?: unknown };
    // Drafts from before v6 also stored secrets: rewrite them without (same
    // age, so the TTL is not extended). Stored secrets are never restored.
    if (storedDraftHasSecrets(parsed) || stagedImport !== undefined) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...withoutSecrets(stored), savedAt }));
    }
    const secrets = heldDraftSecrets(DRAFT_KEY);
    const keys = secrets?.keys ?? {};
    const own = withoutOrphanAddons(stored.customAddons, stored.addons, keys);
    return {
      ...stored,
      keys,
      watchlist: secrets?.watchlist ?? {},
      pushConn: secrets && isPushConn(secrets.pushConn) ? secrets.pushConn : null,
      addons: own.addons,
      customAddons: own.customAddons,
      nuvioPlayback: cleanNuvioPlayback(stored.nuvioPlayback ?? null),
      nuvioHideUnreleased: cleanNuvioHideUnreleased(stored.nuvioHideUnreleased),
    };
  } catch {
    return null;
  }
}

export function saveFullDraft(draft: FullDraft): void {
  // Secrets go to memory only, whether or not storage works.
  holdDraftSecrets(DRAFT_KEY, { keys: draft.keys, watchlist: draft.watchlist, pushConn: draft.pushConn });
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...withoutSecrets(draft), savedAt: Date.now() }));
  } catch {
    // Private mode / quota: the setup flow still works, it just won't resume.
  }
}

export function clearFullDraft(): void {
  dropDraftSecrets(DRAFT_KEY);
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}
