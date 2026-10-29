import { useEffect, useState } from 'react';
import { useNuvioCreatePrefill } from '@/features/setup/nuvio/prefill';
import { Link } from 'react-router-dom';
import { Accordion } from '@/features/setup/shared/Accordion';
import { useRestoreToast } from '@/features/setup/shared/Toast';
import { SetupCreatedModal } from '@/features/setup/shared/SetupCreatedModal';
import { PublishPanel } from '@/features/setup/shared/PublishPanel';
import { ConfirmModal } from '@/features/setup/shared/Modal';
import { useWizardStep } from '@/features/setup/shared/WizardStepper';
import { ListKey, ProviderKeys } from '@/features/setup/shared/sections';
import { TierProgress } from '@/features/setup/shared/tier/TierProgress';
import { BadgePackStrip, StreamStylePicker, TierMetadata, usePresetPicker } from '@/features/setup/shared/tier/TierPickers';
import { TierInstall } from '@/features/setup/shared/tier/TierInstall';
import { TierDock, TierPreviewPanel } from '@/features/setup/shared/tier/TierPreview';
import { PosterWall, TierHero, TierStep, TierWizardNav } from '@/features/setup/shared/tier/TierChrome';
import '@/features/setup/shared/tier/tier.css';
import { badgeForSnapshot, snapshotToPartialDraft, useEditSnapshot, type EditMode } from '@/features/setup/shared/edit-mode';
import { EMPTY_FILTER_SETS, FilterSets, type FilterSetsDraft } from '@/features/setup/full/FilterSets';
import { EMPTY_MEDIA_SETS, FilterMediaSets, type MediaSetsDraft } from '@/features/setup/partial/FilterMediaSets';
import { DEFAULT_BADGE_PACK, BADGE_PACKS } from '@/features/setup/shared/BadgePackPicker';
import {
  EMPTY_METADATA_EXTRAS,
  MetadataExtras,
  MetadataWatchlists,
  WATCHLIST_ACCORDION_DESC,
  type MetadataExtrasDraft,
} from '@/features/setup/full/MetadataExtras';
import { cleanWatchlistDraft, type WatchlistDraftMap } from '@/features/setup/resolver/api';
import { HomeRowsSection } from '@/features/setup/full/HomeRowsSection';
import { useCustomAddonActions, type CustomAddonRef } from '@/features/setup/shared/custom-addons';
import { LibraryRowsSection } from '@/features/setup/shared/LibraryRowsSection';
import { EMPTY_LIBRARY_ROWS, withLibraryRowNames, type LibraryRowsDraft } from '@/features/setup/shared/library-rows';
import {
  EMPTY_FORMATTING,
  FormattingSection,
  type FormattingDraft,
} from '@/features/setup/shared/FormattingSection';
import { EMPTY_POSTERS, PostersSection, type PostersDraft } from '@/features/setup/shared/PostersSection';
import { useCreateSetup } from '@/features/setup/shared/useCreateSetup';
import { clearPartialDraft, loadPartialDraft, savePartialDraft, type PartialDraft } from '@/features/setup/partial/partial-draft';
import { hubPrefix, normalizeHomeOrder, type HomeRowDoc } from '@/features/setup/shared/collection-doc';
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
import { StreamAddonsSection } from '@/features/setup/full/StreamAddonsSection';
import { CustomStreamsSection } from '@/features/setup/full/CustomStreamsSection';
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
import { DestinationStep } from '@/features/setup/full/DestinationStep';
import { ImportSection, type ImportedPayload } from '@/features/setup/full/ImportSection';
import { usePlatformPush } from '@/features/setup/shared/usePlatformPush';
import { toast } from '@/features/setup/shared/Toast';
import type { PlatformConnection } from '@/features/setup/full/platform-login';
import type { StagedImport } from '@/features/setup/full/full-draft';

// Settle In builds on the library-first Quick Look with Home rows, playback
// controls and artwork. External sources and list providers remain optional.
// There is deliberately no Collections studio; collections are built in Move In.
export const PARTIAL_SECTIONS = [
  { id: 'destination', title: 'Destination', icon: '📍' },
  { id: 'providers', title: 'Providers', icon: '🔌' },
  { id: 'metadata', title: 'Metadata', icon: '🎬' },
  { id: 'streams', title: 'Playback', icon: '🎚️' },
  { id: 'artwork', title: 'Posters', icon: '🖼️' },
  { id: 'stream-look', title: 'Formatting', icon: '🎨' },
  { id: 'home-rows', title: 'Home rows', icon: '🏠' },
  { id: 'password', title: 'Protect your setup', icon: '🔒' },
] as const;

export const PARTIAL_SECTION_IDS = PARTIAL_SECTIONS.map((section) => section.id);

const INITIAL_KEYS: SetupKeysDraft = {};

// Mirrors Quick Look: anything entered that creation hasn't consumed yet.
// The draft persists every keystroke (refresh-safe until creation or reset
// wipes it); the sidebar banner says so while this is true.
export function isPartialDirty(state: {
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
  addons?: string[];
  customStreams?: CustomStreamRow[];
}): boolean {
  if (state.name.trim() !== '') return true;
  if (Object.keys(cleanKeys(state.keys)).length > 0) return true;
  if (state.homeRows.length > 0) return true;
  if ((state.addons ?? []).length > 0 || (state.customStreams ?? []).length > 0) return true;
  if (Object.keys(state.watchlist ?? {}).length > 0) return true;
  if (state.customBadgeUrl.trim() !== '') return true;
  const same = (current: unknown, pristine: unknown) => JSON.stringify(current) === JSON.stringify(pristine);
  return (
    !same(state.formatting, EMPTY_FORMATTING) ||
    !same(state.posters, EMPTY_POSTERS) ||
    !same(state.filterSets, EMPTY_FILTER_SETS) ||
    !same(state.mediaSets, EMPTY_MEDIA_SETS) ||
    !same(state.meta, EMPTY_METADATA_EXTRAS) ||
    state.badgePack !== DEFAULT_BADGE_PACK
  );
}

function parseGb(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

// A draft is stored on mount (pristine included) and Partial keeps it in
// localStorage, so "a draft exists" is not "the user typed something". Judge a
// restore by the same rule that drives the banner.
export function partialDraftHasContent(draft: PartialDraft): boolean {
  return isPartialDirty(draft);
}

// One page, two modes: create (draft kept in this browser, ends in Create) and
// edit (seeded from the saved setup at /{uuid}, ends in Save and publish).
export function PartialSetupPage({ edit }: { edit?: EditMode } = {}) {
  const [restored] = useState<PartialDraft | null>(() => (edit ? snapshotToPartialDraft(edit.initial) : loadPartialDraft()));
  const [name, setName] = useState(restored?.name ?? '');
  const [keys, setKeys] = useState<SetupKeysDraft>(restored?.keys ?? INITIAL_KEYS);
  const [formatting, setFormatting] = useState<FormattingDraft>(restored?.formatting ?? EMPTY_FORMATTING);
  const [posters, setPosters] = useState<PostersDraft>(restored?.posters ?? EMPTY_POSTERS);
  const [homeRows, setHomeRows] = useState<HomeRowDoc[]>(restored?.homeRows ?? []);
  const [filterSets, setFilterSets] = useState(restored?.filterSets ?? EMPTY_FILTER_SETS);
  const [mediaSets, setMediaSets] = useState(restored?.mediaSets ?? EMPTY_MEDIA_SETS);
  const [meta, setMeta] = useState<MetadataExtrasDraft>(restored?.meta ? { ...EMPTY_METADATA_EXTRAS, ...restored.meta } : EMPTY_METADATA_EXTRAS);
  const [badgePack, setBadgePack] = useState(restored?.badgePack ?? DEFAULT_BADGE_PACK);
  const [customBadgeUrl, setCustomBadgeUrl] = useState(restored?.customBadgeUrl ?? '');
  const [watchlist, setWatchlist] = useState<WatchlistDraftMap>(restored?.watchlist ?? {});
  const [addons, setAddons] = useState<string[]>(restored?.addons ?? []);
  const [customStreams, setCustomStreams] = useState<CustomStreamRow[]>(restored?.customStreams ?? []);
  // Nuvio player choices. Off by default: an untouched setup leaves whatever
  // the user already has in Nuvio alone.
  const [nuvioPlayback, setNuvioPlayback] = useState<NuvioPlaybackDraft>(
    restored?.nuvioPlayback ? cleanNuvioPlayback(restored.nuvioPlayback) : EMPTY_NUVIO_PLAYBACK,
  );
  const [nuvioHideUnreleased, setNuvioHideUnreleased] = useState<NuvioHideUnreleased>(
    restored?.nuvioHideUnreleased ?? DEFAULT_NUVIO_HIDE_UNRELEASED,
  );
  const [libraryRows, setLibraryRows] = useState<LibraryRowsDraft>(restored?.libraryRows ?? EMPTY_LIBRARY_ROWS);
  const [customAddons, setCustomAddons] = useState<CustomAddonRef[]>(restored?.customAddons ?? []);
  const customAddonActions = useCustomAddonActions({
    custom: customAddons, setCustom: setCustomAddons, setKeys, addons, setAddons,
    onRemoveKey: edit?.onRemoveKey,
  });
  // Where this setup is watched, and the login the end-of-flow push uses.
  // Settle In has no Destination step, so the player is chosen on the publish
  // desk; it still has to survive a refresh like every other choice.
  const [platform, setPlatform] = useState<'nuvio' | 'stremio'>(restored?.platform ?? 'nuvio');
  const [connection, setConnection] = useState<PlatformConnection | null>(restored?.pushConn ?? null);
  // Settings the Nuvio profile already has are filled in after sign-in.
  useNuvioCreatePrefill({
    enabled: !edit, platform, connection: connection, onConnection: setConnection,
    playback: nuvioPlayback, setPlayback: setNuvioPlayback,
    unreleased: nuvioHideUnreleased, setUnreleased: setNuvioHideUnreleased,
  });
  const [stagedImport, setStagedImport] = useState<StagedImport | null>(restored?.stagedImport ?? null);
  const [confirmReset, setConfirmReset] = useState(false);
  const wizard = useWizardStep(PARTIAL_SECTIONS.length);
  // Stay on the page after creation so the publish panel can offer the install
  // link, destination sign-in and optional Home-row push.
  const creation = useCreateSetup('partial', { navigateToSetup: false });
  // The push at the end of the flow: seal the login made here, then install.
  const platformName = platform === 'nuvio' ? 'Nuvio' : 'Stremio';
  const push = usePlatformPush({
    uuid: creation.result?.uuid ?? null,
    password: creation.password,
    platform,
    connection,
    onPushed: () => toast(`Pushed to ${platformName}`),
    onError: (message) => toast(message, 'error'),
  });
  // The post-creation modal is the "you are done" moment; dismissed back to the
  // success panel underneath.
  const [createdOpen, setCreatedOpen] = useState(true);
  const pickPreset = usePresetPicker(formatting, setFormatting);

  useEffect(() => {
    if (edit) return;
    savePartialDraft({
      name, keys, formatting, posters, homeRows,
      filterSets, mediaSets,
      meta, badgePack, customBadgeUrl, watchlist,
      addons, customStreams, nuvioPlayback, nuvioHideUnreleased, libraryRows, customAddons, platform, pushConn: connection,
      stagedImport,
    });
  }, [edit, name, keys, formatting, posters, homeRows, filterSets, mediaSets, meta, badgePack, customBadgeUrl, watchlist, addons, customStreams, nuvioPlayback, nuvioHideUnreleased, libraryRows, customAddons, platform, connection, stagedImport]);

  useRestoreToast(!edit && restored !== null && partialDraftHasContent(restored));

  const seed = edit?.initial;
  useEditSnapshot(edit, seed ? {
    ...seed, name, keys, platform, connection, posters, formatting,
    badgePack: badgeForSnapshot(seed, badgePack, customBadgeUrl, (id) => BADGE_PACKS.find((entry) => entry.id === id)?.url ?? ''),
    meta, filterSets, mediaSets, homeRows, addons, customStreams, nuvioPlayback, nuvioHideUnreleased, libraryRows, customAddons,
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
    setName('');
    setKeys(INITIAL_KEYS);
    setFormatting(EMPTY_FORMATTING);
    setPosters(EMPTY_POSTERS);
    setHomeRows([]);
    setFilterSets(EMPTY_FILTER_SETS);
    setMediaSets(EMPTY_MEDIA_SETS);
    setMeta(EMPTY_METADATA_EXTRAS);
    setBadgePack(DEFAULT_BADGE_PACK);
    setCustomBadgeUrl('');
    setWatchlist({});
    setAddons([]);
    setCustomStreams([]);
    setNuvioPlayback(EMPTY_NUVIO_PLAYBACK);
    setNuvioHideUnreleased(DEFAULT_NUVIO_HIDE_UNRELEASED);
    setLibraryRows(EMPTY_LIBRARY_ROWS);
    setCustomAddons([]);
    setConnection(null);
    setConfirmReset(false);
    clearPartialDraft();
    wizard.go(0);
  }

  // One draft builder for submit and row previews so previews can never
  // drift from what creation saves.
  function buildDraft() {
    const watchlistKeys = cleanWatchlistDraft(watchlist);
    const badgeUrl = badgePack === 'custom' ? customBadgeUrl : '';
    const playback = nuvioPlaybackForConfig(nuvioPlayback);
    const hideUnreleased = nuvioHideUnreleasedForConfig(nuvioHideUnreleased);
    return {
      config: withLibraryRowNames(libraryRows, pruneConfig({
        provider: providerSelection(keys),
        // Remember the chosen player (chosen on the publish desk): the manifest
        // resolver prefers this over the client's user agent, exactly as the
        // full flow does.
        wizardPlatform: platform,
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
        collectionHomeRows: homeRows,
        watchlistHomeManaged: true,
        streamAddons: addons,
        customAddons,
        customStreams,
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
        filterCodecs: mediaSets.codecs,
        filterHdr: mediaSets.hdr,
        filterAudio: mediaSets.audio,
        ...(parseGb(filterSets.minSizeGb) > 0 ? { filterMinSize: parseGb(filterSets.minSizeGb) } : {}),
        ...(parseGb(filterSets.maxSizeGb) > 0 ? { filterMaxSize: parseGb(filterSets.maxSizeGb) } : {}),
        ...(filterSets.cachedOnly ? { filterCachedOnly: true } : {}),
      })),
      keys: Object.keys(watchlistKeys).length > 0
        ? { ...cleanKeys(keys), watchlist: watchlistKeys }
        : cleanKeys(keys),
    };
  }

  function submit() {
    const draft = buildDraft();
    // An imported old setup is removed (and the old account with it once
    // nothing else is left to import) after creation succeeds, as on Move In.
    void creation.create(
      { name, config: draft.config, keys: draft.keys },
      stagedImport ? { purgeImport: { email: stagedImport.email, idMasked: stagedImport.idMasked } } : undefined,
    ).then((ok) => { if (ok) clearPartialDraft(); });
  }

  // Bring an old setup across. Settle In stages the settings, keys, home rows
  // and login; it deliberately does not adopt the old collections document,
  // because this tier does not build collections (Move In does).
  function stageImport(next: StagedImport | null, payload?: ImportedPayload) {
    setStagedImport(next);
    if (!next || !payload) return;
    const { merge } = payload;
    setName((current) => (current.trim() ? current : (merge.name?.trim() || current)));
    if (merge.platform) setPlatform(merge.platform);
    setPosters(merge.posters);
    setFormatting(merge.formatting);
    setBadgePack(merge.badgePack);
    setCustomBadgeUrl(merge.customBadgeUrl);
    setMeta((prev) => ({ ...prev, ...merge.meta }));
    setFilterSets((prev) => ({ ...prev, ...merge.filterSets }));
    // Pre-v5.5 configs kept media sets outside the shared merge.
    const media = payload.config as { filterCodecs?: string[]; filterHdr?: string[]; filterAudio?: string[] };
    setMediaSets((prev) => ({
      codecs: Array.isArray(media.filterCodecs) && media.filterCodecs.length > 0 ? media.filterCodecs : prev.codecs,
      hdr: Array.isArray(media.filterHdr) && media.filterHdr.length > 0 ? media.filterHdr : prev.hdr,
      audio: Array.isArray(media.filterAudio) && media.filterAudio.length > 0 ? media.filterAudio : prev.audio,
    }));
    if (merge.addons.length > 0) setAddons(merge.addons);
    if (payload.homeRows.length > 0) setHomeRows(normalizeHomeOrder(payload.homeRows, platform));
    if (Object.keys(payload.keys).length > 0) setKeys((prev) => ({ ...prev, ...payload.keys }));
    if (payload.pushConn) setConnection(payload.pushConn);
  }

  /* The end of a Settle In setup: the shared publish panel. The player login
     is step 1 now; the desk only offers it again when that step was skipped,
     since without it a Settle In setup could never push its Home order. */
  if (creation.result) {
    const platformName = platform === 'nuvio' ? 'Nuvio' : 'Stremio';
    const activeConn = connection && connection.platform === platform ? connection : null;
    return (
      <section className="setup">
        <div className={`created-done${createdOpen ? ' is-waiting' : ''}`}>
        <PublishPanel
          installToken={creation.result.installToken}
          uuid={creation.result.uuid}
          tierLabel="Settle In"
          name={name}
          platform={platform}
          counts={{
            homeRows: homeRows.filter((row) => row.enabled !== false).length,
            lang: meta.lang,
          }}
          deskTitle={activeConn ? `Publish to ${platformName}` : 'Choose where you watch'}
          deskBody={activeConn ? undefined : (
            <div id="settle-in-destination">
              <DestinationStep
              profileName={name}
                platform={platform}
                onPlatform={setPlatform}
                connection={connection}
                onConnection={setConnection}
              />
            </div>
          )}
          action={{
            // Everything was saved at creation; this only pushes.
            label: push.busy ?? (push.pushed ? `Push to ${platformName} again` : `Push to ${platformName}`),
            busy: push.busy !== null,
            disabled: !activeConn || !push.editToken,
            onClick: () => void push.push(),
            ...(!activeConn
              ? { hint: `Choose Stremio or Nuvio and sign in above to push your Home rows. The install link below works either way.` }
              : push.libraryPending
                ? { hint: 'Pushed. Your library folders are still being prepared and will appear on their own — nothing else to do.' }
                : push.pushed ? { hint: 'Pushed. Your saved setup can be pushed again any time.' } : {}),
          }}
          replaceOthers={activeConn ? { value: push.replaceOthers, onChange: push.setReplaceOthers } : null}
          actionsExtra={<Link className="setup-secondary" to={`/${creation.result.uuid}`}>Open your setup</Link>}
        />
        </div>
        <SetupCreatedModal
          open={createdOpen}
          uuid={creation.result.uuid}
          installToken={creation.result.installToken}
          name={name.trim() || null}
          password={creation.password}
          platform={platform}
          pushConn={connection}
          onConnectPrompt={() => {
            setCreatedOpen(false);
            document.getElementById('settle-in-destination')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
          onClose={() => setCreatedOpen(false)}
        />
      </section>
    );
  }

  const badgeUrl = badgePack === 'custom' ? customBadgeUrl : '';
  const presetLabel = STREAM_PRESETS.find((preset) => preset.id === formatting.preset)?.name ?? formatting.preset;
  const artworkLabel = POSTER_PROVIDERS.find((p) => p.id === posters.provider)?.name ?? 'TMDB default';
  const filtersActive = filterSets.resolutions.length > 0 || filterSets.qualities.length > 0
    || filterSets.sources.length > 0 || mediaSets.codecs.length > 0 || mediaSets.hdr.length > 0
    || mediaSets.audio.length > 0 || filterSets.minSizeGb.trim() !== '' || filterSets.maxSizeGb.trim() !== ''
    || filterSets.cachedOnly;
  const connected = PROVIDER_KEY_FIELDS.filter(({ field }) => (keys[field] ?? '').trim()).map(({ label }) => label.replace(/ API key$/, ''));
  const hasTmdb = Boolean((keys.tmdbApiKey ?? '').trim());
  const enabledRows = homeRows.filter((row) => row.enabled !== false).length;
  const dirty = edit ? edit.dirty : !creation.result && isPartialDirty({
    name, keys, formatting, posters, homeRows,
    filterSets, mediaSets,
    meta, badgePack, customBadgeUrl, watchlist,
  });
  const next = PARTIAL_SECTIONS[wizard.step + 1];

  const panel = (
    <TierPreviewPanel
      keys={keys} posters={posters} formatting={formatting} badgePack={{ pack: badgePack, url: badgeUrl }}
      rows={[
        { label: 'Library', value: connected.length ? connected.join(' + ') : 'Not connected yet', ok: connected.length > 0 },
        { label: 'Name', value: name.trim() || '—' },
        { label: 'Posters', value: artworkLabel },
        { label: 'Formatting', value: presetLabel },
        { label: 'Badges', value: BADGE_PACKS.find((entry) => entry.id === badgePack)?.name ?? badgePack },
        { label: 'Home rows', value: enabledRows > 0 ? String(enabledRows) : '—' },
        { label: 'Filters', value: filtersActive ? 'Custom' : 'Default' },
      ]}
    />
  );

  return (
    <section className="setup setup-wide qs qs-wizard">
      <TierProgress
        steps={PARTIAL_SECTIONS.map((section) => ({ id: section.id, label: section.title }))}
        unsaved={dirty}
        wizard={{ active: wizard.step, onStep: wizard.go }}
      />
      {wizard.step === 0 && <PosterWall />}
      <TierHero
        eyebrow={edit ? 'SETTLE IN · EDITING' : 'SETTLE IN · RECOMMENDED'} title="Make your library" accent="feel like home"
        lede={edit ? 'Your saved settings and keys are filled in below. Change anything, then save.' : 'Start with your debrid library, then choose its Home rows, artwork and playback settings. Extra stream sources and MDBList are optional. Collections are in Move In.'}
        facts={edit ? ['Saved keys stay hidden', 'Nothing changes until you save', 'Same install link'] : ['Eight guided steps', 'Home rows and filters', 'Keys sealed on the server']}
        compact={wizard.step > 0}
      />
      <div className="qs-grid">
        <div className="qs-flow">
          <TierStep id="destination" index={1} title="Destination" hidden={wizard.step !== 0} lede="Where this setup gets installed. Sign in now and your Home rows can be pushed straight to your player at the end. Already have a v5 setup? Bring it across instead.">
            {!edit && <ImportSection staged={stagedImport} platform={platform} keepsCollections={false} onStage={stageImport} />}
            <DestinationStep
              profileName={name}
              platform={platform} onPlatform={setPlatform}
              connection={connection} onConnection={setConnection}
              {...(edit ? { savedAccount: edit.savedAccount, onSavedProfile: edit.onSavedProfile } : {})}
            />
          </TierStep>
          <TierStep id="providers" index={2} title="Library providers" hidden={wizard.step !== 1} lede="Connect the debrid account or accounts that hold your library.">
            <ProviderKeys
              values={keys} onChange={setKeys}
              {...(edit ? { savedServices: edit.savedServices, revealSaved: revealEdit, onRemove: edit.onRemoveKey } : {})}
            />
          </TierStep>
          <TierStep id="metadata" index={3} title="Metadata" hidden={wizard.step !== 2} lede="Keys that power posters, matching and search.">
            <TierMetadata
              values={keys} onChange={setKeys}
              {...(edit ? { savedServices: edit.savedServices, revealSaved: revealEdit } : {})}
            />
            <div className="qs-accordions">
              <Accordion title="Display, search & notices" desc="Language, order, main metadata, anime, search scope and stream notices." icon="🎬">
                <MetadataExtras draft={meta} onChange={setMeta} />
              </Accordion>
              <Accordion title="Optional list sources" desc="Only needed if you use MDBList lists or external watchlists." icon="📋">
                <ListKey
                  value={keys.mdblistKey ?? ''} onChange={(value) => setKeys({ ...keys, mdblistKey: value })}
                  {...(edit ? { savedServices: edit.savedServices, revealSaved: revealEdit } : {})}
                />
              </Accordion>
              <Accordion title="Watchlists" desc={WATCHLIST_ACCORDION_DESC} icon="🔖">
                {edit
                  ? <MetadataWatchlists uuid={edit.uuid} editToken={edit.editToken} />
                  : <MetadataWatchlists uuid={null} editToken={null} draft={watchlist} onDraft={setWatchlist} />}
              </Accordion>
            </div>
          </TierStep>
          <TierStep id="streams" index={4} title="Playback" hidden={wizard.step !== 3} lede="Your library comes first. Set playback filters here; extra sources are optional.">
            <div className="qs-accordions">
              <Accordion title="Library playback filters" desc="Choose the resolutions, qualities and file details you want to see." icon="🎛️" defaultOpen>
                <FilterSets draft={filterSets} onChange={setFilterSets} />
                <FilterMediaSets draft={mediaSets} onChange={setMediaSets} />
              </Accordion>
              <Accordion title="Optional stream add-ons" desc="Only use these if you want sources beyond your saved library." icon="🌐">
                <StreamAddonsSection
                  selected={addons} onChange={setAddons}
                  custom={customAddons} onAddCustom={customAddonActions.add} onRemoveCustom={customAddonActions.remove}
                />
              </Accordion>
              <Accordion title="Optional custom links" desc="Add a direct link for a title or episode if you need one." icon="🔗">
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
          <TierStep id="artwork" index={5} title="Posters" hidden={wizard.step !== 4} lede="Pick a look and watch it render before you save anything.">
            <PostersSection draft={posters} keys={keys} onDraft={setPosters} onKeys={setKeys} hidePreview savedServices={edit?.savedServices} />
          </TierStep>
          <TierStep id="stream-look" index={6} title="Formatting" hidden={wizard.step !== 5} lede="Choose how your library files appear in the player.">
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
          <TierStep id="home-rows" index={7} title="Home rows" hidden={wizard.step !== 6} lede="Choose the library and discovery rows on your home screen.">
            <HomeRowsSection
              rows={homeRows} onChange={setHomeRows} platform={platform}
              prefix={hubPrefix(providerSelectionWithSaved(keys, edit?.savedServices ?? []))}
            />
            <details className="advanced">
              <summary>Rename your library rows</summary>
              <div className="advanced-body"><LibraryRowsSection value={libraryRows} onChange={setLibraryRows} /></div>
            </details>
          </TierStep>
          {edit ? (
            <TierStep id="password" index={8} title="Save and publish" hidden={wizard.step !== 7} lede="Nothing changes until you save. Your install link stays the same.">
              {edit.renderFinish({ name: { value: name, onChange: setName } })}
            </TierStep>
          ) : (
          <TierStep id="password" index={8} title="Protect your setup" hidden={wizard.step !== 7} lede="Name it if you like, lock it with a password. Watching never asks for either.">
            <label className="setup-field qs-name">
              <span>Setup name <small className="setup-hint" style={{ display: 'inline' }}>· optional</small></span>
              <input
                type="text" autoComplete="off" placeholder="e.g. Living room"
                value={name} onChange={(event) => setName(event.target.value)}
              />
            </label>
            <TierInstall
              password={creation.password} confirmation={creation.confirmation}
              busy={creation.busy} error={creation.error}
              onPassword={creation.setPassword} onConfirmation={creation.setConfirmation}
              onSubmit={submit} submitLabel="Create my setup"
            />
          </TierStep>
          )}
          <TierWizardNav
            step={wizard.step} total={PARTIAL_SECTIONS.length}
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
