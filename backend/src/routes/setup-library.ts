'use strict';
// Library page API: /api/setup/:uuid/library/*.
//
// Shows one setup's own library (the files its debrid keys hold, as already
// indexed by the library engine) and lets the owner fix what the matcher
// could not. Same authority as editing: a bearer edit token from /unlock.
// Nothing new is fetched from debrid providers here, file names are never
// logged, responses are never cached, and provider ids, hashes, links and the
// raw provider record never leave the server.

import type { Express, Request, Response } from 'express';
import type { EditSessionsApi, EditSessionStore } from '../setup/edit-sessions.ts';
import type { RuntimeApi } from '../setup/runtime.ts';
import type { ReviewApi, ReviewView } from '../library/review.ts';
import type { OverridesApi, OverrideMediaType } from '../library/overrides.ts';

const express = require('express') as typeof import('express');
const runtime = require('../setup/runtime.ts') as RuntimeApi;
const { createEditSessionStore, bearerToken } = require('../setup/edit-sessions.ts') as EditSessionsApi;
const review = require('../library/review.ts') as ReviewApi;
const overrides = require('../library/overrides.ts') as OverridesApi;

export interface SetupLibraryRoutesOptions {
  basePath?: string;
  editSessions?: EditSessionStore;
}

export interface SetupLibraryRoutesApi {
  mountSetupLibraryRoutes: (app: Express, options?: SetupLibraryRoutesOptions) => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VIEWS: ReviewView[] = ['attention', 'matched', 'ignored'];

function rateLimited(windowMs: number, max: number) {
  return (req: Request, res: Response, next: () => void) => {
    const { rateLimit } = require('../middleware/rate-limit.ts') as {
      rateLimit: (options?: { windowMs?: number; max?: number }) => (req: unknown, res: unknown, next: () => void) => void;
    };
    rateLimit({ windowMs, max })(req, res, next);
  };
}

function smallInt(value: unknown, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : NaN;
}

function mountSetupLibraryRoutes(app: Express, { basePath = '/api/setup', editSessions }: SetupLibraryRoutesOptions = {}): void {
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));
  const sessions: EditSessionStore = editSessions || createEditSessionStore();
  router.use((_req: Request, res: Response, next: () => void) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  // Resolve the unlocked setup to its library. 401 without a matching edit
  // token, 409 when the setup has no debrid key, 503 without the indexed engine.
  async function context(req: Request, res: Response) {
    const uuid = String(req.params['uuid'] || '').toLowerCase();
    if (!UUID_RE.test(uuid)) { res.status(400).json({ error: 'Invalid setup id' }); return null; }
    const bearer = bearerToken(req);
    const session = bearer ? sessions.verify(bearer) : null;
    if (!session || session.uuid !== uuid) { res.status(401).json({ error: 'Unlock the setup first' }); return null; }
    const engine = require('../library/engine.ts');
    if (!engine.isIndexed()) { res.status(503).json({ error: 'The library page needs the library database on this instance.', code: 'no-index' }); return null; }
    const store = await runtime.getSetupStore().catch(() => null);
    if (!store) { res.status(503).json({ error: 'Setup storage is unavailable on this instance' }); return null; }
    const opened = await store.resolveByUuid(uuid);
    if (!opened) { res.status(404).json({ error: 'Setup not found' }); return null; }
    const config = store.toEngineConfig(opened) as Record<string, any>;
    const providers = require('../providers/index.ts');
    if (!providers.activeProviders(config).length) { res.status(409).json({ error: 'This setup has no debrid key yet.', code: 'no-provider' }); return null; }
    const scopeId: string = providers.getUserKey(config);
    const token = opened.secret ? `${opened.uuid}.${opened.secret}` : '';
    if (token) engine.noteConfig(token, config);
    return {
      uuid, scopeId, token, config, engine,
      hasPassword: opened.hasPassword === true,
      tmdbApiKey: typeof config['tmdbApiKey'] === 'string' ? (config['tmdbApiKey'] as string) : '',
      lang: typeof config['lang'] === 'string' ? (config['lang'] as string) : 'en-US',
    };
  }

  // A fix changes what catalogs and title pages show: rebuild them.
  async function refreshProjection(ctx: { scopeId: string; engine: any }) {
    ctx.engine.noteProjectionChange(ctx.scopeId);
    try { await require('../runtime/cache.ts').delPattern(`meta:*${ctx.scopeId}*`); } catch { /* ages out */ }
  }

  router.get('/:uuid/library', rateLimited(60_000, 60), async (req: Request, res: Response) => {
    const ctx = await context(req, res);
    if (!ctx) return;
    const summary = await review.summary(ctx.scopeId);
    res.json({ ...summary, hasPassword: ctx.hasPassword, canFix: Boolean(ctx.tmdbApiKey) });
  });

  router.get('/:uuid/library/items', rateLimited(60_000, 120), async (req: Request, res: Response) => {
    const ctx = await context(req, res);
    if (!ctx) return;
    const view = VIEWS.includes(req.query['view'] as ReviewView) ? (req.query['view'] as ReviewView) : 'attention';
    const offset = Math.max(0, Number(req.query['offset']) || 0);
    res.json(await review.items(ctx.scopeId, { view, q: String(req.query['q'] || ''), offset, limit: 50 }));
  });

  // TMDB search for the fix dialog, with the setup's own TMDB key. A TMDB id
  // or an IMDb id (tt...) can be pasted instead of a title.
  router.get('/:uuid/library/search', rateLimited(60_000, 60), async (req: Request, res: Response) => {
    const ctx = await context(req, res);
    if (!ctx) return;
    if (!ctx.tmdbApiKey) { res.status(409).json({ error: 'Add a TMDB key to this setup to fix matches.', code: 'no-tmdb' }); return; }
    const type = req.query['type'] === 'tv' ? 'tv' : 'movie';
    const q = String(req.query['q'] || '').trim().slice(0, 120);
    const year = smallInt(req.query['year'], 2100);
    if (!q) { res.json({ results: [] }); return; }
    const tmdb = require('../media/tmdb.ts');
    let raw: Record<string, any>[] = [];
    if (/^tt\d{5,10}$/i.test(q)) {
      const mapped = await tmdb.imdbToTmdbCached(ctx.tmdbApiKey, q.toLowerCase()).catch(() => null);
      if (mapped && Number.isInteger(mapped.tmdbId)) {
        const mediaType: OverrideMediaType = mapped.type === 'movie' ? 'movie' : 'series';
        const source = await overrides.fetchTmdbSource(ctx.tmdbApiKey, mediaType, mapped.tmdbId, ctx.lang);
        if (source) raw = [{ ...source, _type: mediaType === 'movie' ? 'movie' : 'tv' }];
      }
    } else if (/^\d{1,9}$/.test(q)) {
      const source = await overrides.fetchTmdbSource(ctx.tmdbApiKey, type === 'movie' ? 'movie' : 'series', Number(q), ctx.lang);
      if (source) raw = [{ ...source, _type: type }];
    } else {
      raw = ((await tmdb.searchCandidates(ctx.tmdbApiKey, q, type, Number.isInteger(year) ? year : undefined, ctx.lang, 10).catch(() => [])) || [])
        .map((row: Record<string, any>) => ({ ...row, _type: type }));
    }
    res.json({
      results: raw.slice(0, 10).map((row) => ({
        tmdbId: row['id'],
        type: row['_type'],
        title: row['title'] || row['name'] || '',
        originalTitle: row['original_title'] || row['original_name'] || null,
        year: String(row['release_date'] || row['first_air_date'] || '').slice(0, 4) || null,
        poster: row['poster_path'] ? `https://image.tmdb.org/t/p/w185${row['poster_path']}` : null,
        overview: typeof row['overview'] === 'string' ? row['overview'].slice(0, 220) : '',
        anime: row['isJapaneseAnimation'] === true || tmdb.isTmdbAnimeItem(row),
      })),
    });
  });

  router.post('/:uuid/library/items/:id/fix', rateLimited(60_000, 60), async (req: Request, res: Response) => {
    const ctx = await context(req, res);
    if (!ctx) return;
    if (!ctx.tmdbApiKey) { res.status(409).json({ error: 'Add a TMDB key to this setup to fix matches.', code: 'no-tmdb' }); return; }
    const id = Number(req.params['id']);
    const body = (req.body || {}) as Record<string, unknown>;
    const tmdbId = Number(body['tmdbId']);
    const mediaType = body['mediaType'];
    const season = smallInt(body['season'], 200);
    const episode = smallInt(body['episode'], 5000);
    if (!Number.isInteger(id) || !Number.isInteger(tmdbId) || tmdbId <= 0
      || !['movie', 'series', 'anime'].includes(String(mediaType))
      || Number.isNaN(season) || Number.isNaN(episode) || (episode !== null && season === null)) {
      res.status(400).json({ error: 'Invalid fix' });
      return;
    }
    const row = await review.itemForFix(ctx.scopeId, id);
    if (!row) { res.status(404).json({ error: 'File not found in this library' }); return; }
    const override = {
      action: 'match' as const, tmdbId, mediaType: mediaType as OverrideMediaType,
      season: mediaType === 'movie' ? null : season, episode: mediaType === 'movie' ? null : episode,
    };
    const applied = await overrides.apply(row, override, { tmdbApiKey: ctx.tmdbApiKey, lang: ctx.lang });
    if (applied !== 'matched') { res.status(502).json({ error: 'Could not load that title from TMDB. Try again.' }); return; }
    await overrides.save(ctx.scopeId, row.provider, row.source_id, override);
    await refreshProjection(ctx);
    res.json({ ok: true });
  });

  router.post('/:uuid/library/items/:id/ignore', rateLimited(60_000, 60), async (req: Request, res: Response) => {
    const ctx = await context(req, res);
    if (!ctx) return;
    const id = Number(req.params['id']);
    const row = Number.isInteger(id) ? await review.itemForFix(ctx.scopeId, id) : null;
    if (!row) { res.status(404).json({ error: 'File not found in this library' }); return; }
    const override = { action: 'ignore' as const, tmdbId: null, mediaType: null, season: null, episode: null };
    await overrides.apply(row, override, { tmdbApiKey: ctx.tmdbApiKey, lang: ctx.lang });
    await overrides.save(ctx.scopeId, row.provider, row.source_id, override);
    await refreshProjection(ctx);
    res.json({ ok: true });
  });

  // Undo a fix or an ignore: back to automatic matching.
  router.delete('/:uuid/library/items/:id/fix', rateLimited(60_000, 60), async (req: Request, res: Response) => {
    const ctx = await context(req, res);
    if (!ctx) return;
    const id = Number(req.params['id']);
    const row = Number.isInteger(id) ? await review.itemForFix(ctx.scopeId, id) : null;
    if (!row) { res.status(404).json({ error: 'File not found in this library' }); return; }
    await overrides.remove(ctx.scopeId, row.provider, row.source_id);
    await review.requeue(ctx.scopeId, id);
    await refreshProjection(ctx);
    setTimeout(() => ctx.engine.drainOnce().catch(() => {}), 0).unref?.();
    res.json({ ok: true });
  });

  // Ask the matcher to try every unmatched file again now.
  router.post('/:uuid/library/retry', rateLimited(60_000, 5), async (req: Request, res: Response) => {
    const ctx = await context(req, res);
    if (!ctx) return;
    const result = ctx.token ? await ctx.engine.retryFailed(ctx.token, ctx.config) : { requeued: 0 };
    res.json({ ok: true, requeued: result?.requeued || 0 });
  });

  app.use(basePath, router);
}

module.exports = { mountSetupLibraryRoutes } satisfies SetupLibraryRoutesApi;
