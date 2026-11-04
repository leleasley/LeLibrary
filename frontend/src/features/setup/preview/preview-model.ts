import { apiClient } from '@/api/client';

// Setup Preview data. The layout (rows, order, collections, folders, covers)
// comes from GET /api/setup/:uuid/preview, which never carries a key, token or
// link. Row contents are loaded here, from the addon itself, with the install
// token the unlocked page already holds: exactly the catalogue request the
// player makes, first page only.

export type PreviewPlatform = 'nuvio' | 'stremio';

export interface PreviewRow {
  key: string;
  type: string;
  catalogId: string;
  name: string;
  external?: boolean;
}

export interface PreviewSource {
  catalogId: string;
  type: string;
  genre: string;
  name: string;
  external?: boolean;
}

export interface PreviewFolder {
  id: string;
  title: string;
  cover: string;
  shape: 'POSTER' | 'LANDSCAPE' | 'SQUARE';
  hideTitle: boolean;
  sources: PreviewSource[];
}

export interface PreviewCollection {
  id: string;
  title: string;
  backdrop: string;
  folders: PreviewFolder[];
}

export type PreviewHomeEntry = ({ kind: 'row' } & PreviewRow) | { kind: 'collection'; id: string };

export interface SetupPreview {
  platform: PreviewPlatform;
  home: PreviewHomeEntry[];
  hero: PreviewRow[];
  collections: PreviewCollection[];
  franchisePending: boolean;
}

export interface PreviewMeta {
  id: string;
  name: string;
  poster: string;
  background: string;
}

export const ROW_LIMIT = 12;
export const GRID_LIMIT = 24;
export const CONCURRENCY = 3;

export function fetchSetupPreview(uuid: string, platform: PreviewPlatform, editToken: string): Promise<SetupPreview> {
  return apiClient.get<SetupPreview>(`/api/setup/${encodeURIComponent(uuid)}/preview?platform=${platform}`, {
    headers: { Authorization: `Bearer ${editToken}` },
  });
}

// One catalogue the preview can load: a Home/board row or a folder source.
export interface CatalogRef {
  type: string;
  catalogId: string;
  genre?: string | undefined;
}

export function catalogKey(ref: CatalogRef): string {
  return `${ref.type}\u0000${ref.catalogId}\u0000${ref.genre ?? ''}`;
}

// The addon's catalogue URL, in the form the players send: the genre extra
// (folders pass their source's genre) as a path segment, first page only.
export function catalogUrl(installToken: string, ref: CatalogRef): string {
  const base = `/${encodeURIComponent(installToken)}/catalog/${encodeURIComponent(ref.type)}/${encodeURIComponent(ref.catalogId)}`;
  return ref.genre ? `${base}/genre=${encodeURIComponent(ref.genre)}.json` : `${base}.json`;
}

// Display fields only, posters first; anything without an image is dropped.
export function metasFrom(body: unknown, limit: number): PreviewMeta[] {
  const metas = body && typeof body === 'object' && Array.isArray((body as { metas?: unknown }).metas)
    ? (body as { metas: unknown[] }).metas
    : [];
  const out: PreviewMeta[] = [];
  for (const raw of metas) {
    if (out.length >= limit) break;
    if (!raw || typeof raw !== 'object') continue;
    const meta = raw as Record<string, unknown>;
    const poster = typeof meta['poster'] === 'string' ? meta['poster'] : '';
    if (!poster) continue;
    out.push({
      id: String(meta['id'] ?? out.length),
      name: typeof meta['name'] === 'string' ? meta['name'] : '',
      poster,
      background: typeof meta['background'] === 'string' ? meta['background'] : '',
    });
  }
  return out;
}

export type RowState =
  | { status: 'loading' }
  | { status: 'ready'; metas: PreviewMeta[] }
  | { status: 'error' };

export interface CatalogLoader {
  get: (ref: CatalogRef) => RowState | undefined;
  // Starts loading once; a loaded or loading row is left alone.
  load: (ref: CatalogRef) => void;
  // Loads again after an error.
  retry: (ref: CatalogRef) => void;
  subscribe: (listener: () => void) => () => void;
}

type FetchJson = (url: string) => Promise<unknown>;

const defaultFetch: FetchJson = async (url) => {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

// Shared by every row of one preview: each catalogue is requested at most
// once (rows and the hero share it), at most `concurrency` at a time.
export function createCatalogLoader(installToken: string, options: { fetchJson?: FetchJson; concurrency?: number; limit?: number } = {}): CatalogLoader {
  const fetchJson = options.fetchJson ?? defaultFetch;
  const concurrency = Math.max(1, options.concurrency ?? CONCURRENCY);
  const limit = options.limit ?? GRID_LIMIT;
  const states = new Map<string, RowState>();
  const queue: CatalogRef[] = [];
  const listeners = new Set<() => void>();
  let active = 0;

  const notify = () => { for (const listener of listeners) listener(); };
  const pump = () => {
    while (active < concurrency && queue.length) {
      const ref = queue.shift() as CatalogRef;
      const key = catalogKey(ref);
      active += 1;
      fetchJson(catalogUrl(installToken, ref))
        .then((body) => { states.set(key, { status: 'ready', metas: metasFrom(body, limit) }); })
        .catch(() => { states.set(key, { status: 'error' }); })
        .finally(() => { active -= 1; notify(); pump(); });
    }
  };
  const enqueue = (ref: CatalogRef) => {
    states.set(catalogKey(ref), { status: 'loading' });
    queue.push(ref);
    notify();
    pump();
  };

  return {
    get: (ref) => states.get(catalogKey(ref)),
    load: (ref) => { if (!states.has(catalogKey(ref))) enqueue(ref); },
    retry: (ref) => { if (states.get(catalogKey(ref))?.status === 'error') enqueue(ref); },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

// Where the preview is: Home (or Stremio's board), one collection's folders,
// or one folder's poster grid on one of its source tabs.
export type PreviewPlace =
  | { at: 'home' }
  | { at: 'collection'; collectionId: string }
  | { at: 'folder'; collectionId: string; folderId: string; tab: number };

export type PreviewAction =
  | { type: 'home' }
  | { type: 'collection'; collectionId: string }
  | { type: 'folder'; collectionId: string; folderId: string }
  | { type: 'tab'; tab: number }
  | { type: 'back' };

export function previewPlace(place: PreviewPlace, action: PreviewAction): PreviewPlace {
  switch (action.type) {
    case 'home': return { at: 'home' };
    case 'collection': return { at: 'collection', collectionId: action.collectionId };
    case 'folder': return { at: 'folder', collectionId: action.collectionId, folderId: action.folderId, tab: 0 };
    case 'tab': return place.at === 'folder' ? { ...place, tab: Math.max(0, action.tab) } : place;
    case 'back':
      if (place.at === 'folder') return { at: 'collection', collectionId: place.collectionId };
      return { at: 'home' };
    default: return place;
  }
}

export function findCollection(preview: SetupPreview | null, id: string): PreviewCollection | null {
  return preview?.collections.find((collection) => collection.id === id) ?? null;
}

export function findFolder(preview: SetupPreview | null, collectionId: string, folderId: string): PreviewFolder | null {
  return findCollection(preview, collectionId)?.folders.find((folder) => folder.id === folderId) ?? null;
}

export function typeLabel(type: string): string {
  if (type === 'movie') return 'Movie';
  if (type === 'series') return 'Series';
  if (type === 'anime') return 'Anime';
  return type;
}
