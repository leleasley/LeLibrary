import { apiClient } from '@/api/client';

// Setup Preview data and the pure rules behind the Nuvio replica. The layout
// (rows, order, collections, folders, covers) comes from
// GET /api/setup/:uuid/preview, which never carries a key, token or link. Row
// contents and item details load here, from the addon itself, with the
// install token the unlocked page already holds: exactly the catalogue and
// meta requests the player makes, first page only. Nothing here writes.
//
// Live draft (v6): before a setup is saved (creating, or editing with
// unsaved changes) the layout comes from POST /api/setup/preview-draft,
// built by the same server code from the page's non-secret config, and rows
// from POST /api/setup/preview-draft/catalog (LeLibrary's own catalogues,
// plain TMDB posters; library rows come back as a sample). The browser never
// sends a key: only the names of the keys that are filled in.

export type PreviewPlatform = 'nuvio' | 'stremio';
// The replica's three screens: Nuvio TV, Nuvio Mobile, Stremio's board.
export type PreviewMode = 'tv' | 'mobile' | 'stremio';

export interface PreviewRow {
  key: string;
  type: string;
  catalogId: string;
  name: string;
  custom?: boolean;
  external?: boolean;
  // Client only: a folder source opened on its own "See all" keeps its genre.
  genre?: string | undefined;
}

export interface PreviewSource {
  catalogId: string;
  type: string;
  genre: string;
  name: string;
  catalogName: string;
  external?: boolean;
}

export interface PreviewFolder {
  id: string;
  title: string;
  cover: string;
  focusGif: string;
  shape: 'POSTER' | 'LANDSCAPE' | 'SQUARE';
  hideTitle: boolean;
  sources: PreviewSource[];
}

export interface PreviewCollection {
  id: string;
  title: string;
  backdrop: string;
  pinToTop: boolean;
  folders: PreviewFolder[];
}

export type PreviewHomeEntry = ({ kind: 'row' } & PreviewRow) | { kind: 'collection'; id: string };

export interface SetupPreview {
  platform: PreviewPlatform;
  addonName: string;
  home: PreviewHomeEntry[];
  hero: PreviewRow[];
  collections: PreviewCollection[];
  franchisePending: boolean;
}

export interface PreviewMeta {
  id: string;
  type: string;
  name: string;
  poster: string;
  background: string;
  logo: string;
  year: string;
  genres: string[];
  description: string;
}

// Nuvio: a Home row shows at most 18 items; "See all" and folder grids show
// the first page.
export const ROW_LIMIT = 18;
export const GRID_LIMIT = 60;
export const HERO_LIMIT = 8;
export const HERO_INTERVAL_MS = 8000;
export const CONCURRENCY = 3;

export function fetchSetupPreview(uuid: string, platform: PreviewPlatform, editToken: string): Promise<SetupPreview> {
  return apiClient.get<SetupPreview>(`/api/setup/${encodeURIComponent(uuid)}/preview?platform=${platform}`, {
    headers: { Authorization: `Bearer ${editToken}` },
  });
}

// The page's current draft, as the Preview may see it: the create body's
// config (never its keys) and the names of the filled-in keys.
export interface PreviewDraft {
  tier: 'quick' | 'partial' | 'full';
  config: Record<string, unknown>;
  keyServices: string[];
}

// Where the Preview's data comes from:
// - draft: creating (no saved setup yet), the draft endpoints only.
// - saved: editing with nothing unsaved, the saved setup, exactly.
// - edited: editing with unsaved changes, the draft layout; library rows
//   still load for real through the install token.
export type PreviewSourceMode = 'draft' | 'saved' | 'edited';

export function previewSourceMode(input: { saved: boolean; dirty: boolean; hasDraft: boolean }): PreviewSourceMode {
  if (!input.saved) return 'draft';
  return input.dirty && input.hasDraft ? 'edited' : 'saved';
}

// Never sent in a draft, at any depth (mirrors the server's draftConfig):
// keys, logins, links that can carry someone's credentials.
const SECRET_FIELDS = new Set([
  'torboxApiKey', 'rdApiKey', 'adApiKey', 'pmApiKey', 'tmdbApiKey', 'tvdbApiKey', 'omdbKey', 'mdblistKey',
  'erdbToken', 'rpdbKey', 'fanartKey', 'postersPlusUrl', 'customAddon1', 'customAddon2', 'customAddon3',
  'webdavUrl', 'webdavUser', 'webdavPassword', 'keys', 'push', 'watchlist', 'connection', 'pushConn', 'password',
  'installToken', 'editToken', 'pictoriumUrl', 'customPosterTemplate', 'nuvioBadgeUrl', 'customStreams',
  'externalSources', 'addonUrl', 'manifestUrl', 'transportUrl',
]);
const SECRET_NAME = /api_?key|token|secret|passw|auth|session|cookie|credential|refresh/i;
const KEY_SERVICE_NAMES = new Set([
  'torboxApiKey', 'rdApiKey', 'adApiKey', 'pmApiKey', 'tmdbApiKey', 'tvdbApiKey', 'omdbKey', 'mdblistKey',
  'erdbToken', 'rpdbKey', 'fanartKey', 'postersPlusUrl',
]);

export function draftRequestConfig(value: unknown): Record<string, unknown> {
  const walk = (input: unknown, depth: number): unknown => {
    if (depth > 12) return undefined;
    if (Array.isArray(input)) return input.map((child) => walk(child, depth + 1)).filter((child) => child !== undefined);
    if (input && typeof input === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(input as Record<string, unknown>)) {
        if (key.startsWith('__') || SECRET_FIELDS.has(key) || SECRET_NAME.test(key)) continue;
        const kept = walk(child, depth + 1);
        if (kept !== undefined) out[key] = kept;
      }
      return out;
    }
    return typeof input === 'function' ? undefined : input;
  };
  const out = walk(value, 0);
  return out && typeof out === 'object' && !Array.isArray(out) ? out as Record<string, unknown> : {};
}

// The key NAMES a draft reports (filled in now, or saved and not removed).
export function draftKeyServices(filled: Record<string, unknown>, saved: readonly string[] = [], removed: readonly string[] = []): string[] {
  const names = new Set<string>();
  for (const [name, value] of Object.entries(filled)) if (typeof value === 'string' && value.trim()) names.add(name);
  for (const name of saved) names.add(name);
  for (const name of removed) if (!(typeof filled[name] === 'string' && String(filled[name]).trim())) names.delete(name);
  return [...names].filter((name) => KEY_SERVICE_NAMES.has(name)).sort();
}

export function draftBody(draft: PreviewDraft, platform: PreviewPlatform) {
  return {
    tier: draft.tier,
    platform,
    config: draftRequestConfig(draft.config),
    keyServices: draft.keyServices.filter((name) => KEY_SERVICE_NAMES.has(name)),
  };
}

export function fetchDraftPreview(draft: PreviewDraft, platform: PreviewPlatform): Promise<SetupPreview> {
  return apiClient.post<SetupPreview>('/api/setup/preview-draft', draftBody(draft, platform));
}

// What the draft catalogue endpoint needs to know about the setup: the
// language, Hide anime and the chosen packs (for folder labels). Nothing else.
export function draftCatalogConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof config['lang'] === 'string') out['lang'] = config['lang'];
  if (config['hideAnime'] === true) out['hideAnime'] = true;
  if (Array.isArray(config['nuvioCollectionPacks'])) out['nuvioCollectionPacks'] = (config['nuvioCollectionPacks'] as unknown[]).filter((id) => typeof id === 'string');
  return out;
}

export function platformFor(mode: PreviewMode): PreviewPlatform {
  return mode === 'stremio' ? 'stremio' : 'nuvio';
}

// Saved player Stremio opens on Stremio; Nuvio opens on Mobile on a phone
// and on TV on anything wider.
export function defaultMode(platform: PreviewPlatform, viewportWidth: number): PreviewMode {
  if (platform === 'stremio') return 'stremio';
  return viewportWidth > 0 && viewportWidth < 600 ? 'mobile' : 'tv';
}

// TV mode in a narrow modal (a phone) is laid out at the modal's width
// instead of shrinking the 1280x720 stage until nothing reads.
export const PHONE_TV_MAX_WIDTH = 700;

export function tvLayout(modalWidth: number): 'phone' | 'stage' {
  return modalWidth > 0 && modalWidth < PHONE_TV_MAX_WIDTH ? 'phone' : 'stage';
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

export function metaUrl(installToken: string, type: string, id: string): string {
  return `/${encodeURIComponent(installToken)}/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
}

// TMDB art at a size that suits where it is drawn; other hosts untouched.
export function tmdbSized(url: string, size: 'w185' | 'w342' | 'w500' | 'w780' | 'w1280'): string {
  return url.replace(/^(https?:\/\/image\.tmdb\.org\/t\/p\/)(?:w\d+|original)(\/)/i, `$1${size}$2`);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function yearOf(meta: Record<string, unknown>): string {
  const info = str(meta['releaseInfo']) || str(meta['year']) || (typeof meta['year'] === 'number' ? String(meta['year']) : '');
  if (info) return info.slice(0, 12);
  const released = str(meta['released']);
  return /^\d{4}/.test(released) ? released.slice(0, 4) : '';
}

// Display fields of one Stremio meta (catalogue item or full meta).
export function previewMetaFrom(raw: unknown, fallbackId = ''): PreviewMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const meta = raw as Record<string, unknown>;
  const genres = Array.isArray(meta['genres']) ? (meta['genres'] as unknown[]).filter((g): g is string => typeof g === 'string') : [];
  return {
    id: String(meta['id'] ?? fallbackId),
    type: str(meta['type']),
    name: str(meta['name']),
    poster: str(meta['poster']),
    background: str(meta['background']),
    logo: str(meta['logo']),
    year: yearOf(meta),
    genres: genres.slice(0, 4),
    description: str(meta['description']).slice(0, 1200),
  };
}

// Catalogue items with a poster, capped; `total` counts every item the page
// returned, so a row knows whether there is more to see.
export function metasFrom(body: unknown, limit: number): { metas: PreviewMeta[]; total: number } {
  const metas = body && typeof body === 'object' && Array.isArray((body as { metas?: unknown }).metas)
    ? (body as { metas: unknown[] }).metas
    : [];
  const out: PreviewMeta[] = [];
  const seen = new Set<string>();
  for (const raw of metas) {
    if (out.length >= limit) break;
    const meta = previewMetaFrom(raw, String(out.length));
    if (!meta || !meta.poster || seen.has(meta.id)) continue;
    seen.add(meta.id);
    out.push(meta);
  }
  return { metas: out, total: metas.length };
}

// `sample`: a draft row the preview cannot fill yet: the library (shows
// once the setup exists) or a list that needs the person's own key.
export type SampleReason = 'library' | 'key' | 'unavailable';

export type RowState =
  | { status: 'loading' }
  | { status: 'ready'; metas: PreviewMeta[]; total: number }
  | { status: 'sample'; reason: SampleReason }
  | { status: 'error' };

function sampleOf(body: unknown): SampleReason | null {
  if (!body || typeof body !== 'object' || (body as { sample?: unknown }).sample !== true) return null;
  const reason = (body as { reason?: unknown }).reason;
  return reason === 'key' || reason === 'unavailable' ? reason : 'library';
}

// Nuvio shows a row's "see all" button only when it has more than one row's
// worth of items.
export function rowHasMore(state: RowState | undefined): boolean {
  return state?.status === 'ready' && state.total > ROW_LIMIT;
}

export interface CatalogLoader {
  get: (ref: CatalogRef) => RowState | undefined;
  // Starts loading once; a loaded or loading row is left alone.
  load: (ref: CatalogRef) => void;
  // Loads again after an error.
  retry: (ref: CatalogRef) => void;
  subscribe: (listener: () => void) => () => void;
}

export type FetchJson = (url: string) => Promise<unknown>;

const defaultFetch: FetchJson = async (url) => {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

// A small queue: at most `concurrency` requests at a time, each key once.
function createQueue<T>(run: (job: T) => Promise<void>, concurrency: number) {
  const queue: T[] = [];
  let active = 0;
  const pump = () => {
    while (active < concurrency && queue.length) {
      const job = queue.shift() as T;
      active += 1;
      run(job).finally(() => { active -= 1; pump(); });
    }
  };
  return (job: T) => { queue.push(job); pump(); };
}

// Shared by every row of one preview: each catalogue is requested at most
// once (rows, folders and the hero share it), at most `concurrency` at a time.
export function createCatalogLoader(installToken: string, options: { fetchJson?: FetchJson; concurrency?: number; limit?: number } = {}): CatalogLoader {
  const fetchJson = options.fetchJson ?? defaultFetch;
  return createRowLoader((ref) => fetchJson(catalogUrl(installToken, ref)), options);
}

// One draft row request (read-only: POST only because it carries a body).
export type PostDraftRow = (body: unknown) => Promise<unknown>;

const defaultPost: PostDraftRow = (body) => apiClient.post<unknown>('/api/setup/preview-draft/catalog', body);

// Draft rows: LeLibrary's own catalogues through the draft endpoint. With an
// install token (editing with unsaved changes) a library row the endpoint
// answers with a sample loads for real from the saved setup instead: the
// library does not depend on the draft.
export function createDraftCatalogLoader(config: Record<string, unknown>, options: {
  installToken?: string | null; post?: PostDraftRow; fetchJson?: FetchJson; concurrency?: number; limit?: number;
} = {}): CatalogLoader {
  const post = options.post ?? defaultPost;
  const fetchJson = options.fetchJson ?? defaultFetch;
  const setup = draftCatalogConfig(config);
  return createRowLoader(async (ref) => {
    const body = await post({
      config: setup, type: ref.type, catalogId: ref.catalogId, ...(ref.genre ? { genre: ref.genre } : {}),
    });
    if (options.installToken && sampleOf(body) === 'library') return fetchJson(catalogUrl(options.installToken, ref));
    return body;
  }, options);
}

export function createRowLoader(fetchRows: (ref: CatalogRef) => Promise<unknown>, options: { concurrency?: number; limit?: number } = {}): CatalogLoader {
  const limit = options.limit ?? GRID_LIMIT;
  const states = new Map<string, RowState>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const push = createQueue<CatalogRef>((ref) => fetchRows(ref)
    .then((body) => {
      const sample = sampleOf(body);
      states.set(catalogKey(ref), sample ? { status: 'sample', reason: sample } : { status: 'ready', ...metasFrom(body, limit) });
    })
    .catch(() => { states.set(catalogKey(ref), { status: 'error' }); })
    .finally(notify), Math.max(1, options.concurrency ?? CONCURRENCY));
  const enqueue = (ref: CatalogRef) => {
    states.set(catalogKey(ref), { status: 'loading' });
    notify();
    push(ref);
  };
  return {
    get: (ref) => states.get(catalogKey(ref)),
    load: (ref) => { if (!states.has(catalogKey(ref))) enqueue(ref); },
    retry: (ref) => { if (states.get(catalogKey(ref))?.status === 'error') enqueue(ref); },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

// Full metas (logo, backdrop, genres, description) for the few items that
// need them: the hero's picks, the focused TV card, an open details sheet.
export interface MetaLoader {
  get: (meta: Pick<PreviewMeta, 'type' | 'id'>) => PreviewMeta | undefined;
  load: (meta: Pick<PreviewMeta, 'type' | 'id'>) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createMetaLoader(installToken: string, options: { fetchJson?: FetchJson; concurrency?: number } = {}): MetaLoader {
  const fetchJson = options.fetchJson ?? defaultFetch;
  const states = new Map<string, PreviewMeta | null>();
  const listeners = new Set<() => void>();
  const keyOf = (meta: Pick<PreviewMeta, 'type' | 'id'>) => `${meta.type}\u0000${meta.id}`;
  const push = createQueue<Pick<PreviewMeta, 'type' | 'id'>>((meta) => fetchJson(metaUrl(installToken, meta.type, meta.id))
    .then((body) => {
      const full = previewMetaFrom((body as { meta?: unknown } | null)?.meta, meta.id);
      states.set(keyOf(meta), full);
    })
    .catch(() => { states.set(keyOf(meta), null); })
    .finally(() => { for (const listener of listeners) listener(); }), Math.max(1, options.concurrency ?? 2));
  return {
    get: (meta) => states.get(keyOf(meta)) ?? undefined,
    load: (meta) => {
      if (!meta.type || !meta.id || states.has(keyOf(meta))) return;
      states.set(keyOf(meta), null);
      push(meta);
    },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

// A catalogue item with its full meta laid over it (full meta wins where it
// has a value).
export function enrich(meta: PreviewMeta, full: PreviewMeta | undefined): PreviewMeta {
  if (!full) return meta;
  return {
    ...meta,
    name: full.name || meta.name,
    poster: meta.poster || full.poster,
    background: full.background || meta.background,
    logo: full.logo || meta.logo,
    year: full.year || meta.year,
    genres: full.genres.length ? full.genres : meta.genres,
    description: full.description || meta.description,
  };
}

// The hero's picks: up to 8 items from its source rows, taken in turn from
// each row and never the same title twice.
export function heroPicks(rows: { metas: PreviewMeta[]; type: string }[], max = HERO_LIMIT): PreviewMeta[] {
  const out: PreviewMeta[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...rows.map((row) => row.metas.length));
  for (let n = 0; n < longest && out.length < max; n += 1) {
    for (const row of rows) {
      const meta = row.metas[n];
      if (!meta || seen.has(meta.id) || out.length >= max) continue;
      seen.add(meta.id);
      out.push(meta.type ? meta : { ...meta, type: row.type });
    }
  }
  return out;
}

// Nuvio Mobile's hero height for a screen of `width` x `height`.
export function heroHeight(width: number, height: number): number {
  const clamp = (value: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, value)));
  if (width >= 1200) return clamp(width * 0.42, 360, 440);
  if (width >= 840) return clamp(width * 0.46, 340, 420);
  if (width >= 600) return clamp(width * 0.58, 320, 380);
  return clamp(Math.min(height * 0.82, width * 1.16), 360, 760);
}

// The carousel only moves by itself with more than one slide, while visible,
// not hovered, and never for people who asked for reduced motion.
export function shouldAutoAdvance(state: { count: number; reducedMotion: boolean; hidden: boolean; hovered: boolean }): boolean {
  return state.count > 1 && !state.reducedMotion && !state.hidden && !state.hovered;
}

// Ticks every `interval` ms while `canRun()` says so; returns a stop.
export function startAutoAdvance(canRun: () => boolean, onAdvance: () => void, interval = HERO_INTERVAL_MS): () => void {
  const timer = setInterval(() => { if (canRun()) onAdvance(); }, interval);
  return () => clearInterval(timer);
}

export function wrapIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

// Scale that fits a `dw` x `dh` design into a `cw` x `ch` box.
export function fitScale(cw: number, ch: number, dw: number, dh: number): number {
  if (cw <= 0 || ch <= 0) return 1;
  return Math.min(cw / dw, ch / dh);
}

// Nuvio's grid columns for a screen width (folders and "See all").
export function gridColumns(width: number): number {
  if (width >= 1400) return 7;
  if (width >= 1200) return 6;
  if (width >= 1000) return 5;
  if (width >= 840) return 4;
  return 3;
}

// TV focus: a grid of rows of `lengths[row]` cards. Arrow keys move; up and
// down keep the column where the next row allows it.
export interface FocusPos { row: number; col: number }

export function moveFocus(lengths: number[], pos: FocusPos, key: string): FocusPos {
  if (!lengths.length) return pos;
  const clampCol = (row: number, col: number) => Math.max(0, Math.min(col, Math.max(0, (lengths[row] ?? 1) - 1)));
  const step = (from: number, dir: 1 | -1) => {
    for (let row = from + dir; row >= 0 && row < lengths.length; row += dir) if ((lengths[row] ?? 0) > 0) return row;
    return from;
  };
  switch (key) {
    case 'ArrowRight': return { row: pos.row, col: clampCol(pos.row, pos.col + 1) };
    case 'ArrowLeft': return { row: pos.row, col: clampCol(pos.row, pos.col - 1) };
    case 'ArrowDown': { const row = step(pos.row, 1); return { row, col: clampCol(row, pos.col) }; }
    case 'ArrowUp': { const row = step(pos.row, -1); return { row, col: clampCol(row, pos.col) }; }
    default: return pos;
  }
}

// Where the replica is. Home is the bottom of the stack; a folder, a "See
// all" grid or a details sheet go on top, Back pops.
export type PreviewScreen =
  | { at: 'home' }
  | { at: 'folder'; collectionId: string; folderId: string; tab: number }
  | { at: 'catalog'; row: PreviewRow }
  | { at: 'details'; meta: PreviewMeta };

export type PreviewAction =
  | { type: 'home' }
  | { type: 'folder'; collectionId: string; folderId: string }
  | { type: 'catalog'; row: PreviewRow }
  | { type: 'details'; meta: PreviewMeta }
  | { type: 'tab'; tab: number }
  | { type: 'back' };

export function previewNav(stack: PreviewScreen[], action: PreviewAction): PreviewScreen[] {
  const base: PreviewScreen[] = stack.length ? stack : [{ at: 'home' }];
  switch (action.type) {
    case 'home': return [{ at: 'home' }];
    case 'folder': return [...base, { at: 'folder', collectionId: action.collectionId, folderId: action.folderId, tab: 0 }];
    case 'catalog': return [...base, { at: 'catalog', row: action.row }];
    case 'details': return [...base, { at: 'details', meta: action.meta }];
    case 'tab': {
      const top = base[base.length - 1];
      if (top?.at !== 'folder') return base;
      return [...base.slice(0, -1), { ...top, tab: Math.max(0, action.tab) }];
    }
    case 'back': return base.length > 1 ? base.slice(0, -1) : base;
    default: return base;
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
  if (type === 'tv') return 'TV';
  return type;
}

// A folder's tabs: "All" (only with more than one source), then one per
// source. Index 0 is "All" when it exists.
export function folderTabs(folder: PreviewFolder): { all: boolean; sources: PreviewSource[] } {
  return { all: folder.sources.length > 1, sources: folder.sources };
}

// "All": every source's items in turn, each title once.
export function mergeSources(lists: PreviewMeta[][], max = GRID_LIMIT): PreviewMeta[] {
  return heroPicks(lists.map((metas) => ({ metas, type: '' })), max);
}

// A collection that cannot show a cover shows two letters of its title.
export function initials(title: string): string {
  const letters = title.replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).filter(Boolean);
  if (!letters.length) return '?';
  const first = letters[0] ?? '';
  return (letters.length > 1 ? `${first.charAt(0)}${letters[1]?.charAt(0) ?? ''}` : first.slice(0, 2)).toUpperCase();
}
