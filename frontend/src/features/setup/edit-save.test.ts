import { describe, expect, it } from 'vitest';
import { buildEditSaveBody, type EditSaveInput } from '@/features/setup/shared/edit-save';
import { EMPTY_FORMATTING } from '@/features/setup/shared/FormattingSection';
import { EMPTY_POSTERS } from '@/features/setup/shared/PostersSection';
import { EMPTY_METADATA_EXTRAS } from '@/features/setup/full/MetadataExtras';
import { EMPTY_FILTER_SETS } from '@/features/setup/full/FilterSets';
import { EMPTY_MEDIA_SETS } from '@/features/setup/partial/FilterMediaSets';
import { collectionDefault, ownedFranchiseMarker } from '@/features/setup/shared/collection-doc';
import { EMPTY_NUVIO_PLAYBACK } from '@/features/setup/shared/nuvio-playback';
import { DEFAULT_NUVIO_HIDE_UNRELEASED } from '@/features/setup/shared/nuvio-library';

export const BASE_EDIT_SAVE: EditSaveInput = {
  keys: {},
  name: '',
  savedName: null,
  platform: 'nuvio',
  rdCatalog: 'merge',
  destinationTouched: false,
  posters: EMPTY_POSTERS,
  postersTouched: false,
  formatting: EMPTY_FORMATTING,
  formattingTouched: false,
  badgePack: { pack: 'lelibrary-premium', url: '' },
  badgeTouched: false,
  meta: EMPTY_METADATA_EXTRAS,
  metaTouched: false,
  filterSets: EMPTY_FILTER_SETS,
  mediaSets: EMPTY_MEDIA_SETS,
  filtersTouched: false,
  homeRows: [],
  homeRowsTouched: false,
  collections: [],
  collectionsTouched: false,
  packs: [],
  addons: [],
  addonsTouched: false,
  customStreams: [],
  customStreamsTouched: false,
  nuvioPlayback: EMPTY_NUVIO_PLAYBACK,
  nuvioPlaybackTouched: false,
  nuvioHideUnreleased: DEFAULT_NUVIO_HIDE_UNRELEASED,
  nuvioHideUnreleasedTouched: false,
};

describe('edit save body', () => {
  it('saves Nuvio playback only when the section was touched', () => {
    expect(buildEditSaveBody({
      ...BASE_EDIT_SAVE,
      nuvioPlayback: { enabled: true, mode: 'FIRST_STREAM', regex: '', nextEpisode: true },
    })).toBe(null);

    const body = buildEditSaveBody({
      ...BASE_EDIT_SAVE,
      nuvioPlayback: { enabled: true, mode: 'REGEX_MATCH', regex: '(2160p|4k)', nextEpisode: true },
      nuvioPlaybackTouched: true,
    });
    expect(body?.config).toEqual({
      nuvioPlayback: { mode: 'REGEX_MATCH', regex: '(2160p|4k)', nextEpisode: true },
    });
  });

  it('clears a saved Nuvio choice when the user turns the section off', () => {
    const body = buildEditSaveBody({
      ...BASE_EDIT_SAVE,
      nuvioPlayback: EMPTY_NUVIO_PLAYBACK,
      nuvioPlaybackTouched: true,
    });
    expect(body?.config).toEqual({ nuvioPlayback: null });
  });

  it('saves the Nuvio unreleased choice only when touched', () => {
    expect(buildEditSaveBody({
      ...BASE_EDIT_SAVE,
      nuvioHideUnreleased: 'hide',
    })).toBe(null);

    const body = buildEditSaveBody({
      ...BASE_EDIT_SAVE,
      nuvioHideUnreleased: 'hide',
      nuvioHideUnreleasedTouched: true,
    });
    expect(body?.config).toEqual({ nuvioHideUnreleased: true });
  });

  it('clears a saved Nuvio unreleased choice back to leave-unchanged', () => {
    const body = buildEditSaveBody({
      ...BASE_EDIT_SAVE,
      nuvioHideUnreleased: 'inherit',
      nuvioHideUnreleasedTouched: true,
    });
    expect(body?.config).toEqual({ nuvioHideUnreleased: null });
  });

  it('returns null when nothing changed', () => {
    expect(buildEditSaveBody(BASE_EDIT_SAVE)).toBe(null);
    // Seeded-but-untouched drafts are not changes either.
    expect(buildEditSaveBody({
      ...BASE_EDIT_SAVE,
      name: 'Living room',
      savedName: 'Living room',
      posters: { ...EMPTY_POSTERS, provider: 'pictorium' },
      collections: [collectionDefault('Seeded')],
      homeRows: [ownedFranchiseMarker(0)],
    })).toBe(null);
  });

  it('sends only filled keys, blanks keep saved secrets', () => {
    expect(buildEditSaveBody({
      ...BASE_EDIT_SAVE,
      keys: { torboxApiKey: '  tb-new  ', rdApiKey: '   ', tmdbApiKey: '' },
    })).toEqual({ keys: { torboxApiKey: 'tb-new' }, config: { provider: 'torbox' } });
  });

  it('sends the name only when it changed', () => {
    expect(buildEditSaveBody({ ...BASE_EDIT_SAVE, name: 'Den', savedName: null }))
      .toEqual({ name: 'Den' });
    expect(buildEditSaveBody({ ...BASE_EDIT_SAVE, name: 'Den', savedName: 'Den' })).toBe(null);
  });

  it('sends only touched config areas', () => {
    const body = buildEditSaveBody({
      ...BASE_EDIT_SAVE,
      formatting: { ...EMPTY_FORMATTING, preset: 'cinema' },
      formattingTouched: true,
      badgePack: { pack: 'nard-full', url: '' },
      badgeTouched: true,
    });
    expect(body).toEqual({
      config: { streamPreset: 'cinema', nuvioBadgePack: 'nard-full' },
      clearConfig: ['streamNameTemplate', 'streamDescTemplate'],
    });
  });

  it('switching from a custom style back to a named one clears the saved templates', () => {
    const back = buildEditSaveBody({
      ...BASE_EDIT_SAVE,
      formatting: { ...EMPTY_FORMATTING, preset: 'lelibrary', nameTemplate: 'seeded', descTemplate: 'seeded' },
      formattingTouched: true,
    });
    expect(back).toEqual({ config: { streamPreset: 'lelibrary' }, clearConfig: ['streamNameTemplate', 'streamDescTemplate'] });
    const custom = buildEditSaveBody({
      ...BASE_EDIT_SAVE,
      formatting: { ...EMPTY_FORMATTING, preset: 'custom', nameTemplate: '{addon.name}', descTemplate: '{stream.filename}' },
      formattingTouched: true,
    });
    expect(custom).toEqual({ config: { streamPreset: 'custom', streamNameTemplate: '{addon.name}', streamDescTemplate: '{stream.filename}' } });
  });

  it('removes a saved key through the explicit clear list and updates provider selection', () => {
    const body = buildEditSaveBody({ ...BASE_EDIT_SAVE, keys: { rdApiKey: 'rd-new' } });
    expect(body).toEqual({
      keys: { rdApiKey: 'rd-new' },
      config: { provider: 'realdebrid' },
    });
    const cleared = buildEditSaveBody({
      ...BASE_EDIT_SAVE,
      providerServices: ['torboxApiKey', 'rdApiKey'],
      clearKeys: ['rdApiKey'],
    });
    expect(cleared).toEqual({ clearKeys: ['rdApiKey'], config: { provider: 'torbox' } });
  });

  it('adds a new provider key to an existing explicit provider selection', () => {
    const body = buildEditSaveBody({
      ...BASE_EDIT_SAVE,
      keys: { rdApiKey: 'rd-new' },
      providerServices: ['torboxApiKey'],
    });
    expect(body).toEqual({
      keys: { rdApiKey: 'rd-new' },
      config: { provider: 'torbox,realdebrid' },
    });
  });

  it('preserves an explicit provider selection on unrelated edits', () => {
    const body = buildEditSaveBody({
      ...BASE_EDIT_SAVE,
      postersTouched: true,
      posters: { ...EMPTY_POSTERS, provider: 'betterposter' },
      providerServices: ['torboxApiKey'],
    });
    expect(body).toEqual({ config: { posterProvider: 'betterposter' } });
  });

  it('combines keys, name and config in one body', () => {
    const body = buildEditSaveBody({
      ...BASE_EDIT_SAVE,
      keys: { tmdbApiKey: 'tmdb-new' },
      name: 'Den',
      posters: { ...EMPTY_POSTERS, provider: 'betterposter' },
      postersTouched: true,
    });
    expect(body).toEqual({
      keys: { tmdbApiKey: 'tmdb-new' },
      name: 'Den',
      config: { posterProvider: 'betterposter' },
    });
  });

  // The store merges shallowly, so a cleared list has to be sent as an empty
  // list or the deletion never lands.
  it('sends cleared collections, home rows and stream sources as empty lists', () => {
    const body = buildEditSaveBody({
      ...BASE_EDIT_SAVE,
      collectionsTouched: true,
      collections: [],
      packs: [],
      homeRowsTouched: true,
      homeRows: [],
      addonsTouched: true,
      addons: [],
      customStreamsTouched: true,
      customStreams: [],
    });
    expect(body).toEqual({
      config: {
        collectionHomeRows: [],
        collections: [],
        nuvioCollectionPacks: [],
        streamAddons: [],
        customStreams: [],
      },
    });
  });

  it('sends the destination and the metadata toggles when touched', () => {
    const body = buildEditSaveBody({
      ...BASE_EDIT_SAVE,
      destinationTouched: true,
      platform: 'stremio',
      rdCatalog: 'separate',
      metaTouched: true,
      meta: { ...EMPTY_METADATA_EXTRAS, mainMetadata: true, hideAnime: true, notices: false, noticeTypes: ['none'] },
    });
    expect(body).toEqual({
      config: {
        wizardPlatform: 'stremio',
        rdCatalog: 'separate',
        lang: 'en-US',
        sortBy: 'data_adicao',
        libraryIdMode: 'tt',
        hideAnime: true,
        searchScope: 'combined',
        streamNotices: 'off',
        streamNoticeTypes: ['none'],
      },
    });
  });

  it('sends filter and media sets, including the codec/HDR/audio sets creation writes', () => {
    const body = buildEditSaveBody({
      ...BASE_EDIT_SAVE,
      filtersTouched: true,
      filterSets: { ...EMPTY_FILTER_SETS, resolutions: ['4K'], qualities: ['BluRay'], maxSizeGb: '12', cachedOnly: true },
      mediaSets: { codecs: ['HEVC'], hdr: ['HDR10'], audio: ['TrueHD'] },
    });
    expect(body).toEqual({
      config: {
        filterResolutions: ['4K'],
        filterResOrder: EMPTY_FILTER_SETS.resolutionOrder,
        filterQualities: ['BluRay'],
        filterSources: [],
        filterCodecs: ['HEVC'],
        filterHdr: ['HDR10'],
        filterAudio: ['TrueHD'],
        filterMinSize: 0,
        filterMaxSize: 12,
        filterCachedOnly: true,
      },
    });
  });
});
