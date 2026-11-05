import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { folderSourceCount } from '@/features/setup/shared/collection-doc';
import { detailCollections, importPublicCollections, toFolderDoc } from '@/features/setup/full/public-collection-import';

// Trimmed real public Nuvio community collections (TMDB discover, collection,
// person and company packs plus an addon pack), shared with the backend tests.
const fixture = JSON.parse(readFileSync(new URL('../../../../../backend/test/fixtures/nuvio-public-collections.json', import.meta.url), 'utf8')) as Record<string, unknown>;

function imported() {
  const { collections } = detailCollections(fixture, {});
  return importPublicCollections(collections);
}

describe('public Nuvio collection import (issue #21)', () => {
  it('keeps every folder source, including TMDB packs whose catalogSources is empty', () => {
    const { collections, skipped } = imported();
    expect(skipped).toBe(0);
    expect(collections.map((collection) => collection.title)).toEqual(['Networks', 'Film Collections', 'Actors', 'Studios', 'Streaming Services', 'Awards']);
    for (const collection of collections) {
      expect(collection.folders.length).toBeGreaterThan(0);
      for (const folder of collection.folders) expect(folderSourceCount(folder)).toBe(2);
    }
  });

  it('keeps TMDB sources in Nuvio shape and addon sources as catalogue sources', () => {
    const { collections } = imported();
    const [networks, films, actors, studios, streaming, awards] = collections;
    const nbc = networks!.folders[0]!;
    expect(nbc.catalogSources).toEqual([]);
    expect(nbc.nativeSources?.[0]).toEqual({
      provider: 'tmdb',
      tmdbSourceType: 'DISCOVER',
      tmdbId: null,
      title: 'Popular Series',
      mediaType: 'TV',
      sortBy: 'popularity.desc',
      filters: { voteCountGte: 50, withNetworks: '6', withOriginalLanguage: 'en' },
    });
    // A hidden-title folder keeps its logo, or Nuvio shows it nameless.
    expect(nbc.hideTitle).toBe(true);
    expect(nbc.titleLogoUrl).toMatch(/^https:\/\//);
    expect(films!.folders[0]!.nativeSources?.[0]).toMatchObject({ tmdbSourceType: 'COLLECTION', tmdbId: 14890, mediaType: 'MOVIE' });
    expect(actors!.folders[0]!.nativeSources?.map((source) => source.mediaType)).toEqual(['MOVIE', 'TV']);
    expect(studios!.folders[0]!.nativeSources?.[0]).toMatchObject({ tmdbSourceType: 'COMPANY' });
    expect(awards!.folders[0]!.nativeSources?.[0]).toEqual({
      provider: 'trakt', traktListId: 4325279, title: 'Best Picture - All Time', mediaType: 'MOVIE', sortBy: 'rank', sortHow: 'asc',
    });
    const netflix = streaming!.folders[0]!;
    expect(netflix.nativeSources).toBeUndefined();
    expect(netflix.catalogSources.map((source) => [source.addonId, source.catalogId, source.type])).toEqual([
      ['aio-metadata', 'custom.pw_ers_netflix_catalog.movie.nfx', 'movie'],
      ['aio-metadata', 'custom.pw_ers_netflix_catalog.series.nfx', 'series'],
    ]);
  });

  it('reads catalogSources when a folder has no sources list, and the old single-catalogue folder', () => {
    const old = toFolderDoc({ id: 'f', title: 'Old', catalogSources: [{ addonId: 'x', catalogId: 'top', type: 'series' }] }, 0, 0);
    expect(old?.catalogSources).toMatchObject([{ addonId: 'x', catalogId: 'top', type: 'series' }]);
    const legacy = toFolderDoc({ id: 'g', title: 'Older', catalogId: 'lib-trending_movies', type: 'movie' }, 0, 0);
    expect(legacy?.catalogSources.map((source) => source.catalogId)).toEqual(['lib-trending_movies']);
  });

  it('keeps Trakt list sources and counts what it cannot keep instead of dropping it silently', () => {
    const { collections, skipped } = importPublicCollections([{
      id: 'c', title: 'Mixed', folders: [{
        id: 'f', title: 'Mixed', catalogSources: [],
        sources: [
          { provider: 'trakt', traktListId: 2143363, title: 'Trakt list', mediaType: 'TV', sortBy: 'rank', sortHow: 'DESC' },
          { provider: 'tmdb', tmdbSourceType: 'PERSON', tmdbId: null, title: 'No person id' },
          { provider: 'somethingnew', title: 'Future kind' },
        ],
      }],
    }]);
    expect(collections[0]!.folders[0]!.nativeSources).toEqual([
      { provider: 'trakt', traktListId: 2143363, title: 'Trakt list', mediaType: 'TV', sortBy: 'rank', sortHow: 'desc' },
    ]);
    expect(skipped).toBe(2);
  });
});
