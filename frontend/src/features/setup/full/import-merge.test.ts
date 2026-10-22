import { describe, expect, it } from 'vitest';
import { cleanImportedDocs, importedKeys, importPushConn, mergeImportPreview } from '@/features/setup/full/import-merge';
import type { ImportPreview, OldSetupData } from '@/features/setup/resolver/api';

function preview(overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    config: {},
    sourceLabel: 'My setup',
    kind: 'token',
    keyServices: ['torboxApiKey', 'tmdbApiKey'],
    watchlist: [],
    push: [],
    collections: { contexts: 0, collections: 0 },
    ...overrides,
  };
}

describe('import preview merge', () => {
  it('maps engine fields onto drafts and keeps secrets out', () => {
    const merged = mergeImportPreview(preview({
      config: {
        torboxApiKey: 'MUST-NOT-COME-ACROSS',
        tmdbApiKey: 'MUST-NOT-COME-ACROSS',
        posterProvider: 'pictorium',
        streamPreset: 'torrentio',
        libraryIdMode: 'tt',
        hideAnime: true,
        lang: 'pt-BR',
        filterResolutions: ['1080p'],
        filterCachedOnly: true,
        streamAddons: ['comet'],
        wizardPlatform: 'stremio',
        rdCatalog: 'separate',
      },
    }));
    expect(merged.name).toBe('My setup');
    expect(merged.platform).toBe('stremio');
    expect(merged.rdCatalog).toBe('separate');
    expect(merged.posters.provider).toBe('pictorium');
    expect(merged.formatting.preset).toBe('torrentio');
    expect(merged.meta).toMatchObject({ mainMetadata: true, hideAnime: true, lang: 'pt-BR' });
    expect(merged.filterSets).toMatchObject({ resolutions: ['1080p'], cachedOnly: true });
    expect(merged.addons).toEqual(['comet']);
    expect(JSON.stringify(merged)).not.toContain('MUST-NOT-COME-ACROSS');
  });

  it('ignores unknown platform and catalog values instead of corrupting drafts', () => {
    const merged = mergeImportPreview(preview({
      config: { wizardPlatform: 'kodi', rdCatalog: 'everything' },
    }));
    expect(merged.platform).toBeNull();
    expect(merged.rdCatalog).toBeNull();
  });

  it('keeps only well-shaped collections', () => {
    const good = { id: 'c1', title: 'C', folders: [] };
    const merged = mergeImportPreview(preview({
      config: { collections: [good, null, { title: 'no id' }] },
    }));
    expect(merged.collections).toEqual([good]);
  });

  it('leaves everything empty for a bare preview', () => {
    const merged = mergeImportPreview(preview());
    expect(merged.name).toBe('My setup');
    expect(merged.platform).toBeNull();
    expect(merged.addons).toEqual([]);
    expect(merged.collections).toEqual([]);
    expect(merged.packs).toEqual([]);
    expect(merged.meta).toEqual({});
  });
});

function fullData(overrides: Partial<OldSetupData> = {}): OldSetupData {
  return {
    keys: {},
    watchlist: [],
    push: [],
    collections: [],
    homeRows: [],
    context: null,
    config: {},
    sourceLabel: null,
    kind: 'token',
    ...overrides,
  };
}

describe('full data import helpers', () => {
  it('fills key inputs only from string values', () => {
    const keys = importedKeys(fullData({
      keys: { torboxApiKey: 'tb-x', tmdbApiKey: 'tmdb-x', watchlist: { trakt: {} }, empty: '', nada: null },
    }));
    expect(keys).toEqual({ torboxApiKey: 'tb-x', tmdbApiKey: 'tmdb-x' });
  });

  it('keeps only well-shaped collection and home-row documents', () => {
    const { collections, homeRows } = cleanImportedDocs(fullData({
      collections: [
        { id: 'c1', title: 'C', folders: [{ id: 'f1' }] },
        { title: 'no id', folders: [] },
        'junk',
      ],
      homeRows: [
        { id: 'r1', title: 'R', source: { kind: 'catalog', id: 'x', catalogId: 'x', type: 'movie' } },
        { id: 'r2', title: 'Bad', source: { kind: 'catalog', id: 'x', catalogId: 'x', type: 'episode' } },
        { id: 'r3', title: 'No source' },
      ],
    }));
    expect(collections).toHaveLength(1);
    expect(homeRows).toHaveLength(1);
    expect(homeRows[0]?.id).toBe('r1');
  });

  it('restores a saved nuvio login from any token field variant', () => {
    const viaNested = importPushConn(fullData({
      keys: { push: { nuvio: { session: { access_token: 'tok-1' }, nuvioSelectedProfile: 2 } } },
    }), 'nuvio');
    expect(viaNested?.nuvioToken).toBe('tok-1');
    expect(viaNested?.nuvioSelectedProfile).toBe(2);
    expect(importPushConn(fullData(), 'nuvio')).toBeNull();
    expect(importPushConn(fullData({ keys: { push: { stremio: { stremioAuth: 's1' } } } }), 'nuvio')).toBeNull();
  });

  it('restores a saved stremio login', () => {
    const conn = importPushConn(fullData({
      keys: { push: { stremio: { stremioAuth: 's1' } } },
    }), 'stremio');
    expect(conn).toMatchObject({ platform: 'stremio', stremioAuth: 's1' });
  });
});

describe('picker document merge', () => {
  const docs = {
    collections: [
      { id: 'c1', title: 'One', folders: [] },
      { id: 'c2', title: 'Two', folders: [] },
    ] as unknown as import('@/features/setup/shared/collection-doc').CollectionDoc[],
    homeRows: [
      { id: 'r1', title: 'Row', source: { kind: 'catalog', id: 'x', catalogId: 'x', type: 'movie' } },
    ] as unknown as import('@/features/setup/shared/collection-doc').HomeRowDoc[],
  };

  it('fills empty studio state wholesale', async () => {
    const { mergeImportDocs } = await import('@/features/setup/full/import-merge');
    const out = mergeImportDocs([], [], docs);
    expect(out.collections).toHaveLength(2);
    expect(out.homeRows).toHaveLength(1);
  });

  it('never duplicates what is already there', async () => {
    const { mergeImportDocs } = await import('@/features/setup/full/import-merge');
    const out = mergeImportDocs(
      docs.collections.slice(0, 1),
      docs.homeRows,
      docs,
    );
    expect(out.collections?.map((collection) => collection.id)).toEqual(['c1', 'c2']);
    expect(out.homeRows).toBeNull();
  });

  it('skips the update entirely when the payload carries nothing', async () => {
    const { mergeImportDocs } = await import('@/features/setup/full/import-merge');
    const out = mergeImportDocs(docs.collections.slice(0, 1), [], { collections: [], homeRows: [] });
    expect(out).toEqual({ collections: null, homeRows: null });
  });
});
