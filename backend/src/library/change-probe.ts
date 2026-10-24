'use strict';
// "Did anything change?" before a full provider listing. A full TorBox
// listing of a 10k-item account is several MB and seconds; this probe is a
// few KB. The engine only lists in full when a
// probe says something changed, or on a safety resync.
//
// A probe answers true (changed), false (unchanged) or null (unknown: a request
// failed, or there is nothing to compare with). Unknown is never treated as
// "unchanged": the engine falls back to its normal cadence.
//
// TorBox (verified on a real account): mylist is newest first and matches the
// cached raw listing (`tb-source-v1`, written by every full listing); a request
// at offset N-1 returns exactly the cached last item when the count is
// unchanged. Real-Debrid exposes a total count header and an active count.

const FAMILIES = ['torrents', 'usenet', 'webdl'];
const MIN_HEAD = 5;
const MAX_HEAD = 64;

type Row = { id?: unknown; download_state?: unknown; download_finished?: unknown; active?: unknown };
type TorboxGet = (family: string, params: { limit: number; offset: number }) => Promise<Row[]>;

// Status only: progress moves on every poll while something downloads.
function statusOf(row: Row): string {
  return `${String(row?.id)}:${String(row?.download_state ?? '')}:${row?.download_finished === true}:${row?.active === true}`;
}

function stillMoving(row: Row): boolean {
  return row?.download_finished !== true;
}

// Enough of the newest items to cover everything still downloading.
function headWindow(rows: Row[]): number {
  let last = -1;
  for (let i = 0; i < Math.min(rows.length, MAX_HEAD); i += 1) if (stillMoving(rows[i])) last = i;
  return Math.min(rows.length, Math.max(MIN_HEAD, last + 1));
}

async function probeTorbox({ get, cached }: { get: TorboxGet; cached: (family: string) => Promise<Row[] | undefined | null> }): Promise<boolean | null> {
  try {
    for (const family of FAMILIES) {
      const previous = await cached(family);
      if (!Array.isArray(previous)) return null;
      const n = previous.length;
      if (n === 0) {
        if ((await get(family, { limit: 1, offset: 0 })).length > 0) return true;
        continue;
      }
      const boundary = await get(family, { limit: 2, offset: n - 1 });
      if (boundary.length !== 1 || String(boundary[0]?.id) !== String(previous[n - 1]?.id)) return true;
      const w = headWindow(previous);
      const head = await get(family, { limit: w, offset: 0 });
      if (head.length !== w) return true;
      for (let i = 0; i < w; i += 1) if (statusOf(head[i]) !== statusOf(previous[i])) return true;
    }
    return false;
  } catch {
    return null;
  }
}

type RdGet = (path: string, params?: Record<string, unknown>) => Promise<{ data: any; headers: Record<string, unknown> }>;

async function realDebridToken({ get }: { get: RdGet }): Promise<string | null> {
  try {
    const list = await get('/torrents', { limit: 1 });
    const active = await get('/torrents/activeCount');
    const first = Array.isArray(list.data) ? list.data[0] : null;
    const total = list.headers['x-total-count'];
    if (total == null) return null;
    return `${String(total)}|${first ? `${first.id}:${first.status}` : '-'}|${active.data && active.data.nb != null ? active.data.nb : '-'}`;
  } catch {
    return null;
  }
}

function combine(answers: (boolean | null)[]): boolean | null {
  if (answers.some((a) => a === true)) return true;
  if (answers.length && answers.every((a) => a === false)) return false;
  return null;
}

type Policy = { now: number; intervalMs: number; fullResyncMs: number; activeProbeMs: number; rec: { lastSyncAt?: number; lastProbeAt?: number; lastRequestAt?: number } };
const ACTIVE_WINDOW_MS = 60 * 60 * 1000;

// Before probing: is a full sync, a probe, or nothing due?
function decideSync({ now, intervalMs, fullResyncMs, activeProbeMs, rec }: Policy): 'full' | 'probe' | 'skip' {
  if (!rec.lastSyncAt) return 'full';
  if (now - rec.lastSyncAt >= fullResyncMs) return 'full';
  const active = rec.lastRequestAt != null && now - rec.lastRequestAt < ACTIVE_WINDOW_MS;
  const every = active ? activeProbeMs : intervalMs;
  const since = rec.lastProbeAt ? now - rec.lastProbeAt : Infinity;
  return since >= every ? 'probe' : 'skip';
}

// After a probe answered.
function afterProbe({ now, intervalMs, rec, changed }: Policy & { changed: boolean | null }): 'full' | 'skip' {
  if (changed === true) return 'full';
  if (changed === false) return 'skip';
  return rec.lastSyncAt && now - rec.lastSyncAt < intervalMs ? 'skip' : 'full';
}

const defaultDeps = {
  torboxPage: (key: string, family: string, params: { limit: number; offset: number }) => require('../providers/torbox.ts').torboxListPage(key, family, params),
  torboxCached: (key: string, family: string) => require('../providers/torbox.ts').torboxCachedListing(key, family),
  rdGet: (key: string, path: string, params?: Record<string, unknown>) => require('../providers/realdebrid.ts').realDebridProbeGet(key, path, params),
};

// One answer for a library: every active provider is asked. Real-Debrid
// tokens are returned so the engine can keep them once a full sync succeeds.
async function probeScope(rec: { config: any; probeTokens?: Record<string, string> }, deps = defaultDeps): Promise<{ changed: boolean | null; tokens: Record<string, string> }> {
  const active: string[] = require('../providers/index.ts').activeProviders(rec.config || {});
  const answers: (boolean | null)[] = [];
  const tokens: Record<string, string> = {};
  for (const id of active) {
    if (id === 'torbox') {
      const key = rec.config.torboxApiKey;
      answers.push(await probeTorbox({ get: (family, params) => deps.torboxPage(key, family, params), cached: (family) => deps.torboxCached(key, family) }));
    } else if (id === 'realdebrid') {
      const key = rec.config.rdApiKey;
      const token = await realDebridToken({ get: (path, params) => deps.rdGet(key, path, params) });
      if (token) tokens.realdebrid = token;
      const previous = rec.probeTokens && rec.probeTokens.realdebrid;
      answers.push(token == null || previous == null ? null : token !== previous);
    } else {
      answers.push(null);
    }
  }
  return { changed: combine(answers), tokens };
}

export interface ChangeProbeApi {
  probeScope: typeof probeScope;
  probeTorbox: typeof probeTorbox;
  realDebridToken: typeof realDebridToken;
  combine: typeof combine;
  decideSync: typeof decideSync;
  afterProbe: typeof afterProbe;
  headWindow: typeof headWindow;
}

module.exports = { probeScope, probeTorbox, realDebridToken, combine, decideSync, afterProbe, headWindow } satisfies ChangeProbeApi;
