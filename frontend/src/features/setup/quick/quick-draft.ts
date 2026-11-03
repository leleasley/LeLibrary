import type { FormattingDraft } from '@/features/setup/shared/FormattingSection';
import type { PostersDraft } from '@/features/setup/shared/PostersSection';
import type { QuickExtras } from '@/features/setup/full/MetadataExtras';
import type { SetupKeysDraft } from '@/features/setup/shared/config-contract';
import type { LibraryRowsDraft } from '@/features/setup/shared/library-rows';
import { isRecord } from '@/features/setup/shared/is-record';
import {
  dropDraftSecrets,
  heldDraftSecrets,
  holdDraftSecrets,
  storedDraftHasSecrets,
  withoutSecrets,
} from '@/features/setup/shared/draft-secrets';

// Session draft: every non-secret choice on the Quick flow survives a refresh
// in this tab, exactly like the legacy page's sessionStorage draft. Nothing
// leaves the browser; a successful create or an explicit reset wipes it. TTL
// keeps a stale tab from resurrecting ancient input. Keys are never stored:
// they are held in memory (shared/draft-secrets.ts), so they survive moving
// around the app and a reload asks for them again.
const DRAFT_KEY = 'lelibrary_quick_draft';
// A mistaken refresh must restore everything until creation wipes it, so the
// TTL matches the other tiers (a full day), not an hour.
const DRAFT_TTL_MS = 24 * 3600000;

export interface QuickDraft {
  name: string;
  keys: SetupKeysDraft;
  formatting: FormattingDraft;
  posters: PostersDraft;
  badgePack: { pack: string; url: string };
  extras?: QuickExtras;
  libraryRows?: LibraryRowsDraft;
}

interface StoredDraft extends QuickDraft {
  savedAt: number;
}

function isDraft(value: unknown): value is StoredDraft {
  if (!isRecord(value)) return false;
  return (
    typeof value['savedAt'] === 'number' &&
    typeof value['name'] === 'string' &&
    isRecord(value['keys']) &&
    isRecord(value['formatting']) &&
    isRecord(value['posters']) &&
    isRecord(value['badgePack'])
  );
}

export function loadQuickDraft(): QuickDraft | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isDraft(parsed)) {
      sessionStorage.removeItem(DRAFT_KEY);
      dropDraftSecrets(DRAFT_KEY);
      return null;
    }
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      sessionStorage.removeItem(DRAFT_KEY);
      dropDraftSecrets(DRAFT_KEY);
      return null;
    }
    const { savedAt, ...stored } = parsed;
    // Drafts from before v6 stored the keys: rewrite them without (same age,
    // so the TTL is not extended). Stored keys are never restored.
    if (storedDraftHasSecrets(parsed)) {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...withoutSecrets(stored), savedAt }));
    }
    return { ...stored, keys: heldDraftSecrets(DRAFT_KEY)?.keys ?? {} };
  } catch {
    return null;
  }
}

export function saveQuickDraft(draft: QuickDraft): void {
  // Keys go to memory only, whether or not storage works.
  holdDraftSecrets(DRAFT_KEY, { keys: draft.keys, watchlist: {}, pushConn: null });
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...withoutSecrets(draft), savedAt: Date.now() }));
  } catch {
    // Private mode / quota: the setup flow still works, it just won't resume.
  }
}

export function clearQuickDraft(): void {
  dropDraftSecrets(DRAFT_KEY);
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}
