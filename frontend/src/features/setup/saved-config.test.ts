import { describe, expect, it } from 'vitest';
import { applySavedConfig } from '@/features/setup/shared/saved-config';

// The edit page pre-fills pickers from saved structural config. Unknown or
// hostile values must fall back to defaults, never into the drafts.
describe('saved config mapping', () => {
  it('maps a saved setup onto drafts', () => {
    const drafts = applySavedConfig({
      provider: 'torbox',
      streamPreset: 'cinema',
      posterProvider: 'pictorium',
      pictoriumOptions: { badges: true },
      nuvioBadgePack: 'nard-full',
    });
    expect(drafts.posters).toEqual({ provider: 'pictorium', pictoriumUrl: '', pictoriumOptions: { badges: true }, customTemplate: '' });
    expect(drafts.formatting).toEqual({ preset: 'cinema', nameTemplate: '', descTemplate: '' });
    expect(drafts.badgePack).toEqual({ pack: 'nard-full', url: '' });
    expect(drafts.collections).toEqual([]);
    expect(drafts.collectionHomeRows).toEqual([]);
    expect(drafts.addons).toEqual([]);
    expect(drafts.customStreams).toEqual([]);
  });

  it('keeps custom templates and badge urls', () => {
    const drafts = applySavedConfig({
      streamPreset: 'custom',
      streamNameTemplate: '{addon.name}',
      streamDescTemplate: '{stream.filename}',
      posterProvider: 'custom',
      customPosterTemplate: 'https://img.example.com/{tmdbId}.jpg',
      nuvioBadgePack: 'custom',
      nuvioBadgeUrl: 'https://example.com/badges.json',
    });
    expect(drafts.formatting).toEqual({ preset: 'custom', nameTemplate: '{addon.name}', descTemplate: '{stream.filename}' });
    expect(drafts.posters.customTemplate).toBe('https://img.example.com/{tmdbId}.jpg');
    expect(drafts.badgePack).toEqual({ pack: 'custom', url: 'https://example.com/badges.json' });
  });

  it('falls back to defaults for unknown or missing values', () => {
    const drafts = applySavedConfig(null);
    expect(drafts.platform).toBe('nuvio');
    expect(drafts.rdCatalog).toBe('merge');
    expect(drafts.posters).toEqual({ provider: '', pictoriumUrl: '', pictoriumOptions: {}, customTemplate: '' });
    expect(drafts.formatting).toEqual({ preset: 'lelibrary', nameTemplate: '', descTemplate: '' });
    expect(drafts.badgePack).toEqual({ pack: 'lelibrary-premium', url: '' });
    expect(drafts.meta.lang).toBe('en-US');
    expect(drafts.meta.notices).toBe(true);
    expect(drafts.filterSets.resolutions).toEqual([]);
    expect(drafts.mediaSets).toEqual({ codecs: [], hdr: [], audio: [] });

    const hostile = applySavedConfig({
      streamPreset: 'bogus', nuvioBadgePack: 'bogus',
      posterProvider: 42, pictoriumOptions: ['badges'], streamNameTemplate: null,
    });
    expect(hostile.formatting.preset).toBe('lelibrary');
    expect(hostile.badgePack.pack).toBe('lelibrary-premium');
    expect(hostile.posters.provider).toBe('');
    expect(hostile.posters.pictoriumOptions).toEqual({});
    expect(hostile.formatting.nameTemplate).toBe('');
  });

  it('keeps only enabled pictorium flags', () => {
    const { posters } = applySavedConfig({
      pictoriumOptions: { badges: true, ratings: false, extra: 'x', count: 3 },
    });
    expect(posters.pictoriumOptions).toEqual({ badges: true });
  });

  // Both create flows write home rows as documents, so the editor has to read
  // them back as documents too.
  it('restores home-row and collection documents, dropping malformed ones', () => {
    const drafts = applySavedConfig({
      collectionHomeRows: [
        { id: 'r1', source: { id: 'lib-x', type: 'movie' } },
        { id: 'r2', source: { id: 'lib-y', type: 'nonsense' } },
        'nope',
      ],
      collections: [
        { id: 'c1', folders: [] },
        { id: 'c2' },
      ],
      nuvioCollectionPacks: ['pack-a', 7],
      streamAddons: ['torrentio', null],
      customStreams: [{ url: 'https://example.com/a.mkv' }, { name: 'no url' }],
    });
    expect(drafts.collectionHomeRows.map((row) => row.id)).toEqual(['r1']);
    expect(drafts.collections.map((collection) => collection.id)).toEqual(['c1']);
    expect(drafts.packs).toEqual(['pack-a']);
    expect(drafts.addons).toEqual(['torrentio']);
    expect(drafts.customStreams).toEqual([{ url: 'https://example.com/a.mkv' }]);
  });

  it('restores the filter sets and media sets the flows wrote', () => {
    const drafts = applySavedConfig({
      filterResolutions: ['4K', 'nonsense'],
      filterQualities: ['BluRay'],
      filterSources: ['WEB-DL', 'nope'],
      filterResOrder: ['720p', '4K'],
      filterMinSize: 2,
      filterMaxSize: 0,
      filterCachedOnly: true,
      filterCodecs: ['HEVC', 'nope'],
      filterHdr: ['Dolby Vision'],
      filterAudio: ['TrueHD'],
    });
    expect(drafts.filterSets.resolutions).toEqual(['4K']);
    expect(drafts.filterSets.qualities).toEqual(['BluRay']);
    expect(drafts.filterSets.sources).toEqual(['WEB-DL']);
    expect(drafts.filterSets.resolutionOrder).toEqual(['720p', '4K']);
    expect(drafts.filterSets.minSizeGb).toBe('2');
    expect(drafts.filterSets.maxSizeGb).toBe('');
    expect(drafts.filterSets.cachedOnly).toBe(true);
    expect(drafts.mediaSets).toEqual({ codecs: ['HEVC'], hdr: ['Dolby Vision'], audio: ['TrueHD'] });
  });

  it('reads the destination and metadata toggles back', () => {
    const drafts = applySavedConfig({
      wizardPlatform: 'stremio', rdCatalog: 'separate',
      lang: 'fr-FR', sortBy: 'ano', libraryIdMode: 'tt', hideAnime: true,
      searchScope: 'library', streamNotices: 'off', streamNoticeTypes: ['none'],
    });
    expect(drafts.platform).toBe('stremio');
    expect(drafts.rdCatalog).toBe('separate');
    expect(drafts.meta).toEqual({
      lang: 'fr-FR', sortBy: 'ano', mainMetadata: true, hideAnime: true,
      searchScope: 'library', notices: false, noticeTypes: ['none'],
    });
  });
});
