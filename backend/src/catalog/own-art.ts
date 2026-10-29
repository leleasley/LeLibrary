// LeLibrary's own collection folder art.
//
// Every curated folder's cover and focus GIF is drawn by LeLibrary
// (promo/collection-art, gitignored) from TMDB stills/posters and official
// logos. The files and their index live in frontend/public/collection-art/
// (gitignored, shipped to the hosted instance inside the built bundle). A
// self-hosted build has no index: its folders keep the generated covers.
//
// Three kinds:
//   live       drawn by the server from the folder's current titles
//              (/art/folder/<folderId>.jpg, catalog/live-art.ts)
//   subject    one franchise/studio/network/person; fixed, versioned file
//   evergreen  genres, moods, decades; fixed, versioned file
// A redraw bumps the version in the file name; a request for an older version
// is sent to the current file (see redirectFor), so collections already
// pushed to Nuvio pick up new art without a re-push.
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

export type ArtKind = 'live' | 'subject' | 'evergreen';

export interface LiveSpec {
  layout: 'brand' | 'wall' | 'top3' | 'still';
  version: number;
  under?: boolean;
  [key: string]: unknown;
}

export interface ArtBasis {
  collections?: number[];
  parts?: number[];
  titleLogo?: string;
  person?: number;
}

export interface OwnArtEntry {
  kind: ArtKind;
  version: number;
  cover: string;
  gif?: string;
  backdrop?: string;
  live?: LiveSpec;
  basis?: ArtBasis;
  // TMDB poster paths for the hero backdrop mosaic (hero-art.ts).
  heroPosters?: string[];
}

interface OwnArtIndex { version: number; generatedAt?: string; folders: Record<string, OwnArtEntry> }

const ROOT = path.join(__dirname, '..', '..', '..');
const URL_PREFIX = '/collection-art/';
const LIVE_PREFIX = '/art/folder/';
const HERO_PREFIX = '/art/hero/';
const FILE = /^[a-z0-9][a-z0-9_-]{0,120}-(?:focus-)?v\d{1,4}\.(?:jpg|gif)$/;
const FOLDER_ID = /^folder-lelibrary-[a-z0-9][a-z0-9_-]{0,120}$/;
const TMDB_PATH = /^\/[A-Za-z0-9]+\.jpg$/;

let cached: { dir: string; index: OwnArtIndex } | null | undefined;

// The bundle copy wins (that is what the hosted instance serves); the public
// folder covers a dev tree before a build.
function artDirs(): string[] {
  const override = process.env.COLLECTION_ART_DIR;
  if (override) return [override];
  // Tests never read this machine's private art: a test that needs art points
  // COLLECTION_ART_DIR at a fixture, so results match CI (which has none).
  if (process.env.NODE_TEST_CONTEXT || process.argv.some((arg) => arg.includes('--test'))) return [];
  return [path.join(ROOT, 'frontend', 'dist', 'collection-art'), path.join(ROOT, 'frontend', 'public', 'collection-art')];
}

function validEntry(id: string, raw: unknown): raw is OwnArtEntry {
  if (!FOLDER_ID.test(id) || !raw || typeof raw !== 'object') return false;
  const e = raw as Record<string, unknown>;
  if (e['kind'] !== 'live' && e['kind'] !== 'subject' && e['kind'] !== 'evergreen') return false;
  if (typeof e['cover'] !== 'string' || !FILE.test(e['cover'])) return false;
  if (e['gif'] !== undefined && (typeof e['gif'] !== 'string' || !FILE.test(e['gif']))) return false;
  if (e['backdrop'] !== undefined && (typeof e['backdrop'] !== 'string' || !TMDB_PATH.test(e['backdrop']))) return false;
  if (e['heroPosters'] !== undefined && (!Array.isArray(e['heroPosters']) || !e['heroPosters'].every((p) => typeof p === 'string' && TMDB_PATH.test(p)))) return false;
  return Number.isInteger(e['version']);
}

function loadIndex(): { dir: string; index: OwnArtIndex } | null {
  if (cached !== undefined) return cached;
  cached = null;
  for (const dir of artDirs()) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
      const folders: Record<string, OwnArtEntry> = {};
      for (const [id, entry] of Object.entries(raw && raw.folders || {})) {
        // A listed file that is not on disk is skipped (that folder keeps its
        // generated cover) rather than pushed as a dead link.
        if (!validEntry(id, entry) || !fs.existsSync(path.join(dir, entry.cover))) continue;
        if (entry.gif && !fs.existsSync(path.join(dir, entry.gif))) delete entry.gif;
        folders[id] = entry;
      }
      cached = { dir, index: { version: Number(raw.version) || 0, generatedAt: raw.generatedAt, folders } };
      break;
    } catch { /* no index here */ }
  }
  return cached;
}

function ownArtEntry(folderId: string): OwnArtEntry | null {
  return loadIndex()?.index.folders[folderId] || null;
}

function artDir(): string { return loadIndex()?.dir || ''; }

function shortId(folderId: string): string { return folderId.replace(/^folder-lelibrary-/, ''); }

// The layers a Live cover needs on disk (over.png, and under.png for Top 3).
function liveLayerPath(folderId: string, layer: 'over' | 'under'): string {
  const dir = artDir();
  return dir ? path.join(dir, 'live', shortId(folderId), `${layer}.png`) : '';
}

function liveSpec(folderId: string): LiveSpec | null {
  const entry = ownArtEntry(folderId);
  if (!entry || entry.kind !== 'live' || !entry.live) return null;
  const over = liveLayerPath(folderId, 'over');
  if (!over || !fs.existsSync(over)) return null;
  if (entry.live.under && !fs.existsSync(liveLayerPath(folderId, 'under'))) return null;
  return entry.live;
}

// Live drawing needs the server's own TMDB key (never a user's): without it
// the folder uses its fixed snapshot.
function liveArtKey(): string {
  return String(process.env.ART_TMDB_API_KEY || process.env.RELEASES_TMDB_API_KEY || '').trim();
}

function liveArtEnabled(): boolean {
  return process.env.LIVE_ART !== 'off' && !!liveArtKey() && !!loadIndex();
}

function liveFolderIds(): string[] {
  const idx = loadIndex();
  if (!idx) return [];
  return Object.keys(idx.index.folders).filter((id) => liveSpec(id));
}

function fixedUrl(file: string): string { return `${URL_PREFIX}${file}`; }

// Fields for a curated folder, or null when this install has no art for it.
function ownArtFor(folder: { id?: unknown }): Record<string, unknown> | null {
  const id = String(folder && folder.id || '');
  const entry = ownArtEntry(id);
  if (!entry) return null;
  const live = entry.kind === 'live' && liveArtEnabled() && liveSpec(id);
  const out: Record<string, unknown> = {
    coverImageUrl: live ? `${LIVE_PREFIX}${id}.jpg` : fixedUrl(entry.cover),
    focusGifUrl: entry.gif ? fixedUrl(entry.gif) : '',
    focusGifEnabled: !!entry.gif,
  };
  // The hero: our poster mosaic (drawn by the server, kept up to date like
  // the cover), else the plain still the cover was designed from.
  if (require('./hero-art-service.ts').hasHero(id)) out['heroBackdropUrl'] = `${HERO_PREFIX}${id}.jpg`;
  else if (entry.backdrop) out['heroBackdropUrl'] = `https://image.tmdb.org/t/p/w1280${entry.backdrop}`;
  return out;
}

// /collection-art/<shortId>-v<old>.jpg (or -focus-v<old>.gif) that is no
// longer on disk: the current file for that folder, else ''.
function redirectFor(file: string): string {
  const m = String(file || '').match(/^([a-z0-9][a-z0-9_-]*?)-(focus-)?v(\d+)\.(jpg|gif)$/);
  if (!m) return '';
  const entry = ownArtEntry(`folder-lelibrary-${m[1]}`);
  if (!entry) return '';
  const wanted = m[2] ? entry.gif || entry.cover : entry.cover;
  return wanted && wanted !== file ? fixedUrl(wanted) : '';
}

function isOwnArtUrl(value: unknown): boolean {
  return typeof value === 'string' && (value.startsWith(URL_PREFIX) || value.startsWith(LIVE_PREFIX) || value.startsWith(HERO_PREFIX));
}

function resetOwnArtCache(): void { cached = undefined; }

export interface OwnArtApi {
  ownArtFor: typeof ownArtFor;
  ownArtEntry: typeof ownArtEntry;
  liveSpec: typeof liveSpec;
  liveLayerPath: typeof liveLayerPath;
  liveArtKey: typeof liveArtKey;
  liveArtEnabled: typeof liveArtEnabled;
  liveFolderIds: typeof liveFolderIds;
  redirectFor: typeof redirectFor;
  isOwnArtUrl: typeof isOwnArtUrl;
  artDir: typeof artDir;
  allEntries: () => Record<string, OwnArtEntry>;
  resetOwnArtCache: typeof resetOwnArtCache;
  URL_PREFIX: string;
  LIVE_PREFIX: string;
}

module.exports = {
  ownArtFor, ownArtEntry, liveSpec, liveLayerPath, liveArtKey, liveArtEnabled, liveFolderIds, redirectFor, isOwnArtUrl, artDir,
  allEntries: () => ({ ...(loadIndex()?.index.folders || {}) }),
  resetOwnArtCache, URL_PREFIX, LIVE_PREFIX,
} satisfies OwnArtApi;
