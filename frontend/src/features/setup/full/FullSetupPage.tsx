import { useEffect, useState } from 'react';
import { searchOptionsForConfig, searchSummaryParts } from '@/features/setup/shared/search-options';
import { SearchOptionsSection } from '@/features/setup/shared/SearchOptionsSection';
import { useNuvioCreatePrefill } from '@/features/setup/nuvio/prefill';
import { Accordion } from '@/features/setup/shared/Accordion';
import { ConfirmModal } from '@/features/setup/shared/Modal';
import { useWizardStep } from '@/features/setup/shared/WizardStepper';
import { ListKey, ProviderKeys, RdCatalogSelect } from '@/features/setup/shared/sections';
import { TierProgress } from '@/features/setup/shared/tier/TierProgress';
import { BadgePackStrip, StreamStylePicker, TierMetadata, usePresetPicker } from '@/features/setup/shared/tier/TierPickers';
import { TierDock, useTierPreview } from '@/features/setup/shared/tier/TierPreview';
import { PosterWall, TierHero, TierStep, TierWizardNav } from '@/features/setup/shared/tier/TierChrome';
import '@/features/setup/shared/tier/tier.css';
import { badgeForSnapshot, snapshotToFullDraft, useEditSnapshot, type EditMode } from '@/features/setup/shared/edit-mode';
import { EMPTY_METADATA_EXTRAS, MetadataExtras, type MetadataExtrasDraft } from '@/features/setup/full/MetadataExtras';
import { EMPTY_FILTER_SETS, FilterSets, filterSummaryParts, type FilterSetsDraft } from '@/features/setup/full/FilterSets';
import { StreamAddonsSection } from '@/features/setup/full/StreamAddonsSection';
import { CustomStreamsSection } from '@/features/setup/full/CustomStreamsSection';
import { MetadataWatchlists, WATCHLIST_ACCORDION_DESC } from '@/features/setup/full/MetadataExtras';
import { cleanWatchlistDraft, type WatchlistDraftMap } from '@/features/setup/resolver/api';
import { BADGE_PACKS, DEFAULT_BADGE_PACK } from '@/features/setup/shared/BadgePackPicker';
import { toast } from '@/features/setup/shared/Toast';
import { HomeRowsSection } from '@/features/setup/full/HomeRowsSection';
import { useCustomAddonActions, type CustomAddonRef } from '@/features/setup/shared/custom-addons';
import { LibraryRowsSection } from '@/features/setup/shared/LibraryRowsSection';
import { EMPTY_LIBRARY_ROWS, withLibraryRowNames, type LibraryRowsDraft } from '@/features/setup/shared/library-rows';
import { hubPrefix, normalizeHomeOrder, ownedFranchiseMarker, OWNED_DEFAULT_TITLE, type CollectionDoc, type HomeRowDoc } from '@/features/setup/shared/collection-doc';
import { CollectionStudio } from '@/features/setup/full/collections/CollectionStudio';
import { DestinationStep } from '@/features/setup/full/DestinationStep';
import { ReviewStep } from '@/features/setup/full/ReviewStep';
import { CreatingSetup } from '@/features/setup/shared/CreatingSetup';
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
import { same } from '@/features/setup/shared/same';

// Move In: the 8-step Collections spine (Docs/plans/v5.5-move-in-scoping.md).
// Stages 2-6 fill in the destination connection, provider skins, collections
// studio, home-row builder, badge packs and review. The rail stays fixed.
export const FULL_SECTIONS = [
  { id: 'connect', title: 'Connect', icon: '📍' },
  { id: 'setup', title: 'Setup', icon: '⚙️' },
  { id: 'home', title: 'Home', icon: '🏠' },
  { id: 'collections', title: 'Collections', icon: '🗂️' },
  { id: 'review', title: 'Protect', icon: '🔒' },
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
}): boolean {
  if (state.platform !== 'nuvio' || state.rdCatalog !== 'merge') return true;
  if (state.name.trim() !== '') return true;
  if (Object.keys(cleanKeys(state.keys)).length > 0) return true;
  if (state.homeRows.length > 0 || state.collections.length > 0 || state.packs.length > 0) return true;
  if (state.addons.length > 0 || state.customStreams.length > 0) return true;
  if (Object.keys(state.watchlist ?? {}).length > 0) return true;
  if (state.customBadgeUrl.trim() !== '') return true;
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
// `previewOpen` starts with the Preview open (tests only).
export function FullSetupPage({ edit, previewOpen }: { edit?: EditMode; previewOpen?: boolean } = {}) {
  const [restored] = useState<FullDraft | null>(() => (edit ? snapshotToFullDraft(edit.initial) : loadFullDraft()));
  const [platform, setPlatform] = useState<PlatformId>(restored?.platform ?? 'nuvio');
  const [pushConn, setPushConn] = useState<PlatformConnection | null>(restored?.pushConn ?? null);
  // A Nuvio login restored from a draft or a saved setup is often past
  // its short expiry. Renew it with its refresh token so the public collection
  // browser and profile list get a working session instead of "JWT expired".
  useEffect(() => {
    if (pushConn?.platform !== 'nuvio' || !pushConn.nuvioRefresh || !nuvioTokenExpired(pushConn.nuvioToken)) return;
    let cancelled = false;
    ensureFreshNuvio(pushConn).then((next) => { if (!cancelled) setPushConn(next); }).catch(() => { /* Step 1 shows the reconnect prompt */ });
    return () => { cancelled = true; };
    // Keyed on the token, not the connection, so the refreshed connection this
    // sets cannot re-run it.
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
  const [confirmReset, setConfirmReset] = useState(false);
  const wizard = useWizardStep(FULL_SECTIONS.length);
  // Stay on the page after creation: the review step turns into the push
  // desk (seal + push + watchlists) once the UUID + password exist.
  const creation = useCreateSetup('full', { navigateToSetup: false, loader: true });
  const pickPreset = usePresetPicker(formatting, setFormatting);

  useEffect(() => {
    if (edit) return;
    saveFullDraft({
      platform, rdCatalog, name, keys, formatting, posters, homeRows,
      badgePack, customBadgeUrl, collections, packs, meta, filterSets,
      addons, customStreams, nuvioPlayback, nuvioHideUnreleased, libraryRows, customAddons, watchlist, pushConn,
    });
  }, [edit, platform, rdCatalog, name, keys, formatting, posters, homeRows, badgePack, customBadgeUrl, collections, packs, meta, filterSets, addons, customStreams, nuvioPlayback, nuvioHideUnreleased, libraryRows, customAddons, watchlist, pushConn]);

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
        searchOptions: searchOptionsForConfig(meta.searchOptions) ?? undefined,
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

  // The Preview reads the same draft creation saves (its config, never its keys).
  const preview = useTierPreview(edit, {
    tier: 'full', platform, config: () => buildDraft().config, keys, formatting,
    badgePack: { pack: badgePack, url: badgeUrl }, posterStyle: posters.provider, name,
  }, previewOpen);

  function submit() {
    const draft = buildDraft();
    void creation.create(
      { name, config: draft.config, keys: draft.keys, connection: pushConn?.platform === platform ? pushConn : null },
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

  const providerPrefix = hubPrefix(providerSelectionWithSaved(keys, edit?.savedServices ?? []));
  const ownedMarker = homeRows.find((row) => row._nativeFranchiseCollection === true) ?? null;
  const ownedFranchiseOn = ownedMarker !== null;

  function toggleOwnedFranchise(on: boolean, slot?: number) {
    if (on) {
      if (!providerPrefix) {
        toast('Connect a debrid provider to build owned movie collections', 'error');
        return;
      }
      if (!ownedFranchiseOn) {
        // A new Movie Collections card goes after the collections already there,
        // unless the caller names its place (LeLibrary Special: under the Hub).
        setHomeRows(normalizeHomeOrder([...homeRows, ownedFranchiseMarker(homeRows.length, slot ?? collections.length)], platform));
      }
    } else {
      setHomeRows(normalizeHomeOrder(homeRows.filter((row) => row._nativeFranchiseCollection !== true), platform));
    }
  }

  // Movie Collections on the Collections page (Nuvio): its slot and name live
  // on the marker row.
  function updateOwnedFranchise(patch: { slot?: number | null; title?: string }) {
    setHomeRows((rows) => rows.map((row) => {
      if (row._nativeFranchiseCollection !== true) return row;
      const next: HomeRowDoc = { ...row };
      if (patch.slot !== undefined) {
        if (patch.slot === null) delete next.collectionSlot;
        else next.collectionSlot = patch.slot;
      }
      if (patch.title !== undefined) {
        // Empty = Nuvio's own name for it; anything typed renames it.
        const title = patch.title.slice(0, 80);
        next.title = title.trim() ? title : OWNED_DEFAULT_TITLE;
        next.customTitle = Boolean(title.trim());
      }
      return next;
    }));
  }
  const presetLabel = STREAM_PRESETS.find((preset) => preset.id === formatting.preset)?.name ?? formatting.preset;
  const artworkLabel = POSTER_PROVIDERS.find((p) => p.id === posters.provider)?.name ?? 'TMDB default';

  const connected = PROVIDER_KEY_FIELDS.filter(({ field }) => (keys[field] ?? '').trim()).map(({ label }) => label.replace(/ API key$/, ''));
  const hasTmdb = Boolean((keys.tmdbApiKey ?? '').trim());
  const dirty = edit ? edit.dirty : !creation.result && isFullDirty({
    platform, rdCatalog, name, keys, formatting, posters, homeRows,
    badgePack, customBadgeUrl, collections, packs, meta, filterSets,
    addons, customStreams, watchlist,
  });
  const next = FULL_SECTIONS[wizard.step + 1];
  const folderCount = collections.reduce((total, collection) => total + (collection.folders || []).length, 0);

  return (
    <section className="setup setup-wide qs qs-tier qs-wizard">
      <TierProgress
        steps={FULL_SECTIONS.map((section) => ({ id: section.id, label: edit && section.id === 'review' ? 'Save' : section.title }))}
        unsaved={dirty}
        wizard={{ active: wizard.step, onStep: wizard.go }}
        save={edit && !edit.locked ? { onSave: edit.onSave, onSaveAndPush: edit.onSaveAndPush, pushTarget: edit.pushTarget, busy: edit.saving || edit.pushing } : null}
      />
      {wizard.step === 0 && <PosterWall />}
      <TierHero
        eyebrow={edit ? 'MOVE IN · EDITING' : 'MOVE IN'} title="Make your library" accent="yours"
        lede={edit ? 'Your saved settings and keys are filled in below. Change anything, then save.' : 'Organize your library, choose what appears on Home and build collections. MDBList and extra stream sources are optional. Finish with one install link.'}
        facts={edit ? ['Saved keys stay hidden', 'Nothing changes until you save', 'Same install link'] : ['Five short pages', 'Collections and folders', 'Push straight to Nuvio or Stremio']}
        compact={wizard.step > 0}
      />
      <div className="qs-grid">
        <div className="qs-flow">
          <TierStep id="connect" index={1} title="Connect" hidden={wizard.step !== 0} lede="Where this setup gets installed.">
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
          <TierStep id="setup" index={2} title="Setup" hidden={wizard.step !== 1} lede="Everything about your library in one place. Open a section to change it; each one shows where it stands.">
            <div className="qs-accordions qs-setup-page">
              <Accordion title="Integrations" icon="🔌"
                summary={[connected.length ? connected.join(' + ') : 'No library yet', hasTmdb || edit?.savedServices.includes('tmdbApiKey') ? 'TMDB key added' : 'TMDB key needed']}>
                <h3 className="qs-sub"><strong>Library providers</strong><span>Debrid</span></h3>
                {edit ? (
                  <ProviderKeys
                    values={keys} onChange={setKeys}
                    savedServices={edit.savedServices} revealSaved={revealEdit} onRemove={edit.onRemoveKey}
                  />
                ) : (
                  <ProviderKeys values={keys} onChange={setKeys} />
                )}
                <div className="qs-catalogs"><RdCatalogSelect value={rdCatalog} onChange={setRdCatalog} /></div>
                {edit
                  ? <TierMetadata values={keys} onChange={setKeys} savedServices={edit.savedServices} revealSaved={revealEdit} />
                  : <TierMetadata values={keys} onChange={setKeys} />}
                <h3 className="qs-sub"><strong>MDBList</strong><span>Optional</span></h3>
                {edit
                  ? <ListKey value={keys.mdblistKey ?? ''} onChange={(value) => setKeys({ ...keys, mdblistKey: value })} savedServices={edit.savedServices} revealSaved={revealEdit} />
                  : <ListKey value={keys.mdblistKey ?? ''} onChange={(value) => setKeys({ ...keys, mdblistKey: value })} />}
                <p className="setup-hint qs-note">Want what you watch on MDBList? In Nuvio open Settings, then MDBList, then Connect, and approve the code on mdblist.com. Nuvio then scrobbles for you. The key here only powers lists and ratings in LeLibrary.</p>
                <h3 className="qs-sub"><strong>Watchlists</strong><span>Optional</span></h3>
                {edit
                  ? <MetadataWatchlists uuid={edit.uuid} editToken={edit.editToken} />
                  : <MetadataWatchlists uuid={null} editToken={null} draft={watchlist} onDraft={setWatchlist} />}
              </Accordion>
              <Accordion title="Streams" icon="🎚️"
                summary={[...filterSummaryParts(filterSets).slice(0, 2), addons.length + customAddons.length > 0 ? 'Extra sources on' : 'Library only']}>
                <h3 className="qs-sub"><strong>Library playback filters</strong><span>Resolutions, qualities and files</span></h3>
                <FilterSets draft={filterSets} onChange={setFilterSets} />
                <h3 className="qs-sub"><strong>Optional stream add-ons</strong><span>Sources beyond your library</span></h3>
                <StreamAddonsSection
                  selected={addons} onChange={setAddons}
                  custom={customAddons} onAddCustom={customAddonActions.add} onRemoveCustom={customAddonActions.remove}
                />
                <h3 className="qs-sub"><strong>Optional custom links</strong><span>A direct link for one title</span></h3>
                <CustomStreamsSection rows={customStreams} onChange={setCustomStreams} tmdbKey={keys.tmdbApiKey ?? ''} />
              </Accordion>
              <Accordion title="Search" icon="🔎" summary={searchSummaryParts(meta.searchScope, meta.searchOptions)}>
                <SearchOptionsSection
                  scope={meta.searchScope} onScope={(searchScope) => setMeta({ ...meta, searchScope })}
                  value={meta.searchOptions} onChange={(searchOptions) => setMeta({ ...meta, searchOptions })}
                  hideAnime={meta.hideAnime}
                />
              </Accordion>
              <Accordion title="Posters" icon="🖼️" summary={[artworkLabel]}>
                <PostersSection draft={posters} keys={keys} onDraft={setPosters} onKeys={setKeys} savedServices={edit?.savedServices} />
              </Accordion>
              <Accordion title="Formatting" icon="🎨" summary={[presetLabel, BADGE_PACKS.find((entry) => entry.id === badgePack)?.name ?? badgePack]}>
                <h3 className="qs-sub"><strong>Badge packs</strong><span>Nuvio</span></h3>
                <BadgePackStrip
                  pack={badgePack} customUrl={customBadgeUrl}
                  onChange={({ pack, url }) => { setBadgePack(pack); if (pack === 'custom') setCustomBadgeUrl(url); }}
                />
                <h3 className="qs-sub"><strong>Stream display style</strong><span>Stremio and Nuvio</span></h3>
                <StreamStylePicker draft={formatting} onPick={pickPreset}>
                  <FormattingSection draft={formatting} onChange={setFormatting} templatesOnly />
                </StreamStylePicker>
              </Accordion>
              <Accordion title="Preferences" icon="🧭" desc="Language, order, anime, notices, row names and Nuvio playback.">
                <MetadataExtras draft={meta} onChange={setMeta} />
                <h3 className="qs-sub"><strong>Library row names</strong><span>My Movies, My Shows, My Anime</span></h3>
                <LibraryRowsSection value={libraryRows} onChange={setLibraryRows} />
                {platform === 'nuvio' && (
                  <>
                    <h3 className="qs-sub"><strong>Nuvio playback</strong><span>Auto stream selection and next episode</span></h3>
                    <NuvioPlaybackSection value={nuvioPlayback} onChange={setNuvioPlayback} current={edit?.nuvioCurrent} />
                    <h3 className="qs-sub"><strong>Nuvio library</strong><span>Unreleased titles</span></h3>
                    <NuvioUnreleasedSection value={nuvioHideUnreleased} onChange={setNuvioHideUnreleased} current={edit?.nuvioCurrent} />
                  </>
                )}
              </Accordion>
            </div>
          </TierStep>
          <TierStep id="home" index={3} title="Home" hidden={wizard.step !== 2} lede="The rows on your home screen.">
            <HomeRowsSection
              rows={homeRows} onChange={setHomeRows} platform={platform} prefix={providerPrefix}
              lang={meta.lang} ownedInCollections
              hasMdblistKey={Boolean((keys.mdblistKey ?? '').trim()) || Boolean(edit?.savedServices.includes('mdblistKey'))}
            />
          </TierStep>
          <TierStep id="collections" index={4} title="Collections" hidden={wizard.step !== 3} lede="Folders with artwork, Quick Packs and the Nuvio public browser.">
            <CollectionStudio
              collections={collections} onChange={setCollections} providerPrefix={providerPrefix}
              platform={platform} packs={packs} onPacks={setPacks}
              ownedOn={ownedFranchiseOn} onToggleOwned={toggleOwnedFranchise}
              owned={platform === 'nuvio' && ownedMarker ? { slot: ownedMarker.collectionSlot ?? null, title: ownedMarker.customTitle ? ownedMarker.title : '' } : null}
              onOwned={updateOwnedFranchise}
              lang={meta.lang}
              hideAnime={meta.hideAnime === true}
              hasMdblistKey={Boolean((keys.mdblistKey ?? '').trim()) || Boolean(edit?.savedServices.includes('mdblistKey'))}
              nuvioToken={pushConn?.platform === 'nuvio' ? pushConn.nuvioToken ?? null : null}
              {...(edit && edit.savedAccount && edit.editToken ? { savedSetup: { uuid: edit.uuid, editToken: edit.editToken } } : {})}
            />
          </TierStep>
          {edit ? (
            <TierStep id="review" index={5} title="Save and publish" hidden={wizard.step !== 4} lede="Nothing changes until you save. Your install link stays the same.">
              {edit.renderFinish({})}
            </TierStep>
          ) : (
          <TierStep id="review" index={5} title="Protect your setup" hidden={wizard.step !== 4} lede="This password only guards changes. Watching never asks for it.">
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
      </div>
      <TierDock hasArt={hasTmdb} label={hasTmdb ? `${artworkLabel} · ${presetLabel}` : 'Add your TMDB key to see posters'}
        next={next ? { onClick: wizard.next } : undefined} onPreview={preview.openPreview}
      />
      {preview.modal}
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
