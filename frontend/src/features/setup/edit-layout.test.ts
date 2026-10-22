import { describe, expect, it } from 'vitest';
import { tierFor, tierPageFor } from '@/features/setup/SetupEditPage';
import { QuickSetupPage } from '@/features/setup/quick/QuickSetupPage';
import { PartialSetupPage } from '@/features/setup/partial/PartialSetupPage';
import { FullSetupPage } from '@/features/setup/full/FullSetupPage';
import {
  badgeForSnapshot,
  editSaveBody,
  snapshotFromSaved,
  snapshotToFullDraft,
  snapshotToPartialDraft,
  type TierSnapshot,
} from '@/features/setup/shared/edit-mode';

// /{uuid} opens the exact page the setup was created on, in edit mode. There is
// no separate editor: the three tier pages are the only setup surfaces.
describe('edit opens the tier page the setup was made with', () => {
  it('maps each saved tier to its own create page', () => {
    expect(tierPageFor('quick')).toBe(QuickSetupPage);
    expect(tierPageFor('partial')).toBe(PartialSetupPage);
    expect(tierPageFor('full')).toBe(FullSetupPage);
  });

  it('opens unknown or legacy tiers in Move In, so a setup is never uneditable', () => {
    expect(tierFor('')).toBe('full');
    expect(tierFor('bogus')).toBe('full');
    expect(tierFor(null)).toBe('full');
  });
});

const SAVED_CONFIG = {
  posterProvider: 'betterposter',
  streamPreset: 'cinema',
  nuvioBadgePack: 'nard-full',
  nuvioBadgeUrl: 'https://example.com/nard.json',
  collections: [{ id: 'c1', title: 'Marvel', folders: [{ id: 'f1', title: 'Phase 1', catalogSources: [] }] }],
  wizardPlatform: 'nuvio',
};

function savedSnapshot(): TierSnapshot {
  return snapshotFromSaved(SAVED_CONFIG, { torboxApiKey: 'tb-saved', tmdbApiKey: 'tmdb-saved' }, 'Living room');
}

function body(current: TierSnapshot, options: { tier?: 'quick' | 'partial' | 'full'; clearKeys?: string[] } = {}) {
  return editSaveBody({
    current,
    saved: savedSnapshot(),
    savedName: 'Living room',
    savedTier: 'full',
    tier: options.tier ?? 'full',
    providerServices: ['torboxApiKey', 'tmdbApiKey'],
    clearKeys: options.clearKeys ?? [],
  });
}

describe('edit save body', () => {
  it('loads saved values into the snapshot the page starts from', () => {
    const snapshot = savedSnapshot();
    expect(snapshot.posters.provider).toBe('betterposter');
    expect(snapshot.formatting.preset).toBe('cinema');
    expect(snapshot.badgePack.pack).toBe('nard-full');
    expect(snapshot.collections[0]?.folders[0]?.title).toBe('Phase 1');
    expect(snapshot.keys.torboxApiKey).toBe('tb-saved');
    expect(snapshot.name).toBe('Living room');
  });

  it('sends nothing for an untouched setup (no phantom unsaved changes)', () => {
    expect(body(savedSnapshot())).toBeNull();
  });

  it('never re-sends a prefilled saved key, only a changed one', () => {
    const current = savedSnapshot();
    current.keys = { ...current.keys, torboxApiKey: 'tb-new' };
    expect(body(current)).toMatchObject({ keys: { torboxApiKey: 'tb-new' } });
    expect((body(current) as { keys: Record<string, string> }).keys.tmdbApiKey).toBeUndefined();
  });

  it('sends only the areas that changed', () => {
    const current = savedSnapshot();
    current.posters = { ...current.posters, provider: 'rpdb' };
    const out = body(current) as { config: Record<string, unknown> };
    expect(out.config.posterProvider).toBe('rpdb');
    expect(out.config.streamPreset).toBeUndefined();
    expect(out.config.collections).toBeUndefined();
  });

  it('sends an emptied collection list so the deletion actually persists', () => {
    const current = savedSnapshot();
    current.collections = [];
    const out = body(current) as { config: Record<string, unknown> };
    expect(out.config.collections).toEqual([]);
  });

  it('switches tier on save only, keeping everything else as is', () => {
    expect(body(savedSnapshot(), { tier: 'partial' })).toEqual({ tier: 'partial' });
  });

  it('sends key removals', () => {
    expect(body(savedSnapshot(), { clearKeys: ['torboxApiKey'] })).toMatchObject({ clearKeys: ['torboxApiKey'] });
  });
});

describe('stepped pages start from the saved setup', () => {
  it('carries every value into the Settle In and Move In drafts', () => {
    const snapshot = savedSnapshot();
    const partial = snapshotToPartialDraft(snapshot);
    const full = snapshotToFullDraft(snapshot);
    expect(partial.posters.provider).toBe('betterposter');
    expect(partial.badgePack).toBe('nard-full');
    expect(full.collections).toHaveLength(1);
    expect(full.keys.torboxApiKey).toBe('tb-saved');
    expect(partial.stagedImport).toBeNull();
  });

  it('keeps an untouched badge pack URL, so it never reads as a change', () => {
    const seed = savedSnapshot();
    expect(badgeForSnapshot(seed, 'nard-full', '', () => 'other')).toEqual(seed.badgePack);
    expect(badgeForSnapshot(seed, 'custom', 'https://x/y.json', () => '')).toEqual({ pack: 'custom', url: 'https://x/y.json' });
  });
});
