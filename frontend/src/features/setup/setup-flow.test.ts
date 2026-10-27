import { describe, expect, it, vi, afterEach } from 'vitest';
import { checkPassword, installUrl, tierRequired } from '@/features/setup/resolver/validation';
import { TIERS } from '@/features/setup/shared/tiers';
import { clearEditToken, getEditToken, setEditToken } from '@/features/setup/resolver/edit-session';
import { QUICK_SECTION_IDS } from '@/features/setup/quick/QuickSetupPage';
import { PARTIAL_SECTION_IDS } from '@/features/setup/partial/PartialSetupPage';
import { FULL_SECTION_IDS } from '@/features/setup/full/FullSetupPage';
import {
  FORMAT_SAMPLES,
  HOME_ROW_PACKS,
  POSTER_PROVIDERS,
  POSTER_SAMPLES,
  STREAM_PRESETS,
  cleanKeys,
  pruneConfig,
} from '@/features/setup/shared/config-contract';
import { maskTokenId, tokenIdFromInput } from '@/features/setup/resolver/api';
import { DEFAULT_CAT_ORDER } from '@/features/setup/shared/home-model';

afterEach(() => clearEditToken());

describe('setup tiers', () => {
  it('offers exactly the three tiers with one recommendation', () => {
    expect(TIERS.map((tier) => tier.id)).toEqual(['quick', 'partial', 'full']);
    expect(TIERS.filter((tier) => tier.recommended)).toHaveLength(1);
  });

  it('only accepts a real tier id', () => {
    expect(tierRequired('quick')).toBe(true);
    expect(tierRequired('partial')).toBe(true);
    expect(tierRequired('full')).toBe(true);
    expect(tierRequired('')).toBe(false);
    expect(tierRequired('bogus')).toBe(false);
  });
});

describe('tier sections', () => {
  it('gives each tier its own sub-headed sections', () => {
    expect([...QUICK_SECTION_IDS]).toEqual([
      'providers', 'artwork', 'stream-look', 'password',
    ]);
    expect([...PARTIAL_SECTION_IDS]).toEqual([
      'providers', 'metadata', 'streams', 'artwork', 'stream-look',
      'home-rows', 'password',
    ]);
    expect([...FULL_SECTION_IDS]).toEqual([
      'destination', 'providers', 'metadata', 'streams', 'artwork',
      'home', 'collections', 'review',
    ]);
  });

  it('never reorders the sections tiers share', () => {
    const order = (ids: readonly string[]) => new Map(ids.map((id, index) => [id, index]));
    const quick = order(QUICK_SECTION_IDS);
    const partial = order(PARTIAL_SECTION_IDS);
    const full = order(FULL_SECTION_IDS);
    // Any section two tiers share must appear in the same relative order.
    for (const [a, b] of [[quick, partial], [partial, full], [quick, full]] as const) {
      const shared = [...a.keys()].filter((id) => b.has(id));
      const sorted = [...shared].sort((x, y) => (a.get(x) ?? 0) - (a.get(y) ?? 0));
      expect(sorted).toEqual(shared);
    }
  });

  it('no longer carries a Lists section in Quick Look', () => {
    expect([...QUICK_SECTION_IDS]).not.toContain('lists');
  });

  it('keeps tier step counts in sync with the section lists', () => {
    const steps = Object.fromEntries(TIERS.map((tier) => [tier.id, tier.steps]));
    expect(steps).toEqual({
      quick: QUICK_SECTION_IDS.length,
      partial: PARTIAL_SECTION_IDS.length,
      full: FULL_SECTION_IDS.length,
    });
  });
});

describe('config contract', () => {
  it('lists every preset the formatter engine ships, custom last', () => {
    expect(STREAM_PRESETS.map((preset) => preset.id)).toEqual([
      'lelibrary', 'cinema', 'remux', 'compact', 'technical',
      'torrentio', 'torbox', 'gdrive', 'lightgdrive', 'minimalisticgdrive',
      'prism', 'tamtaro', 'custom',
    ]);
  });

  it('carries the real poster provider set and preview samples', () => {
    expect(POSTER_PROVIDERS.map((provider) => provider.id)).toEqual([
      '', 'erdb', 'rpdb', 'betterposter', 'pictorium', 'fanart', 'custom',
    ]);
    expect(POSTER_SAMPLES.length).toBeGreaterThanOrEqual(6);
    expect(POSTER_SAMPLES.every((sample) => /^tt\d+$/.test(sample.imdb))).toBe(true);
    expect(FORMAT_SAMPLES.every((sample) => sample.filename.endsWith('.mkv'))).toBe(true);
  });

  it('writes a TorBox source limit only when some sources are off', () => {
    expect(pruneConfig({ torboxSources: ['usenet'] })).toEqual({ torboxSources: ['usenet'] });
    expect(pruneConfig({ torboxSources: ['webdl', 'torrent', 'bogus'] })).toEqual({ torboxSources: ['torrent', 'webdl'] });
    expect(pruneConfig({ torboxSources: ['torrent', 'usenet', 'webdl'] })).toEqual({});
    expect(pruneConfig({ torboxSources: [] })).toEqual({});
  });

  it('sends templates only for the custom preset', () => {
    expect(pruneConfig({ streamPreset: 'cinema', streamNameTemplate: 'x', streamDescTemplate: 'y' }))
      .toEqual({ streamPreset: 'cinema' });
    expect(pruneConfig({ streamPreset: 'custom', streamNameTemplate: 'x', streamDescTemplate: 'y' }))
      .toEqual({ streamPreset: 'custom', streamNameTemplate: 'x', streamDescTemplate: 'y' });
  });

  it('keeps badge packs out unless customized', () => {
    expect(pruneConfig({ nuvioBadgePack: 'lelibrary-premium' })).toEqual({});
    expect(pruneConfig({ nuvioBadgePack: 'nard-full', nuvioBadgeUrl: 'https://x/y.json' }))
      .toEqual({ nuvioBadgePack: 'nard-full' });
    expect(pruneConfig({ nuvioBadgePack: 'custom', nuvioBadgeUrl: 'https://x/y.json' }))
      .toEqual({ nuvioBadgePack: 'custom', nuvioBadgeUrl: 'https://x/y.json' });
  });

  it('stores Nuvio playback only when the setup opted in', () => {
    expect(pruneConfig({})).toEqual({});
    expect(pruneConfig({
      nuvioPlayback: { mode: 'REGEX_MATCH', regex: '(2160p|4k)', nextEpisode: true, onlyLeLibrary: false },
    })).toEqual({
      nuvioPlayback: { mode: 'REGEX_MATCH', regex: '(2160p|4k)', nextEpisode: true, onlyLeLibrary: false },
    });
  });

  it('stores the Nuvio unreleased choice only when it is explicit', () => {
    expect(pruneConfig({ nuvioHideUnreleased: true })).toEqual({ nuvioHideUnreleased: true });
    expect(pruneConfig({ nuvioHideUnreleased: false })).toEqual({ nuvioHideUnreleased: false });
    expect(pruneConfig({})).toEqual({});
  });

  it('writes the full metadata and stream model in backend names', () => {
    expect(pruneConfig({
      lang: 'pt-BR', sortBy: 'titulo', libraryIdMode: 'tt', hideAnime: true,
      searchScope: 'library', streamNotices: 'off', streamNoticeTypes: ['none'],
      filterResolutions: ['4K'], filterResOrder: ['4K', '1080p'], filterQualities: ['CAM'],
      filterSources: ['HDTV'], filterMinSize: 2, filterMaxSize: 20, filterCachedOnly: true,
      streamAddons: ['comet'], customStreams: [{ name: 'x', url: 'https://x/y.mkv', type: '*' }],
    })).toEqual({
      lang: 'pt-BR', sortBy: 'titulo', libraryIdMode: 'tt', hideAnime: true,
      searchScope: 'library', streamNotices: 'off', streamNoticeTypes: ['none'],
      filterResolutions: ['4K'], filterResOrder: ['4K', '1080p'], filterQualities: ['CAM'],
      filterSources: ['HDTV'], filterMinSize: 2, filterMaxSize: 20, filterCachedOnly: true,
      streamAddons: ['comet'], customStreams: [{ name: 'x', url: 'https://x/y.mkv', type: '*' }],
    });
    expect(pruneConfig({
      lang: 'en-US', sortBy: 'data_adicao', libraryIdMode: 'torbox', searchScope: 'combined',
      streamNoticeTypes: ['none', 'rateLimit', 'digitalRelease'],
      filterResolutions: [], streamAddons: [], customStreams: [],
    })).toEqual({});
  });

  it('translates simple tier filters into backend fields', () => {
    expect(pruneConfig({ streamFilters: { hideUncached: true, minResolution: '1080p', maxSizeGb: '10' } }))
      .toEqual({
        streamFilters: { hideUncached: true, maxSizeGb: 10 },
        filterCachedOnly: true,
        filterResolutions: ['4K', '2K', '1080p'],
        filterMaxSize: 10,
      });
  });

  it('saves settle-in home rows with omit-when-default semantics', () => {
    expect(pruneConfig({
      libraryCatalogs: ['genre_action_movies'],
      libHomeHidden: ['x'],
      libraryNames: { x: 'X' },
      catalogOrder: [...DEFAULT_CAT_ORDER],
    })).toEqual({
      libraryCatalogs: ['genre_action_movies'],
      libHomeHidden: ['x'],
      libraryNames: { x: 'X' },
    });
    expect(pruneConfig({
      catalogTrendingMovies: true,
      catalogTrendingSeries: false,
      catalogMovies: false,
      catalogSeries: true,
      catNameMovies: '🎬 My Movies',
      collectionsName: 'Mine',
    })).toEqual({
      catalogTrendingMovies: true,
      catalogMovies: false,
      collectionsName: 'Mine',
    });
    expect(pruneConfig({})).toEqual({});
  });

  it('lists only real home-row packs', () => {
    expect(HOME_ROW_PACKS).toHaveLength(14);
    expect(HOME_ROW_PACKS.map((pack) => pack.id)).toContain('movie-night');
  });

  it('drops blank keys and untouched defaults before sending', () => {
    expect(cleanKeys({ torboxApiKey: '  key  ', rdApiKey: '   ', mdblistKey: '' })).toEqual({
      torboxApiKey: 'key',
    });
    expect(pruneConfig({ streamPreset: 'lelibrary', homeRows: [], streamFilters: { hideUncached: false, minResolution: '', maxSizeGb: '' } })).toEqual({});
    expect(pruneConfig({ streamPreset: 'torrentio', homeRows: ['movie-night'] })).toEqual({
      streamPreset: 'torrentio',
      homeRows: ['movie-night'],
    });
  });
});

describe('import input', () => {
  it('accepts a pasted install link or a bare token id', () => {
    expect(tokenIdFromInput('jbzWeu2IYZptt0-clbY4zw')).toBe('jbzWeu2IYZptt0-clbY4zw');
    expect(tokenIdFromInput('https://lelibrary.uk/jbzWeu2IYZptt0-clbY4zw/manifest.json')).toBe('jbzWeu2IYZptt0-clbY4zw');
    expect(tokenIdFromInput('')).toBe('');
  });

  it('unwraps every old configure URL shape to its token id', () => {
    const id = '4v18KBDILCusxh7bDH-epA';
    expect(tokenIdFromInput(`https://lelibrary.uk/accounts/collections/${id}/configure`)).toBe(id);
    expect(tokenIdFromInput(`https://lelibrary.uk/accounts/collections/${id}/configure/`)).toBe(id);
    expect(tokenIdFromInput(`https://lelibrary.uk/accounts/${id}/configure`)).toBe(id);
    expect(tokenIdFromInput(`https://lelibrary.uk/${id}/configure`)).toBe(id);
    expect(tokenIdFromInput(`https://lelibrary.uk/${id}/configure?x=1`)).toBe(id);
    expect(tokenIdFromInput(`https://lelibrary.uk/accounts/collections/${id}/configure`)).not.toBe('configure');
  });

  it('masks token ids exactly like the server picker', () => {
    expect(maskTokenId('4v18KBDILCusxh7bDH-epA')).toBe('4v18…epA');
    expect(maskTokenId('short')).toBe('…');
  });
});

describe('password rules', () => {
  it('requires a minimum length and a matching confirmation', () => {
    expect(checkPassword('short', 'short').ok).toBe(false);
    expect(checkPassword('a-good-password', 'different').ok).toBe(false);
    expect(checkPassword('a-good-password', 'a-good-password').ok).toBe(true);
  });
});

describe('install url', () => {
  it('is built from the returned token, not assembled by hand', () => {
    expect(installUrl('https://lelibrary.uk', 'uuid.secret')).toBe('https://lelibrary.uk/uuid.secret/manifest.json');
    expect(installUrl('https://lelibrary.uk/', 'uuid.secret')).toBe('https://lelibrary.uk/uuid.secret/manifest.json');
  });
});

describe('edit session token', () => {
  it('is held in memory and expires', () => {
    setEditToken('token-value', 1000);
    expect(getEditToken()).toBe('token-value');
    vi.useFakeTimers();
    vi.advanceTimersByTime(1001);
    expect(getEditToken()).toBe(null);
    vi.useRealTimers();
  });
});
