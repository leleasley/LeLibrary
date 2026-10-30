import { useEffect, useState } from 'react';
import { useNuvioCreatePrefill } from '@/features/setup/nuvio/prefill';
import { Accordion } from '@/features/setup/shared/Accordion';
import { ConfirmModal } from '@/features/setup/shared/Modal';
import { useWizardStep } from '@/features/setup/shared/WizardStepper';
import { ListKey, ProviderKeys, RdCatalogSelect } from '@/features/setup/shared/sections';
import { TierProgress } from '@/features/setup/shared/tier/TierProgress';
import { BadgePackStrip, StreamStylePicker, TierMetadata, usePresetPicker } from '@/features/setup/shared/tier/TierPickers';
import { TierDock, TierPreviewPanel } from '@/features/setup/shared/tier/TierPreview';
import { PosterWall, TierHero, TierStep, TierWizardNav } from '@/features/setup/shared/tier/TierChrome';
import '@/features/setup/shared/tier/tier.css';
import { badgeForSnapshot, snapshotToFullDraft, useEditSnapshot, type EditMode } from '@/features/setup/shared/edit-mode';
import { EMPTY_METADATA_EXTRAS, MetadataExtras, type MetadataExtrasDraft } from '@/features/setup/full/MetadataExtras';
import { EMPTY_FILTER_SETS, FilterSets, type FilterSetsDraft } from '@/features/setup/full/FilterSets';
import { StreamAddonsSection } from '@/features/setup/full/StreamAddonsSection';
import { CustomStreamsSection } from '@/features/setup/full/CustomStreamsSection';
import { MetadataWatchlists, WATCHLIST_ACCORDION_DESC } from '@/features/setup/full/MetadataExtras';
import { cleanWatchlistDraft, importOldSetup, type WatchlistDraftMap } from '@/features/setup/resolver/api';
import { BADGE_PACKS, DEFAULT_BADGE_PACK } from '@/features/setup/shared/BadgePackPicker';
import { toast } from '@/features/setup/shared/Toast';
import { HomeRowsSection } from '@/features/setup/full/HomeRowsSection';
import { useCustomAddonActions, type CustomAddonRef } from '@/features/setup/shared/custom-addons';
import { LibraryRowsSection } from '@/features/setup/shared/LibraryRowsSection';
import { EMPTY_LIBRARY_ROWS, withLibraryRowNames, type LibraryRowsDraft } from '@/features/setup/shared/library-rows';
import { hubPrefix, normalizeHomeOrder, ownedFranchiseMarker, type CollectionDoc, type HomeRowDoc } from '@/features/setup/shared/collection-doc';
import { CollectionStudio } from '@/features/setup/full/collections/CollectionStudio';
import { DestinationStep } from '@/features/setup/full/DestinationStep';
import { ReviewStep } from '@/features/setup/full/ReviewStep';
import { ensureFreshNuvio, nuvioTokenExpired, type PlatformConnection } from '@/features/setup/full/platform-login';
import {
  EMPTY_FORMATTING,
  FormattingSection,
  type FormattingDraft,
} from '@/features/setup/shared/FormattingSection';
import { EMPTY_POSTERS, PostersSection, type PostersDraft } from '@/features/setup/shared/PostersSection';
import { useCreateSetup } from '@/features/setup/shared/useCreateSetup';
import { clearFullDraft, loadFullDraft, saveFullDraft, type FullDraft } from '@/features/setup/full/full-draft';
import { useRestoreToast } from '@/features/setup/shared/Toast';
import { ImportSection, type ImportedPayload } from '@/features/setup/full/ImportSection';
import { NuvioPlaybackSection } from '@/features/setup/shared/NuvioPlaybackSection';
import {
  EMPTY_NUVIO_PLAYBACK,
  cleanNuvioPlayback,
  nuvioPlaybackForConfig,
  type NuvioPlaybackDraft,
} from '@/features/setup/shared/nuvio-playback';
import { NuvioUnreleasedSection } from '@/features/setup/shared/NuvioUnreleasedSection';
import {
  DEFAULT_NUVIO_HIDE_UNRELEASED,
  nuvioHideUnreleasedForConfig,
  type NuvioHideUnreleased,
} from '@/features/setup/shared/nuvio-library';
import { importedKeys, mergeImportDocs } from '@/features/setup/full/import-merge';
import type { StagedImport } from '@/features/setup/full/full-draft';
import {
  POSTER_PROVIDERS,
  PROVIDER_KEY_FIELDS,
  STREAM_PRESETS,
  cleanKeys,
  providerSelection,
  providerSelectionWithSaved,
  pruneConfig,
  type CustomStreamRow,
  type SetupKeysDraft,
} from '@/features/setup/shared/config-contract';

// Move In: the 8-step Collections spine (Docs/plans/v5.5-move-in-scoping.md).
// Stages 2-6 fill in the destination connection, provider skins, collections
// studio, home-row builder, badge packs and review. The rail stays fixed.
export const FULL_SECTIONS = [
  { id: 'destination', title: 'Destination', icon: '📍' },
  { id: 'providers', title: 'Library keys', icon: '🔌' },
  { id: 'metadata', title: 'Metadata', icon: '🎬' },
  { id: 'streams', title: 'Playback', icon: '🎚️' },
  { id: 'artwork', title: 'Artwork', icon: '🖼️' },
  { id: 'home', title: 'Home', icon: '🏠' },
  { id: 'collections', title: 'Collections', icon: '🗂️' },
  { id: 'review', title: 'Review', icon: '🔒' },
] as const;

export const FULL_SECTION_IDS = FULL_SECTIONS.map((section) => section.id);

type PlatformId = 'nuvio' | 'stremio';

const INITIAL_KEYS: SetupKeysDraft = {};

// Mirrors the other tiers: anything entered that creation hasn't consumed
// yet. The draft persists every keystroke (refresh-safe until creation or
// reset wipes it); the sidebar banner says so while this is true.
export function isFullDirty(state: {
  platform: string;
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
  stagedImport: unknown;
}): boolean {
  if (state.stagedImport !== null && state.stagedImport !== undefined) return true;
  if (state.platform !== 'nuvio' || state.rdCatalog !== 'merge') return true;
  if (state.name.trim() !== '') return true;
  if (Object.keys(cleanKeys(state.keys)).length > 0) return true;
  if (state.homeRows.length > 0 || state.collections.length > 0 || state.packs.length > 0) return true;
  if (state.addons.length > 0 || state.customStreams.length > 0) return true;
  if (Object.keys(state.watchlist ?? {}).length > 0) return true;
  if (state.customBadgeUrl.trim() !== '') return true;
  const same = (current: unknown, pristine: unknown) => JSON.stringify(current) === JSON.stringify(pristine);
  return (
    !same(state.formatting, EMPTY_FORMATTING) ||
    !same(state.posters, EMPTY_POSTERS) ||
    !same(state.meta, EMPTY_METADATA_EXTRAS) ||
    !same(state.filterSets, EMPTY_FILTER_SETS) ||
    state.badgePack !== DEFAULT_BADGE_PACK
  );
}

// A draft is stored on mount (pristine included) and Move In keeps it in
// localStorage, so "a draft exists" is not "the user typed something". Judge a
// restore by the same rule that drives the banner.
export function fullDraftHasContent(draft: FullDraft): boolean {
  return isFullDirty(draft);
}

// One page, two modes: create (draft kept in this browser, ends in Review) and
// edit (seeded from the saved setup at /{uuid}, ends in Save and publish).
export function FullSetupPage({ edit }: { edit?: EditMode } = {}) {
  const [restored] = useState<FullDraft | null>(() => (edit ? snapshotToFullDraft(edit.initial) : loadFullDraft()));
  const [platform, setPlatform] = useState<PlatformId>(restored?.platform ?? 'nuvio');
  const [pushConn, setPushConn] = useState<PlatformConnection | null>(restored?.pushConn ?? null);
  // A Nuvio login restored from a draft or an imported old setup is often past
  // its short expiry. Renew it with its refresh token so the public collection
  // browser and profile list get a working session instead of "JWT expired".
  useEffect(() => {
    if (pushConn?.platform !== 'nuvio' || !pushConn.nuvioRefresh || !nuvioTokenExpired(pushConn.nuvioToken)) return;
    let cancelled = false;
    ensureFreshNuvio(pushConn).then((next) => { if (!cancelled) setPushConn(next); }).catch(() => { /* Step 1 shows the reconnect prompt */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushConn?.nuvioToken]);
  const [rdCatalog, setRdCatalog] = useState(restored?.rdCatalog ?? 'merge');
  const [name, setName] = useState(restored?.name ?? '');
  const [keys, setKeys] = useState<SetupKeysDraft>(restored?.keys ?? INITIAL_KEYS);
  const [formatting, setFormatting] = useState<FormattingDraft>(restored?.formatting ?? EMPTY_FORMATTING);
  const [posters, setPosters] = useState<PostersDraft>(restored?.posters ?? EMPTY_POSTERS);
  const [homeRows, setHomeRows] = useState<HomeRowDoc[]>(restored?.homeRows ?? []);
  const [badgePack, setBadgePack] = useState(restored?.badgePack ?? DEFAULT_BADGE_PACK);
  // The typed custom URL lives apart from pack URLs: picking "Choose your
  // own" always opens a blank field, never the last pack's URL.
  const [customBadgeUrl, setCustomBadgeUrl] = useState(restored?.customBadgeUrl ?? '');
  const badgeUrl = badgePack === 'custom' ? customBadgeUrl : '';
  const [collections, setCollections] = useState<CollectionDoc[]>(restored?.collections ?? []);
  const [packs, setPacks] = useState<string[]>(restored?.packs ?? []);
  const [meta, setMeta] = useState<MetadataExtrasDraft>(restored?.meta ? { ...EMPTY_METADATA_EXTRAS, ...restored.meta } : EMPTY_METADATA_EXTRAS);
  const [filterSets, setFilterSets] = useState(restored?.filterSets ?? EMPTY_FILTER_SETS);
  const [addons, setAddons] = useState<string[]>(restored?.addons ?? []);
  const [customStreams, setCustomStreams] = useState<CustomStreamRow[]>(restored?.customStreams ?? []);
  // Opt-in Nuvio player choices; absent/off leaves the user's Nuvio alone.
  const [nuvioPlayback, setNuvioPlayback] = useState<NuvioPlaybackDraft>(
    restored?.nuvioPlayback ? cleanNuvioPlayback(restored.nuvioPlayback) : EMPTY_NUVIO_PLAYBACK,
  );
  const [nuvioHideUnreleased, setNuvioHideUnreleased] = useState<NuvioHideUnreleased>(
    restored?.nuvioHideUnreleased ?? DEFAULT_NUVIO_HIDE_UNRELEASED,
  );
  // Settings the Nuvio profile already has are filled in after sign-in.
  useNuvioCreatePrefill({
    enabled: !edit, platform, connection: pushConn, onConnection: setPushConn,
    playback: nuvioPlayback, setPlayback: setNuvioPlayback,
    unreleased: nuvioHideUnreleased, setUnreleased: setNuvioHideUnreleased,
  });
  const [libraryRows, setLibraryRows] = useState<LibraryRowsDraft>(restored?.libraryRows ?? EMPTY_LIBRARY_ROWS);
  const [customAddons, setCustomAddons] = useState<CustomAddonRef[]>(restored?.customAddons ?? []);
  const customAddonActions = useCustomAddonActions({
    custom: customAddons, setCustom: setCustomAddons, setKeys, addons, setAddons,
    onRemoveKey: edit?.onRemoveKey,
  });
  const [watchlist, setWatchlist] = useState<WatchlistDraftMap>(restored?.watchlist ?? {});
  // Staged old-setup import (picked in the Destination step modal, no
  // password yet): creation migrates the old row instead of starting blank.
  const [stagedImport, setStagedImport] = useState(restored?.stagedImport ?? null);

  // Folds a picked old setup into the draft the moment it is imported: its
  // settings merge, its key values fill their inputs, its collection and
  // home-row documents merge by id (never duplicating what is already here),
  // and a saved platform login reconnects. Creation afterwards is ordinary.
  function stageImport(next: StagedImport | null, payload?: ImportedPayload) {
    setStagedImport(next);
    if (!next || !payload) return;
    const { merge } = payload;
    setName((current) => current.trim() ? current : (merge.name?.trim() || current));
    if (merge.platform) setPlatform(merge.platform);
    if (merge.rdCatalog) setRdCatalog(merge.rdCatalog);
    setPosters(merge.posters);
    setFormatting(merge.formatting);
    setBadgePack(merge.badgePack);
    setCustomBadgeUrl(merge.customBadgeUrl);
    setMeta((prev) => ({ ...prev, ...merge.meta }));
    setFilterSets((prev) => ({ ...prev, ...merge.filterSets }));
    if (merge.addons.length > 0) setAddons(merge.addons);
    // Collection/home-row documents come from the picker payload (the old
    // account's own context docs), NOT from merge.collections: token configs
    // on v5 accounts never carry them, so reading the merge leaves the
    // studio empty even though the import succeeded.
    const docs = mergeImportDocs(collections, homeRows, payload);
    if (docs.collections) setCollections(docs.collections);
    if (docs.homeRows) setHomeRows(normalizeHomeOrder(docs.homeRows, platform));
    if (merge.packs.length > 0) {
      setPacks((prev) => (prev.length === 0 ? merge.packs : [...prev, ...merge.packs.filter((pack) => !prev.includes(pack))]));
    }
    if (Object.keys(payload.keys).length > 0) {
      setKeys((prev) => ({ ...prev, ...payload.keys }));
    }
    if (docs.homeRows) {
      const rows = docs.homeRows;
      setHomeRows((prev) => {
        if (prev.length === 0) return rows;
        const known = new Set(prev.map((row) => row.id));
        return normalizeHomeOrder([...prev, ...rows.filter((row) => !known.has(row.id))], platform);
      });
    }
    if (payload.pushConn) setPushConn(payload.pushConn);
  }

  // Ask the server for one saved key from the staged old setup. There is no
  // setup row yet at this point, so the row's own reveal endpoint cannot be
  // used; this goes back through the same email + masked id gate the import
  // picker used, and only ever fills the field that was asked for.
  async function revealSavedKey(field: keyof SetupKeysDraft): Promise<string | null> {
    if (!stagedImport) return null;
    const data = await importOldSetup({ email: stagedImport.email, idMasked: stagedImport.idMasked });
    const value = importedKeys(data)[field];
    if (!value) return null;
    setKeys((prev) => ({ ...prev, [field]: value }));
    return value;
  }
  const [confirmReset, setConfirmReset] = useState(false);
  const wizard = useWizardStep(FULL_SECTIONS.length);
  // Stay on the page after creation: the review step turns into the push
  // desk (seal + push + watchlists) once the UUID + password exist.
  const creation = useCreateSetup('full', { navigateToSetup: false });
  const pickPreset = usePresetPicker(formatting, setFormatting);

  useEffect(() => {
    if (edit) return;
    saveFullDraft({
      platform, rdCatalog, name, keys, formatting, posters, homeRows,
      badgePack, customBadgeUrl, collections, packs, meta, filterSets,
      addons, customStreams, nuvioPlayback, nuvioHideUnreleased, libraryRows, customAddons, watchlist, stagedImport, pushConn,
    });
  }, [edit, platform, rdCatalog, name, keys, formatting, posters, homeRows, badgePack, customBadgeUrl, collections, packs, meta, filterSets, addons, customStreams, nuvioPlayback, nuvioHideUnreleased, libraryRows, customAddons, watchlist, stagedImport, pushConn]);

  useRestoreToast(!edit && restored !== null && fullDraftHasContent(restored));

  const seed = edit?.initial;
  useEditSnapshot(edit, seed ? {
    ...seed, name, keys, platform, rdCatalog, connection: pushConn, posters, formatting,
    badgePack: badgeForSnapshot(seed, badgePack, customBadgeUrl, (id) => BADGE_PACKS.find((entry) => entry.id === id)?.url ?? ''),
    meta, filterSets, homeRows, collections, packs, addons, customStreams, nuvioPlayback, nuvioHideUnreleased, libraryRows, customAddons,
  } : (null as never));

  // Revealing a saved key fills this page's own field (the eye on an empty
  // saved field), exactly like typing it would.
  const revealEdit = async (field: keyof SetupKeysDraft): Promise<string | null> => {
    if (!edit) return null;
    const value = await edit.revealSaved(field);
    if (value) setKeys((prev) => ({ ...prev, [field]: value }));
    return value;
  };

  function reset() {
    setPlatform('nuvio');
    setRdCatalog('merge');
    setName('');
    setKeys(INITIAL_KEYS);
    setFormatting(EMPTY_FORMATTING);
    setPosters(EMPTY_POSTERS);
    setBadgePack(DEFAULT_BADGE_PACK);
    setCustomBadgeUrl('');
    setHomeRows([]);
    setCollections([]);
    setPacks([]);
    setMeta(EMPTY_METADATA_EXTRAS);
    setFilterSets(EMPTY_FILTER_SETS);
    setAddons([]);
    setCustomStreams([]);
    setNuvioPlayback(EMPTY_NUVIO_PLAYBACK);
    setNuvioHideUnreleased(DEFAULT_NUVIO_HIDE_UNRELEASED);
    setLibraryRows(EMPTY_LIBRARY_ROWS);
    setCustomAddons([]);
    setWatchlist({});
    setStagedImport(null);
    setPushConn(null);
    setConfirmReset(false);
    clearFullDraft();
    wizard.go(0);
  }

  // One draft builder for submit and preview so the preview can never drift
  // from what creation saves. Pre-creation watchlist connects ride in the
  // keys envelope and seal at creation like every other secret.
  function buildDraft() {
    const watchlistKeys = cleanWatchlistDraft(watchlist);
    const playback = nuvioPlaybackForConfig(nuvioPlayback);
    const hideUnreleased = nuvioHideUnreleasedForConfig(nuvioHideUnreleased);
    return {
      config: withLibraryRowNames(libraryRows, pruneConfig({
        provider: providerSelection(keys),
        wizardPlatform: platform,
        rdCatalog,
        streamPreset: formatting.preset,
        streamNameTemplate: formatting.nameTemplate,
        streamDescTemplate: formatting.descTemplate,
        posterProvider: posters.provider,
        pictoriumUrl: posters.pictoriumUrl,
        pictoriumOptions: posters.pictoriumOptions,
        customPosterTemplate: posters.customTemplate,
        nuvioBadgePack: badgePack,
        nuvioBadgeUrl: badgeUrl,
        ...(playback ? { nuvioPlayback: playback } : {}),
        ...(hideUnreleased === null ? {} : { nuvioHideUnreleased: hideUnreleased }),
        collections,
        nuvioCollectionPacks: packs,
        collectionHomeRows: homeRows,
        watchlistHomeManaged: true,
        lang: meta.lang,
        sortBy: meta.sortBy,
        libraryIdMode: meta.mainMetadata ? 'tt' : 'torbox',
        hideAnime: meta.hideAnime,
        torboxSources: meta.torboxSources,
        searchScope: meta.searchScope,
        streamNotices: meta.notices ? 'on' : 'off',
        streamNoticeTypes: meta.noticeTypes,
        filterResolutions: filterSets.resolutions,
        filterResOrder: filterSets.resolutionOrder,
        filterQualities: filterSets.qualities,
        filterSources: filterSets.sources,
        ...(parseGb(filterSets.minSizeGb) > 0 ? { filterMinSize: parseGb(filterSets.minSizeGb) } : {}),
        ...(parseGb(filterSets.maxSizeGb) > 0 ? { filterMaxSize: parseGb(filterSets.maxSizeGb) } : {}),
        ...(filterSets.cachedOnly ? { filterCachedOnly: true } : {}),
        streamAddons: addons,
        customAddons,
        customStreams,
      })),
      keys: Object.keys(watchlistKeys).length > 0
        ? { ...cleanKeys(keys), watchlist: watchlistKeys }
        : cleanKeys(keys),
    };
  }

  function submit() {
    // By submit time an import is just draft content like anything else:
    // keys filled, docs merged, logins reconnected. Ordinary creation, then
    // the old account is purged in the background.
    const draft = buildDraft();
    void creation.create(
      { name, config: draft.config, keys: draft.keys, connection: pushConn?.platform === platform ? pushConn : null },
      stagedImport ? { purgeImport: { email: stagedImport.email, idMasked: stagedImport.idMasked } } : undefined,
    ).then((ok) => { if (ok) clearFullDraft(); });
  }

  function parseGb(value: string): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function importPublicCollections(cols: CollectionDoc[]) {
    setCollections((prev) => {
      const known = new Set(prev.map((collection) => collection.id));
      return [...prev, ...cols.filter((collection) => !known.has(collection.id))];
    });
  }

  // An import hands back a live setup, so it travels the same road as a fresh
  // creation: /{uuid} with the just-created install link. (Staged old-setup
  // imports migrate at submit instead - see submit().)

  // Keys the import holds that are sitting empty here: they will not travel to
  // the new setup, and creation removes the old one, so name them.
  const missingImportedServices = (stagedImport?.services ?? []).filter(
    (service) => !String((keys as Record<string, string | undefined>)[service] ?? '').trim(),
  );
  const providerPrefix = hubPrefix(providerSelectionWithSaved(keys, edit?.savedServices ?? []));
  const ownedFranchiseOn = homeRows.some((row) => row._nativeFranchiseCollection === true);

  function toggleOwnedFranchise(on: boolean) {
    if (on) {
      if (!providerPrefix) {
        toast('Connect a debrid provider to build owned movie collections', 'error');
        return;
      }
      if (!ownedFranchiseOn) {
        setHomeRows(normalizeHomeOrder([...homeRows, ownedFranchiseMarker(homeRows.length)], platform));
      }
    } else {
      setHomeRows(normalizeHomeOrder(homeRows.filter((row) => row._nativeFranchiseCollection !== true), platform));
    }
  }
  const presetLabel = STREAM_PRESETS.find((preset) => preset.id === formatting.preset)?.name ?? formatting.preset;
  const artworkLabel = POSTER_PROVIDERS.find((p) => p.id === posters.provider)?.name ?? 'TMDB default';
  const filtersActive = filterSets.resolutions.length > 0 || filterSets.qualities.length > 0
    || filterSets.sources.length > 0 || filterSets.minSizeGb.trim() !== '' || filterSets.maxSizeGb.trim() !== ''
    || filterSets.cachedOnly || addons.length > 0 || customStreams.length > 0;

  const connected = PROVIDER_KEY_FIELDS.filter(({ field }) => (keys[field] ?? '').trim()).map(({ label }) => label.replace(/ API key$/, ''));
  const hasTmdb = Boolean((keys.tmdbApiKey ?? '').trim());
  const dirty = edit ? edit.dirty : !creation.result && isFullDirty({
    platform, rdCatalog, name, keys, formatting, posters, homeRows,
    badgePack, customBadgeUrl, collections, packs, meta, filterSets,
    addons, customStreams, watchlist, stagedImport,
  });
  const next = FULL_SECTIONS[wizard.step + 1];
  const folderCount = collections.reduce((total, collection) => total + (collection.folders || []).length, 0);

  const panel = (
    <TierPreviewPanel
      keys={keys} posters={posters} formatting={formatting} badgePack={{ pack: badgePack, url: badgeUrl }}
      rows={[
        { label: 'Destination', value: platform === 'nuvio' ? 'Nuvio' : 'Stremio' },
        { label: 'Library', value: connected.length ? connected.join(' + ') : 'Not connected yet', ok: connected.length > 0 },
        { label: 'Catalogs', value: rdCatalog === 'separate' ? 'Separate rows' : 'Combined' },
        { label: 'Name', value: name.trim() || '-' },
        { label: 'Posters', value: artworkLabel },
        { label: 'Formatting', value: presetLabel },
        { label: 'Badges', value: BADGE_PACKS.find((entry) => entry.id === badgePack)?.name ?? badgePack },
        { label: 'Home rows', value: homeRows.length > 0 ? String(homeRows.length) : '-' },
        { label: 'Collections', value: collections.length > 0 ? `${collections.length} · ${folderCount} folders` : '-' },
        ...(stagedImport ? [{ label: 'Import', value: stagedImport.label ?? stagedImport.idMasked }] : []),
        { label: 'Filters', value: filtersActive ? 'Custom' : 'Default' },
      ]}
    />
  );

  // Once created, the steps make way for the finished page (like Settle In):
  // edits made on a created setup's wizard were never saved, so a push sent
  // the setup as it was at creation. Changes go through the edit page now.
  if (!edit && creation.result) {
    return (
      <section className="setup">
        <ReviewStep
          password={creation.password} confirmation={creation.confirmation}
          busy={creation.busy} error={creation.error} backTo="/configure"
          onPassword={creation.setPassword} onConfirmation={creation.setConfirmation}
          onSubmit={submit} created={creation.result}
          name={name}
          platform={platform} pushConn={pushConn}
          counts={{
            homeRows: homeRows.filter((row) => row.enabled !== false).length,
            collections: collections.length,
            folders: folderCount,
            lang: meta.lang,
          }}
          collections={collections} onImportCollections={importPublicCollections}
        />
      </section>
    );
  }

  return (
    <section className="setup setup-wide qs qs-wizard">
      <TierProgress
        steps={FULL_SECTIONS.map((section) => ({ id: section.id, label: section.title }))}
        unsaved={dirty}
        wizard={{ active: wizard.step, onStep: wizard.go }}
      />
      {wizard.step === 0 && <PosterWall />}
      <TierHero
        eyebrow={edit ? 'MOVE IN · EDITING' : 'MOVE IN'} title="Make your library" accent="yours"
        lede={edit ? 'Your saved settings and keys are filled in below. Change anything, then save.' : 'Organize your library, choose what appears on Home and build collections. MDBList and extra stream sources are optional. Finish with one install link.'}
        facts={edit ? ['Saved keys stay hidden', 'Nothing changes until you save', 'Same install link'] : ['Eight guided steps', 'Collections and folders', 'Push straight to Nuvio or Stremio']}
        compact={wizard.step > 0}
      />
      <div className="qs-grid">
        <div className="qs-flow">
          <TierStep id="destination" index={1} title="Destination" hidden={wizard.step !== 0} lede="Where this setup gets installed. Already have a v5 setup? Bring it across instead.">
            {!edit && <ImportSection staged={stagedImport} platform={platform} onStage={stageImport} />}
            <DestinationStep
              profileName={name}
              platform={platform} onPlatform={setPlatform}
              connection={pushConn} onConnection={setPushConn}
              {...(edit ? { savedAccount: edit.savedAccount, onSavedProfile: edit.onSavedProfile } : {})}
            />
            <label className="setup-field qs-name">
              <span>Setup name</span>
              <input
                type="text" autoComplete="off" placeholder="e.g. Living room"
                value={name} onChange={(event) => setName(event.target.value)}
              />
            </label>
          </TierStep>
          <TierStep id="providers" index={2} title="Library providers" hidden={wizard.step !== 1} lede="Connect the debrid account or accounts that hold your library. Verify each key as you paste it.">
            {missingImportedServices.length > 0 && (
              <p className="setup-error" role="alert">
                From your imported setup but empty here: {missingImportedServices.join(', ')}.
                {' '}These will not be carried over, and creating this setup removes the old one.
                {' '}Press the eye to fetch each one, or paste it again.
              </p>
            )}
            {edit ? (
              <ProviderKeys
                values={keys} onChange={setKeys}
                savedServices={edit.savedServices} revealSaved={revealEdit} onRemove={edit.onRemoveKey}
              />
            ) : (
              <ProviderKeys
                values={keys} onChange={setKeys}
                savedServices={stagedImport?.services} savedScope="import"
                {...(revealSavedKey ? { revealSaved: revealSavedKey } : {})}
              />
            )}
            <div className="qs-catalogs"><RdCatalogSelect value={rdCatalog} onChange={setRdCatalog} /></div>
          </TierStep>
          <TierStep id="metadata" index={3} title="Metadata" hidden={wizard.step !== 2} lede="Keys that power posters, matching and search.">
            {edit
              ? <TierMetadata values={keys} onChange={setKeys} savedServices={edit.savedServices} revealSaved={revealEdit} />
              : <TierMetadata values={keys} onChange={setKeys} savedServices={stagedImport?.services} savedScope="import" revealSaved={revealSavedKey} />}
            <div className="qs-accordions">
              <Accordion title="Display, search & notices" desc="Language, order, main metadata, anime, search scope and stream notices." icon="🎬">
                <MetadataExtras draft={meta} onChange={setMeta} />
              </Accordion>
              <Accordion title="Optional list sources" desc="Only add an MDBList key if you want its lists or collection sources. It is not needed for your library." icon="📋">
                {edit
                  ? <ListKey value={keys.mdblistKey ?? ''} onChange={(value) => setKeys({ ...keys, mdblistKey: value })} savedServices={edit.savedServices} revealSaved={revealEdit} />
                  : <ListKey value={keys.mdblistKey ?? ''} onChange={(value) => setKeys({ ...keys, mdblistKey: value })} savedServices={stagedImport?.services} savedScope="import" revealSaved={revealSavedKey} />}
              </Accordion>
              <Accordion title="Watchlists" desc={WATCHLIST_ACCORDION_DESC} icon="🔖">
                {edit
                  ? <MetadataWatchlists uuid={edit.uuid} editToken={edit.editToken} />
                  : <MetadataWatchlists uuid={null} editToken={null} draft={watchlist} onDraft={setWatchlist} />}
              </Accordion>
            </div>
          </TierStep>
          <TierStep id="streams" index={4} title="Playback" hidden={wizard.step !== 3} lede="Tune the files returned from your connected library. Other sources are optional.">
            <div className="qs-accordions">
              <Accordion title="Library playback filters" desc="Choose which of your library files appear and how they are ordered." icon="🎚️" defaultOpen>
                <FilterSets draft={filterSets} onChange={setFilterSets} />
              </Accordion>
              <Accordion title="Optional stream add-ons" desc="Add external stream providers after your own library, if you use them." icon="🌐">
                <StreamAddonsSection
                  selected={addons} onChange={setAddons}
                  custom={customAddons} onAddCustom={customAddonActions.add} onRemoveCustom={customAddonActions.remove}
                />
              </Accordion>
              <Accordion title="Optional custom links" desc="Add direct media links for a title or episode, if you need them." icon="🔗">
                <CustomStreamsSection rows={customStreams} onChange={setCustomStreams} tmdbKey={keys.tmdbApiKey ?? ''} />
              </Accordion>
              {platform === 'nuvio' && (
                <>
                  <Accordion title="Nuvio playback" desc="Set Nuvio's auto stream selection and next-episode behaviour from here." icon="▶️">
                    <NuvioPlaybackSection value={nuvioPlayback} onChange={setNuvioPlayback} current={edit?.nuvioCurrent} />
                  </Accordion>
                  <Accordion title="Nuvio library" desc="Choose what Nuvio does with titles that have not been released yet." icon="🗓️">
                    <NuvioUnreleasedSection value={nuvioHideUnreleased} onChange={setNuvioHideUnreleased} current={edit?.nuvioCurrent} />
                  </Accordion>
                </>
              )}
            </div>
          </TierStep>
          <TierStep id="artwork" index={5} title="Artwork" hidden={wizard.step !== 4} lede="Pick a look and watch it render before you save anything.">
            <h3 className="qs-sub"><strong>Poster provider</strong><span>The live preview sits beside you</span></h3>
            <PostersSection draft={posters} keys={keys} onDraft={setPosters} onKeys={setKeys} hidePreview savedServices={edit ? edit.savedServices : stagedImport?.services} />
            <h3 className="qs-sub"><strong>Badge packs</strong><span>Nuvio</span></h3>
            <BadgePackStrip
              pack={badgePack} customUrl={customBadgeUrl}
              onChange={({ pack, url }) => { setBadgePack(pack); if (pack === 'custom') setCustomBadgeUrl(url); }}
            />
            <h3 className="qs-sub"><strong>Stream display style</strong><span>Stremio and Nuvio</span></h3>
            <StreamStylePicker draft={formatting} onPick={pickPreset}>
              <FormattingSection draft={formatting} onChange={setFormatting} templatesOnly />
            </StreamStylePicker>
          </TierStep>
          <TierStep id="home" index={6} title="Home" hidden={wizard.step !== 5} lede="The rows on your home screen.">
            <HomeRowsSection
              rows={homeRows} onChange={setHomeRows} platform={platform} prefix={providerPrefix}
              lang={meta.lang}
              hasMdblistKey={Boolean((keys.mdblistKey ?? '').trim()) || Boolean(edit?.savedServices.includes('mdblistKey'))}
            />
            <details className="advanced">
              <summary>Rename your library rows</summary>
              <div className="advanced-body"><LibraryRowsSection value={libraryRows} onChange={setLibraryRows} /></div>
            </details>
          </TierStep>
          <TierStep id="collections" index={7} title="Collections" hidden={wizard.step !== 6} lede="Folders with artwork, Quick Packs and the Nuvio public browser.">
            <CollectionStudio
              collections={collections} onChange={setCollections} providerPrefix={providerPrefix}
              platform={platform} packs={packs} onPacks={setPacks}
              ownedOn={ownedFranchiseOn} onToggleOwned={toggleOwnedFranchise}
              lang={meta.lang}
              hideAnime={meta.hideAnime === true}
              hasMdblistKey={Boolean((keys.mdblistKey ?? '').trim()) || Boolean(edit?.savedServices.includes('mdblistKey'))}
              nuvioToken={pushConn?.platform === 'nuvio' ? pushConn.nuvioToken ?? null : null}
              {...(edit && edit.savedAccount && edit.editToken ? { savedSetup: { uuid: edit.uuid, editToken: edit.editToken } } : {})}
            />
          </TierStep>
          {edit ? (
            <TierStep id="review" index={8} title="Save and publish" hidden={wizard.step !== 7} lede="Nothing changes until you save. Your install link stays the same.">
              {edit.renderFinish({})}
            </TierStep>
          ) : (
          <TierStep id="review" index={8} title="Review" hidden={wizard.step !== 7} lede="This password only guards changes. Watching never asks for it.">
            <ReviewStep
              password={creation.password} confirmation={creation.confirmation}
              busy={creation.busy} error={creation.error} backTo="/configure"
              onPassword={creation.setPassword} onConfirmation={creation.setConfirmation}
              onSubmit={submit} created={creation.result}
              name={name}
              platform={platform} pushConn={pushConn}
              counts={{
                homeRows: homeRows.filter((row) => row.enabled !== false).length,
                collections: collections.length,
                folders: folderCount,
                lang: meta.lang,
              }}
              collections={collections} onImportCollections={importPublicCollections}
            />
          </TierStep>
          )}
          <TierWizardNav
            step={wizard.step} total={FULL_SECTIONS.length}
            onBack={wizard.back} onNext={wizard.next} onReset={edit ? edit.onClearEdits : () => setConfirmReset(true)}
            {...(edit ? { resetLabel: 'Clear my edits' } : {})}
            {...(next ? { nextLabel: next.title } : {})}
          />
        </div>
        <aside className="qs-aside">{panel}</aside>
      </div>
      <TierDock hasArt={hasTmdb} label={hasTmdb ? `${artworkLabel} · ${presetLabel}` : 'Add your TMDB key to see posters'}
        next={next ? { onClick: wizard.next } : undefined}
      >
        {panel}
      </TierDock>
      <ConfirmModal
        open={confirmReset}
        title="Start over?"
        body="This clears everything you typed on this page. Saved setups are untouched."
        confirmLabel="Clear it"
        danger
        onConfirm={reset}
        onCancel={() => setConfirmReset(false)}
      />
    </section>
  );
}
