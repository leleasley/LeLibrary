import { useEffect, type ReactNode } from 'react';
import { applySavedConfig } from '@/features/setup/shared/saved-config';
import { buildEditSaveBody } from '@/features/setup/shared/edit-save';
import type { SetupKeysDraft, CustomStreamRow } from '@/features/setup/shared/config-contract';
import type { FormattingDraft } from '@/features/setup/shared/FormattingSection';
import type { PostersDraft } from '@/features/setup/shared/PostersSection';
import type { MetadataExtrasDraft } from '@/features/setup/full/MetadataExtras';
import type { FilterSetsDraft } from '@/features/setup/full/FilterSets';
import type { MediaSetsDraft } from '@/features/setup/partial/FilterMediaSets';
import type { CollectionDoc, HomeRowDoc } from '@/features/setup/shared/collection-doc';
import type { NuvioPlaybackDraft } from '@/features/setup/shared/nuvio-playback';
import type { NuvioHideUnreleased } from '@/features/setup/shared/nuvio-library';
import { libraryRowsEditConfig, type LibraryRowsDraft } from '@/features/setup/shared/library-rows';
import type { CustomAddonRef } from '@/features/setup/shared/custom-addons';
import type { NuvioProfileRef, PlatformConnection } from '@/features/setup/full/platform-login';
import type { PartialDraft } from '@/features/setup/partial/partial-draft';
import type { FullDraft } from '@/features/setup/full/full-draft';

export type TierId = 'quick' | 'partial' | 'full';

// Everything a tier page shows, in one shape. The edit container seeds a page
// with one of these, the page reports its current one back on every change,
// and the save body is the difference between the two. All three tier pages
// speak this shape, which is what lets a setup switch tier without losing work.
export interface TierSnapshot {
  name: string;
  keys: SetupKeysDraft;
  platform: 'nuvio' | 'stremio';
  rdCatalog: string;
  // A player login made in this session (not yet sealed server-side).
  connection: PlatformConnection | null;
  posters: PostersDraft;
  formatting: FormattingDraft;
  badgePack: { pack: string; url: string };
  meta: MetadataExtrasDraft;
  filterSets: FilterSetsDraft;
  mediaSets: MediaSetsDraft;
  homeRows: HomeRowDoc[];
  collections: CollectionDoc[];
  packs: string[];
  addons: string[];
  customStreams: CustomStreamRow[];
  nuvioPlayback: NuvioPlaybackDraft;
  nuvioHideUnreleased: NuvioHideUnreleased;
  libraryRows: LibraryRowsDraft;
  customAddons: CustomAddonRef[];
}

// What a tier page receives in edit mode. Pages stay in charge of their own
// fields; the container owns loading, saving, pushing and the tier switch.
export interface EditMode {
  uuid: string;
  tier: TierId;
  // Bearer edit token for live, server-side panels (watchlists).
  editToken: string | null;
  // Read-only preview behind the password modal: the page renders, but inert.
  locked: boolean;
  // The Nuvio profile's current settings (SettingId values), when signed in.
  nuvioCurrent?: Partial<Record<string, unknown>> | null;
  initial: TierSnapshot;
  dirty: boolean;
  savedServices: string[];
  revealSaved: (field: keyof SetupKeysDraft) => Promise<string | null>;
  onRemoveKey: (field: keyof SetupKeysDraft) => void;
  onSnapshot: (snapshot: TierSnapshot) => void;
  onSave: () => void;
  saving: boolean;
  // Restore every field to what the server holds.
  onClearEdits: () => void;
  // The saved player account for the Destination step and publish desk.
  savedAccount: { user: string | null; profiles: NuvioProfileRef[]; selected: number | null } | null;
  onSavedProfile: (profileIndex: number) => void;
  // The last step's content (save, publish, install link). The page passes the
  // desk body it wants inside the publish panel (Settle In's player login).
  renderFinish: (options: { deskBody?: ReactNode; name?: { value: string; onChange: (next: string) => void } }) => ReactNode;
}

// Saved config + revealed keys -> the snapshot a page starts from.
export function snapshotFromSaved(config: unknown, keys: Record<string, string>, name: string | null): TierSnapshot {
  const drafts = applySavedConfig(config);
  return {
    name: name ?? '',
    keys: { ...keys } as SetupKeysDraft,
    platform: drafts.platform,
    rdCatalog: drafts.rdCatalog,
    connection: null,
    posters: drafts.posters,
    formatting: drafts.formatting,
    badgePack: drafts.badgePack,
    meta: drafts.meta,
    filterSets: drafts.filterSets,
    mediaSets: drafts.mediaSets,
    homeRows: drafts.collectionHomeRows,
    collections: drafts.collections,
    packs: drafts.packs,
    addons: drafts.addons,
    customStreams: drafts.customStreams,
    nuvioPlayback: drafts.nuvioPlayback,
    nuvioHideUnreleased: drafts.nuvioHideUnreleased,
    libraryRows: drafts.libraryRows,
    customAddons: drafts.customAddons,
  };
}

export function emptySnapshot(): TierSnapshot {
  return snapshotFromSaved({}, {}, null);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// The save body for an edit: only areas that differ from what the server
// holds, keys only when genuinely new or changed, and the tier only when the
// user switched it. Null means nothing to save (the dirty check).
export function editSaveBody(input: {
  current: TierSnapshot;
  saved: TierSnapshot;
  savedName: string | null;
  savedTier: TierId;
  tier: TierId;
  providerServices: string[];
  clearKeys: string[];
}): Record<string, unknown> | null {
  const { current, saved } = input;
  const savedKeys = saved.keys as Record<string, string | undefined>;
  const changedKeys = Object.fromEntries(
    Object.entries(current.keys).filter(([field, value]) => {
      const text = typeof value === 'string' ? value : '';
      return text.trim().length > 0 && savedKeys[field] !== text;
    }),
  ) as SetupKeysDraft;
  const body = buildEditSaveBody({
    keys: changedKeys,
    clearKeys: input.clearKeys,
    providerServices: input.providerServices,
    name: current.name,
    savedName: input.savedName,
    platform: current.platform,
    rdCatalog: current.rdCatalog,
    destinationTouched: current.platform !== saved.platform || current.rdCatalog !== saved.rdCatalog,
    posters: current.posters,
    postersTouched: !same(current.posters, saved.posters),
    formatting: current.formatting,
    formattingTouched: !same(current.formatting, saved.formatting),
    badgePack: current.badgePack,
    badgeTouched: !same(current.badgePack, saved.badgePack),
    meta: current.meta,
    metaTouched: !same(current.meta, saved.meta),
    filterSets: current.filterSets,
    mediaSets: current.mediaSets,
    filtersTouched: !same(current.filterSets, saved.filterSets) || !same(current.mediaSets, saved.mediaSets),
    homeRows: current.homeRows,
    homeRowsTouched: !same(current.homeRows, saved.homeRows),
    collections: current.collections,
    collectionsTouched: !same(current.collections, saved.collections) || !same(current.packs, saved.packs),
    packs: current.packs,
    addons: current.addons,
    addonsTouched: !same(current.addons, saved.addons),
    customStreams: current.customStreams,
    customStreamsTouched: !same(current.customStreams, saved.customStreams),
    nuvioPlayback: current.nuvioPlayback,
    nuvioPlaybackTouched: !same(current.nuvioPlayback, saved.nuvioPlayback),
    nuvioHideUnreleased: current.nuvioHideUnreleased,
    nuvioHideUnreleasedTouched: current.nuvioHideUnreleased !== saved.nuvioHideUnreleased,
    libraryRowsConfig: libraryRowsEditConfig(current.libraryRows, saved.libraryRows),
    customAddons: current.customAddons,
    customAddonsTouched: !same(current.customAddons, saved.customAddons),
  });
  if (input.tier === input.savedTier) return body;
  return { ...(body ?? {}), tier: input.tier };
}

// Pages call this every render in edit mode; it reports only when the content
// actually changed, so the container's dirty check stays cheap and stable.
export function useEditSnapshot(edit: EditMode | undefined, snapshot: TierSnapshot) {
  const json = JSON.stringify(snapshot);
  useEffect(() => {
    if (edit && !edit.locked) edit.onSnapshot(snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, edit?.locked]);
}

// Edit mode seeds the stepped pages through the same draft shape they restore
// from, so a page has exactly one way to start from existing values.
function customBadge(snapshot: TierSnapshot): { badgePack: string; customBadgeUrl: string } {
  return {
    badgePack: snapshot.badgePack.pack,
    customBadgeUrl: snapshot.badgePack.pack === 'custom' ? snapshot.badgePack.url : '',
  };
}

export function snapshotToPartialDraft(snapshot: TierSnapshot): PartialDraft {
  return {
    name: snapshot.name,
    keys: snapshot.keys,
    formatting: snapshot.formatting,
    posters: snapshot.posters,
    homeRows: snapshot.homeRows,
    filterSets: snapshot.filterSets,
    mediaSets: snapshot.mediaSets,
    meta: snapshot.meta,
    ...customBadge(snapshot),
    watchlist: {},
    addons: snapshot.addons,
    customStreams: snapshot.customStreams,
    nuvioPlayback: snapshot.nuvioPlayback,
    nuvioHideUnreleased: snapshot.nuvioHideUnreleased,
    libraryRows: snapshot.libraryRows,
    customAddons: snapshot.customAddons,
    platform: snapshot.platform,
    pushConn: snapshot.connection,
    stagedImport: null,
  };
}

export function snapshotToFullDraft(snapshot: TierSnapshot): FullDraft {
  return {
    platform: snapshot.platform,
    rdCatalog: snapshot.rdCatalog,
    name: snapshot.name,
    keys: snapshot.keys,
    formatting: snapshot.formatting,
    posters: snapshot.posters,
    homeRows: snapshot.homeRows,
    ...customBadge(snapshot),
    collections: snapshot.collections,
    packs: snapshot.packs,
    meta: snapshot.meta,
    filterSets: snapshot.filterSets,
    addons: snapshot.addons,
    customStreams: snapshot.customStreams,
    watchlist: {},
    nuvioPlayback: snapshot.nuvioPlayback,
    nuvioHideUnreleased: snapshot.nuvioHideUnreleased,
    libraryRows: snapshot.libraryRows,
    customAddons: snapshot.customAddons,
    stagedImport: null,
    pushConn: snapshot.connection,
  };
}

// A non-custom pack keeps the URL it was saved with, so an untouched pack is
// never reported as a change.
export function badgeForSnapshot(seed: TierSnapshot, pack: string, customUrl: string, packUrl: (id: string) => string): { pack: string; url: string } {
  if (pack === 'custom') return { pack, url: customUrl };
  if (pack === seed.badgePack.pack) return { pack, url: seed.badgePack.url };
  return { pack, url: packUrl(pack) };
}
