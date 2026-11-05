import {
  collectionEntries,
  moveCollectionEntryTo,
  normalizeHomeOrder,
  type CollectionDoc,
  type HomeRowDoc,
} from '@/features/setup/shared/collection-doc';

// The Home layout sheet and the Home rows / Collections pages edit the same
// two lists: `collectionHomeRows` (homeRows) and `collections`, with the
// Movie Collections card placed by its marker row's `collectionSlot`. These
// helpers are the one place both read and reorder them, so the sheet can
// never keep a second order. On Nuvio, collections always sit above Home
// rows (operator rule), so each list only reorders within itself.

// The rows a Home list shows. On Nuvio Movie Collections is a collection,
// not a Home row: its marker (and any stray franchise row) stays out.
export function homeLayoutRows(rows: HomeRowDoc[], platform: string): HomeRowDoc[] {
  return platform === 'nuvio'
    ? rows.filter((row) => row._nativeFranchiseCollection !== true && String(row.source?.catalogId || '') !== 'torbox-collections')
    : rows;
}

// The shown rows put in a new order (everything hidden from the list is kept
// after them, the marker last on Nuvio) and renumbered.
export function commitHomeLayoutRows(rows: HomeRowDoc[], shown: HomeRowDoc[], platform: string): HomeRowDoc[] {
  const shownSet = new Set(homeLayoutRows(rows, platform));
  const kept = rows.filter((row) => !shownSet.has(row));
  return normalizeHomeOrder([...shown, ...kept], platform);
}

export function moveHomeLayoutRow(rows: HomeRowDoc[], platform: string, from: number, to: number): HomeRowDoc[] {
  const shown = homeLayoutRows(rows, platform);
  if (from === to || from < 0 || to < 0 || from >= shown.length || to >= shown.length) return rows;
  const next = shown.slice();
  const [moved] = next.splice(from, 1);
  if (!moved) return rows;
  next.splice(to, 0, moved);
  return commitHomeLayoutRows(rows, next, platform);
}

function ownedMarker(rows: HomeRowDoc[]): HomeRowDoc | null {
  return rows.find((row) => row._nativeFranchiseCollection === true) ?? null;
}

// Where Movie Collections sits among the collections (Nuvio only; null =
// not a collection card). Matches the Collections page (absent slot = first).
export function ownedCollectionSlot(rows: HomeRowDoc[], platform: string): number | null {
  const marker = platform === 'nuvio' ? ownedMarker(rows) : null;
  return marker ? marker.collectionSlot ?? 0 : null;
}

export type HomeLayoutKind = 'collection' | 'library' | 'row';

export interface HomeLayoutItem {
  key: string;
  kind: HomeLayoutKind;
  title: string;
}

// The setup's own library rows (My Movies, 4K, Your genres...): catalogue
// ids on a provider prefix, apart from the discovery rows on the same prefix.
function isLibraryRow(row: HomeRowDoc): boolean {
  const id = String(row.source?.catalogId || '');
  if (row.source?.addonId) return false;
  if (/-(trending|popular)-/.test(id)) return false;
  return /^(torbox|rd|ad|pm|dav)-(movies|series|anime|collections)(-|$)/.test(id);
}

export function homeLayoutCollections(collections: CollectionDoc[], rows: HomeRowDoc[], platform: string): HomeLayoutItem[] {
  const marker = ownedMarker(rows);
  return collectionEntries(collections.length, ownedCollectionSlot(rows, platform)).map((entry) => (entry.kind === 'owned'
    ? { key: 'movie-collections', kind: 'library' as const, title: marker?.title || 'LeLibrary Movie Collections' }
    : { key: collections[entry.index]?.id ?? `collection-${entry.index}`, kind: 'collection' as const, title: collections[entry.index]?.title || 'Collection' }));
}

export function homeLayoutRowItems(rows: HomeRowDoc[], platform: string): HomeLayoutItem[] {
  return homeLayoutRows(rows, platform).map((row) => ({ key: row.id, kind: isLibraryRow(row) ? 'library' : 'row', title: row.title }));
}

// Moves one card of the collections list (Movie Collections included) and
// returns both lists: the collections in their new order and the rows with
// the marker's slot updated.
export function moveHomeLayoutCollection(
  collections: CollectionDoc[],
  rows: HomeRowDoc[],
  platform: string,
  from: number,
  to: number,
): { collections: CollectionDoc[]; rows: HomeRowDoc[] } {
  const slot = ownedCollectionSlot(rows, platform);
  const moved = moveCollectionEntryTo(collections, slot, from, to);
  if (moved.collections === collections && moved.slot === slot) return { collections, rows };
  const nextRows = moved.slot === slot ? rows : rows.map((row) => (row._nativeFranchiseCollection === true && moved.slot !== null
    ? { ...row, collectionSlot: moved.slot }
    : row));
  return { collections: moved.collections, rows: nextRows };
}

// "Arrange home · N items": everything the sheet lists.
export function homeLayoutCount(collections: CollectionDoc[], rows: HomeRowDoc[], platform: string): number {
  return homeLayoutCollections(collections, rows, platform).length + homeLayoutRows(rows, platform).length;
}
