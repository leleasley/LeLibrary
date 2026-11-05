import { useEffect, useMemo, useState } from 'react';
import { ConfirmModal } from '@/features/setup/shared/Modal';
import { ManifestResult } from '@/features/setup/shared/ManifestResult';
import { ProviderKeys } from '@/features/setup/shared/sections';
import { MetadataKeyCards } from '@/features/setup/shared/ApiKeysSection';
import {
  EMPTY_FORMATTING,
  FormattingSection,
  type FormattingDraft,
} from '@/features/setup/shared/FormattingSection';
import {
  EMPTY_POSTERS,
  PostersSection,
  type PostersDraft,
} from '@/features/setup/shared/PostersSection';
import { BADGE_PACKS, DEFAULT_BADGE_PACK } from '@/features/setup/shared/BadgePackPicker';
import { BadgePackStrip, StreamStylePicker, usePresetPicker } from '@/features/setup/shared/tier/TierPickers';
import { INSTALL_FORM_ID, TierInstall } from '@/features/setup/shared/tier/TierInstall';
import { useTierPreview } from '@/features/setup/shared/tier/TierPreview';
import { TierStep } from '@/features/setup/shared/tier/TierChrome';
import { ShellSidebar, TierShell } from '@/features/setup/shared/tier/TierShell';
import { createBlocker, optionalChecks, posterFacts, preferenceFacts, requiredChecks, setupCompletion } from '@/features/setup/shared/tier/shell-model';
import '@/features/setup/shared/tier/tier.css';
import { useEditSnapshot, type EditMode } from '@/features/setup/shared/edit-mode';
import { EMPTY_QUICK_EXTRAS, QuickExtrasFields, type QuickExtras, quickExtrasChips } from '@/features/setup/full/MetadataExtras';
import { useCreateSetup } from '@/features/setup/shared/useCreateSetup';
import { LibraryRowsCard } from '@/features/setup/shared/LibraryRowsSection';
import { OptionsCard } from '@/features/setup/shared/OptionsCard';
import { EMPTY_LIBRARY_ROWS, libraryRowsToConfig, type LibraryRowsDraft } from '@/features/setup/shared/library-rows';
import { useRestoreToast } from '@/features/setup/shared/Toast';
import { clearQuickDraft, loadQuickDraft, saveQuickDraft, type QuickDraft } from '@/features/setup/quick/quick-draft';
import {
  POSTER_PROVIDERS,
  PROVIDER_KEY_FIELDS,
  STREAM_PRESETS,
  cleanKeys,
  providerSelection,
  pruneConfig,
  type SetupKeysDraft,
} from '@/features/setup/shared/config-contract';
import { same } from '@/features/setup/shared/same';

export const QUICK_SECTION_IDS = [
  'providers',
  'artwork',
  'stream-look',
  'password',
] as const;

const INITIAL_KEYS: SetupKeysDraft = {};

const PROVIDER_NAMES: Partial<Record<keyof SetupKeysDraft, string>> = {
  torboxApiKey: 'TorBox', rdApiKey: 'Real-Debrid', adApiKey: 'AllDebrid', pmApiKey: 'Premiumize', webdavUrl: 'WebDAV',
};

// Anything entered that creation hasn't consumed yet. The draft persists
// every keystroke (refresh-safe until creation wipes it); the sidebar banner
// says so while this is true.
export function isQuickDirty(state: {
  name: string;
  keys: SetupKeysDraft;
  formatting: FormattingDraft;
  posters: PostersDraft;
  badgePack: { pack: string; url: string };
  extras: QuickExtras;
  libraryRows?: LibraryRowsDraft;
}): boolean {
  if (state.name.trim() !== '') return true;
  if (Object.keys(cleanKeys(state.keys)).length > 0) return true;
  return (
    !same(state.formatting, EMPTY_FORMATTING) ||
    !same(state.posters, EMPTY_POSTERS) ||
    !same(state.badgePack, { pack: DEFAULT_BADGE_PACK, url: '' }) ||
    !same(state.extras, EMPTY_QUICK_EXTRAS) ||
    !same(state.libraryRows ?? EMPTY_LIBRARY_ROWS, EMPTY_LIBRARY_ROWS)
  );
}

// The page writes a draft on mount, pristine one included, so "a draft is
// stored" does not mean the user typed anything. Only announce a restore when
// the draft actually holds content, judged by the same rule as the banner.
export function quickDraftHasContent(draft: QuickDraft): boolean {
  return isQuickDirty({
    name: draft.name,
    keys: draft.keys,
    formatting: draft.formatting,
    posters: draft.posters,
    badgePack: draft.badgePack,
    extras: draft.extras ?? EMPTY_QUICK_EXTRAS,
    libraryRows: draft.libraryRows ?? EMPTY_LIBRARY_ROWS,
  });
}

// Quick Look's "More library options" are a slice of the shared metadata
// model, so an edit maps them both ways.
function extrasFromMeta(meta: TierSnapshotMeta): QuickExtras {
  return { lang: meta.lang, notices: meta.notices, noticeTypes: [...meta.noticeTypes], searchScope: meta.searchScope, hideAnime: meta.hideAnime, torboxSources: [...meta.torboxSources] };
}
type TierSnapshotMeta = EditMode['initial']['meta'];

// One page, two modes: create (draft kept in this browser, ends in Create) and
// edit (seeded from the saved setup at /{uuid}, ends in Save).
// The config a Quick Look setup is created with (never its keys): creation
// and the Preview both build it here, so the Preview shows what is saved.
export function quickCreateConfig(input: {
  keys: SetupKeysDraft;
  formatting: FormattingDraft;
  posters: PostersDraft;
  badgePack: { pack: string; url: string };
  extras: QuickExtras;
  libraryRows: LibraryRowsDraft;
}): Record<string, unknown> {
  const { keys, formatting, posters, badgePack, extras, libraryRows } = input;
  return {
    ...pruneConfig({
      provider: providerSelection(keys),
      streamPreset: formatting.preset,
      streamNameTemplate: formatting.nameTemplate,
      streamDescTemplate: formatting.descTemplate,
      posterProvider: posters.provider,
      pictoriumUrl: posters.pictoriumUrl,
      pictoriumOptions: posters.pictoriumOptions,
      customPosterTemplate: posters.customTemplate,
      nuvioBadgePack: badgePack.pack,
      nuvioBadgeUrl: badgePack.url,
      searchScope: extras.searchScope,
      lang: extras.lang,
      libraryIdMode: 'torbox',
      hideAnime: extras.hideAnime,
      torboxSources: extras.torboxSources,
      streamNotices: extras.notices ? 'on' : 'off',
      streamNoticeTypes: extras.noticeTypes,
    }),
    ...libraryRowsToConfig(libraryRows),
  };
}

// `previewOpen` starts with the Preview open (tests only).
export function QuickSetupPage({ edit, previewOpen }: { edit?: EditMode; previewOpen?: boolean } = {}) {
  const [restored] = useState(() => (edit ? null : loadQuickDraft()));
  const seed = edit?.initial;
  const [name, setName] = useState(seed?.name ?? restored?.name ?? '');
  const [keys, setKeys] = useState<SetupKeysDraft>(seed?.keys ?? restored?.keys ?? INITIAL_KEYS);
  const [formatting, setFormatting] = useState<FormattingDraft>(seed?.formatting ?? restored?.formatting ?? EMPTY_FORMATTING);
  const [posters, setPosters] = useState<PostersDraft>(seed?.posters ?? restored?.posters ?? EMPTY_POSTERS);
  const [badgePack, setBadgePack] = useState(seed?.badgePack ?? restored?.badgePack ?? { pack: DEFAULT_BADGE_PACK, url: '' });
  // Older stored drafts predate some extras (language): fill them from the defaults.
  const [extras, setExtras] = useState<QuickExtras>(seed ? extrasFromMeta(seed.meta) : { ...EMPTY_QUICK_EXTRAS, ...(restored?.extras ?? {}) });
  const [libraryRows, setLibraryRows] = useState<LibraryRowsDraft>(seed?.libraryRows ?? restored?.libraryRows ?? EMPTY_LIBRARY_ROWS);
  const [confirmReset, setConfirmReset] = useState(false);
  const creation = useCreateSetup('quick', { navigateToSetup: false });

  useEffect(() => {
    if (edit) return;
    saveQuickDraft({ name, keys, formatting, posters, badgePack, extras, libraryRows });
  }, [edit, name, keys, formatting, posters, badgePack, extras, libraryRows]);

  useRestoreToast(!edit && restored !== null && quickDraftHasContent(restored));

  useEditSnapshot(edit, seed ? {
    ...seed, name, keys, formatting, posters, badgePack, meta: { ...seed.meta, ...extras }, libraryRows,
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
    setBadgePack({ pack: DEFAULT_BADGE_PACK, url: '' });
    setExtras(EMPTY_QUICK_EXTRAS);
    setLibraryRows(EMPTY_LIBRARY_ROWS);
    setConfirmReset(false);
    clearQuickDraft();
  }

  function submit() {
    void creation.create({
      name,
      config: quickCreateConfig({ keys, formatting, posters, badgePack, extras, libraryRows }),
      keys: cleanKeys(keys),
    }).then((ok) => { if (ok) clearQuickDraft(); });
  }

  // Quick Look has no player choice: its library rows show the same on both.
  const preview = useTierPreview(edit, {
    tier: 'quick',
    platform: edit?.initial.platform ?? 'nuvio',
    config: () => quickCreateConfig({ keys, formatting, posters, badgePack, extras, libraryRows }),
    keys, formatting, badgePack, posterStyle: posters.provider, name,
  }, previewOpen);

  const pickPreset = usePresetPicker(formatting, setFormatting);

  const connected = PROVIDER_KEY_FIELDS
    .filter(({ field }) => (keys[field] ?? '').trim())
    .map(({ field }) => PROVIDER_NAMES[field] ?? field);
  const hasTmdb = Boolean((keys.tmdbApiKey ?? '').trim());
  const passwordReady = creation.password.length > 0 && creation.password === creation.confirmation;
  const keyState = { keys, savedServices: edit?.savedServices };

  const steps = useMemo(() => [
    { id: 'providers', label: 'Library', done: connected.length > 0 && hasTmdb },
    { id: 'artwork', label: 'Artwork', done: false },
    { id: 'stream-look', label: 'Playback', done: false },
    { id: 'password', label: 'Install', done: passwordReady },
  ], [connected.length, hasTmdb, passwordReady]);

  const posterLabel = POSTER_PROVIDERS.find((provider) => provider.id === posters.provider)?.name ?? 'TMDB default';
  const streamLabel = STREAM_PRESETS.find((preset) => preset.id === formatting.preset)?.name ?? 'LeLibrary';
  const badgeLabel = BADGE_PACKS.find((pack) => pack.id === badgePack.pack)?.name ?? 'LeLibrary Premium';
  if (creation.result) {
    return (
      <section className="setup setup-wide quick-setup-redesign">
        <ManifestResult
          installToken={creation.result.installToken} uuid={creation.result.uuid} name={name}
          rows={[
            { label: 'Library', value: connected.length ? connected.join(' + ') : 'Not connected yet' },
            { label: 'Artwork', value: posterLabel },
            { label: 'Streams', value: streamLabel },
            { label: 'Nuvio badges', value: badgeLabel },
          ]}
        />
      </section>
    );
  }
  const required = requiredChecks(keyState);
  const optional = optionalChecks('quick', keyState);
  const blocked = edit ? null : createBlocker(keyState, { value: creation.password, confirmation: creation.confirmation });
  return (
    <section className="setup qs qs-tier ts-page">
      <TierShell
        tierLabel="Quick Look" name={name} editing={Boolean(edit)}
        steps={steps}
        onPreview={preview.openPreview}
        sidebar={(
          <ShellSidebar
            status={edit ? (edit.dirty ? 'unsaved' : 'saved') : 'draft'}
            onPreview={preview.openPreview}
            completion={setupCompletion(required, optional)} required={required} optional={optional}
            posters={posterFacts(posterLabel, streamLabel, badgeLabel)}
            preferences={preferenceFacts({ lang: extras.lang, hideAnime: extras.hideAnime })}
          />
        )}
        footer={{
          reset: edit
            ? { label: 'Clear my edits', onClick: edit.onClearEdits, disabled: !edit.dirty }
            : { label: 'Start over', onClick: () => setConfirmReset(true) },
          finish: edit
            ? { label: edit.saving ? 'Saving…' : edit.dirty ? 'Save changes' : 'Everything is saved', disabled: !edit.dirty || edit.locked, busy: edit.saving, onClick: edit.onSave }
            : { label: creation.busy ? 'Creating…' : 'Create my setup', busy: creation.busy, form: INSTALL_FORM_ID },
          blocked,
          save: edit && !edit.locked && edit.dirty
            ? { onSave: edit.onSave, onSaveAndPush: edit.onSaveAndPush, pushTarget: edit.pushTarget, busy: edit.saving || edit.pushing }
            : null,
        }}
      >
        <TierStep id="providers" title="Connect your library" lede="Choose the debrid service where your files are saved. You can connect more than one.">
          <ProviderKeys
            values={keys} onChange={setKeys}
            {...(edit ? { savedServices: edit.savedServices, revealSaved: revealEdit, onRemove: edit.onRemoveKey } : {})}
          />
          <h3 className="qs-sub"><strong>Match titles and artwork</strong><span>TMDB required · TVDB and OMDb optional</span></h3>
          <MetadataKeyCards
            values={keys} onChange={setKeys}
            {...(edit ? { savedServices: edit.savedServices, revealSaved: revealEdit, onRemove: edit.onRemoveKey } : {})}
          />
          <LibraryRowsCard value={libraryRows} onChange={setLibraryRows} hideAnime={extras.hideAnime} />
        </TierStep>

        <TierStep id="artwork" title="Posters" lede="Pick a look. The preview updates as you choose.">
          <PostersSection draft={posters} keys={keys} onDraft={setPosters} onKeys={setKeys} savedServices={edit?.savedServices} />
        </TierStep>

        <TierStep id="stream-look" title="Playback style" lede="Choose how your library files appear in the player.">
          <h3 className="qs-sub"><strong>Badge packs</strong><span>Nuvio</span></h3>
          <BadgePackStrip
            pack={badgePack.pack}
            customUrl={badgePack.url}
            onChange={(next) => setBadgePack(next.pack === 'custom' ? next : { pack: next.pack, url: badgePack.url })}
          />
          <h3 className="qs-sub"><strong>Stream display style</strong><span>Stremio and Nuvio</span></h3>
          <StreamStylePicker draft={formatting} onPick={pickPreset}>
            <FormattingSection draft={formatting} onChange={setFormatting} templatesOnly />
          </StreamStylePicker>
          <OptionsCard label="Library options" chips={quickExtrasChips(extras)}>
            <QuickExtrasFields draft={extras} onChange={setExtras} />
          </OptionsCard>
        </TierStep>

        {edit ? (
          <TierStep id="password" title="Save your changes" lede="Nothing changes until you save. Your install link stays the same.">
            {edit.renderFinish({ name: { value: name, onChange: setName } })}
          </TierStep>
        ) : (
        <TierStep id="password" title="Create your install link" lede="Set a password to protect future edits. Your player won’t ask for it when you watch.">
          <TierInstall
            password={creation.password} confirmation={creation.confirmation} error={creation.error}
            onPassword={creation.setPassword} onConfirmation={creation.setConfirmation}
            onSubmit={submit}
          />
        </TierStep>
        )}
      </TierShell>
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
