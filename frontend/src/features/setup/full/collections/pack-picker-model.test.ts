import { describe, expect, it } from 'vitest';
import type { CuratedFolder, CuratedPack } from '@/features/setup/full/collections/curated-packs';
import type { CollectionDoc } from '@/features/setup/shared/collection-doc';
import {
  HOME_FOLDER_WARNING,
  addPackFolders,
  addableFolders,
  folderLocked,
  folderPresence,
  inSeason,
  nextSeasonStart,
  packLocked,
  presentSourceIds,
  sizeMeter,
  visibleFolders,
} from '@/features/setup/full/collections/pack-picker-model';

function folder(id: string, sourceIds: string[], extra: Partial<CuratedFolder> = {}): CuratedFolder {
  return {
    id, title: id, tileShape: 'LANDSCAPE', hideTitle: false, coverImageUrl: '', focusGifEnabled: false,
    focusGifUrl: '', heroBackdropUrl: '',
    catalogSources: sourceIds.map((sid) => ({ catalogId: `lib-${sid}`, type: sid.endsWith('_series') ? 'series' : 'movie' })),
    sourceIds,
    ...extra,
  };
}

function pack(id: string, folders: CuratedFolder[], extra: Partial<CuratedPack> = {}): CuratedPack {
  return {
    id, title: id, description: '', category: '', icon: '', refresh: 'live', coverImageUrl: '', backdropUrl: '',
    folderCount: folders.length, folders, sections: [], ...extra,
  };
}

const DISCOVER = pack('discover', [
  folder('folder-lelibrary-trending', ['trending_movies', 'trending_series']),
  folder('folder-lelibrary-popular', ['tmdb_popular_movies', 'tmdb_popular_series']),
]);
// Special repeats the standard folders across sections.
const SPECIAL = pack('lelibrary-special', [
  folder('folder-lelibrary-trending', ['trending_movies', 'trending_series']),
  folder('folder-lelibrary-popular', ['tmdb_popular_movies', 'tmdb_popular_series']),
  folder('folder-lelibrary-action', ['genre_action_movies']),
], {
  kind: 'bundle',
  sections: [
    { id: 'discover', title: 'Discover', folders: ['folder-lelibrary-trending', 'folder-lelibrary-popular'] },
    { id: 'genres', title: 'Genres', folders: ['folder-lelibrary-action'] },
  ],
});
const GB = { region: 'GB', hasMdblistKey: false };

function allSources(collections: CollectionDoc[]): string[] {
  return collections.flatMap((collection) => collection.folders.flatMap((item) => item.catalogSources.map((source) => source.catalogId)));
}

describe('pack picker model: dedupe on add', () => {
  it('adds Discover then Special without any source twice', () => {
    const first = addPackFolders([], DISCOVER, GB);
    expect(first.added).toBe(2);
    const second = addPackFolders(first.collections, SPECIAL, GB);
    expect(second.added).toBe(1);
    const sources = allSources(second.collections);
    expect(new Set(sources).size).toBe(sources.length);
    expect(second.collections.map((collection) => collection.id)).toEqual(['pack-discover', 'pack-lelibrary-special-genres']);
  });

  it('keeps only the new sources of a partly present folder', () => {
    const start = addPackFolders([], pack('top10', [folder('folder-lelibrary-top10', ['trending_movies'])]), GB).collections;
    const next = addPackFolders(start, DISCOVER, GB);
    const trending = next.collections.find((collection) => collection.id === 'pack-discover')?.folders[0];
    expect(trending?.catalogSources.map((source) => source.catalogId)).toEqual(['lib-trending_series']);
    expect(folderPresence(DISCOVER.folders[0]!, presentSourceIds(start, {}), {})).toBe('partial');
  });

  it('treats an old alias id as the source it serves', () => {
    const old: CollectionDoc[] = [{
      id: 'mine', title: 'Mine', tileShape: 'LANDSCAPE', pinToTop: false, focusGlowEnabled: true, showAllTab: true,
      viewMode: 'TABBED_GRID', backdropUrl: '', hideTitle: false,
      folders: [{ id: 'f', title: 'f', tileShape: 'LANDSCAPE', hideTitle: false, coverImageUrl: '', focusGifEnabled: false, focusGifUrl: '', heroBackdropUrl: '',
        catalogSources: [{ addonId: '', addonUrl: '', catalogId: 'lib-collection_universe_star_wars', type: 'movie', genre: '' }] }],
    }];
    const sw = pack('franchises', [folder('folder-lelibrary-sw', ['collection_star_wars'])]);
    expect(addPackFolders(old, sw, { ...GB, aliases: { collection_universe_star_wars: 'collection_star_wars' } }).added).toBe(0);
    expect(addPackFolders(old, sw, GB).added).toBe(1);
  });

  it('skips unticked folders and extends an earlier partial add in place', () => {
    const skip = new Set(['folder-lelibrary-popular']);
    const first = addPackFolders([], DISCOVER, { ...GB, excluded: skip });
    expect(first.collections[0]?.folders.map((item) => item.id)).toEqual(['folder-lelibrary-trending']);
    const second = addPackFolders(first.collections, DISCOVER, GB);
    expect(second.collections).toHaveLength(1);
    expect(second.collections[0]?.folders.map((item) => item.id)).toEqual(['folder-lelibrary-trending', 'folder-lelibrary-popular']);
  });
});

describe('pack picker model: gating', () => {
  const streaming = pack('streaming-region', [
    folder('folder-lelibrary-netflix', ['streaming_netflix_movies']),
    folder('folder-lelibrary-bbc', ['svc_bbc_iplayer_movies'], { regions: ['GB'] }),
    folder('folder-lelibrary-joyn', ['svc_joyn_movies'], { regions: ['DE'] }),
  ]);

  it('hides folders outside the region and never adds them', () => {
    expect(visibleFolders(streaming, 'GB').map((item) => item.id)).toEqual(['folder-lelibrary-netflix', 'folder-lelibrary-bbc']);
    expect(visibleFolders(streaming, 'DE').map((item) => item.id)).toEqual(['folder-lelibrary-netflix', 'folder-lelibrary-joyn']);
    const added = addPackFolders([], streaming, GB);
    expect(allSources(added.collections)).not.toContain('lib-svc_joyn_movies');
  });

  it('locks MDBList folders until a key exists', () => {
    const charts = pack('charts', [folder('folder-lelibrary-week', ['chart_watched_week_movies'], { needsMdblistKey: true })], { requiresMdblistKey: true });
    expect(packLocked(charts, false)).toBe(true);
    expect(folderLocked(charts, charts.folders[0]!, false)).toBe(true);
    expect(addableFolders(charts, [], GB)).toHaveLength(0);
    expect(addPackFolders([], charts, GB).added).toBe(0);
    expect(packLocked(charts, true)).toBe(false);
    expect(addPackFolders([], charts, { ...GB, hasMdblistKey: true }).added).toBe(1);
    // A single keyed folder inside an open pack locks only itself.
    const mixed = pack('mixed', [folder('a', ['x_movies']), folder('b', ['y_movies'], { needsMdblistKey: true })]);
    expect(packLocked(mixed, false)).toBe(false);
    expect(addableFolders(mixed, [], GB).map((item) => item.id)).toEqual(['a']);
  });
});

describe('pack picker model: seasons', () => {
  const christmas = { from: '11-15', to: '01-06' };
  const halloween = { from: '10-01', to: '11-02' };
  it('handles windows that wrap the year end', () => {
    expect(inSeason(christmas, new Date(2026, 11, 25))).toBe(true);
    expect(inSeason(christmas, new Date(2027, 0, 6))).toBe(true);
    expect(inSeason(christmas, new Date(2027, 0, 7))).toBe(false);
    expect(inSeason(christmas, new Date(2026, 9, 28))).toBe(false);
    expect(inSeason(halloween, new Date(2026, 9, 28))).toBe(true);
  });
  it('names the next opening date', () => {
    expect(nextSeasonStart(christmas, new Date(2026, 9, 28))).toEqual(new Date(2026, 10, 15));
    expect(nextSeasonStart(halloween, new Date(2026, 10, 3))).toEqual(new Date(2027, 9, 1));
  });
});

describe('pack picker model: size meter', () => {
  function docs(count: number): CollectionDoc[] {
    return [{
      id: 'c', title: 'c', tileShape: 'LANDSCAPE', pinToTop: false, focusGlowEnabled: true, showAllTab: true,
      viewMode: 'TABBED_GRID', backdropUrl: '', hideTitle: false,
      folders: Array.from({ length: count }, (_, index) => ({
        id: `f${index}`, title: 'f', tileShape: 'LANDSCAPE' as const, hideTitle: false, coverImageUrl: '', focusGifEnabled: false, focusGifUrl: '', heroBackdropUrl: '',
        catalogSources: [{ addonId: '', addonUrl: '', catalogId: `lib-s${index}_movies`, type: 'movie' as const, genre: '' }, { addonId: '', addonUrl: '', catalogId: `lib-s${index}_series`, type: 'series' as const, genre: '' }],
      })),
    }];
  }
  it('warns only above the Nuvio Home threshold', () => {
    expect(HOME_FOLDER_WARNING).toBe(60);
    expect(sizeMeter(docs(60)).warn).toBe(false);
    expect(sizeMeter(docs(61)).warn).toBe(true);
    const meter = sizeMeter(docs(3));
    expect(meter).toEqual({ collections: 1, folders: 3, catalogues: 6, warn: false });
  });
  it('ignores the Hub collection', () => {
    const hub = { ...docs(2)[0]!, id: 'collection-lelibrary-hub' };
    expect(sizeMeter([hub]).folders).toBe(0);
  });
});
