// Generated Nuvio folder covers.
//
// A folder without hand-made art gets a cover composed from its own
// catalogue: a few TMDB posters (2x2 grid or a three-poster fan) or a TMDB
// backdrop, a dark gradient and the folder title, or the network/company/
// service logo when the folder is one of those.
//
// The URL is content-addressed: it carries the TMDB image paths, the title
// and a hash of exactly those values, so the art route needs no key, no
// token and no catalogue fetch. It only composes public image.tmdb.org files.
// Whoever builds the collection plan (the Nuvio push, which already has the
// setup's catalogue rows) puts the paths into the URL. New contents = new
// paths = a new URL, so the bytes behind one URL never change and can be
// cached as immutable everywhere.
//
// Hand-made art always wins: a folder that already has a cover keeps its URL.
import type { Sharp, SharpOptions, OverlayOptions } from 'sharp';

type SharpFactory = (input?: Buffer | SharpOptions, options?: SharpOptions) => Sharp;

export type CoverKind = 'poster' | 'wide';
export type CoverLayout = 'grid' | 'fan' | '';

export interface CoverSpec {
  kind: CoverKind;
  posters: string[];
  backdrop: string;
  logo: string;
  title: string;
  layout: CoverLayout;
  version: number;
}

export interface CoverParts {
  posters: string[];
  backdrop: string;
  logo: string;
  title: string;
}

export interface CoverImages {
  posters: (Buffer | null)[];
  backdrop: Buffer | null;
  logo: Buffer | null;
}

interface HttpResponse { status: number; data: unknown; headers?: Record<string, unknown> }
export interface CoverHttpClient { get: (url: string, config?: Record<string, unknown>) => Promise<HttpResponse> }

type Row = Record<string, unknown>;
type Folder = Record<string, unknown>;

// Output sizes: the poster width matches the catalogue artwork (w342); the
// wide cover matches TMDB's w780 backdrop.
const POSTER_W = 342;
const POSTER_H = 513;
const WIDE_W = 780;
const WIDE_H = 439;
const JPEG_QUALITY = 82;

// Bump when the drawing changes. It is part of the URL and the hash, so new
// pushes get new URLs while URLs already pushed to Nuvio keep working (the
// route renders any known version with the current drawing).
const ART_VERSION = 1;

const TMDB_IMAGE_ORIGIN = 'https://image.tmdb.org';
const TMDB_PATH = /^\/[A-Za-z0-9]+\.(?:jpg|png|svg)$/;
const MAX_POSTERS = 6;
const MAX_TITLE = 60;
const ROUTE_PREFIX = '/art/generated/';
const HASH_LENGTH = 24;

function validTmdbPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && TMDB_PATH.test(value);
}

// Titles are drawn into an SVG overlay: drop control characters, collapse
// whitespace and cap the length. Escaping happens at draw time.
function cleanTitle(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  const text = String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, MAX_TITLE).join('').trim();
}

// Normalise a spec from the plan side. Returns null when nothing usable is
// left (no image and no title).
function buildSpec(kind: CoverKind, parts: Partial<CoverParts>, layout: CoverLayout = ''): CoverSpec | null {
  const posters = (Array.isArray(parts.posters) ? parts.posters : []).filter(validTmdbPath).slice(0, MAX_POSTERS);
  const backdrop = validTmdbPath(parts.backdrop) ? parts.backdrop : '';
  const logo = validTmdbPath(parts.logo) ? parts.logo : '';
  const title = cleanTitle(parts.title);
  if (!posters.length && !backdrop) return null;
  return { kind, posters: [...new Set(posters)], backdrop, logo, title, layout: layout === 'grid' || layout === 'fan' ? layout : '', version: ART_VERSION };
}

function canonical(spec: CoverSpec): string {
  return [spec.kind, String(spec.version), spec.layout, spec.posters.join(','), spec.backdrop, spec.logo, spec.title].join('\n');
}

function coverFingerprint(spec: CoverSpec): string {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  return crypto.createHash('sha256').update(canonical(spec)).digest('hex').slice(0, HASH_LENGTH);
}

function stripSlash(path: string): string { return path.replace(/^\//, ''); }

// Relative URL. Nuvio needs absolute URLs; collection-artwork.ts adds the
// origin exactly as it does for /collection-assets/.
function coverUrl(spec: CoverSpec): string {
  const query = new URLSearchParams();
  if (spec.posters.length) query.set('p', spec.posters.map(stripSlash).join(','));
  if (spec.backdrop) query.set('b', stripSlash(spec.backdrop));
  if (spec.logo) query.set('l', stripSlash(spec.logo));
  if (spec.title) query.set('t', spec.title);
  if (spec.layout) query.set('y', spec.layout);
  query.set('v', String(spec.version));
  return `${ROUTE_PREFIX}${spec.kind}/${coverFingerprint(spec)}.jpg?${query.toString()}`;
}

function isGeneratedCoverUrl(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(ROUTE_PREFIX);
}

// Route side: strict. Any invalid path, too many posters, a bad version or a
// hash that does not match the parameters rejects the request outright.
// Covers known when the server starts (curated folders, curated-folder-art):
// registered here so their URL can be short, with no query string. Same
// content-addressed hash, so a changed cover is a new URL.
const STATIC_COVERS = new Map<string, CoverSpec>();

// [hash, spec] of every registered static cover (for background warming).
function staticCovers(): [string, CoverSpec][] {
  return [...STATIC_COVERS.entries()].map(([key, spec]) => [key.split(':')[1] as string, spec]);
}

function staticCoverUrl(spec: CoverSpec): string {
  const hash = coverFingerprint(spec);
  STATIC_COVERS.set(`${spec.kind}:${hash}`, spec);
  return `${ROUTE_PREFIX}${spec.kind}/${hash}.jpg`;
}

function parseCoverRequest(kindParam: unknown, fileParam: unknown, query: Record<string, unknown>):
  { ok: true; spec: CoverSpec; hash: string } | { ok: false; error: string } {
  const kind = String(kindParam || '');
  if (kind !== 'poster' && kind !== 'wide') return { ok: false, error: 'kind' };
  const file = String(fileParam || '').match(/^([a-f0-9]{24})\.jpg$/);
  if (!file) return { ok: false, error: 'file' };
  if (Object.keys(query || {}).length === 0) {
    const known = STATIC_COVERS.get(`${kind}:${file[1]}`);
    return known ? { ok: true, spec: known, hash: file[1] } : { ok: false, error: 'unknown' };
  }
  const single = (key: string): string | null => {
    const value = query[key];
    if (value === undefined) return '';
    return typeof value === 'string' ? value : null;
  };
  const p = single('p'); const b = single('b'); const l = single('l'); const t = single('t'); const y = single('y'); const v = single('v');
  if (p === null || b === null || l === null || t === null || y === null || v === null) return { ok: false, error: 'query' };
  const posters = p ? p.split(',').map((item) => `/${item}`) : [];
  if (posters.length > MAX_POSTERS || !posters.every(validTmdbPath)) return { ok: false, error: 'posters' };
  const backdrop = b ? `/${b}` : '';
  if (backdrop && !validTmdbPath(backdrop)) return { ok: false, error: 'backdrop' };
  const logo = l ? `/${l}` : '';
  if (logo && !validTmdbPath(logo)) return { ok: false, error: 'logo' };
  if (!posters.length && !backdrop) return { ok: false, error: 'empty' };
  if (t.length > MAX_TITLE * 4 || cleanTitle(t) !== t) return { ok: false, error: 'title' };
  if (y && y !== 'grid' && y !== 'fan') return { ok: false, error: 'layout' };
  const version = Number(v);
  if (!/^\d{1,3}$/.test(v) || version < 1 || version > ART_VERSION) return { ok: false, error: 'version' };
  if (new Set(posters).size !== posters.length) return { ok: false, error: 'posters' };
  const spec: CoverSpec = { kind, posters, backdrop, logo, title: t, layout: y as CoverLayout, version };
  const hash = coverFingerprint(spec);
  if (hash !== file[1]) return { ok: false, error: 'hash' };
  return { ok: true, spec, hash };
}

// The only URLs the art route ever fetches. Sizes are fixed here, the path
// was validated against TMDB_PATH, so the host can never be anything else.
function tmdbImageUrl(size: 'w342' | 'w780' | 'w300' | 'w1280', path: string): string {
  if (!validTmdbPath(path)) throw new Error('invalid TMDB image path');
  return `${TMDB_IMAGE_ORIGIN}/t/p/${size}${path}`;
}

// Pull the TMDB path out of a catalogue artwork URL. Poster providers wrap
// the TMDB poster (Pictorium/ERDB proxies carry it as `fallback`), so one
// level of fallback is followed. Anything that is not image.tmdb.org yields
// ''. Never returns a token or a non-TMDB value.
function tmdbPathFromImageUrl(value: unknown, depth = 0): string {
  if (typeof value !== 'string' || !value || value.length > 4096) return '';
  let url: URL;
  try { url = new URL(value, 'http://local.invalid'); } catch { return ''; }
  if (url.protocol === 'https:' && url.hostname === 'image.tmdb.org') {
    const match = url.pathname.match(/^\/t\/p\/[a-z0-9]+(\/[A-Za-z0-9]+\.(?:jpg|png|svg))$/);
    return match && validTmdbPath(match[1]) ? match[1] : '';
  }
  if (depth > 0) return '';
  const fallback = url.searchParams.get('fallback');
  return fallback ? tmdbPathFromImageUrl(fallback, depth + 1) : '';
}

function artFromRows(rows: unknown, maxPosters = 4): { posters: string[]; backdrop: string } {
  const posters: string[] = [];
  let backdrop = '';
  for (const raw of Array.isArray(rows) ? rows : []) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Row;
    const poster = tmdbPathFromImageUrl(row['poster']);
    if (poster && posters.length < maxPosters && !posters.includes(poster)) posters.push(poster);
    if (!backdrop) backdrop = tmdbPathFromImageUrl(row['background']);
    if (posters.length >= maxPosters && backdrop) break;
  }
  return { posters, backdrop };
}

// ── Plan side ─────────────────────────────────────────────────────────────

// Hand-made art wins. A legacy /covers/ path is dead (collection-artwork.ts
// suppresses it), so it counts as no art.
function folderHasArt(folder: Folder | null | undefined): boolean {
  const cover = folder && folder['coverImageUrl'];
  return typeof cover === 'string' && cover.trim() !== '' && !cover.startsWith('/covers/') && !isGeneratedCoverUrl(cover);
}

// Cover URLs for one folder, matching its tile shape. The hero backdrop is
// the plain TMDB backdrop, straight from image.tmdb.org (no title on it, no
// proxy): only filled when the folder has none.
function generatedFolderArtwork(folder: Folder, parts: Partial<CoverParts>, options: { short?: boolean } = {}): Record<string, unknown> {
  const shape = String(folder['tileShape'] || '').trim().toLowerCase();
  const kind: CoverKind = shape === 'landscape' || shape === 'wide' ? 'wide' : 'poster';
  const spec = buildSpec(kind, { ...parts, title: parts.title ?? String(folder['title'] || '') });
  if (!spec) return {};
  const art: Record<string, unknown> = { coverImageUrl: options.short ? staticCoverUrl(spec) : coverUrl(spec) };
  const hero = folder['heroBackdropUrl'];
  if ((typeof hero !== 'string' || !hero.trim()) && spec.backdrop) art['heroBackdropUrl'] = tmdbImageUrl('w1280', spec.backdrop);
  return art;
}

function ownLibrarySourceIds(folder: Folder, manifestId = ''): { catalogId: string; type: 'movie' | 'series' }[] {
  const sources = Array.isArray(folder['catalogSources']) ? folder['catalogSources'] as Row[] : [];
  const out: { catalogId: string; type: 'movie' | 'series' }[] = [];
  const plan = require('./collection-plan.ts') as {
    isLeLibrarySource: (source: unknown, manifestId?: string) => boolean;
    upgradeCuratedSourceId: (catalogId: unknown, genre: unknown, type: unknown) => string;
  };
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    if (source['addonUrl'] || source['externalSourceId']) continue;
    if (source['addonId'] !== '__lelibrary__' && !plan.isLeLibrarySource(source, manifestId)) continue;
    const type = source['type'] === 'series' ? 'series' : 'movie';
    let catalogId = String(source['catalogId'] || source['id'] || '').trim();
    if (!catalogId.startsWith('lib-')) catalogId = plan.upgradeCuratedSourceId(catalogId, source['genre'], type);
    if (!/^lib-[a-z0-9_]+$/i.test(catalogId)) continue;
    if (!out.some((item) => item.catalogId === catalogId)) out.push({ catalogId, type });
  }
  return out;
}

export interface CollectArtOptions {
  /** First page of a LeLibrary catalogue (`lib-*`), as catalogue metas. */
  loadRows: (catalogId: string, type: 'movie' | 'series') => Promise<unknown[]>;
  /** Optional TMDB logo path for a source (network/company/service). */
  resolveLogo?: (catalogId: string) => Promise<string>;
  budgetMs?: number;
  concurrency?: number;
  maxFolders?: number;
  /** The installed manifest id, so the setup's own sources are recognised. */
  manifestId?: string;
}

// Generated cover parts per folder id, for folders without hand-made art.
// Folder ids default exactly like compileCollectionPlan (`folder-ci-fi`).
// Bounded: a slow catalogue only means that folder has no generated cover
// on this push; nothing waits past the budget.
async function collectGeneratedArt(collections: unknown, options: CollectArtOptions): Promise<Record<string, CoverParts>> {
  const budgetMs = Math.max(0, options.budgetMs ?? 5000);
  const deadline = Date.now() + budgetMs;
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4));
  const maxFolders = Math.max(0, options.maxFolders ?? 200);
  const jobs: { folderId: string; title: string; sources: { catalogId: string; type: 'movie' | 'series' }[] }[] = [];
  (Array.isArray(collections) ? collections : []).forEach((collection: unknown, ci: number) => {
    const folders = collection && typeof collection === 'object' && Array.isArray((collection as Row)['folders'])
      ? (collection as Row)['folders'] as Folder[] : [];
    folders.forEach((folder, fi) => {
      if (!folder || typeof folder !== 'object') return;
      const folderId = String(folder['id'] || `folder-${ci}-${fi}`);
      if (folderId.startsWith('folder-lelibrary-hub-') || folderHasArt(folder)) return;
      const sources = ownLibrarySourceIds(folder, options.manifestId || '');
      if (!sources.length || jobs.length >= maxFolders) return;
      jobs.push({ folderId, title: String(folder['title'] || ''), sources: sources.slice(0, 2) });
    });
  });
  const rowCache = new Map<string, Promise<unknown[]>>();
  const logoCache = new Map<string, Promise<string>>();
  const withDeadline = <T>(work: Promise<T>, fallback: T): Promise<T> => {
    const left = deadline - Date.now();
    if (left <= 0) return Promise.resolve(fallback);
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      work.catch(() => fallback),
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), left); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
  };
  const rowsFor = (source: { catalogId: string; type: 'movie' | 'series' }) => {
    const key = `${source.type}:${source.catalogId}`;
    if (!rowCache.has(key)) rowCache.set(key, Promise.resolve().then(() => options.loadRows(source.catalogId, source.type)).catch(() => []));
    return withDeadline(rowCache.get(key)!, [] as unknown[]);
  };
  const logoFor = (catalogId: string) => {
    if (!options.resolveLogo) return Promise.resolve('');
    if (!logoCache.has(catalogId)) logoCache.set(catalogId, Promise.resolve().then(() => options.resolveLogo!(catalogId)).catch(() => ''));
    return withDeadline(logoCache.get(catalogId)!, '');
  };
  const result: Record<string, CoverParts> = {};
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length && Date.now() < deadline) {
      const job = jobs[cursor++];
      const posters: string[] = [];
      let backdrop = '';
      for (const source of job.sources) {
        if (posters.length >= 4 && backdrop) break;
        const art = artFromRows(await rowsFor(source), 4);
        for (const poster of art.posters) if (posters.length < 4 && !posters.includes(poster)) posters.push(poster);
        if (!backdrop) backdrop = art.backdrop;
      }
      if (!posters.length && !backdrop) continue;
      const logo = await logoFor(job.sources[0].catalogId.slice(4));
      result[job.folderId] = { posters, backdrop, logo: validTmdbPath(logo) ? logo : '', title: job.title };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return result;
}

// ── Logos (network / company / streaming service) ───────────────────────

// Logo paths come from TMDB's API, which needs a key. The server only uses
// its own instance key (the hosted Releases key); without one, covers carry
// the title text instead. User keys are never used for this.
const LOGO_TTL = 30 * 24 * 60 * 60;
const LOGO_MISS_TTL = 24 * 60 * 60;

async function resolveSourceLogo(sourceId: string, deps: { apiKey?: string; http?: CoverHttpClient; cache?: { get: (k: string) => Promise<unknown>; set: (k: string, v: unknown, ttl?: number) => Promise<unknown> } } = {}): Promise<string> {
  const { getSourceDefinition } = require('./catalog-source-registry.ts') as { getSourceDefinition: (id: string) => Row | null };
  const definition = getSourceDefinition(String(sourceId || '').replace(/^lib-/, ''));
  if (!definition) return '';
  const params = (definition['params'] || {}) as Row;
  let kind = '';
  let id = 0;
  if (definition['handler'] === 'tmdb_network') { kind = 'network'; id = Number(params['networkId']); }
  else if (definition['handler'] === 'tmdb_company') { kind = 'company'; id = Number(params['companyId']); }
  else if (definition['handler'] === 'tmdb_provider') { kind = 'provider'; id = Number(params['providerId']); }
  if (!kind || !Number.isInteger(id) || id <= 0) return '';
  const apiKey = deps.apiKey ?? (require('../platform/hosted.ts') as { releasesKey: () => string }).releasesKey();
  if (!apiKey) return '';
  const store = deps.cache || require('../runtime/cache.ts');
  const cacheKey = `gencover-logo:v1:${kind}:${id}`;
  try {
    const hit = await store.get(cacheKey);
    if (typeof hit === 'string') return validTmdbPath(hit) ? hit : '';
  } catch { /* fall through */ }
  const http = deps.http || require('axios') as CoverHttpClient;
  const auth = apiKey.startsWith('eyJ')
    ? { headers: { Authorization: `Bearer ${apiKey}` }, params: {} }
    : { headers: {}, params: { api_key: apiKey } };
  let path = '';
  try {
    if (kind === 'provider') {
      for (const media of ['movie', 'tv']) {
        const res = await http.get(`https://api.themoviedb.org/3/watch/providers/${media}`, { ...auth, timeout: 8000, validateStatus: () => true });
        const list = res.status === 200 && res.data && Array.isArray((res.data as Row)['results']) ? (res.data as Row)['results'] as Row[] : [];
        const found = list.find((item) => Number(item['provider_id']) === id);
        if (found && validTmdbPath(found['logo_path'])) { path = found['logo_path']; break; }
      }
    } else {
      const res = await http.get(`https://api.themoviedb.org/3/${kind}/${id}`, { ...auth, timeout: 8000, validateStatus: () => true });
      const logo = res.status === 200 && res.data ? (res.data as Row)['logo_path'] : '';
      if (validTmdbPath(logo)) path = logo;
    }
  } catch { return ''; }
  try { await store.set(cacheKey, path, path ? LOGO_TTL : LOGO_MISS_TTL); } catch { /* best effort */ }
  return path;
}

// ── Rendering ───────────────────────────────────────────────────────────

let sharpModule: SharpFactory | null | undefined;
function loadSharp(): SharpFactory | null {
  if (sharpModule === undefined) {
    try { sharpModule = require('sharp') as SharpFactory; } catch { sharpModule = null; }
  }
  return sharpModule ?? null;
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

// TMDB logos can be SVG. Refuse anything that could reach outside the file.
function safeSvg(buffer: Buffer): boolean {
  const text = buffer.toString('utf8');
  return !/<!ENTITY|<!DOCTYPE|<script|<foreignObject|(?:xlink:)?href\s*=\s*["'](?!#|data:image\/)/i.test(text);
}

async function fetchTmdbImage(http: CoverHttpClient, size: 'w342' | 'w780' | 'w300' | 'w1280', path: string): Promise<Buffer | null> {
  if (!validTmdbPath(path)) return null;
  try {
    const res = await http.get(tmdbImageUrl(size, path), {
      responseType: 'arraybuffer',
      timeout: 8000,
      maxContentLength: MAX_IMAGE_BYTES,
      maxBodyLength: MAX_IMAGE_BYTES,
      maxRedirects: 0,
      validateStatus: () => true,
      headers: { 'User-Agent': 'LeLibrary/2.0' },
    });
    if (res.status !== 200 || !res.data) return null;
    const buffer = Buffer.from(res.data as ArrayBuffer);
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null;
    if (path.endsWith('.svg') && !safeSvg(buffer)) return null;
    return buffer;
  } catch { return null; }
}

async function fetchCoverImages(spec: CoverSpec, http: CoverHttpClient): Promise<CoverImages> {
  const posterCount = spec.kind === 'wide' ? (spec.backdrop ? 0 : 4) : 4;
  const [posters, backdrop, logo] = await Promise.all([
    Promise.all(spec.posters.slice(0, posterCount).map((path) => fetchTmdbImage(http, 'w342', path))),
    spec.backdrop ? fetchTmdbImage(http, 'w780', spec.backdrop) : Promise.resolve(null),
    spec.logo ? fetchTmdbImage(http, 'w300', spec.logo) : Promise.resolve(null),
  ]);
  return { posters, backdrop, logo };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Liberation Sans ships in both Docker images (font-liberation); the rest of
// the list covers development machines.
const FONT_STACK = "'Liberation Sans','DejaVu Sans',Arial,Helvetica,sans-serif";
const CHAR_WIDTH = 0.57; // average bold glyph width per font-size unit

function wrapTitle(title: string, maxWidth: number, startSize: number, minSize: number, maxLines: number): { lines: string[]; size: number } {
  const words = title.split(' ').filter(Boolean);
  for (let size = startSize; size >= minSize; size -= 2) {
    const perLine = Math.max(1, Math.floor(maxWidth / (size * CHAR_WIDTH)));
    const lines: string[] = [];
    let current = '';
    let fits = true;
    for (const word of words) {
      if (word.length > perLine) { fits = false; break; }
      const next = current ? `${current} ${word}` : word;
      if (next.length <= perLine) current = next;
      else { lines.push(current); current = word; }
    }
    if (current) lines.push(current);
    if (fits && lines.length <= maxLines) return { lines, size };
  }
  // Last resort: hard cut at the smallest size.
  const perLine = Math.max(1, Math.floor(maxWidth / (minSize * CHAR_WIDTH)));
  const chars = Array.from(title);
  const lines: string[] = [];
  for (let i = 0; i < chars.length && lines.length < maxLines; i += perLine) lines.push(chars.slice(i, i + perLine).join('').trim());
  return { lines, size: minSize };
}

// Title block, bottom-left, with a soft shadow. Returns the SVG and the top
// of the text so a logo icon can sit above it.
function titleSvg(width: number, height: number, title: string, opts: { left: number; bottom: number; maxWidth: number; startSize: number; minSize: number; maxLines: number }): { svg: string; top: number } {
  const { lines, size } = wrapTitle(title, opts.maxWidth, opts.startSize, opts.minSize, opts.maxLines);
  const lineHeight = Math.round(size * 1.08);
  const lastBaseline = height - opts.bottom;
  const firstBaseline = lastBaseline - lineHeight * (lines.length - 1);
  const tspans = (dx: number, dy: number) => lines.map((line, i) =>
    `<tspan x="${opts.left + dx}" y="${firstBaseline + i * lineHeight + dy}">${escapeXml(line)}</tspan>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<defs><filter id="s" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${Math.max(2, size / 10)}"/></filter></defs>`
    + `<g font-family="${FONT_STACK}" font-weight="700" font-size="${size}" letter-spacing="-0.5">`
    + `<text fill="#000" fill-opacity="0.65" filter="url(#s)">${tspans(0, Math.round(size / 18) + 1)}</text>`
    + `<text fill="#ffffff">${tspans(0, 0)}</text>`
    + `</g></svg>`;
  return { svg, top: firstBaseline - size };
}

function gradientSvg(width: number, height: number, kind: CoverKind): string {
  if (kind === 'wide') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs>`
      + `<linearGradient id="h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.72"/><stop offset="0.55" stop-color="#000" stop-opacity="0.18"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>`
      + `<linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.8"/></linearGradient>`
      + `</defs><rect width="100%" height="100%" fill="url(#h)"/><rect width="100%" height="100%" fill="url(#v)"/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs>`
    + `<linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.15"/><stop offset="0.42" stop-color="#000" stop-opacity="0"/><stop offset="0.68" stop-color="#05060a" stop-opacity="0.72"/><stop offset="1" stop-color="#05060a" stop-opacity="0.96"/></linearGradient>`
    + `</defs><rect width="100%" height="100%" fill="url(#v)"/></svg>`;
}

async function decodeTo(sharp: SharpFactory, input: Buffer | null, width: number, height: number): Promise<Buffer | null> {
  if (!input) return null;
  try {
    return await sharp(input, { failOn: 'none', limitInputPixels: 40_000_000 })
      .resize({ width, height, fit: 'cover', position: 'attention' })
      .removeAlpha()
      .png()
      .toBuffer();
  } catch { return null; }
}

async function roundedShadowed(sharp: SharpFactory, image: Buffer, width: number, height: number, radius: number): Promise<Buffer> {
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`);
  return sharp(image).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function shadowLayer(sharp: SharpFactory, width: number, height: number, radius: number, pad: number): Promise<Buffer> {
  const w = width + pad * 2;
  const h = height + pad * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><filter id="b"><feGaussianBlur stdDeviation="${pad / 2.5}"/></filter></defs>`
    + `<rect x="${pad}" y="${pad + pad / 3}" width="${width}" height="${height}" rx="${radius}" fill="#000" fill-opacity="0.7" filter="url(#b)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// Logo: fit inside the box; a dark logo (most network wordmarks) becomes a
// white silhouette so it reads on the dark gradient.
async function prepareLogo(sharp: SharpFactory, input: Buffer | null, maxWidth: number, maxHeight: number): Promise<{ buf: Buffer; width: number; height: number; wordmark: boolean } | null> {
  if (!input) return null;
  try {
    const sized = await sharp(input, { failOn: 'none', density: 300, limitInputPixels: 40_000_000 })
      .resize({ width: maxWidth, height: maxHeight, fit: 'inside', withoutEnlargement: false })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { data, info } = sized;
    let sum = 0; let count = 0; let transparent = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha < 128) { transparent++; continue; }
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      count++;
    }
    if (!count) return null;
    const hasTransparency = transparent > (data.length / 4) * 0.05;
    const dark = hasTransparency && sum / count < 96;
    const raw = { raw: { width: info.width, height: info.height, channels: 4 as const } };
    let buf: Buffer;
    if (dark) {
      const alpha = await sharp(data, raw).extractChannel(3).raw().toBuffer();
      buf = await sharp({ create: { width: info.width, height: info.height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
        .joinChannel(alpha, { raw: { width: info.width, height: info.height, channels: 1 } })
        .png().toBuffer();
    } else if (!hasTransparency) {
      // Opaque square-ish app icon: round its corners.
      const radius = Math.round(Math.min(info.width, info.height) * 0.2);
      buf = await roundedShadowed(sharp, await sharp(data, raw).png().toBuffer(), info.width, info.height, radius);
    } else {
      buf = await sharp(data, raw).png().toBuffer();
    }
    return { buf, width: info.width, height: info.height, wordmark: info.width / info.height >= 1.8 };
  } catch { return null; }
}

function chooseLayout(spec: CoverSpec, posterCount: number): 'grid' | 'fan' | 'single' {
  if (spec.layout === 'grid' && posterCount >= 4) return 'grid';
  if (spec.layout === 'fan' && posterCount >= 3) return 'fan';
  if (posterCount >= 4) return 'grid';
  if (posterCount >= 3) return 'fan';
  return 'single';
}

async function renderPoster(sharp: SharpFactory, spec: CoverSpec, images: CoverImages): Promise<Buffer> {
  const W = POSTER_W; const H = POSTER_H;
  const posters = images.posters.filter((item): item is Buffer => !!item);
  const layout = chooseLayout(spec, posters.length);
  const layers: OverlayOptions[] = [];
  let base: Sharp;
  if (layout === 'grid') {
    base = sharp({ create: { width: W, height: H, channels: 3, background: { r: 8, g: 9, b: 14 } } });
    const gap = 2;
    const cw = Math.floor((W - gap) / 2);
    const ch = Math.floor((H - gap) / 2);
    for (let i = 0; i < 4; i++) {
      const cell = await decodeTo(sharp, posters[i], cw, ch);
      if (cell) layers.push({ input: cell, left: (i % 2) * (cw + gap), top: Math.floor(i / 2) * (ch + gap) });
    }
  } else {
    const backgroundSource = images.backdrop || posters[0] || null;
    const bg = await decodeTo(sharp, backgroundSource, W, H);
    base = bg
      ? sharp(await sharp(bg).blur(14).modulate({ brightness: 0.55, saturation: 1.1 }).png().toBuffer())
      : sharp({ create: { width: W, height: H, channels: 3, background: { r: 14, g: 16, b: 24 } } });
    const placements = layout === 'fan'
      ? [
        { index: 1, width: 146, height: 219, left: -4, top: 86, angle: -11 },
        { index: 2, width: 146, height: 219, left: 200, top: 86, angle: 11 },
        { index: 0, width: 180, height: 270, left: 81, top: 52, angle: 0 },
      ]
      : posters.length >= 2
        ? [
          { index: 0, width: 150, height: 225, left: 18, top: 70, angle: -5 },
          { index: 1, width: 150, height: 225, left: 174, top: 70, angle: 5 },
        ]
        : [{ index: 0, width: 210, height: 315, left: 66, top: 40, angle: 0 }];
    for (const place of placements) {
      const decoded = await decodeTo(sharp, posters[place.index] || null, place.width, place.height);
      if (!decoded) continue;
      const pad = 16;
      const radius = 8;
      const card = await roundedShadowed(sharp, decoded, place.width, place.height, radius);
      const shadow = await shadowLayer(sharp, place.width, place.height, radius, pad);
      let shadowBuf = shadow; let cardBuf = card;
      if (place.angle) {
        const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
        shadowBuf = await sharp(shadow).rotate(place.angle, { background: transparent }).png().toBuffer();
        cardBuf = await sharp(card).rotate(place.angle, { background: transparent }).png().toBuffer();
      }
      const cardMeta = await sharp(cardBuf).metadata();
      const shadowMeta = await sharp(shadowBuf).metadata();
      const cx = place.left + place.width / 2;
      const cy = place.top + place.height / 2;
      layers.push({ input: shadowBuf, left: Math.round(cx - (shadowMeta.width || 0) / 2), top: Math.round(cy - (shadowMeta.height || 0) / 2) });
      layers.push({ input: cardBuf, left: Math.round(cx - (cardMeta.width || 0) / 2), top: Math.round(cy - (cardMeta.height || 0) / 2) });
    }
  }
  layers.push({ input: Buffer.from(gradientSvg(W, H, 'poster')), left: 0, top: 0 });
  await addTitleAndLogo(sharp, layers, spec, images, W, H, {
    left: 18, bottom: 22, maxWidth: W - 36, startSize: 36, minSize: 22, maxLines: 3,
    logoWordmark: { width: W - 60, height: 96 }, logoIcon: 64,
  });
  return finish(sharp, base, layers, W, H);
}

async function renderWide(sharp: SharpFactory, spec: CoverSpec, images: CoverImages): Promise<Buffer> {
  const W = WIDE_W; const H = WIDE_H;
  const layers: OverlayOptions[] = [];
  let base: Sharp;
  const backdrop = await decodeTo(sharp, images.backdrop, W, H);
  if (backdrop) {
    base = sharp(backdrop);
  } else {
    // No backdrop: a blurred poster wash with a row of posters on the right.
    const posters = images.posters.filter((item): item is Buffer => !!item);
    const bg = await decodeTo(sharp, posters[0] || null, W, H);
    base = bg
      ? sharp(await sharp(bg).blur(18).modulate({ brightness: 0.5 }).png().toBuffer())
      : sharp({ create: { width: W, height: H, channels: 3, background: { r: 14, g: 16, b: 24 } } });
    const pw = 150; const ph = 225; const gap = 14;
    const count = Math.min(3, posters.length);
    const startLeft = W - 28 - count * pw - (count - 1) * gap;
    for (let i = 0; i < count; i++) {
      const decoded = await decodeTo(sharp, posters[i], pw, ph);
      if (!decoded) continue;
      const card = await roundedShadowed(sharp, decoded, pw, ph, 8);
      const shadow = await shadowLayer(sharp, pw, ph, 8, 16);
      const left = startLeft + i * (pw + gap);
      const top = 48 + (i % 2) * 22;
      layers.push({ input: shadow, left: left - 16, top: top - 16 });
      layers.push({ input: card, left, top });
    }
  }
  layers.push({ input: Buffer.from(gradientSvg(W, H, 'wide')), left: 0, top: 0 });
  await addTitleAndLogo(sharp, layers, spec, images, W, H, {
    left: 36, bottom: 38, maxWidth: Math.round(W * 0.62), startSize: 58, minSize: 30, maxLines: 2,
    logoWordmark: { width: 300, height: 110 }, logoIcon: 84,
  });
  return finish(sharp, base, layers, W, H);
}

async function addTitleAndLogo(sharp: SharpFactory, layers: OverlayOptions[], spec: CoverSpec, images: CoverImages, W: number, H: number,
  opts: { left: number; bottom: number; maxWidth: number; startSize: number; minSize: number; maxLines: number; logoWordmark: { width: number; height: number }; logoIcon: number }): Promise<void> {
  let logo = await prepareLogo(sharp, images.logo, opts.logoWordmark.width, opts.logoWordmark.height);
  if (logo && !logo.wordmark) logo = await prepareLogo(sharp, images.logo, opts.logoIcon, opts.logoIcon);
  if (logo && logo.wordmark) {
    // A wordmark is the title: draw it alone.
    layers.push({ input: logo.buf, left: opts.left, top: H - opts.bottom - logo.height });
    return;
  }
  let textTop = H - opts.bottom;
  if (spec.title) {
    const text = titleSvg(W, H, spec.title, opts);
    layers.push({ input: Buffer.from(text.svg), left: 0, top: 0 });
    textTop = text.top;
  }
  if (logo) layers.push({ input: logo.buf, left: opts.left, top: Math.max(8, Math.round(textTop - logo.height - 12)) });
}

async function finish(sharp: SharpFactory, base: Sharp, layers: OverlayOptions[], W: number, H: number): Promise<Buffer> {
  const flat = await base.composite(layers).png().toBuffer();
  return sharp(flat)
    .resize({ width: W, height: H, fit: 'cover' })
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

async function renderCover(spec: CoverSpec, images: CoverImages, sharpFactory?: SharpFactory | null): Promise<Buffer | null> {
  const sharp = sharpFactory ?? loadSharp();
  if (!sharp) return null;
  return spec.kind === 'wide' ? renderWide(sharp, spec, images) : renderPoster(sharp, spec, images);
}

// Where the route sends a client when it cannot render (rate limit, sharp
// missing, render error): the plain TMDB image, never a non-TMDB host.
function coverFallbackUrl(spec: CoverSpec): string {
  if (spec.kind === 'wide' && spec.backdrop) return tmdbImageUrl('w780', spec.backdrop);
  if (spec.posters[0]) return tmdbImageUrl('w342', spec.posters[0]);
  return spec.backdrop ? tmdbImageUrl('w780', spec.backdrop) : '';
}

export interface GeneratedCoversApi {
  ART_VERSION: number;
  POSTER_SIZE: { width: number; height: number };
  WIDE_SIZE: { width: number; height: number };
  validTmdbPath: (value: unknown) => value is string;
  cleanTitle: (value: unknown) => string;
  buildSpec: typeof buildSpec;
  coverFingerprint: (spec: CoverSpec) => string;
  coverUrl: (spec: CoverSpec) => string;
  isGeneratedCoverUrl: (value: unknown) => boolean;
  parseCoverRequest: typeof parseCoverRequest;
  staticCoverUrl: typeof staticCoverUrl;
  staticCovers: typeof staticCovers;
  tmdbImageUrl: typeof tmdbImageUrl;
  tmdbPathFromImageUrl: (value: unknown) => string;
  artFromRows: typeof artFromRows;
  folderHasArt: typeof folderHasArt;
  generatedFolderArtwork: typeof generatedFolderArtwork;
  collectGeneratedArt: typeof collectGeneratedArt;
  resolveSourceLogo: typeof resolveSourceLogo;
  fetchCoverImages: typeof fetchCoverImages;
  fetchTmdbImage: typeof fetchTmdbImage;
  renderCover: typeof renderCover;
  coverFallbackUrl: typeof coverFallbackUrl;
}

module.exports = {
  ART_VERSION,
  POSTER_SIZE: { width: POSTER_W, height: POSTER_H },
  WIDE_SIZE: { width: WIDE_W, height: WIDE_H },
  validTmdbPath,
  cleanTitle,
  buildSpec,
  coverFingerprint,
  coverUrl,
  isGeneratedCoverUrl,
  parseCoverRequest,
  staticCoverUrl,
  staticCovers,
  tmdbImageUrl,
  tmdbPathFromImageUrl,
  artFromRows,
  folderHasArt,
  generatedFolderArtwork,
  collectGeneratedArt,
  resolveSourceLogo,
  fetchCoverImages,
  fetchTmdbImage,
  renderCover,
  coverFallbackUrl,
} satisfies GeneratedCoversApi;
