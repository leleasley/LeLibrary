import {
  HUB_COLLECTION_ID,
  isPortraitShape,
  normaliseSourceCatalogId,
  type CollectionDoc,
  type FolderDoc,
} from '@/features/setup/shared/collection-doc';
import type { CuratedFolder, CuratedPack, PackKind, SeasonWindow } from '@/features/setup/full/collections/curated-packs';

// Pure logic behind the pack picker (PackLibraryModal): region and key
// gating, season windows, dedupe by catalogue source and the Nuvio Home size
// meter. Kept free of React so every rule is unit tested.

// The picker's fixed, non-overlapping filters (server: PACK_FILTERS).
export const PACK_FILTERS = [
  { id: 'streaming', label: 'Streaming' },
  { id: 'genres', label: 'Genres & Moods' },
  { id: 'franchises', label: 'Franchises & Universes' },
  { id: 'people', label: 'People' },
  { id: 'world', label: 'World & Regional' },
  { id: 'seasonal', label: 'Seasonal' },
  { id: 'kids', label: 'Kids & Family' },
  { id: 'charts', label: 'Charts' },
] as const;

// Nuvio Home gets crowded above about this many folders.
export const HOME_FOLDER_WARNING = 60;

export interface PickerContext {
  region: string;
  hasMdblistKey: boolean;
}

export function packKind(pack: CuratedPack): PackKind {
  if (pack.kind) return pack.kind;
  if (pack.id === 'lelibrary-special') return 'bundle';
  return (pack.folderCount || pack.folders.length) > 4 ? 'pack' : 'single';
}

// ── Region and key gating ─────────────────────────────────────────────
export function folderInRegion(folder: Pick<CuratedFolder, 'regions'>, region: string): boolean {
  return !folder.regions || folder.regions.length === 0 || folder.regions.includes(region);
}

export function folderLocked(pack: Pick<CuratedPack, 'requiresMdblistKey'>, folder: Pick<CuratedFolder, 'needsMdblistKey'>, hasMdblistKey: boolean): boolean {
  return !hasMdblistKey && (pack.requiresMdblistKey === true || folder.needsMdblistKey === true);
}

export function packLocked(pack: CuratedPack, hasMdblistKey: boolean): boolean {
  if (hasMdblistKey) return false;
  if (pack.requiresMdblistKey === true) return true;
  const visible = pack.folders;
  return visible.length > 0 && visible.every((folder) => folder.needsMdblistKey === true);
}

// Folders the user can see in their region. A provider folder is only
// "hidden" when it is a streaming service; other region-bound folders
// (Thanksgiving) are counted separately so the note stays accurate.
export function visibleFolders(pack: CuratedPack, region: string): CuratedFolder[] {
  return pack.folders.filter((folder) => folderInRegion(folder, region));
}

export function hiddenByRegion(pack: CuratedPack, region: string): CuratedFolder[] {
  return pack.folders.filter((folder) => !folderInRegion(folder, region));
}

// ── Season windows ────────────────────────────────────────────────────
function monthDay(value: string): [number, number] {
  const [month, day] = value.split('-').map((part) => Number(part));
  return [month ?? 1, day ?? 1];
}

function dayKey(month: number, day: number): number {
  return month * 100 + day;
}

export function inSeason(season: SeasonWindow, today: Date): boolean {
  const [fromMonth, fromDay] = monthDay(season.from);
  const [toMonth, toDay] = monthDay(season.to);
  const now = dayKey(today.getMonth() + 1, today.getDate());
  const from = dayKey(fromMonth, fromDay);
  const to = dayKey(toMonth, toDay);
  return from <= to ? now >= from && now <= to : now >= from || now <= to;
}

// The next date the window opens (this year or next).
export function nextSeasonStart(season: SeasonWindow, today: Date): Date {
  const [month, day] = monthDay(season.from);
  const candidate = new Date(today.getFullYear(), month - 1, day);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return candidate < startOfToday ? new Date(today.getFullYear() + 1, month - 1, day) : candidate;
}

// ── Sources already in the document ───────────────────────────────────
export function canonicalId(id: string, aliases: Record<string, string>): string {
  const raw = String(id || '').replace(/^lib-/, '');
  return aliases[raw] || raw;
}

function docSourceId(source: { catalogId: string; genre?: string; addonId?: string }): string {
  const catalogId = normaliseSourceCatalogId(source.catalogId);
  if (catalogId.startsWith('lib-')) return catalogId.slice(4);
  const genre = String(source.genre || '');
  if (/^lelibrary-curated-/.test(catalogId) && genre.startsWith('lib-')) return genre.slice(4);
  return '';
}

export function presentSourceIds(collections: CollectionDoc[], aliases: Record<string, string>): Set<string> {
  const present = new Set<string>();
  for (const collection of collections) {
    if (collection.id === HUB_COLLECTION_ID) continue;
    for (const folder of collection.folders) {
      for (const source of folder.catalogSources) {
        const id = docSourceId(source);
        if (id) present.add(canonicalId(id, aliases));
      }
    }
  }
  return present;
}

export function folderSourceIds(folder: CuratedFolder, aliases: Record<string, string>): string[] {
  const ids = folder.sourceIds && folder.sourceIds.length
    ? folder.sourceIds
    : folder.catalogSources.map((source) => source.catalogId);
  return [...new Set(ids.map((id) => canonicalId(id, aliases)))];
}

export type FolderPresence = 'added' | 'partial' | 'new';

export function folderPresence(folder: CuratedFolder, present: Set<string>, aliases: Record<string, string>): FolderPresence {
  const ids = folderSourceIds(folder, aliases);
  const have = ids.filter((id) => present.has(id)).length;
  if (ids.length > 0 && have === ids.length) return 'added';
  return have > 0 ? 'partial' : 'new';
}

// ── Adding a pack ─────────────────────────────────────────────────────
const PACK_BASE = {
  tileShape: 'LANDSCAPE',
  pinToTop: false,
  focusGlowEnabled: true,
  showAllTab: true,
  viewMode: 'TABBED_GRID',
  hideTitle: false,
} as const;

function folderCopy(folder: CuratedFolder, keep: (source: CuratedFolder['catalogSources'][number]) => boolean): FolderDoc {
  return {
    id: folder.id,
    title: folder.title,
    tileShape: isPortraitShape(folder.tileShape) ? 'PORTRAIT' : 'LANDSCAPE',
    hideTitle: folder.hideTitle,
    coverImageUrl: folder.coverImageUrl,
    focusGifEnabled: folder.focusGifEnabled,
    focusGifUrl: folder.focusGifUrl,
    heroBackdropUrl: folder.heroBackdropUrl,
    catalogSources: folder.catalogSources.filter(keep).map((source) => ({
      addonId: '',
      addonUrl: '',
      catalogId: source.catalogId,
      type: source.type === 'series' ? 'series' : 'movie',
      genre: '',
      ...(source.title ? { title: source.title } : {}),
    })),
  };
}

// The collections a pack compiles to: one per section, else one for the pack.
export function packGroups(pack: CuratedPack): { id: string; title: string; folders: CuratedFolder[] }[] {
  if (!pack.sections.length) return [{ id: `pack-${pack.id}`, title: pack.title, folders: pack.folders }];
  return pack.sections
    .map((section) => {
      const wanted = new Set(section.folders);
      return {
        id: `pack-${pack.id}-${section.id}`,
        title: section.title,
        folders: pack.folders.filter((folder) => wanted.has(folder.id)
          || section.folders.some((id) => folder.id.endsWith(`-${id}`))),
      };
    })
    .filter((group) => group.folders.length > 0);
}

export interface AddOptions extends PickerContext {
  // Folders the user unticked in "Peek inside".
  excluded?: ReadonlySet<string>;
  aliases?: Record<string, string>;
}

// Folders adding the pack would bring in: in the region, not locked, not
// unticked and not already in the document.
export function addableFolders(pack: CuratedPack, collections: CollectionDoc[], options: AddOptions): CuratedFolder[] {
  const aliases = options.aliases ?? {};
  const present = presentSourceIds(collections, aliases);
  const out: CuratedFolder[] = [];
  for (const folder of visibleFolders(pack, options.region)) {
    if (options.excluded?.has(folder.id)) continue;
    if (folderLocked(pack, folder, options.hasMdblistKey)) continue;
    const ids = folderSourceIds(folder, aliases).filter((id) => !present.has(id));
    if (!ids.length) continue;
    ids.forEach((id) => present.add(id));
    out.push(folder);
  }
  return out;
}

// Adds a pack to the collections document. Only folders that bring at least
// one new catalogue source are added, and a folder that partly overlaps
// keeps only its new sources: no source is ever added twice. An existing
// `pack-<id>` collection (an earlier partial add) is extended in place.
export function addPackFolders(
  collections: CollectionDoc[],
  pack: CuratedPack,
  options: AddOptions,
): { collections: CollectionDoc[]; added: number; openedId: string | null } {
  const aliases = options.aliases ?? {};
  const present = presentSourceIds(collections, aliases);
  const allowed = new Set(addableFolders(pack, collections, options).map((folder) => folder.id));
  const next = collections.map((collection) => ({ ...collection, folders: collection.folders.slice() }));
  let added = 0;
  let openedId: string | null = null;
  for (const group of packGroups(pack)) {
    const folders: FolderDoc[] = [];
    for (const folder of group.folders) {
      if (!allowed.has(folder.id)) continue;
      const copy = folderCopy(folder, (source) => {
        const id = canonicalId(source.catalogId, aliases);
        if (present.has(id)) return false;
        present.add(id);
        return true;
      });
      if (!copy.catalogSources.length) continue;
      folders.push(copy);
    }
    if (!folders.length) continue;
    added += folders.length;
    const existing = next.find((collection) => collection.id === group.id);
    if (existing) {
      const known = new Set(existing.folders.map((folder) => folder.id));
      existing.folders.push(...folders.filter((folder) => !known.has(folder.id)));
    } else {
      next.push({ ...PACK_BASE, backdropUrl: pack.backdropUrl || '', id: group.id, title: group.title, folders });
    }
    openedId = openedId ?? group.id;
  }
  return { collections: next, added, openedId };
}

export function packCollectionsIn(collections: CollectionDoc[], packId: string): CollectionDoc[] {
  const prefix = `pack-${packId}`;
  return collections.filter((collection) => collection.id === prefix || collection.id.startsWith(`${prefix}-`));
}

// ── Nuvio Home size meter ─────────────────────────────────────────────
export interface SizeMeter {
  collections: number;
  folders: number;
  catalogues: number;
  warn: boolean;
}

export function sizeMeter(collections: CollectionDoc[], aliases: Record<string, string> = {}): SizeMeter {
  const regular = collections.filter((collection) => collection.id !== HUB_COLLECTION_ID);
  const folders = regular.reduce((total, collection) => total + collection.folders.length, 0);
  return {
    collections: regular.length,
    folders,
    catalogues: presentSourceIds(regular, aliases).size,
    warn: folders > HOME_FOLDER_WARNING,
  };
}
