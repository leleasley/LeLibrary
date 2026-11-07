// Poster image proxies: the ERDB rating-poster proxy and the plain TMDB
// image passthrough. Both keep the user's artwork credentials server-side
// and cache the produced bytes.
import type { Express, Request, Response } from 'express';
import type { RateLimitApi } from '../middleware/rate-limit.ts';
import type { SharedApi } from './shared.ts';
import type { GeneratedCoversApi } from '../catalog/generated-covers.ts';

type HttpImageResponse = { status: number; data: any; headers: Record<string, unknown> };
interface CacheLike {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown, ttlSeconds?: number) => Promise<unknown>;
}
interface HttpClient { get: (url: string, config?: Record<string, unknown>) => Promise<HttpImageResponse> }
interface ConfigStoreLike { mergeStoredConfig: (config: unknown) => Promise<Record<string, unknown> | null> }
type SharpFactory = (input: Buffer, options?: { failOn?: string }) => import('sharp').Sharp;

const cache = require('../runtime/cache.ts') as CacheLike;
const rateLimitModule = require('../middleware/rate-limit.ts') as RateLimitApi;
const { hashShort } = require('./shared.ts') as SharedApi;

const { rateLimitBuckets } = rateLimitModule;

export interface ImageRoutesDeps {
  resolveConfig: (token: string) => Promise<Record<string, unknown> | null>;
  /** Optional route dependencies let contract tests simulate upstream failures without network access. */
  imageHttpClient?: HttpClient;
  cache?: CacheLike;
  configStore?: ConfigStoreLike;
}

export interface CoreImageRoutesDeps {
  /** Test seams: a fake image.tmdb.org client and a fake Redis cache. */
  imageHttpClient?: HttpClient;
  cache?: CacheLike;
}

export interface ImageRoutesApi {
  mountImageRoutes: (app: Express, deps: ImageRoutesDeps) => void;
  mountCoreImageRoutes: (app: Express, deps?: CoreImageRoutesDeps) => void;
}

// The TMDB image passthrough is registered BEFORE the website router (whose
// trailing 404 would otherwise answer /img/tmdb/*), so it has its own mount
// point rather than living with the poster proxies.
function mountCoreImageRoutes(app: Express, deps: CoreImageRoutesDeps = {}): void {
  const axiosImg = require('axios') as HttpClient;
  mountGeneratedCoverRoute(app, deps);
  mountLiveArtRoute(app);
  mountHeroArtRoute(app);
  // Express 5 wildcard: named, and captured as path segments.
  app.get('/img/tmdb/*splat', async (req: Request, res: Response) => {
    try {
      const splat = (req.params as Record<string, unknown>)['splat'];
      const tmdbPath = Array.isArray(splat) ? splat.join('/') : String(splat || '');
      if (!/^(?:w\d+|original)\/[A-Za-z0-9_.-]+\.(?:jpe?g|png|webp)$/i.test(tmdbPath)) {
        res.status(400).end();
        return;
      }
      const url = `https://image.tmdb.org/t/p/${tmdbPath}`;
      const resp = await axiosImg.get(url, {
        responseType: 'arraybuffer',
        maxContentLength: 10 * 1024 * 1024,
        maxBodyLength: 10 * 1024 * 1024,
        headers: { 'User-Agent': 'LeLibrary/2.0' },
        timeout: 10000,
      });
      res.setHeader('Content-Type', (resp.headers['content-type'] as string | undefined) || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      res.send(Buffer.from(resp.data));
    } catch (err) {
      console.error('[IMG PROXY]', (err as Error).message);
      res.status(502).end();
    }
  });
}

interface CachedImage { buf: Buffer; type: string; exp: number }

// ── Generated folder covers ─────────────────────────────────────────────
// /art/generated/<poster|wide>/<hash>.jpg?p=..&b=..&l=..&t=..&v=1
// Content-addressed (catalog/generated-covers.ts): the query holds only public
// TMDB image paths and the title, the hash must match them, and the route only
// ever fetches image.tmdb.org. No key, no token, no catalogue fetch. One URL
// always means the same bytes, so it is cached as immutable and kept in the
// same memory + Redis image cache shape as the ERDB renders.
function mountGeneratedCoverRoute(app: Express, deps: CoreImageRoutesDeps): void {
  const covers = require('../catalog/generated-covers.ts') as GeneratedCoversApi;
  const http = deps.imageHttpClient || require('axios') as HttpClient;
  const store = deps.cache || cache;
  const MEM_MAX = Math.max(50, parseInt(process.env.GENERATED_COVER_CACHE_MAX ?? '', 10) || 500);
  const MEM_TTL = 24 * 60 * 60 * 1000;
  const REDIS_TTL = 90 * 24 * 60 * 60;
  const REDIS_PREFIX = 'gencover:v1:';
  const memory = new Map<string, CachedImage>();
  const inflight = new Map<string, Promise<CachedImage | null>>();
  const RENDERS_PER_MINUTE = 60;
  const REQUESTS_PER_MINUTE = 600;

  function memGet(key: string): CachedImage | null {
    const hit = memory.get(key);
    if (!hit) return null;
    if (hit.exp < Date.now()) { memory.delete(key); return null; }
    memory.delete(key);
    memory.set(key, hit);
    return hit;
  }
  function memSet(key: string, value: CachedImage): void {
    memory.set(key, value);
    while (memory.size > MEM_MAX) {
      const oldest = memory.keys().next().value;
      if (oldest === undefined) break;
      memory.delete(oldest);
    }
  }
  async function cacheGet(key: string): Promise<CachedImage | null> {
    const mem = memGet(key);
    if (mem) return mem;
    try {
      const stored = await store.get(REDIS_PREFIX + key) as { b64?: string; type?: string } | null;
      if (stored && stored.b64) {
        const value: CachedImage = { buf: Buffer.from(stored.b64, 'base64'), type: stored.type || 'image/jpeg', exp: Date.now() + MEM_TTL };
        memSet(key, value);
        return value;
      }
    } catch { /* Redis blip: render */ }
    return null;
  }
  async function cacheSet(key: string, value: CachedImage): Promise<void> {
    memSet(key, value);
    try { await store.set(REDIS_PREFIX + key, { b64: value.buf.toString('base64'), type: value.type }, REDIS_TTL); } catch { /* best effort */ }
  }
  function exceeded(req: Request, name: string, max: number): boolean {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `gencover-${name}:${ip}`;
    const now = Date.now();
    let bucket = rateLimitBuckets.get(key);
    if (!bucket || now - bucket.start > 60000) {
      bucket = { start: now, count: 0 };
      rateLimitBuckets.set(key, bucket);
    }
    bucket.count++;
    return bucket.count > max;
  }

  // One render per hash at a time; the result goes to the image cache.
  function renderOnce(spec: Parameters<typeof covers.renderCover>[0], hash: string): Promise<CachedImage | null> {
    let pending = inflight.get(hash);
    if (!pending) {
      pending = (async () => {
        const images = await covers.fetchCoverImages(spec, http);
        const usable = images.posters.some(Boolean) || !!images.backdrop;
        if (!usable) return null;
        const buf = await covers.renderCover(spec, images);
        if (!buf || !buf.length) return null;
        const value: CachedImage = { buf, type: 'image/jpeg', exp: Date.now() + MEM_TTL };
        await cacheSet(hash, value);
        return value;
      })().finally(() => inflight.delete(hash));
      inflight.set(hash, pending);
    }
    return pending;
  }

  // Curated folders' covers are known at start: draw them slowly in the
  // background (about one a second) so a first visitor never waits on, or
  // gets rate limited out of, a pack's worth of renders.
  async function warmStaticCovers(): Promise<void> {
    require('../catalog/curated-collections.ts');
    for (const [hash, spec] of covers.staticCovers()) {
      try {
        if (await cacheGet(hash)) continue;
        await renderOnce(spec, hash);
      } catch { /* next one */ }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (process.env['NODE_ENV'] !== 'test' && !process.argv.some((arg) => arg.includes('--test'))) {
    const timer = setTimeout(() => { void warmStaticCovers(); }, 60_000);
    timer.unref?.();
  }

  app.get('/art/generated/:kind/:file', async (req: Request, res: Response) => {
    // Loading the curated packs registers their short cover URLs.
    require('../catalog/curated-collections.ts');
    const parsed = covers.parseCoverRequest(req.params.kind, req.params.file, req.query as Record<string, unknown>);
    if (!parsed.ok) { res.setHeader('Cache-Control', 'no-store'); res.status(400).end(); return; }
    const { spec, hash } = parsed;
    const fallback = covers.coverFallbackUrl(spec);
    const sendFallback = () => {
      res.setHeader('Cache-Control', 'no-store');
      if (fallback) res.redirect(302, fallback); else res.status(404).end();
    };
    if (exceeded(req, 'req', REQUESTS_PER_MINUTE)) { res.setHeader('Retry-After', '60'); res.status(429).end(); return; }
    try {
      let hit = await cacheGet(hash);
      if (!hit) {
        if (!inflight.has(hash) && exceeded(req, 'render', RENDERS_PER_MINUTE)) { sendFallback(); return; }
        hit = await renderOnce(spec, hash);
      }
      if (!hit) { sendFallback(); return; }
      res.setHeader('Content-Type', hit.type);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.end(hit.buf);
    } catch {
      sendFallback();
    }
  });
}

// ── Live folder covers ──────────────────────────────────────────────────
// /art/folder/<folderId>.jpg: one fixed link per Live folder (Trending,
// charts, streaming services). The server draws it from the folder's current
// titles (catalog/live-art-service.ts); the ETag is the fingerprint of what is
// drawn, so an unchanged cover answers 304 and a changed one reaches Nuvio at
// the same link. No key, no current rows or a draw error: the fixed snapshot.
function mountLiveArtRoute(app: Express): void {
  const FILE = /^(folder-lelibrary-[a-z0-9][a-z0-9_-]{0,120})\.jpg$/;
  // ?w=480: the tile size the setup pages show (studio, pack picker).
  const thumbs = new Map<string, Buffer>();
  async function thumbOf(etag: string, buf: Buffer): Promise<Buffer> {
    const hit = thumbs.get(etag);
    if (hit) return hit;
    const sharp = require('sharp');
    const out: Buffer = await sharp(buf).resize(480, 270).jpeg({ quality: 80, progressive: true, mozjpeg: true }).toBuffer();
    thumbs.set(etag, out);
    while (thumbs.size > 200) { const oldest = thumbs.keys().next().value; if (oldest === undefined) break; thumbs.delete(oldest); }
    return out;
  }
  app.get('/art/folder/:file', async (req: Request, res: Response) => {
    const thumb = req.query['w'] === '480';
    const match = String(req.params['file'] || '').match(FILE);
    const own = require('../catalog/own-art.ts');
    const entry = match ? own.ownArtEntry(match[1]) : null;
    if (!match || !entry || entry.kind !== 'live') { res.setHeader('Cache-Control', 'no-store'); res.status(404).end(); return; }
    const folderId = match[1] as string;
    let cover = null;
    try { cover = await require('../catalog/live-art-service.ts').getLiveCover(folderId); } catch { cover = null; }
    if (cover) {
      const etag = thumb ? cover.etag.replace(/"$/, '-t"') : cover.etag;
      res.setHeader('ETag', etag);
      // A cover drawn with a missing image (etag ends in -p) must not sit in
      // Cloudflare or a device for hours: it is redrawn within minutes.
      const partial = cover.etag.endsWith('-p"');
      res.setHeader('Cache-Control', partial ? 'public, max-age=300' : 'public, max-age=21600, stale-while-revalidate=86400');
      if (req.headers['if-none-match'] === etag) { res.status(304).end(); return; }
      res.setHeader('Content-Type', 'image/jpeg');
      let body = cover.buf;
      if (thumb) { try { body = await thumbOf(etag, cover.buf); } catch { /* full size */ } }
      res.end(body);
      return;
    }
    const thumbFile = require('path').join(own.artDir(), 'thumbs', entry.cover);
    const file = thumb && own.artDir() && require('fs').existsSync(thumbFile) ? thumbFile : require('path').join(own.artDir(), entry.cover);
    if (!own.artDir() || !require('fs').existsSync(file)) { res.setHeader('Cache-Control', 'no-store'); res.status(404).end(); return; }
    // Short cache: the drawn cover replaces the snapshot as soon as it can.
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.sendFile(file);
  });
}

// ── Folder hero backdrops ───────────────────────────────────────────────
// /art/hero/<folderId>.jpg: the tilted poster mosaic Nuvio shows behind a
// folder's contents (catalog/hero-art-service.ts). ETag = fingerprint of the
// posters drawn; Live heroes follow the folder's titles, the rest change
// rarely (a franchise's new film). ?w=960 is the review/preview size.
function mountHeroArtRoute(app: Express): void {
  const FILE = /^(folder-lelibrary-[a-z0-9][a-z0-9_-]{0,120})\.jpg$/;
  const small = new Map<string, Buffer>();
  app.get('/art/hero/:file', async (req: Request, res: Response) => {
    const match = String(req.params['file'] || '').match(FILE);
    const service = require('../catalog/hero-art-service.ts');
    if (!match || !service.hasHero(match[1])) { res.setHeader('Cache-Control', 'no-store'); res.status(404).end(); return; }
    const folderId = match[1] as string;
    let hero = null;
    try { hero = await service.getHero(folderId); } catch { hero = null; }
    if (!hero) { res.setHeader('Cache-Control', 'no-store'); res.status(404).end(); return; }
    const preview = req.query['w'] === '960';
    const etag = preview ? hero.etag.replace(/"$/, '-s"') : hero.etag;
    const live = require('../catalog/own-art.ts').ownArtEntry(folderId)?.kind === 'live';
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', hero.etag.endsWith('-p"') ? 'public, max-age=300'
      : live ? 'public, max-age=21600, stale-while-revalidate=86400' : 'public, max-age=86400, stale-while-revalidate=604800');
    if (req.headers['if-none-match'] === etag) { res.status(304).end(); return; }
    let body = hero.buf;
    if (preview) {
      const hit = small.get(etag);
      if (hit) body = hit;
      else {
        try {
          body = await require('sharp')(hero.buf).resize(960, 540).jpeg({ quality: 78, progressive: true, mozjpeg: true }).toBuffer();
          small.set(etag, body);
          while (small.size > 300) { const oldest = small.keys().next().value; if (oldest === undefined) break; small.delete(oldest); }
        } catch { body = hero.buf; }
      }
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.end(body);
  });
}

function mountImageRoutes(app: Express, deps: ImageRoutesDeps): void {
  const { resolveConfig } = deps;
  const axiosImg = deps.imageHttpClient || require('axios') as HttpClient;
  const routeCache = deps.cache || cache;

  // ── ERDB poster proxy cache ─────────────────────────────────────────────
  // ERDB composes rating posters on demand upstream (measured 6-14s each). When
  // the user has chosen ERDB, their posters are routed here so the first view
  // falls back to the normal TMDB poster and the composed image is cached for
  // every later view (memory + Redis, survives restarts).
  const erdbImageCache = new Map<string, CachedImage>();
  const ERDB_CACHE_MAX = Math.max(100, parseInt(process.env.ERDB_CACHE_MAX ?? '', 10) || 2000);
  const ERDB_CACHE_TTL = 24 * 60 * 60 * 1000;
  const ERDB_REDIS_TTL = 24 * 60 * 60;
  const ERDB_REDIS_PREFIX = 'erdbcache:';

  function erdbCacheGetMem(key: string): CachedImage | null {
    const hit = erdbImageCache.get(key);
    if (!hit) return null;
    if (hit.exp < Date.now()) { erdbImageCache.delete(key); return null; }
    erdbImageCache.delete(key);
    erdbImageCache.set(key, hit);
    return hit;
  }

  function erdbCacheSetMem(key: string, value: CachedImage): void {
    erdbImageCache.set(key, value);
    while (erdbImageCache.size > ERDB_CACHE_MAX) {
      const oldest = erdbImageCache.keys().next().value;
      if (oldest === undefined) break;
      erdbImageCache.delete(oldest);
    }
  }

  async function erdbCacheGet(key: string): Promise<CachedImage | null> {
    const mem = erdbCacheGetMem(key);
    if (mem) return mem;
    try {
      const stored = await routeCache.get(ERDB_REDIS_PREFIX + hashShort(key)) as { b64?: string; type?: string } | null;
      if (stored && stored.b64) {
        const value: CachedImage = {
          buf: Buffer.from(stored.b64, 'base64'),
          type: stored.type || 'image/jpeg',
          exp: Date.now() + ERDB_CACHE_TTL,
        };
        erdbCacheSetMem(key, value);
        return value;
      }
    } catch { /* fall through */ }
    return null;
  }

  async function erdbCacheSet(key: string, value: CachedImage): Promise<void> {
    erdbCacheSetMem(key, value);
    try {
      await routeCache.set(ERDB_REDIS_PREFIX + hashShort(key), { b64: value.buf.toString('base64'), type: value.type }, ERDB_REDIS_TTL);
    } catch { /* best effort */ }
  }

  // Stremio recommends poster files under 100KB (50KB preferred). ERDB renders
  // can be larger, so cap the cached bytes at the same width TMDB catalog artwork
  // uses. sharp is already a dependency; require it lazily so startup stays fast
  // and self-hosters without it just pass the original through.
  const POSTER_WIDTH = 342;
  const POSTER_QUALITY = 82;
  let sharpModule: SharpFactory | null | undefined;

  function imageSharp(): SharpFactory | null {
    if (sharpModule === undefined) {
      try { sharpModule = require('sharp') as SharpFactory; } catch { sharpModule = null; }
    }
    return sharpModule ?? null;
  }

  async function imageDownscale(buffer: Buffer): Promise<Buffer | null> {
    const sharp = imageSharp();
    if (!sharp) return null;
    try {
      const image = sharp(buffer, { failOn: 'none' });
      const meta = await image.metadata();
      if (!meta || !meta.width || meta.width <= POSTER_WIDTH) return null;
      const out = await image
        .resize({ width: POSTER_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: POSTER_QUALITY, mozjpeg: true })
        .toBuffer();
      return out && out.length ? Buffer.from(out) : null;
    } catch { return null; }
  }

  // ERDB poster proxy: serve the normal TMDB
  // poster instantly while the ERDB image is composed and cached in the
  // background, then serve the cached ERDB image on every later request.
  app.get('/:token/erdb/:type/:id', async (req: Request, res: Response) => {
    const requestedType = String(req.params.type ?? '');
    const type = ['poster', 'backdrop', 'logo'].includes(requestedType) ? requestedType : 'poster';
    const id = String(req.params.id || '').replace(/\.jpg$/i, '');
    if (!/^(?:tt\d{1,20}|tmdb:[a-z]+:\d{1,12}|\d{1,12})$/i.test(id)) { res.status(400).end(); return; }
    const fallback = typeof req.query.fallback === 'string' && /^https?:\/\//i.test(req.query.fallback)
      ? req.query.fallback.slice(0, 2048)
      : '';
    const warm = req.query.warm === '1';
    const redirectFallback = () => (fallback ? res.redirect(302, fallback) : res.status(404).end());
    try {
      const configstore = deps.configStore || require('../runtime/configstore.ts') as ConfigStoreLike;
      const config = await configstore.mergeStoredConfig(await resolveConfig(String(req.params.token || '')));
      const token = config && (config.erdbToken as string | undefined);
      if (!token) { redirectFallback(); return; }
      const upstream = `https://easyratingsdb.com/${encodeURIComponent(token)}/${encodeURIComponent(type)}/${encodeURIComponent(id)}.jpg`;
      const cacheKey = `erdb|${hashShort(token)}|${type}|${id}`;
      let hit = await erdbCacheGet(cacheKey);
      if (!hit) {
        const up = await axiosImg.get(upstream, {
          responseType: 'arraybuffer', timeout: 20000,
          maxContentLength: 6 * 1024 * 1024, validateStatus: () => true,
        });
        if (up.status !== 200 || !up.data) { redirectFallback(); return; }
        let buf: Buffer = Buffer.from(up.data as ArrayBuffer);
        let contentType = (up.headers['content-type'] as string | undefined) || 'image/jpeg';
        const smaller = await imageDownscale(buf);
        if (smaller) { buf = smaller; contentType = 'image/jpeg'; }
        hit = { buf, type: contentType, exp: Date.now() + ERDB_CACHE_TTL };
        await erdbCacheSet(cacheKey, hit);
      }
      if (warm) { res.status(204).end(); return; }
      res.setHeader('Content-Type', hit.type);
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.end(hit.buf);
    } catch {
      redirectFallback();
    }
  });
}

module.exports = { mountImageRoutes, mountCoreImageRoutes } satisfies ImageRoutesApi;
