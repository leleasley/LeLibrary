import { isPortraitShape } from '@/features/setup/shared/collection-doc';
import { useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import {
  HUB_COVER,
  type CollectionDoc,
  type FolderDoc,
} from '@/features/setup/shared/collection-doc';

// Quick Packs: curated collections from /api/curated-collections, materialized
// into editable studio copies. Pack → collection compilation mirrors the old
// wizard's packCollections()/togglePack() pair; ids stay `pack-{id}` so a
// re-toggle removes exactly what adding created.
export const HUB_VORTEX_GIF = '/collection-assets/collections/gifs/lelibrary-hub-vortex-focus.gif';
export const HUB_SYSTEM_COVER = '/collection-assets/collections/covers/lelibrary-hub-movie-collections-v2.png?v=2';

export interface CuratedSection {
  id: string;
  title: string;
  folders: string[];
}

export interface CuratedFolderSource {
  catalogId: string;
  type: string;
  // Human label the pack ships for this source; display only.
  title?: string;
}

export interface CuratedFolder {
  id: string;
  title: string;
  tileShape: string;
  hideTitle: boolean;
  coverImageUrl: string;
  focusGifEnabled: boolean;
  focusGifUrl: string;
  heroBackdropUrl: string;
  catalogSources: CuratedFolderSource[];
}

export interface CuratedPack {
  id: string;
  title: string;
  description: string;
  category: string;
  icon: string;
  refresh: string;
  coverImageUrl: string;
  backdropUrl: string;
  folderCount: number;
  folders: CuratedFolder[];
  sections: CuratedSection[];
}

function text(value: unknown, fallback = ''): string {
  const raw = String(value ?? '').trim();
  return raw || fallback;
}

function normalizeFolder(raw: Record<string, unknown> | null | undefined): CuratedFolder | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  const sources = Array.isArray(raw.catalogSources) ? raw.catalogSources : [];
  return {
    id: raw.id,
    title: text(raw.title, raw.id),
    tileShape: text(raw.tileShape),
    hideTitle: raw.hideTitle === true,
    coverImageUrl: text(raw.coverImageUrl),
    focusGifEnabled: raw.focusGifEnabled === true,
    focusGifUrl: text(raw.focusGifUrl),
    heroBackdropUrl: text(raw.heroBackdropUrl),
    catalogSources: sources
      .filter((source): source is Record<string, unknown> => !!source && typeof source === 'object')
      .map((source) => ({
        catalogId: text(source['catalogId']),
        type: text(source['type'], 'movie'),
        title: text(source['title']) || text(source['name']),
      }))
      .filter((source) => source.catalogId !== ''),
  };
}

export function normalizePack(raw: Record<string, unknown> | null | undefined): CuratedPack | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  const folders = Array.isArray(raw.folders) ? raw.folders : [];
  const sections = Array.isArray(raw.sections) ? raw.sections : [];
  const normalizedFolders = folders
    .map((folder) => normalizeFolder(folder as Record<string, unknown> | null))
    .filter((folder): folder is CuratedFolder => folder !== null);
  return {
    id: raw.id,
    title: text(raw.title, raw.id),
    description: text(raw.description, 'Curated collection'),
    category: text(raw.category, 'More picks'),
    icon: text(raw.icon, '✨'),
    refresh: text(raw.refresh, 'live'),
    coverImageUrl: text(raw.coverImageUrl),
    backdropUrl: text(raw.backdropUrl),
    folderCount: typeof raw.folderCount === 'number' ? raw.folderCount : normalizedFolders.length,
    folders: normalizedFolders,
    sections: sections
      .filter((section): section is Record<string, unknown> => !!section && typeof section === 'object' && typeof section.id === 'string')
      .map((section) => ({
        id: section.id as string,
        title: text(section.title, typeof section.id === 'string' ? section.id : ''),
        folders: (Array.isArray(section.folders) ? section.folders : []).map((id) => String(id)),
      })),
  };
}

export function useCuratedPacks(): { packs: CuratedPack[]; failed: boolean } {
  const [packs, setPacks] = useState<CuratedPack[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    apiClient.get<{ collections?: unknown[] }>('/api/curated-collections')
      .then((payload) => {
        if (cancelled) return;
        const list = Array.isArray(payload?.collections) ? payload.collections : [];
        setPacks(
          list
            .map((pack) => normalizePack(pack as Record<string, unknown> | null))
            .filter((pack): pack is CuratedPack => pack !== null),
        );
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);
  return { packs, failed };
}

function packFolderCopy(folder: CuratedFolder): FolderDoc {
  return {
    id: folder.id,
    title: folder.title,
    tileShape: isPortraitShape(folder.tileShape) ? 'PORTRAIT' : 'LANDSCAPE',
    hideTitle: folder.hideTitle,
    coverImageUrl: folder.coverImageUrl,
    focusGifEnabled: folder.focusGifEnabled,
    focusGifUrl: folder.focusGifUrl,
    heroBackdropUrl: folder.heroBackdropUrl,
    catalogSources: folder.catalogSources.map((source) => ({
      addonId: '',
      addonUrl: '',
      catalogId: source.catalogId,
      type: source.type === 'series' ? 'series' : 'movie',
      genre: '',
      // Display only: the server derives the transport label from the id.
      ...(source.title ? { title: source.title } : {}),
    })),
  };
}

const PACK_BASE = {
  tileShape: 'LANDSCAPE',
  pinToTop: false,
  focusGlowEnabled: true,
  showAllTab: true,
  viewMode: 'TABBED_GRID',
  hideTitle: false,
} as const;

export function packCollections(pack: CuratedPack): CollectionDoc[] {
  const folders = pack.folders || [];
  const base = { ...PACK_BASE, backdropUrl: pack.backdropUrl || '' };
  if (!Array.isArray(pack.sections) || pack.sections.length === 0) {
    return [{ ...base, id: `pack-${pack.id}`, title: pack.title, folders: folders.map(packFolderCopy) }];
  }
  return pack.sections
    .map((section) => {
      const wanted = new Set(section.folders || []);
      const selected = folders.filter(
        (folder) => wanted.has(folder.id) || [...wanted].some((id) => String(folder.id || '').endsWith(`-${id}`)),
      );
      return {
        ...base,
        id: `pack-${pack.id}-${section.id}`,
        title: section.title,
        folders: selected.map(packFolderCopy),
      };
    })
    .filter((collection) => collection.folders.length > 0);
}

export function packIdPrefix(packId: string): string {
  return `pack-${packId}`;
}

export function addPackToCollections(
  collections: CollectionDoc[],
  packs: string[],
  pack: CuratedPack,
): { collections: CollectionDoc[]; packs: string[]; openedId: string | null } {
  const nextPacks = packs.includes(pack.id) ? packs : [...packs, pack.id];
  const prefix = packIdPrefix(pack.id);
  const has = collections.some((collection) => collection.id === prefix || collection.id.startsWith(`${prefix}-`));
  const created = packCollections(pack);
  return {
    collections: has ? collections : [...collections, ...created],
    packs: nextPacks,
    openedId: created[0]?.id ?? null,
  };
}

export function removePackFromCollections(
  collections: CollectionDoc[],
  packs: string[],
  packId: string,
): { collections: CollectionDoc[]; packs: string[] } {
  const prefix = packIdPrefix(packId);
  return {
    collections: collections.filter(
      (collection) => collection.id !== prefix && !collection.id.startsWith(`${prefix}-`),
    ),
    packs: packs.filter((id) => id !== packId),
  };
}

export interface GifItem {
  title: string;
  url: string;
  cover: string;
  catalogSources: { catalogId: string }[];
  pack: string;
}

// Bundled focus animations: the Hub vortex plus every curated folder GIF.
export function focusGifLibrary(curated: CuratedPack[]): GifItem[] {
  const seen = new Set<string>([HUB_VORTEX_GIF]);
  const items: GifItem[] = [
    { title: 'LeLibrary Hub', url: HUB_VORTEX_GIF, cover: HUB_COVER, catalogSources: [], pack: 'LeLibrary' },
  ];
  for (const pack of curated) {
    for (const folder of pack.folders || []) {
      if (!folder.focusGifUrl || seen.has(folder.focusGifUrl)) continue;
      seen.add(folder.focusGifUrl);
      items.push({
        title: folder.title || 'Focus animation',
        url: folder.focusGifUrl,
        cover: folder.coverImageUrl || folder.heroBackdropUrl || folder.focusGifUrl,
        catalogSources: folder.catalogSources || [],
        pack: pack.title || 'Quick Pack',
      });
    }
  }
  return items;
}

// First bundled animation whose catalogues overlap the folder's sources.
export function matchingFocusGif(
  sources: { catalogId?: string }[],
  library: GifItem[],
): GifItem | null {
  const ids = new Set(sources.map((source) => String(source.catalogId || '').replace(/^lib-/, '')));
  return library.find((item) =>
    item.catalogSources.some((source) => ids.has(String(source.catalogId || '').replace(/^lib-/, ''))),
  ) ?? null;
}
