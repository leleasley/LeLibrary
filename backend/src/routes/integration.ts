// Client-integration facade: stable path-based projection of the addon protocol
// for third-party players that derive resource URLs by stripping manifest.json.
import type { Express } from 'express';

import type { ManifestApi } from './manifest.ts';
import type { CatalogApi } from './catalog.ts';
import type { MetaApi } from './meta.ts';
import type { StreamApi } from './stream.ts';

const { handleConfiguredManifest } = require('./manifest.ts') as ManifestApi;
const { handleCatalog } = require('./catalog.ts') as CatalogApi;
const { handleMeta } = require('./meta.ts') as MetaApi;
const { handleStream } = require('./stream.ts') as StreamApi;
const crypto = require('node:crypto') as typeof import('node:crypto');
const { getClientIntegration } = require('../client-integrations/index.ts') as {
  getClientIntegration: (id: unknown, options?: Record<string, unknown>) => any;
};
const {
  finishClientIntegrationStages, clientIntegrationTimingHeader, clientIntegrationTimingLog,
} = require('./shared.ts') as {
  finishClientIntegrationStages: (req: any) => { name: string; durationMs: number }[];
  clientIntegrationTimingHeader: (stages: { name: string; durationMs: number }[]) => string;
  clientIntegrationTimingLog: (stages: { name: string; durationMs: number }[]) => string;
};

export interface IntegrationDeps {
  resolveConfig: (token: string) => Promise<Record<string, any> | null>;
}

export interface IntegrationApi {
  mountIntegrationRoutes: (app: Express, deps: IntegrationDeps) => void;
}

function integrationIdNamespace(id: unknown): string {
  const value = String(id || '');
  if (value.startsWith('tt')) return 'tt';
  if (value.startsWith('torbox:')) return 'torbox';
  if (value.startsWith('kitsu:')) return 'kitsu';
  return value ? 'other' : 'none';
}

interface CapturedResponse {
  setHeader: (name: string, value: string) => void;
  getHeader: (name: string) => string | undefined;
  status: (value: unknown) => CapturedResponse;
  json: (body: unknown) => CapturedResponse;
  send: (body: unknown) => CapturedResponse;
  end: (body?: unknown) => CapturedResponse;
}

function captureIntegrationResponse(handler: (req: any, res: any) => unknown, req: any): Promise<{ body: unknown; statusCode: number; headers: Map<string, string> }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let statusCode = 200;
    const headers = new Map();
    const finish = (body: unknown) => {
      if (settled) return;
      settled = true;
      resolve({ body, statusCode, headers });
    };
    const response: CapturedResponse = {
      setHeader(name: string, value: string) { headers.set(name, value); },
      getHeader(name: string) { return headers.get(name); },
      status(value: unknown) { statusCode = Number(value) || 200; return response; },
      json(body: unknown) { finish(body); return response; },
      send(body: unknown) { finish(body); return response; },
      end(body?: unknown) { finish(body); return response; },
    };
    Promise.resolve(handler(req, response)).then(() => {
      if (!settled) finish(null);
    }, reject);
  });
}

async function runClientIntegration(req: any, res: any, routeClass: string, handler: (req: any, res: any) => unknown, fallbackBody: unknown): Promise<void> {
  const adapter = getClientIntegration(req.params.client, { fallback: false });
  if (!adapter) return res.status(404).json({ error: 'Unknown client integration' });
  req.clientIntegration = adapter;
  const requestId = crypto.randomBytes(6).toString('hex');
  const started = Date.now();
  req.clientIntegrationTrace = { last: process.hrtime.bigint(), stages: [] };
  const budget = Number(adapter.requestPolicy?.[`${routeClass}Ms`]) || 0;
  if (req.params.type && !adapter.capabilities.types?.includes(req.params.type)) {
    res.setHeader('X-LeLibrary-Request-Id', requestId);
    return res.json(fallbackBody);
  }
  let timer;
  try {
    const work = captureIntegrationResponse(handler, req);
    const outcome: any = budget > 0
      ? await Promise.race([
          work,
          new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), budget); }),
        ])
      : await work;
    clearTimeout(timer);
    res.setHeader('X-LeLibrary-Request-Id', requestId);
    if (outcome?.timedOut) {
      const stages = finishClientIntegrationStages(req);
      res.setHeader('Server-Timing', clientIntegrationTimingHeader(stages));
      console.warn(`[ClientIntegration] id=${requestId} client=${adapter.id} route=${routeClass} type=${req.params.type || 'none'} namespace=${integrationIdNamespace(req.params.id)} latencyMs=${Date.now() - started} stages=${clientIntegrationTimingLog(stages)} outcome=timeout`);
      return res.status(routeClass === 'manifest' ? 504 : 200).json(fallbackBody);
    }
    for (const [name, value] of outcome.headers || []) res.setHeader(name, value);
    const body = typeof adapter.response === 'function'
      ? adapter.response({ route: routeClass, body: outcome.body, context: { type: req.params.type } })
      : outcome.body;
    const count = Array.isArray(body?.streams) ? body.streams.length : Array.isArray(body?.metas) ? body.metas.length : body?.meta ? 1 : 0;
    const stages = finishClientIntegrationStages(req);
    res.setHeader('Server-Timing', clientIntegrationTimingHeader(stages));
    console.log(`[ClientIntegration] id=${requestId} client=${adapter.id} route=${routeClass} type=${req.params.type || 'none'} namespace=${integrationIdNamespace(req.params.id)} latencyMs=${Date.now() - started} stages=${clientIntegrationTimingLog(stages)} count=${count} outcome=ok`);
    return res.status(outcome.statusCode || 200).json(body);
  } catch (error: any) {
    clearTimeout(timer);
    const stages = finishClientIntegrationStages(req);
    res.setHeader('Server-Timing', clientIntegrationTimingHeader(stages));
    console.warn(`[ClientIntegration] id=${requestId} client=${adapter.id} route=${routeClass} type=${req.params.type || 'none'} namespace=${integrationIdNamespace(req.params.id)} latencyMs=${Date.now() - started} stages=${clientIntegrationTimingLog(stages)} outcome=error`);
    return res.status(routeClass === 'manifest' ? 502 : 200).json(fallbackBody);
  }
}

function mountIntegrationRoutes(app: Express, deps: IntegrationDeps): void {
  const { resolveConfig } = deps;
// Stable path-based client facade. Some clients derive every resource URL by
// stripping `/manifest.json`, so the integration identity must live in the
// path-not a query string-and all resource routes must remain siblings.
app.get('/:token/i/:client/manifest.json', (req: any, res: any) => runClientIntegration(req, res, 'manifest', (fReq: any, fRes: any) => handleConfiguredManifest(fReq, fRes, { resolveConfig }), { error: 'Manifest unavailable' }));
app.get('/:token/i/:client/catalog/:type/:catalogId.json', (req: any, res: any) => runClientIntegration(req, res, 'catalog', (fReq: any, fRes: any) => handleCatalog(fReq, fRes, { resolveConfig }), { metas: [] }));
app.get('/:token/i/:client/catalog/:type/:catalogId/:extra.json', (req: any, res: any) => runClientIntegration(req, res, 'catalog', (fReq: any, fRes: any) => handleCatalog(fReq, fRes, { resolveConfig }), { metas: [] }));
app.get('/:token/i/:client/meta/:type/:id.json', (req: any, res: any) => runClientIntegration(req, res, 'meta', (fReq: any, fRes: any) => handleMeta(fReq, fRes, { resolveConfig }), { meta: null }));
app.get('/:token/i/:client/stream/:type/:id.json', (req: any, res: any) => runClientIntegration(req, res, 'stream', (fReq: any, fRes: any) => handleStream(fReq, fRes, { resolveConfig }), { streams: [] }));
}

module.exports = { mountIntegrationRoutes } satisfies IntegrationApi;
