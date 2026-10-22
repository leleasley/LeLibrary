import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_ROWS,
  HUB_COLLECTION_ID,
  HUB_MOVIES_FOLDER_ID,
  HUB_SHOWS_FOLDER_ID,
  absoluteUrl,
  collectionDefault,
  folderDefault,
  friendlyCatalogName,
  homeCategoryRank,
  homeRowFromSource,
  hubCollection,
  hubPrefix,
  nativeLibraryRows,
  normalizeHomeOrder,
  normalizeTileShape,
  normalizeViewMode,
  orderCollections,
  ownedFranchiseMarker,
  sourceKey,
  type CollectionDoc,
} from '@/features/setup/shared/collection-doc';

describe('collection document', () => {
  it('builds blank collections and folders with the starter source', () => {
    const collection = collectionDefault();
    expect(collection.title).toBe('My Collection');
    expect(collection.tileShape).toBe('LANDSCAPE');
    expect(collection.viewMode).toBe('TABBED_GRID');
    expect(collection.folders).toEqual([]);
    const folder = folderDefault();
    expect(folder.catalogSources).toEqual([
      { addonId: '', addonUrl: '', catalogId: 'lib-genre_action_movies', type: 'movie', genre: '' },
    ]);
  });

  it('normalizes shapes and view modes to known values', () => {
    expect(normalizeTileShape('PORTRAIT')).toBe('PORTRAIT');
    expect(normalizeTileShape('landscape')).toBe('LANDSCAPE');
    expect(normalizeTileShape(undefined)).toBe('LANDSCAPE');
    expect(normalizeViewMode('FOLLOW_LAYOUT')).toBe('FOLLOW_LAYOUT');
    expect(normalizeViewMode('grid')).toBe('TABBED_GRID');
  });

  it('names catalogues without a registry entry', () => {
    expect(friendlyCatalogName('lib-genre_action_movies')).toBe('Genre Action Movies');
    expect(friendlyCatalogName('imp_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')).toBe('Private imported source');
    expect(friendlyCatalogName('')).toBe('Catalogue');
  });

  it('keys a source by addon, catalogue and type', () => {
    expect(sourceKey({ addonId: '', catalogId: 'lib-genre_action_movies', type: 'movie' }))
      .toBe('lelibrary:lib-genre_action_movies:movie');
  });

  it('maps providers to native prefixes with torbox preferred', () => {
    expect(hubPrefix('torbox,realdebrid')).toBe('torbox');
    expect(hubPrefix('realdebrid')).toBe('rd');
    expect(hubPrefix('alldebrid')).toBe('ad');
    expect(hubPrefix('premiumize')).toBe('pm');
    expect(hubPrefix('realdebrid,premiumize')).toBe('rd');
    expect(hubPrefix('')).toBe(null);
  });

  it('builds the Hub with fixed ids and absolute artwork', () => {
    const hub = hubCollection('torbox', 'https://example.test');
    expect(hub.id).toBe(HUB_COLLECTION_ID);
    expect(hub.folders.map((folder) => folder.id)).toEqual([HUB_MOVIES_FOLDER_ID, HUB_SHOWS_FOLDER_ID]);
    expect(hub.folders[0]?.catalogSources).toEqual([
      { addonId: '', addonUrl: '', catalogId: 'torbox-movies', type: 'movie', genre: '' },
    ]);
    expect(hub.folders[1]?.catalogSources[0]?.catalogId).toBe('torbox-series');
    for (const url of [hub.backdropUrl, hub.folders[0]?.coverImageUrl ?? '']) {
      expect(url.startsWith('https://example.test/collection-assets/')).toBe(true);
    }
  });

  it('keeps the Hub last and leaves other order alone', () => {
    const a = collectionDefault('A');
    const b = collectionDefault('B');
    const hub = hubCollection('rd', 'https://example.test');
    const ordered = orderCollections([hub, a, b]);
    expect(ordered.map((collection: CollectionDoc) => collection.id)).toEqual([a.id, b.id, hub.id]);
    expect(orderCollections([a, b]).map((collection) => collection.id)).toEqual([a.id, b.id]);
  });

  it('absolutizes artwork urls and drops blanks', () => {
    expect(absoluteUrl('https://example.test', '/x/y.png')).toBe('https://example.test/x/y.png');
    expect(absoluteUrl('https://example.test', '  ')).toBe('');
  });
});

describe('home rows', () => {
  it('builds native and discovery browser rows', () => {
    expect(nativeLibraryRows(null, 'nuvio')).toEqual(nativeLibraryRows('torbox', 'nuvio'));
    const native = nativeLibraryRows('torbox', 'nuvio');
    expect(native.map((row) => row.catalogId)).toEqual(['torbox-movies', 'torbox-series', 'torbox-anime']);
    const stremio = nativeLibraryRows('rd', 'stremio');
    expect(stremio.map((row) => row.catalogId)).toEqual(['rd-movies', 'rd-series', 'rd-anime', 'torbox-collections']);
    expect(DISCOVERY_ROWS.map((row) => row.catalogId)).toEqual([
      'torbox-trending-movies', 'torbox-trending-series', 'torbox-popular-movies', 'torbox-popular-series',
    ]);
  });

  it('builds rows from browser sources', () => {
    const row = homeRowFromSource(
      { id: 'x', catalogId: 'lib-genre_action_movies', name: 'Action', type: 'movie', category: 'LeLibrary', addonId: '' },
      3,
    );
    expect(row.title).toBe('Action');
    expect(row.source).toEqual({
      kind: 'catalog', id: 'lib-genre_action_movies', catalogId: 'lib-genre_action_movies',
      type: 'movie', addonId: '', addonUrl: '',
    });
    expect(row).toMatchObject({ enabled: true, limit: 20, order: 3, customTitle: false });
  });

  it('strips franchise rows for nuvio and reorders', () => {
    const marker = ownedFranchiseMarker(0);
    const rows = [
      homeRowFromSource({ id: 'a', catalogId: 'lib-x', name: 'X', type: 'movie', category: 'Other', addonId: '' }, 0),
      { ...homeRowFromSource({ id: 'b', catalogId: 'torbox-collections', name: 'Franchise', type: 'movie', category: 'LeLibrary', addonId: '' }, 1) },
      marker,
    ];
    const nuvio = normalizeHomeOrder(rows, 'nuvio');
    expect(nuvio.map((row) => row.id)).toEqual([rows[0]?.id, marker.id]);
    expect(nuvio.map((row) => row.order)).toEqual([0, 1]);
    const stremio = normalizeHomeOrder(rows, 'stremio');
    expect(stremio).toHaveLength(3);
  });

  it('ranks browser groups lelivery first', () => {
    expect(homeCategoryRank('LeLibrary')).toBe(-10);
    expect(homeCategoryRank('Trending')).toBe(0);
    expect(homeCategoryRank('Popular')).toBe(1);
    expect(homeCategoryRank('Other')).toBe(5);
  });
});
