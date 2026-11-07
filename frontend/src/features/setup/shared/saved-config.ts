import { withHubExtras } from '@/features/setup/shared/collection-doc';
import {
  DEFAULT_STREAM_PRESET,
  HOME_ROW_PACKS,
  STREAM_PRESETS,
  cleanTorboxSources,
  type CustomStreamRow,
  type StreamPresetId,
} from '@/features/setup/shared/config-contract';
import { cleanSearchOptions } from '@/features/setup/shared/search-options';
import { cleanExcludeCategories } from '@/features/setup/shared/content-filters';
import { BADGE_PACKS, DEFAULT_BADGE_PACK } from '@/features/setup/shared/BadgePackPicker';
import {
  DEFAULT_NOTICE_TYPES,
  EMPTY_METADATA_EXTRAS,
  type MetadataExtrasDraft,
} from '@/features/setup/full/MetadataExtras';
import { EMPTY_FILTER_SETS, ALL_QUAL, ALL_RES, ALL_SRC, type FilterSetsDraft } from '@/features/setup/full/FilterSets';
import { ALL_AUDIO, ALL_CODECS, ALL_HDR, type MediaSetsDraft } from '@/features/setup/partial/FilterMediaSets';
import type { CollectionDoc, HomeRowDoc } from '@/features/setup/shared/collection-doc';
import { cleanNuvioPlayback, type NuvioPlaybackDraft } from '@/features/setup/shared/nuvio-playback';
import { cleanNuvioHideUnreleased, type NuvioHideUnreleased } from '@/features/setup/shared/nuvio-library';
import { libraryRowsFromConfig, type LibraryRowsDraft } from '@/features/setup/shared/library-rows';
import { cleanCustomAddons, type CustomAddonRef } from '@/features/setup/shared/custom-addons';
import { isRecord } from '@/features/setup/shared/is-record';

// Maps a saved structural config (from GET /api/setup/:uuid/config or the
// unlock response) onto editor drafts so an edit starts where the setup left
// off. Unknown values fall back to defaults; keys are never part of this
// shape - the server excludes them before anything reaches the browser.
// Saved structural config -> editor drafts. Both create flows persist the same
// shape, so the editor seeds from the same fields and can therefore expose the
// same sections the setup was created with.
export interface SavedDrafts {
  platform: 'nuvio' | 'stremio';
  rdCatalog: string;
  posters: {
    provider: string;
    customTemplate: string;
  };
  formatting: {
    preset: StreamPresetId;
    nameTemplate: string;
    descTemplate: string;
  };
  badgePack: { pack: string; url: string };
  meta: MetadataExtrasDraft;
  filterSets: FilterSetsDraft;
  mediaSets: MediaSetsDraft;
  collectionHomeRows: HomeRowDoc[];
  collections: CollectionDoc[];
  packs: string[];
  addons: string[];
  customStreams: CustomStreamRow[];
  nuvioPlayback: NuvioPlaybackDraft;
  nuvioHideUnreleased: NuvioHideUnreleased;
  libraryRows: LibraryRowsDraft;
  customAddons: CustomAddonRef[];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry !== '') : [];
}


// Collection and home-row documents carry artwork, folder and source structure,
// so they ride through as-is once their minimum shape is proven.
function cleanCollections(value: unknown): CollectionDoc[] {
  if (!Array.isArray(value)) return [];
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return value
    .filter((entry): entry is CollectionDoc =>
      isRecord(entry) && typeof entry['id'] === 'string' && Array.isArray(entry['folders']))
    // An older Hub shows its 4K, HDR and Genres folders, as a push sends them.
    .map((collection) => withHubExtras(collection, origin));
}

export function cleanHomeRowDocs(value: unknown): HomeRowDoc[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is HomeRowDoc => {
    if (!isRecord(entry) || typeof entry['id'] !== 'string') return false;
    const source = entry['source'];
    return isRecord(source)
      && typeof source['id'] === 'string'
      && (source['type'] === 'movie' || source['type'] === 'series');
  });
}

function cleanCustomStreams(value: unknown): CustomStreamRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is CustomStreamRow => isRecord(entry) && typeof entry['url'] === 'string');
}

const PRESET_IDS: Set<string> = new Set(STREAM_PRESETS.map((preset) => preset.id));
const BADGE_IDS: Set<string> = new Set(BADGE_PACKS.map((pack) => pack.id));

export function applySavedConfig(saved: unknown): SavedDrafts {
  const config = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;

  const preset = asString(config.streamPreset);
  const pack = asString(config.nuvioBadgePack);

  // Setups saved with the removed Pictorium provider fall back to the
  // TMDB default. Their stale pictorium fields are ignored here and
  // cleared on the next save.
  const rawProvider = asString(config.posterProvider);
  const provider = rawProvider === 'pictorium' ? '' : rawProvider;

  const platform = config.wizardPlatform === 'stremio' ? 'stremio' : 'nuvio';
  const lang = asString(config.lang) || EMPTY_METADATA_EXTRAS.lang;
  const sortBy = asString(config.sortBy) || EMPTY_METADATA_EXTRAS.sortBy;
  const searchScope = asString(config.searchScope);
  const noticeTypes = asStringArray(config.streamNoticeTypes);

  const pick = (value: unknown, allowed: string[]): string[] =>
    asStringArray(value).filter((entry) => allowed.includes(entry));

  return {
    platform,
    rdCatalog: config.rdCatalog === 'separate' ? 'separate' : 'merge',
    posters: {
      provider,
      customTemplate: asString(config.customPosterTemplate),
    },
    formatting: {
      preset: (PRESET_IDS.has(preset) ? preset : DEFAULT_STREAM_PRESET) as StreamPresetId,
      nameTemplate: asString(config.streamNameTemplate),
      descTemplate: asString(config.streamDescTemplate),
    },
    badgePack: {
      pack: BADGE_IDS.has(pack) ? pack : DEFAULT_BADGE_PACK,
      url: asString(config.nuvioBadgeUrl),
    },
    // Absent in the stored config means the setup never touched Nuvio's player.
    nuvioPlayback: cleanNuvioPlayback(config.nuvioPlayback),
    nuvioHideUnreleased: cleanNuvioHideUnreleased(config.nuvioHideUnreleased),
    libraryRows: libraryRowsFromConfig(config),
    customAddons: cleanCustomAddons(config.customAddons),
    meta: {
      lang,
      sortBy,
      mainMetadata: config.libraryIdMode === 'tt',
      hideAnime: config.hideAnime === true,
      hideAdult: config.hideAdultContent === true,
      excludeCategories: cleanExcludeCategories(config.excludeCategories),
      torboxSources: cleanTorboxSources(config.torboxSources),
      searchScope: searchScope || EMPTY_METADATA_EXTRAS.searchScope,
      searchOptions: cleanSearchOptions(config.searchOptions),
      notices: config.streamNotices !== 'off',
      noticeTypes: noticeTypes.length > 0 ? noticeTypes : [...DEFAULT_NOTICE_TYPES],
    },
    filterSets: {
      resolutions: pick(config.filterResolutions, ALL_RES),
      resolutionOrder: asStringArray(config.filterResOrder).length > 0
        ? asStringArray(config.filterResOrder).filter((entry) => ALL_RES.includes(entry))
        : [...EMPTY_FILTER_SETS.resolutionOrder],
      qualities: pick(config.filterQualities, ALL_QUAL),
      sources: pick(config.filterSources, ALL_SRC),
      minSizeGb: typeof config.filterMinSize === 'number' && config.filterMinSize > 0 ? String(config.filterMinSize) : '',
      maxSizeGb: typeof config.filterMaxSize === 'number' && config.filterMaxSize > 0 ? String(config.filterMaxSize) : '',
      cachedOnly: config.filterCachedOnly === true,
    },
    mediaSets: {
      codecs: pick(config.filterCodecs, ALL_CODECS),
      hdr: pick(config.filterHdr, ALL_HDR),
      audio: pick(config.filterAudio, ALL_AUDIO),
    },
    collectionHomeRows: cleanHomeRowDocs(config.collectionHomeRows),
    collections: cleanCollections(config.collections),
    packs: asStringArray(config.nuvioCollectionPacks),
    addons: asStringArray(config.streamAddons),
    customStreams: cleanCustomStreams(config.customStreams),
  };
}
