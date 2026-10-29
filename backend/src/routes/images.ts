// Poster image proxies: the Pictorium render proxy, the ERDB rating-poster proxy
// and the plain TMDB image passthrough. All three keep the user's artwork
// credentials server-side and cache the produced bytes.
import type { Express, Request, Response } from 'express';
import type { PictoriumWarmApi } from '../runtime/pictorium-warm.ts';
import type { PictoriumApi } from '../runtime/pictorium.ts';
import type { PictoriumOptionsApi } from '../runtime/pictorium-options.ts';
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
const pictoriumWarm = require('../runtime/pictorium-warm.ts') as unknown as PictoriumWarmApi;
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
// same memory + Redis image cache shape as the Pictorium renders.
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
  app.get('/art/folder/:file', async (req: Request, res: Response) => {
    const match = String(req.params['file'] || '').match(FILE);
    const own = require('../catalog/own-art.ts');
    const entry = match ? own.ownArtEntry(match[1]) : null;
    if (!match || !entry || entry.kind !== 'live') { res.setHeader('Cache-Control', 'no-store'); res.status(404).end(); return; }
    const folderId = match[1] as string;
    let cover = null;
    try { cover = await require('../catalog/live-art-service.ts').getLiveCover(folderId); } catch { cover = null; }
    if (cover) {
      res.setHeader('ETag', cover.etag);
      // A cover drawn with a missing image (etag ends in -p) must not sit in
      // Cloudflare or a device for hours: it is redrawn within minutes.
      const partial = cover.etag.endsWith('-p"');
      res.setHeader('Cache-Control', partial ? 'public, max-age=300' : 'public, max-age=21600, stale-while-revalidate=86400');
      if (req.headers['if-none-match'] === cover.etag) { res.status(304).end(); return; }
      res.setHeader('Content-Type', 'image/jpeg');
      res.end(cover.buf);
      return;
    }
    const file = require('path').join(own.artDir(), entry.cover);
    if (!own.artDir() || !require('fs').existsSync(file)) { res.setHeader('Cache-Control', 'no-store'); res.status(404).end(); return; }
    // Short cache: the drawn cover replaces the snapshot as soon as it can.
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.sendFile(file);
  });
}

function mountImageRoutes(app: Express, deps: ImageRoutesDeps): void {
  const { resolveConfig } = deps;
  const axiosImg = deps.imageHttpClient || require('axios') as HttpClient;
  const routeCache = deps.cache || cache;

  // ── Pictorium poster proxy ──────────────────────────────────────────────
  // Pictorium is a separate AGPL-3.0 service (src/pictorium.js). The user's TMDB
  // key is filled in here, server-side, so it never reaches the client. On any
  // upstream failure the client is sent to its normal TMDB poster when that is
  // known, otherwise a soft 404, so a bad poster can never break a grid.
  const pictoriumPosterCache = new Map<string, CachedImage>();
  // In-memory cap raised and made configurable: 150 entries thrashed while a user
  // simply scrolled a large library, forcing re-renders. Redis below is the
  // durable authority, so this only bounds process memory.
  const PICTORIUM_CACHE_MAX = Math.max(100, parseInt(process.env.PICTORIUM_CACHE_MAX ?? '', 10) || 2000);
  const PICTORIUM_CACHE_TTL = 24 * 60 * 60 * 1000; // ms, in-memory mirror
  // A rendered Pictorium poster only changes when our own defaults change (the
  // render version is part of the request), so the durable copy is kept long
  // enough that a library does not re-render every day. Renders cost Pictorium
  // real CPU time, which is exactly what made posters feel slow on repeat views.
  const PICTORIUM_REDIS_TTL = Math.max(3600, parseInt(process.env.PICTORIUM_CACHE_TTL_SECONDS ?? '', 10) || 7 * 24 * 60 * 60);
  const PICTORIUM_REDIS_PREFIX = 'pictcache:';

  function pictoriumRedisKey(key: string): string { return PICTORIUM_REDIS_PREFIX + hashShort(key); }

  function pictoriumCacheGetMem(key: string): CachedImage | null {
    const hit = pictoriumPosterCache.get(key);
    if (!hit) return null;
    if (hit.exp < Date.now()) { pictoriumPosterCache.delete(key); return null; }
    pictoriumPosterCache.delete(key);
    pictoriumPosterCache.set(key, hit);
    return hit;
  }

  function pictoriumCacheSetMem(key: string, value: CachedImage): void {
    pictoriumPosterCache.set(key, value);
    while (pictoriumPosterCache.size > PICTORIUM_CACHE_MAX) {
      const oldest = pictoriumPosterCache.keys().next().value;
      if (oldest === undefined) break;
      pictoriumPosterCache.delete(oldest);
    }
  }

  // Renders persist in Redis so a deploy/restart does not wipe every poster and
  // force a full re-render. Base64 keeps the value a plain JSON string instead of
  // a Buffer object (which JSON.stringify would explode into a byte array).
  async function pictoriumCacheGet(key: string): Promise<CachedImage | null> {
    const mem = pictoriumCacheGetMem(key);
    if (mem) return mem;
    try {
      const stored = await routeCache.get(pictoriumRedisKey(key)) as { b64?: string; type?: string } | null;
      if (stored && stored.b64) {
        const value: CachedImage = {
          buf: Buffer.from(stored.b64, 'base64'),
          type: stored.type || 'image/jpeg',
          exp: Date.now() + PICTORIUM_CACHE_TTL,
        };
        pictoriumCacheSetMem(key, value);
        return value;
      }
    } catch { /* Redis blip: fall through to a render */ }
    return null;
  }

  async function pictoriumCacheSet(key: string, value: CachedImage): Promise<void> {
    pictoriumCacheSetMem(key, value);
    try {
      await routeCache.set(pictoriumRedisKey(key), { b64: value.buf.toString('base64'), type: value.type }, PICTORIUM_REDIS_TTL);
    } catch { /* best effort */ }
  }

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

  // Stremio recommends poster files under 100KB (50KB preferred). Pictorium can
  // render larger, so cap the cached bytes at the same width TMDB catalog artwork
  // uses. sharp is already a dependency; require it lazily so startup stays fast
  // and self-hosters without it just pass the original through.
  const PICTORIUM_POSTER_WIDTH = 342;
  const PICTORIUM_POSTER_QUALITY = 82;
  let sharpModule: SharpFactory | null | undefined;

  function pictoriumSharp(): SharpFactory | null {
    if (sharpModule === undefined) {
      try { sharpModule = require('sharp') as SharpFactory; } catch { sharpModule = null; }
    }
    return sharpModule ?? null;
  }

  async function pictoriumDownscale(buffer: Buffer): Promise<Buffer | null> {
    const sharp = pictoriumSharp();
    if (!sharp) return null;
    try {
      const image = sharp(buffer, { failOn: 'none' });
      const meta = await image.metadata();
      if (!meta || !meta.width || meta.width <= PICTORIUM_POSTER_WIDTH) return null;
      const out = await image
        .resize({ width: PICTORIUM_POSTER_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: PICTORIUM_POSTER_QUALITY, mozjpeg: true })
        .toBuffer();
      return out && out.length ? Buffer.from(out) : null;
    } catch { return null; }
  }

  // Stremio pins the first bytes it sees per poster URL in its image cache,
  // so an instant 302-to-fallback would pin TMDB art indefinitely and the
  // Pictorium render would never be seen. Give the background render a short
  // bounded window to finish first; only then fall back. Zero disables the
  // wait and restores the immediate redirect. Six seconds covers the measured
  // 0.8-4s render for a poster the warmer is already working on (interactive
  // renders now jump the queue), without leaving a grid hanging when Pictorium
  // is having a bad day.
  const PICTORIUM_FIRST_VIEW_WAIT_MS = Math.max(0, parseInt(process.env.PICTORIUM_FIRST_VIEW_WAIT_MS ?? '', 10) || 6000);
  const PICTORIUM_FIRST_VIEW_POLL_MS = 200;
  async function waitForPictoriumRender(key: string, budgetMs: number): Promise<CachedImage | null> {
    const deadline = Date.now() + Math.max(0, budgetMs);
    for (;;) {
      const found = await pictoriumCacheGet(key);
      if (found) return found;
      if (Date.now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, PICTORIUM_FIRST_VIEW_POLL_MS));
    }
  }

  // A light per-IP cap on poster renders, in its own bucket so it can never
  // inflate the config/verify limits. A cold library grid fits comfortably; a
  // hostile client can no longer flood Pictorium's shared render slots. On
  // overflow the client is sent to its normal TMDB poster instead of an error.
  const PICTORIUM_POSTER_MAX = 600;

  function pictoriumPosterExceeded(req: Request): boolean {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const key = `pictorium:${ip}`;
    const now = Date.now();
    let bucket = rateLimitBuckets.get(key);
    if (!bucket || now - bucket.start > 60000) {
      bucket = { start: now, count: 0 };
      rateLimitBuckets.set(key, bucket);
    }
    bucket.count++;
    return bucket.count > PICTORIUM_POSTER_MAX;
  }

  app.get('/:token/pictorium/:type/:id', async (req: Request, res: Response) => {
    const pictorium = require('../runtime/pictorium.ts') as unknown as PictoriumApi;
    const optionsModule = require('../runtime/pictorium-options.ts') as PictoriumOptionsApi;
    const type = req.params.type === 'movie' ? 'movie' : 'series';
    const id = String(req.params.id || '').replace(/\.jpg$/i, '');
    if (!/^(?:tt\d{1,20}|\d{1,10})$/i.test(id)) { res.status(400).end(); return; }
    const fallback = pictorium.safeFallback(req.query.fallback);
    const preview = req.query.preview === '1';
    // Background warm requests are internal loopback calls: they must render and
    // cache even when the client fast path would redirect, and they must not be
    // limited by the client poster bucket (all share 127.0.0.1).
    const warm = req.query.warm === '1';
    const redirectFallback = () => (fallback ? res.redirect(302, fallback) : res.status(404).end());
    if (!warm && pictoriumPosterExceeded(req)) { redirectFallback(); return; }
    try {
      const configstore = deps.configStore || require('../runtime/configstore.ts') as ConfigStoreLike;
      const config = await configstore.mergeStoredConfig(await resolveConfig(String(req.params.token || '')));
      // The Studio preview must work before the first save, so it only needs a
      // TMDB key. Real catalogue posters stay gated on the provider being on.
      if (!config || !config.tmdbApiKey || (config.posterProvider !== 'pictorium' && !preview)) { redirectFallback(); return; }
      const opts = optionsModule.fromQuery(req.query);
      const base = pictorium.resolveBase(config);
      const mdblistKey = (config.mdblistKey as string | undefined) || '';
      const upstream = pictorium.requestUrl({
        base,
        apiKey: config.tmdbApiKey as string,
        type,
        id,
        title: req.query.title as string | undefined,
        releaseDate: req.query.rd as string | undefined,
        imdbId: req.query.imdbId as string | undefined,
        lang: req.query.lang as string | undefined,
        region: req.query.region as string | undefined,
        mdblistKey,
        options: opts,
      });
      // The user's MDBList key changes the aggregate rating, so scope the shared
      // image cache to a key hash: one user's ratings never fill another's entry.
      const mdbFp = mdblistKey ? hashShort(mdblistKey) : 'none';
      const cacheKey = [base, type, id, optionsModule.toQuery(opts), req.query.title || '', req.query.rd || '', req.query.lang || '', req.query.region || '', mdbFp].join('|');
      // Previews use the same cache: the key holds every option, so a changed
      // option is a new render, and the setup page's rotating preview and its
      // duplicate panels no longer make Pictorium draw the same poster again.
      let hit = await pictoriumCacheGet(cacheKey);
      if (!hit) {
        // Fast path: don't make a client wait the full render if it can be
        // avoided — but DO wait briefly. Clients (Stremio especially) pin the
        // first bytes per URL, so an instant redirect pins TMDB fallback art
        // and the finished render is never seen. The wait is bounded; on
        // timeout the TMDB poster is served exactly as before.
        if (!preview && !warm && fallback && pictoriumWarm.enabled()) {
          // Priority: this person has the poster on screen and is waiting. A
          // bulk warm run must never sit in front of them.
          pictoriumWarm.enqueue(req.originalUrl, { priority: true });
          hit = await waitForPictoriumRender(cacheKey, PICTORIUM_FIRST_VIEW_WAIT_MS).catch(() => null);
          if (!hit) {
            // no-store: the fallback must never be cached as "the poster". The
            // client re-requests on the next render and gets the composed Pictorium
            // image as soon as the background render finishes.
            res.setHeader('Cache-Control', 'no-store');
            res.redirect(302, fallback);
            return;
          }
        }
        // A waited render already filled `hit`: serve it below instead of
        // rendering a second time.
        if (!hit) {
        // Background warm renders must be allowed to finish: Pictorium can
        // take 30s+ per poster when an upstream (e.g. MDBList) is failing,
        // and a client-sized timeout here aborts the fetch just before it
        // completes — so nothing is ever cached and every view 302s forever.
        // Interactive callers never reach this branch with a long wait (the
        // fast path above already answered them), so a generous timeout only
        // affects background work.
        const upstreamRes = await axiosImg.get(upstream, {
          responseType: 'arraybuffer',
          timeout: warm ? 120000 : 30000,
          maxContentLength: 6 * 1024 * 1024,
          validateStatus: () => true,
          headers: { 'x-api-key': config.tmdbApiKey as string },
        });
        if (upstreamRes.status !== 200 || !upstreamRes.data) { redirectFallback(); return; }
        let buf: Buffer = Buffer.from(upstreamRes.data as ArrayBuffer);
        let contentType = (upstreamRes.headers['content-type'] as string | undefined) || 'image/jpeg';
        const smaller = await pictoriumDownscale(buf);
        if (smaller) { buf = smaller; contentType = 'image/jpeg'; }
        hit = { buf, type: contentType, exp: Date.now() + PICTORIUM_CACHE_TTL };
        await pictoriumCacheSet(cacheKey, hit);
        }
      }
      if (warm) { res.status(204).end(); return; }
      res.setHeader('Content-Type', hit.type);
      // The preview URL carries the setup's keys, so it stays private, but the
      // browser may reuse it for a while instead of asking for a new render.
      res.setHeader('Cache-Control', preview ? 'private, max-age=600' : 'public, max-age=86400, immutable');
      res.end(hit.buf);
    } catch {
      redirectFallback();
    }
  });

  // ERDB poster proxy. Same speed strategy as Pictorium: serve the normal TMDB
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
        if (!warm && fallback && pictoriumWarm.enabled()) {
          pictoriumWarm.enqueue(req.originalUrl);
          res.setHeader('Cache-Control', 'no-store');
          res.redirect(302, fallback);
          return;
        }
        const up = await axiosImg.get(upstream, {
          responseType: 'arraybuffer', timeout: 20000,
          maxContentLength: 6 * 1024 * 1024, validateStatus: () => true,
        });
        if (up.status !== 200 || !up.data) { redirectFallback(); return; }
        let buf: Buffer = Buffer.from(up.data as ArrayBuffer);
        let contentType = (up.headers['content-type'] as string | undefined) || 'image/jpeg';
        const smaller = await pictoriumDownscale(buf);
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
