// Helpers shared by more than one addon route group. Kept deliberately small:
// anything used by a single group belongs in that group's module.
const { TTL_STREAM } = require('../runtime/refresh.ts') as { TTL_STREAM: number };
const { hashShort, posterFp, posterEnhance } = require('../runtime/cache-fingerprint.ts') as {
  hashShort: (value: unknown) => string;
  posterFp: (config: LooseConfig) => string;
  posterEnhance: (config?: LooseConfig) => Record<string, unknown>;
};

type LooseConfig = Record<string, any>;

export interface IntegrationStage { name: string; durationMs: number }
export interface IntegrationTrace { last: bigint; stages: IntegrationStage[] }

export interface SharedApi {
  hashShort: (value: unknown) => string;
  withCacheHints: (obj: Record<string, unknown>, options?: { cacheMaxAge?: number; staleRevalidate?: number; staleError?: number }) => Record<string, unknown>;
  streamResponseTtl: (result: any) => number;
  setPrivateResponseCache: (res: any, maxAge: number, staleRevalidate?: number, staleError?: number) => void;
  markClientIntegrationStage: (req: any, name: string) => void;
  finishClientIntegrationStages: (req: any) => IntegrationStage[];
  clientIntegrationTimingHeader: (stages: IntegrationStage[]) => string;
  clientIntegrationTimingLog: (stages: IntegrationStage[]) => string;
  posterFp: (config: LooseConfig) => string;
  posterEnhance: (config?: LooseConfig) => Record<string, unknown>;
  safeDecode: (value: string) => string;
  parseExtra: (str: unknown) => Record<string, string>;
}

// Short, stable, non-secret fingerprint. Used for cache keys and rate-limit
// buckets, never for anything needing collision resistance. Moved verbatim from
// the original addon core: changing the algorithm would orphan every existing
// cache entry.
// Add Stremio protocol cache hints (seconds) so clients reuse data while revalidating.
function withCacheHints(obj: Record<string, unknown>, { cacheMaxAge = 60, staleRevalidate = 60, staleError = 1800 } = {}): Record<string, unknown> {
  return { ...obj, cacheMaxAge, staleRevalidate, staleError };
}

function streamResponseTtl(result: any): number {
  if (result?.streams?.some((stream: any) => stream?._transientNotice)) return 60;
  return result?.streams?.some((stream: any) => stream && !stream._notice) ? TTL_STREAM : 60;
}

function setPrivateResponseCache(res: any, maxAge: number, staleRevalidate = maxAge, staleError = 1800): void {
  res.setHeader('Cache-Control', `private, max-age=${maxAge}, stale-while-revalidate=${staleRevalidate}, stale-if-error=${staleError}`);
}

// Facade-only stage timings make client deadline failures diagnosable without
// recording tokens, provider keys, URLs, titles, or upstream response data.
// Normal Stremio/Nuvio routes pay no timing or header cost.
function markClientIntegrationStage(req: any, name: string): void {
  const trace = req?.clientIntegrationTrace as IntegrationTrace | undefined;
  if (!trace || !/^[a-z][a-z0-9-]{0,31}$/.test(String(name || ''))) return;
  const now = process.hrtime.bigint();
  const durationMs = Number(now - trace.last) / 1e6;
  trace.last = now;
  trace.stages.push({ name: String(name), durationMs });
}

function finishClientIntegrationStages(req: any): IntegrationStage[] {
  markClientIntegrationStage(req, 'handler');
  return (req?.clientIntegrationTrace?.stages || []).slice(0, 16);
}

function clientIntegrationTimingHeader(stages: IntegrationStage[]): string {
  return stages.map((stage) => `${stage.name};dur=${stage.durationMs.toFixed(1)}`).join(', ');
}

function clientIntegrationTimingLog(stages: IntegrationStage[]): string {
  return stages.map((stage) => `${stage.name}:${Math.round(stage.durationMs)}`).join(',');
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

// Stremio passes catalogue options as an "&"-joined string (genre, skip, search).
function parseExtra(str: unknown): Record<string, string> {
  const extra: Record<string, string> = {};
  if (!str || typeof str !== 'string' || str.length > 512) return extra;
  try {
    str.split('&').forEach((pair) => {
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const key = safeDecode(pair.slice(0, eq));
        const val = safeDecode(pair.slice(eq + 1));
        if (key.length < 50 && val.length < 200) extra[key] = val;
      }
    });
  } catch { /* malformed input: return what we parsed */ }
  return extra;
}

module.exports = {
  hashShort, safeDecode, parseExtra, withCacheHints, streamResponseTtl, setPrivateResponseCache, posterEnhance,
  markClientIntegrationStage, finishClientIntegrationStages,
  clientIntegrationTimingHeader, clientIntegrationTimingLog, posterFp,
} satisfies SharedApi;
