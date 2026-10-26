import {
  cleanKeys,
  pruneConfig,
  providerSelectionFromServices,
  torboxSourcesForConfig,
  type SetupKeysDraft,
  type CustomStreamRow,
} from '@/features/setup/shared/config-contract';
import type { FormattingDraft } from '@/features/setup/shared/FormattingSection';
import type { PostersDraft } from '@/features/setup/shared/PostersSection';
import type { MetadataExtrasDraft } from '@/features/setup/full/MetadataExtras';
import type { FilterSetsDraft } from '@/features/setup/full/FilterSets';
import type { MediaSetsDraft } from '@/features/setup/partial/FilterMediaSets';
import type { CollectionDoc, HomeRowDoc } from '@/features/setup/shared/collection-doc';
import { nuvioPlaybackForConfig, type NuvioPlaybackDraft } from '@/features/setup/shared/nuvio-playback';
import { nuvioHideUnreleasedForConfig, type NuvioHideUnreleased } from '@/features/setup/shared/nuvio-library';

// One save for the whole edit flow, shaped exactly like the create pages write
// it so an edited setup is indistinguishable from a created one. Blind key
// drafts contribute only filled values (blanks keep the saved secret
// server-side); config areas contribute only when touched. The builder returns
// null when there is nothing to send, which doubles as the dirty check.
//
// Areas whose lists can be emptied (collections, home rows, filters, stream
// sources, custom streams) are sent explicitly, gaps and all: the store merges
// shallowly, so an empty array is how a deletion actually persists. Sending them
// through pruneConfig would drop the empty case and silently keep the old data.
export interface EditSaveInput {
  keys: SetupKeysDraft;
  clearKeys?: string[];
  providerServices?: string[];
  name: string;
  savedName: string | null;
  platform: string;
  rdCatalog: string;
  destinationTouched: boolean;
  posters: PostersDraft;
  postersTouched: boolean;
  formatting: FormattingDraft;
  formattingTouched: boolean;
  badgePack: { pack: string; url: string };
  badgeTouched: boolean;
  meta: MetadataExtrasDraft;
  metaTouched: boolean;
  filterSets: FilterSetsDraft;
  mediaSets: MediaSetsDraft;
  filtersTouched: boolean;
  homeRows: HomeRowDoc[];
  homeRowsTouched: boolean;
  collections: CollectionDoc[];
  collectionsTouched: boolean;
  packs: string[];
  addons: string[];
  addonsTouched: boolean;
  customStreams: CustomStreamRow[];
  customStreamsTouched: boolean;
  nuvioPlayback: NuvioPlaybackDraft;
  nuvioPlaybackTouched: boolean;
  nuvioHideUnreleased: NuvioHideUnreleased;
  nuvioHideUnreleasedTouched: boolean;
  // Only the library row names/switches that changed (null clears one).
  libraryRowsConfig?: Record<string, unknown>;
  customAddons?: { id: string; name: string }[];
  customAddonsTouched?: boolean;
}

function parseGb(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function buildEditSaveBody(input: EditSaveInput): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};

  const keySlice = cleanKeys(input.keys);
  if (Object.keys(keySlice).length > 0) body.keys = keySlice;
  if (input.clearKeys?.length) body.clearKeys = [...new Set(input.clearKeys)];

  const trimmedName = input.name.trim();
  if (trimmedName !== (input.savedName ?? '')) body.name = trimmedName;

  const config: Record<string, unknown> = {};
  const clearConfig: string[] = [];

  // Update the explicit legacy selection only when debrid keys changed. This
  // preserves old tokens' selection during unrelated edits while keeping new
  // or removed keys in sync with `activeProviders`.
  const providerFields = ['torboxApiKey', 'rdApiKey', 'adApiKey', 'pmApiKey', 'webdavUrl', 'webdavUser', 'webdavPassword'];
  if (Object.keys(keySlice).some((field) => providerFields.includes(field)) ||
      (input.clearKeys ?? []).some((field) => providerFields.includes(field))) {
    const services = new Set(input.providerServices ?? []);
    for (const field of Object.keys(keySlice)) services.add(field);
    for (const field of input.clearKeys ?? []) services.delete(field);
    config.provider = providerSelectionFromServices([...services]);
  }

  if (input.destinationTouched) {
    config.wizardPlatform = input.platform;
    if (input.rdCatalog !== 'merge') config.rdCatalog = input.rdCatalog;
  }
  if (input.postersTouched) {
    Object.assign(config, pruneConfig({
      posterProvider: input.posters.provider,
      pictoriumUrl: input.posters.pictoriumUrl,
      pictoriumOptions: input.posters.pictoriumOptions,
      customPosterTemplate: input.posters.customTemplate,
    }));
  }
  if (input.formattingTouched) {
    if (input.formatting.preset === 'custom') {
      Object.assign(config, pruneConfig({
        streamPreset: input.formatting.preset,
        streamNameTemplate: input.formatting.nameTemplate,
        streamDescTemplate: input.formatting.descTemplate,
      }));
    } else {
      // A named style: drop any saved custom templates on the server, so an
      // old custom style cannot linger after switching back.
      // Sent explicitly: pruneConfig drops the default ("lelibrary"), which
      // left a saved "custom" preset in place when switching back to it.
      config.streamPreset = input.formatting.preset;
      clearConfig.push('streamNameTemplate', 'streamDescTemplate');
    }
  }
  if (input.badgeTouched) {
    Object.assign(config, pruneConfig({
      nuvioBadgePack: input.badgePack.pack,
      nuvioBadgeUrl: input.badgePack.url,
    }));
  }
  if (input.metaTouched) {
    config.lang = input.meta.lang;
    config.sortBy = input.meta.sortBy;
    config.libraryIdMode = input.meta.mainMetadata ? 'tt' : 'torbox';
    config.hideAnime = input.meta.hideAnime;
    // Every source on is the default: clear a stored limit instead of saving it.
    const torboxSources = torboxSourcesForConfig(input.meta.torboxSources);
    if (torboxSources.length > 0) config.torboxSources = torboxSources;
    else clearConfig.push('torboxSources');
    config.searchScope = input.meta.searchScope;
    config.streamNotices = input.meta.notices ? 'on' : 'off';
    config.streamNoticeTypes = [...input.meta.noticeTypes];
  }
  if (input.filtersTouched) {
    config.filterResolutions = [...input.filterSets.resolutions];
    config.filterResOrder = [...input.filterSets.resolutionOrder];
    config.filterQualities = [...input.filterSets.qualities];
    config.filterSources = [...input.filterSets.sources];
    config.filterCodecs = [...input.mediaSets.codecs];
    config.filterHdr = [...input.mediaSets.hdr];
    config.filterAudio = [...input.mediaSets.audio];
    config.filterMinSize = parseGb(input.filterSets.minSizeGb);
    config.filterMaxSize = parseGb(input.filterSets.maxSizeGb);
    config.filterCachedOnly = input.filterSets.cachedOnly;
  }
  if (input.homeRowsTouched) {
    config.collectionHomeRows = input.homeRows.map((row) => ({ ...row }));
  }
  if (input.collectionsTouched) {
    config.collections = input.collections.map((collection) => ({ ...collection }));
    config.nuvioCollectionPacks = [...input.packs];
  }
  if (input.addonsTouched) {
    config.streamAddons = [...input.addons];
  }
  if (input.customStreamsTouched) {
    config.customStreams = input.customStreams.map((row) => ({ ...row }));
  }
  if (input.nuvioPlaybackTouched) {
    // Null is explicit: the store merges, so this removes a previously saved
    // choice instead of leaving it in place.
    config.nuvioPlayback = nuvioPlaybackForConfig(input.nuvioPlayback);
  }
  if (input.nuvioHideUnreleasedTouched) {
    // null means "leave my Nuvio setting alone" and clears any stored choice.
    config.nuvioHideUnreleased = nuvioHideUnreleasedForConfig(input.nuvioHideUnreleased);
  }
  if (input.libraryRowsConfig) Object.assign(config, input.libraryRowsConfig);
  // An empty list is explicit: it removes the last of the user's own addons.
  if (input.customAddonsTouched) config.customAddons = (input.customAddons ?? []).map((row) => ({ ...row }));

  if (Object.keys(config).length > 0) body.config = config;
  if (clearConfig.length > 0) body.clearConfig = clearConfig;

  return Object.keys(body).length > 0 ? body : null;
}
