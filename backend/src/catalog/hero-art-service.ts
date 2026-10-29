// Folder hero backdrops: which posters, fingerprint, cache.
//
// One fixed link per folder (/art/hero/<folderId>.jpg). The posters come from:
//   live       the folder's current titles (the same rows as its Live cover),
//              falling back to the list saved with the art
//   subject    the franchise's films as of the daily art check (a new film's
//              poster appears on its own), then the saved list
//   evergreen  the saved list of timeless titles
// The fingerprint of exactly which posters are drawn is the ETag: unchanged
// posters answer 304, changed ones are drawn once and cached (memory + Redis).
const crypto = require('node:crypto') as typeof import('node:crypto');

interface Hero { buf: Buffer; etag: string; fingerprint: string; checkedAt: number }
interface StoreLike { get: (k: string) => Promise<unknown>; set: (k: string, v: unknown, ttl?: number) => Promise<unknown> }

const RECHECK_MS = 5 * 60 * 1000;
const REDIS_PREFIX = 'heroart:v1:';
const REDIS_TTL = 30 * 24 * 60 * 60;
const PARTS_PREFIX = 'artwatch:parts:v1:';
const MAX_POSTERS = 24;
const MIN_POSTERS = 4;
const TMDB_PATH = /^\/[A-Za-z0-9]+\.jpg$/;

const heroes = new Map<string, Hero>();
const inflight = new Map<string, Promise<Hero | null>>();

function store(): StoreLike { return require('../runtime/cache.ts') as StoreLike; }

function unique(paths: unknown[]): string[] {
  const out: string[] = [];
  for (const p of paths) if (typeof p === 'string' && TMDB_PATH.test(p) && !out.includes(p)) out.push(p);
  return out.slice(0, MAX_POSTERS);
}

// The daily art check saves a franchise's current posters here.
async function savedParts(folderId: string): Promise<string[]> {
  try {
    const value = await store().get(PARTS_PREFIX + folderId);
    return Array.isArray(value) ? unique(value) : [];
  } catch { return []; }
}

async function setSavedParts(folderId: string, posters: string[]): Promise<void> {
  try { await store().set(PARTS_PREFIX + folderId, unique(posters), 90 * 24 * 60 * 60); } catch { /* next check */ }
}

async function heroPosters(folderId: string): Promise<string[]> {
  const own = require('./own-art.ts');
  const entry = own.ownArtEntry(folderId);
  if (!entry) return [];
  const saved: string[] = Array.isArray(entry.heroPosters) ? entry.heroPosters : [];
  if (entry.kind === 'live' && own.liveArtEnabled()) {
    try {
      const { folderRows } = require('./live-art-service.ts');
      const { pickPaths } = require('./live-art.ts');
      const rows = await folderRows(folderId, own.liveArtKey());
      const now = pickPaths(rows, { layout: 'wall', posters: MAX_POSTERS }).posters as string[];
      if (now.length >= MIN_POSTERS) return unique(now);
    } catch { /* the saved list */ }
  }
  if (entry.kind === 'subject') return unique([...(await savedParts(folderId)), ...saved]);
  return unique(saved);
}

function fingerprint(folderId: string, posters: string[]): string {
  const { HERO_VERSION } = require('./hero-art.ts');
  return crypto.createHash('sha256').update(JSON.stringify([HERO_VERSION, folderId, posters])).digest('hex').slice(0, 20);
}

function seedOf(folderId: string): number {
  return parseInt(crypto.createHash('sha1').update(`hero:${folderId}`).digest('hex').slice(0, 8), 16);
}

async function getHero(folderId: string, options: { force?: boolean } = {}): Promise<Hero | null> {
  const known = heroes.get(folderId);
  if (known && !options.force && Date.now() - known.checkedAt < RECHECK_MS) return known;
  let pending = inflight.get(folderId);
  if (pending) return pending;
  pending = (async () => {
    const paths = await heroPosters(folderId);
    if (paths.length < MIN_POSTERS) return known || null;
    const fp = fingerprint(folderId, paths);
    if (known && known.fingerprint === fp) { known.checkedAt = Date.now(); return known; }
    try {
      const stored = await store().get(REDIS_PREFIX + fp) as { b64?: string } | null;
      if (stored && stored.b64) {
        const hero = { buf: Buffer.from(stored.b64, 'base64'), etag: `"hero-${fp}"`, fingerprint: fp, checkedAt: Date.now() };
        heroes.set(folderId, hero);
        return hero;
      }
    } catch { /* draw it */ }
    const { tmdbImage } = require('./live-art-service.ts');
    const fetched: (Buffer | null)[] = [];
    for (let i = 0; i < paths.length; i += 4) {
      fetched.push(...await Promise.all(paths.slice(i, i + 4).map((p: string) => tmdbImage('w342', p))));
    }
    const posters = fetched.filter(Boolean) as Buffer[];
    const buf: Buffer | null = await require('./hero-art.ts').drawHero(posters, seedOf(folderId));
    if (!buf) return known || null;
    const complete = posters.length === paths.length;
    // Drawn with a poster missing: served, never stored, redrawn soon.
    const hero = { buf, etag: `"hero-${fp}${complete ? '' : '-p'}"`, fingerprint: complete ? fp : `${fp}-partial`, checkedAt: Date.now() };
    heroes.set(folderId, hero);
    if (complete) { try { await store().set(REDIS_PREFIX + fp, { b64: buf.toString('base64') }, REDIS_TTL); } catch { /* memory copy */ } }
    return hero;
  })().catch(() => known || null).finally(() => inflight.delete(folderId));
  inflight.set(folderId, pending);
  return pending;
}

// Only folders with a saved poster list get a hero link, so the link can
// always be drawn (Live folders swap in their current titles when they can;
// a regional service with no titles here keeps no hero rather than a 404).
function hasHero(folderId: string): boolean {
  const entry = require('./own-art.ts').ownArtEntry(folderId);
  return !!entry && Array.isArray(entry.heroPosters) && entry.heroPosters.length >= MIN_POSTERS;
}

// Draw heroes in turn, slowly: Live ones hourly (their titles move), the rest
// once after start (then they come from Redis) and when the art check saw a
// franchise change.
let warming = false;
async function warmHeroes(ids: string[], gapMs = 3000): Promise<number> {
  if (warming) return 0;
  warming = true;
  let drawn = 0;
  try {
    for (const id of ids) {
      if (!hasHero(id)) continue;
      const before = heroes.get(id)?.fingerprint;
      const hero = await getHero(id, { force: true }).catch(() => null);
      if (hero && hero.fingerprint !== before) drawn++;
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  } finally { warming = false; }
  return drawn;
}

function resetHeroes(): void { heroes.clear(); inflight.clear(); }

export interface HeroArtServiceApi {
  getHero: typeof getHero;
  hasHero: typeof hasHero;
  heroPosters: typeof heroPosters;
  setSavedParts: typeof setSavedParts;
  warmHeroes: typeof warmHeroes;
  resetHeroes: typeof resetHeroes;
}

module.exports = { getHero, hasHero, heroPosters, setSavedParts, warmHeroes, resetHeroes } satisfies HeroArtServiceApi;
