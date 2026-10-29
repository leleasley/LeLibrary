// Live folder covers: current rows -> fingerprint -> cached JPEG.
//
// getLiveCover() is what the /art/folder/:id route and the warm job call.
// Rows come from the shared catalogue cache (buildLibraryCatalog, one hour),
// so asking again within the hour costs a cache read. The rendered JPEG is
// kept in memory and in Redis under its fingerprint; a restart reuses it.
const fs = require('fs') as typeof import('fs');

interface LiveCover { buf: Buffer; etag: string; fingerprint: string; checkedAt: number }
interface HttpLike { get: (url: string, config?: Record<string, unknown>) => Promise<{ status: number; data: unknown }> }
interface StoreLike { get: (k: string) => Promise<unknown>; set: (k: string, v: unknown, ttl?: number) => Promise<unknown> }

const RECHECK_MS = 5 * 60 * 1000;      // rows are re-read at most every 5 minutes per folder
const REDIS_TTL = 7 * 24 * 60 * 60;
const REDIS_PREFIX = 'liveart:v1:';
const POSTER_MEM_MAX = 600;

const covers = new Map<string, LiveCover>();
const inflight = new Map<string, Promise<LiveCover | null>>();
const posterMem = new Map<string, Buffer>();

function deps(): { http: HttpLike; store: StoreLike } {
  return { http: require('axios') as HttpLike, store: require('../runtime/cache.ts') as StoreLike };
}

async function folderRows(folderId: string, key: string): Promise<Record<string, unknown>[]> {
  const { curatedFolderById } = require('./curated-collections.ts');
  const lib = require('./libcatalog.ts');
  const { ROW_SOURCES, MAX_ROWS } = require('./live-art.ts');
  const folder = curatedFolderById(folderId);
  if (!folder) return [];
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const source of (folder.catalogSources || []).slice(0, ROW_SOURCES)) {
    const catalogId = String(source.catalogId || '').replace(/^lib-/, '');
    let page: Record<string, unknown>[] = [];
    try { page = await lib.buildLibraryCatalog({ tmdbApiKey: key, catalogId, lang: 'en-US', userKey: '' }); } catch { page = []; }
    for (const row of page || []) {
      const id = String(row['tmdbId'] || row['id'] || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push(row);
      if (rows.length >= MAX_ROWS) return rows;
    }
  }
  return rows;
}

async function image(http: HttpLike, size: 'w342' | 'w1280', path: string): Promise<Buffer | null> {
  const memKey = size + path;
  const hit = posterMem.get(memKey);
  if (hit) return hit;
  const { fetchTmdbImage } = require('./generated-covers.ts');
  let buf: Buffer | null = await fetchTmdbImage(http, size, path);
  if (!buf) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    buf = await fetchTmdbImage(http, size, path);
  }
  if (buf) {
    posterMem.set(memKey, buf);
    while (posterMem.size > POSTER_MEM_MAX) {
      const oldest = posterMem.keys().next().value;
      if (oldest === undefined) break;
      posterMem.delete(oldest);
    }
  }
  return buf;
}

// One worker thread, created on first use and idle-unref'd; covers are drawn
// one at a time. If a worker cannot start, draw inline.
let worker: import('node:worker_threads').Worker | null = null;
let jobSeq = 0;
const waiting = new Map<number, (buf: Buffer | null) => void>();
function drawInWorker(spec: Record<string, unknown>, posters: Buffer[], backdrop: Buffer | null, layers: { over: string; under?: string }, seed: number): Promise<Buffer | null> {
  if (process.env.LIVE_ART_WORKER === 'off') return require('./live-art.ts').drawLive(spec, { posters, backdrop }, layers, seed);
  if (!worker) {
    try {
      const { Worker } = require('node:worker_threads') as typeof import('node:worker_threads');
      worker = new Worker(require('path').join(__dirname, 'live-art-worker.ts'));
      worker.unref();
      worker.on('message', (msg: { id: number; buf: Uint8Array | null }) => {
        const done = waiting.get(msg.id);
        waiting.delete(msg.id);
        done?.(msg.buf ? Buffer.from(msg.buf) : null);
      });
      const fail = () => { worker = null; for (const done of waiting.values()) done(null); waiting.clear(); };
      worker.on('error', fail);
      worker.on('exit', fail);
    } catch {
      worker = null;
      return require('./live-art.ts').drawLive(spec, { posters, backdrop }, layers, seed);
    }
  }
  const id = ++jobSeq;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker!.postMessage({ id, spec, posters: posters.map((p) => new Uint8Array(p)), backdrop: backdrop ? new Uint8Array(backdrop) : null, layers, seed });
  });
}

function layerStamp(paths: string[]): string {
  return paths.map((p) => { try { const s = fs.statSync(p); return `${s.size}:${Math.trunc(s.mtimeMs)}`; } catch { return '-'; } }).join('|');
}

// The current cover, or null (no key, no layers, no rows, draw failed): the
// caller then serves the fixed snapshot.
async function getLiveCover(folderId: string, options: { force?: boolean } = {}): Promise<LiveCover | null> {
  const own = require('./own-art.ts');
  if (!own.liveArtEnabled()) return null;
  const spec = own.liveSpec(folderId);
  if (!spec) return null;
  const known = covers.get(folderId);
  if (known && !options.force && Date.now() - known.checkedAt < RECHECK_MS) return known;
  let pending = inflight.get(folderId);
  if (pending) return pending;
  pending = (async () => {
    const art = require('./live-art.ts');
    const { http, store } = deps();
    const rows = await folderRows(folderId, own.liveArtKey());
    if (!rows.length) return known || null;
    const paths = art.pickPaths(rows, spec);
    // Rows without stills (list sources): the still the cover was designed with.
    if (!paths.backdrop && art.needsBackdrop(spec)) paths.backdrop = own.ownArtEntry(folderId)?.backdrop || '';
    if (!paths.posters.length && !paths.backdrop) return known || null;
    const layers = { over: own.liveLayerPath(folderId, 'over'), ...(spec.under ? { under: own.liveLayerPath(folderId, 'under') } : {}) };
    const fp = art.fingerprint(folderId, spec, paths, layerStamp(Object.values(layers)));
    if (known && known.fingerprint === fp) { known.checkedAt = Date.now(); return known; }
    try {
      const stored = await store.get(REDIS_PREFIX + fp) as { b64?: string } | null;
      if (stored && stored.b64) {
        const cover = { buf: Buffer.from(stored.b64, 'base64'), etag: `"live-${fp}"`, fingerprint: fp, checkedAt: Date.now() };
        covers.set(folderId, cover);
        return cover;
      }
    } catch { /* draw it */ }
    // Four at a time: a burst of parallel image requests is what fails.
    const fetched: (Buffer | null)[] = [];
    for (let i = 0; i < paths.posters.length; i += 4) {
      fetched.push(...await Promise.all(paths.posters.slice(i, i + 4).map((p: string) => image(http, 'w342', p))));
    }
    const posters = fetched.filter(Boolean) as Buffer[];
    const backdrop = paths.backdrop ? await image(http, 'w1280', paths.backdrop) : null;
    const complete = posters.length === paths.posters.length && (!paths.backdrop || !!backdrop);
    const buf = await drawInWorker(spec, posters, backdrop, layers, art.seedOf(folderId));
    if (!buf) return known || null;
    // A cover drawn with a missing image is served but never stored under the
    // full fingerprint: the next check (within RECHECK_MS) draws it again.
    const cover = { buf, etag: `"live-${fp}${complete ? '' : '-p'}"`, fingerprint: complete ? fp : `${fp}-partial`, checkedAt: Date.now() };
    covers.set(folderId, cover);
    if (complete) {
      try { await store.set(REDIS_PREFIX + fp, { b64: buf.toString('base64') }, REDIS_TTL); } catch { /* memory copy is enough */ }
    }
    return cover;
  })().catch(() => known || null).finally(() => inflight.delete(folderId));
  inflight.set(folderId, pending);
  return pending;
}

// Draw every Live cover in turn, slowly, so no device waits on a first draw
// and a changed row is redrawn soon after the catalogue refreshes.
let warming = false;
async function warmLiveArt(gapMs = 2000): Promise<{ drawn: number; total: number }> {
  if (warming) return { drawn: 0, total: 0 };
  warming = true;
  let drawn = 0;
  const ids: string[] = require('./own-art.ts').liveFolderIds();
  try {
    for (const id of ids) {
      const before = covers.get(id)?.fingerprint;
      const cover = await getLiveCover(id, { force: true }).catch(() => null);
      if (cover && cover.fingerprint !== before) drawn++;
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  } finally { warming = false; }
  return { drawn, total: ids.length };
}

function resetLiveArt(): void {
  covers.clear(); inflight.clear(); posterMem.clear();
  if (worker) { void worker.terminate(); worker = null; }
}

export interface LiveArtServiceApi {
  getLiveCover: typeof getLiveCover;
  warmLiveArt: typeof warmLiveArt;
  resetLiveArt: typeof resetLiveArt;
}

module.exports = { getLiveCover, warmLiveArt, resetLiveArt } satisfies LiveArtServiceApi;
