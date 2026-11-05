import {
  isPortraitShape,
  toNativeSource,
  type CatalogSourceRef,
  type CollectionDoc,
  type FolderDoc,
  type NativeSourceRef,
} from '@/features/setup/shared/collection-doc';

type JsonRecord = Record<string, unknown>;

// A folder's sources the way Nuvio reads them: `sources` is the real list
// (every provider: addon, TMDB, Trakt) whenever it is present, and
// `catalogSources` is only Nuvio's derived addon-only copy, read when
// `sources` is absent (older exports). Community packs built from TMDB or
// Trakt carry an empty `catalogSources`, so reading only that imported every
// folder with 0 sources (issue #21). A folder written before either list
// existed names its single catalogue on the folder itself.
function rawFolderSources(folder: JsonRecord): JsonRecord[] {
  if (Array.isArray(folder['sources'])) return folder['sources'] as JsonRecord[];
  if (Array.isArray(folder['catalogSources'])) return folder['catalogSources'] as JsonRecord[];
  if (typeof folder['catalogId'] === 'string' && folder['catalogId'] !== '') {
    return [{
      catalogId: folder['catalogId'],
      type: folder['type'],
      genre: folder['genre'],
      addonId: (folder['addonId'] ?? folder['addon_id'] ?? '') as string,
      addonUrl: (folder['addonUrl'] ?? folder['addon_url'] ?? '') as string,
    }];
  }
  return [];
}

function isAddonSource(source: JsonRecord): boolean {
  const provider = String(source['provider'] || 'addon').trim().toLowerCase();
  return !provider || provider === 'addon';
}

function toCatalogSource(source: JsonRecord): CatalogSourceRef | null {
  const catalogId = String(source['catalogId'] || source['id'] || '');
  if (!catalogId) return null;
  const title = String(source['title'] || source['name'] || '').trim();
  return {
    addonId: String(source['addonId'] || source['addon_id'] || ''),
    addonUrl: String(source['addonUrl'] || source['addon_url'] || ''),
    catalogId,
    type: source['type'] === 'series' ? 'series' : 'movie',
    genre: String(source['genre'] || ''),
    // Display only: the server derives the transport label from the id.
    ...(title ? { title } : {}),
  };
}

// Normalize a raw community folder into the studio document. Addon sources
// become catalogue sources; TMDB and Trakt sources are kept as Nuvio-native
// sources (pushed back to Nuvio unchanged). Presentation falls back to the
// studio defaults.
export function toFolderDoc(raw: unknown, index: number, folderIndex: number): FolderDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const folder = raw as JsonRecord;
  const catalogSources: CatalogSourceRef[] = [];
  const nativeSources: NativeSourceRef[] = [];
  for (const source of rawFolderSources(folder)) {
    if (!source || typeof source !== 'object') continue;
    if (isAddonSource(source)) {
      const ref = toCatalogSource(source);
      if (ref) catalogSources.push(ref);
    } else {
      const ref = toNativeSource(source);
      if (ref) nativeSources.push(ref);
    }
  }
  return {
    id: String(folder['id'] || `imported-folder-${index}-${folderIndex}`),
    title: String(folder['title'] || folder['name'] || 'Folder').slice(0, 80),
    tileShape: isPortraitShape(folder['tileShape']) ? 'PORTRAIT' : 'LANDSCAPE',
    hideTitle: folder['hideTitle'] === true,
    coverImageUrl: String(folder['customCoverImageUrl'] || folder['coverImageUrl'] || folder['cover'] || ''),
    focusGifEnabled: folder['focusGifEnabled'] === true,
    focusGifUrl: String(folder['focusGifUrl'] || ''),
    heroBackdropUrl: String(folder['heroBackdropUrl'] || folder['backdropUrl'] || ''),
    catalogSources,
    ...(nativeSources.length ? { nativeSources } : {}),
    ...(String(folder['titleLogoUrl'] || '').trim() ? { titleLogoUrl: String(folder['titleLogoUrl']).trim() } : {}),
    ...(String(folder['heroVideoUrl'] || '').trim() ? { heroVideoUrl: String(folder['heroVideoUrl']).trim() } : {}),
  };
}

export function toCollectionDoc(raw: unknown, index: number): CollectionDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const collection = raw as JsonRecord;
  const folders = Array.isArray(collection['folders']) ? collection['folders'] : [];
  return {
    id: String(collection['id'] || `imported-${Date.now()}-${index}`),
    title: String(collection['title'] || collection['name'] || 'Imported collection').slice(0, 80),
    tileShape: isPortraitShape(collection['tileShape']) ? 'PORTRAIT' : 'LANDSCAPE',
    pinToTop: collection['pinToTop'] === true,
    focusGlowEnabled: collection['focusGlowEnabled'] !== false,
    showAllTab: collection['showAllTab'] !== false,
    viewMode: collection['viewMode'] === 'FOLLOW_LAYOUT' ? 'FOLLOW_LAYOUT' : 'TABBED_GRID',
    backdropUrl: String(collection['backdropImageUrl'] || collection['heroBackdropUrl'] || collection['backdropUrl'] || ''),
    hideTitle: collection['hideTitle'] === true,
    folders: folders
      .map((folder, folderIndex) => toFolderDoc(folder, index, folderIndex))
      .filter((folder): folder is FolderDoc => folder !== null),
  };
}

// The collections inside a community detail response: a pack's
// `envelope.collections` or a single `envelope.collection`.
export function detailCollections(data: unknown, item: JsonRecord): { root: JsonRecord; envelope: JsonRecord; collections: JsonRecord[] } {
  const root = ((data as JsonRecord)?.['item'] || data || item || {}) as JsonRecord;
  const envelope = ((root['envelope'] || (item['envelope'] as JsonRecord) || root || {}) as JsonRecord);
  const raw = envelope['collections'];
  const collections = Array.isArray(raw) ? raw as JsonRecord[]
    : envelope['collection'] && typeof envelope['collection'] === 'object' ? [envelope['collection'] as JsonRecord] : [];
  return { root, envelope, collections };
}

// Folder sources as the detail preview counts them (same rule as the import).
export function rawFolderSourceCount(folder: JsonRecord): number {
  return rawFolderSources(folder).length;
}

// The studio documents for a community item's collections, plus how many of
// its sources could not be kept (a provider Nuvio added after this code, or
// a source Nuvio itself would reject), so the import can say so instead of
// silently shrinking a folder.
export function importPublicCollections(collections: unknown[]): { collections: CollectionDoc[]; skipped: number } {
  let total = 0;
  let kept = 0;
  const docs: CollectionDoc[] = [];
  collections.forEach((raw, index) => {
    const doc = toCollectionDoc(raw, index);
    if (!doc) return;
    const folders = Array.isArray((raw as JsonRecord)['folders']) ? (raw as JsonRecord)['folders'] as unknown[] : [];
    for (const folder of folders) {
      if (folder && typeof folder === 'object') total += rawFolderSources(folder as JsonRecord).length;
    }
    for (const folder of doc.folders) kept += folder.catalogSources.length + (folder.nativeSources || []).length;
    docs.push(doc);
  });
  return { collections: docs, skipped: Math.max(0, total - kept) };
}
