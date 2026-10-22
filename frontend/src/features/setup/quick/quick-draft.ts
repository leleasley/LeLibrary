import type { FormattingDraft } from '@/features/setup/shared/FormattingSection';
import type { PostersDraft } from '@/features/setup/shared/PostersSection';
import type { QuickExtras } from '@/features/setup/full/MetadataExtras';
import type { SetupKeysDraft } from '@/features/setup/shared/config-contract';
import type { LibraryRowsDraft } from '@/features/setup/shared/library-rows';

// Session draft: everything the user types on the Quick flow survives a
// refresh in this tab, exactly like the legacy page's sessionStorage draft.
// Nothing leaves the browser; a successful create or an explicit reset wipes
// it. TTL keeps a stale tab from resurrecting ancient input.
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
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft['savedAt'] === 'number' &&
    typeof draft['name'] === 'string' &&
    !!draft['keys'] && typeof draft['keys'] === 'object' &&
    !!draft['formatting'] && typeof draft['formatting'] === 'object' &&
    !!draft['posters'] && typeof draft['posters'] === 'object' &&
    !!draft['badgePack'] && typeof draft['badgePack'] === 'object'
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
      return null;
    }
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      sessionStorage.removeItem(DRAFT_KEY);
      return null;
    }
    const { savedAt: _savedAt, ...draft } = parsed;
    return draft;
  } catch {
    return null;
  }
}

export function saveQuickDraft(draft: QuickDraft): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // Private mode / quota: the setup flow still works, it just won't resume.
  }
}

export function clearQuickDraft(): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}
