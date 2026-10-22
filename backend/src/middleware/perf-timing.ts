// Opt-in addon timing (Phase 0, behaviour-neutral).
// Behind PERF_TIMING=1 only: adds a Server-Timing header and a structured
// [Perf] log line with the route template + per-dependency durations.
// Redaction is load-bearing: the install URL carries uuid.secret (the read
// capability), so this module NEVER records the real path, query string,
// headers, or decrypted keys. Route templates (req.route.path) only;
// outbound spans carry provider + operation names only, never URLs.
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface PerfTrace {
  start: bigint;
  spans: Record<string, number>;
}

export interface PerfTimingApi {
  enabled: () => boolean;
  startPerfTrace: () => PerfTrace;
  timeSpan: <T>(trace: PerfTrace | undefined, name: string, fn: () => Promise<T> | T) => Promise<T>;
  spanName: (base: string, details?: Record<string, unknown>) => string;
  routeTemplate: (req: unknown) => string;
  redactText: (value: unknown) => string;
  logPerf: (req: unknown, message?: string) => void;
  perfMiddleware: RequestHandler;
  finishPerfTrace: (req: unknown, res: unknown) => void;
}

function enabled(): boolean {
  return process.env.PERF_TIMING === '1';
}

function startPerfTrace(): PerfTrace {
  return { start: process.hrtime.bigint(), spans: {} };
}

function sanitizeToken(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9:_.-]/g, '').slice(0, 64);
}

// Span names carry provider + operation only. URL/details values are never
// embedded: keys and signed query parameters live in URLs.
function spanName(base: string, details?: Record<string, unknown>): string {
  const cleanBase = sanitizeToken(base) || 'span';
  if (!details || typeof details !== 'object') return cleanBase;
  const parts = [cleanBase];
  for (const key of ['provider', 'op', 'operation', 'source']) {
    const v = details[key];
    if (typeof v === 'string' && v) parts.push(sanitizeToken(v));
  }
  return parts.join(':');
}

async function timeSpan<T>(trace: PerfTrace | undefined, name: string, fn: () => Promise<T> | T): Promise<T> {
  const safe = spanName(name);
  if (!trace || typeof trace.spans !== 'object') return fn();
  const start = process.hrtime.bigint();
  try {
    return await fn();
  } finally {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    trace.spans[safe] = Math.round(ms * 10) / 10;
  }
}

// Route template only (e.g. /:token/catalog/:type/:catalogId). Never
// req.originalUrl, req.url or req.path: all three embed the install secret.
function routeTemplate(req: unknown): string {
  const r = req as { route?: { path?: unknown }; method?: unknown };
  const path = r?.route?.path;
  if (typeof path === 'string' && path) return path.slice(0, 160);
  if (Array.isArray(path)) {
    const first = path.find((p) => typeof p === 'string');
    if (first) return String(first).slice(0, 160);
  }
  const method = typeof r?.method === 'string' ? r.method.toUpperCase().slice(0, 8) : 'REQ';
  return `${method} unknown-route`;
}

// Strip anything secret-shaped from free text: URLs, query pairs, bearer
// tokens, and long token/key-shaped runs. Span summaries (name:ms) survive.
function redactText(value: unknown): string {
  let s = String(value ?? '');
  s = s.replace(/https?:\/\/\S+/gi, '[url]');
  s = s.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=* /gi, 'Bearer [redacted] ');
  s = s.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*$/gi, 'Bearer [redacted]');
  s = s.replace(/[?&][^=\s&;]+=[^&\s;]*/g, '[query]');
  s = s.replace(/\b(api_key|apikey|apiKey|token|secret|password|auth)\b\s*[:=]\s*\S+/gi, '$1=[redacted]');
  s = s.replace(/[A-Za-z0-9._~+/-]{16,}=*/g, (m) => (/^[a-z]+$/i.test(m) && m.length < 24 ? m : '[redacted]'));
  return s.slice(0, 2000);
}

function logPerf(req: unknown, message?: string): void {
  if (!enabled()) return;
  const trace = (req as { perfTrace?: PerfTrace })?.perfTrace;
  const total = trace ? Number(process.hrtime.bigint() - trace.start) / 1e6 : 0;
  const spans = trace && trace.spans
    ? Object.entries(trace.spans).map(([k, v]) => `${spanName(k)}:${Math.round(Number(v))}`).join(',')
    : '';
  const extra = message ? ` msg=${redactText(message)}` : '';
  console.log(`[Perf] route=${routeTemplate(req)} total=${Math.round(total)} spans={${spans}}${extra}`);
}

const perfMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (!enabled()) { next(); return; }
  const r = req as unknown as { perfTrace?: PerfTrace };
  if (!r.perfTrace) r.perfTrace = startPerfTrace();
  // Inject the Server-Timing header (and the structured log line) on the first
  // send, so no handler needs its dozens of early returns touched. Fully
  // behind the flag: when off, requests pass through untouched.
  const response = res as unknown as {
    json?: (body: unknown) => unknown;
    _perfFinished?: boolean;
  };
  const originalJson = response.json?.bind(res);
  if (typeof originalJson === 'function' && !response._perfFinished) {
    response._perfFinished = true;
    response.json = ((body: unknown) => {
      if (!(res as unknown as { headersSent?: boolean }).headersSent) {
        finishPerfTrace(req, res);
      }
      return originalJson(body);
    }) as (body: unknown) => unknown;
  }
  next();
};

function finishPerfTrace(req: unknown, res: unknown): void {
  if (!enabled()) return;
  const r = req as { perfTrace?: PerfTrace };
  if (!r?.perfTrace) return;
  const total = Number(process.hrtime.bigint() - r.perfTrace.start) / 1e6;
  const entries = [`route;dur=${total.toFixed(1)}`];
  for (const [k, v] of Object.entries(r.perfTrace.spans || {}).slice(0, 16)) {
    entries.push(`${spanName(k)};dur=${Number(v).toFixed(1)}`);
  }
  try {
    (res as { setHeader?: (n: string, v: string) => void }).setHeader?.('Server-Timing', entries.join(', '));
  } catch { /* header best effort */ }
  logPerf(req);
}

module.exports = {
  enabled,
  startPerfTrace,
  timeSpan,
  spanName,
  routeTemplate,
  redactText,
  logPerf,
  perfMiddleware,
  finishPerfTrace,
} satisfies PerfTimingApi;
