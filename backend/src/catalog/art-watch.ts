// Background art jobs (hosted, needs the server's own TMDB key):
//
//   - Live covers: drawn again every hour, slowly, so a changed row reaches
//     Nuvio at the same link without a device waiting on the first draw.
//   - Subject check, daily: compares what each Subject cover was drawn from
//     (index.json `basis`: a franchise's films, a person's photo) with TMDB
//     now. A change marks the folder stale (Redis + DATA_DIR/art-stale.json,
//     read by the pre-release art refresh) and, when ART_WATCH_WEBHOOK_URL is
//     set, posts one line per newly stale folder to that Discord webhook.
// Only TMDB ids and names are read or sent; never a user's key.
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

interface HttpLike {
  get: (url: string, config?: Record<string, unknown>) => Promise<{ status: number; data: any }>;
  post: (url: string, body: unknown, config?: Record<string, unknown>) => Promise<unknown>;
}
interface StoreLike { get: (k: string) => Promise<unknown>; set: (k: string, v: unknown, ttl?: number) => Promise<unknown> }
export interface StaleEntry { reason: string; since: string }

const STALE_KEY = 'artwatch:stale:v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function tmdbParams(key: string): { url: (p: string) => string; headers: Record<string, string> } {
  const bearer = key.startsWith('eyJ');
  return {
    url: (p: string) => `https://api.themoviedb.org/3${p}${bearer ? '' : `${p.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`}`,
    headers: bearer ? { Authorization: `Bearer ${key}` } : {},
  };
}

async function tmdbGet(http: HttpLike, key: string, p: string): Promise<any> {
  const t = tmdbParams(key);
  try {
    const res = await http.get(t.url(p), { headers: t.headers, timeout: 10000, validateStatus: () => true });
    return res.status === 200 ? res.data : null;
  } catch { return null; }
}

// What changed for one folder since its cover was drawn ('' = nothing, or
// TMDB did not answer: never mark stale on a failed read).
// What changed, plus a franchise's current posters in release order (for its
// hero backdrop). posters is null when TMDB did not answer.
async function inspect(entry: { basis?: Record<string, any> }, deps: { http: HttpLike; key: string }): Promise<{ reason: string; posters: string[] | null }> {
  const b = entry.basis || {};
  let posters: string[] | null = null;
  if (Array.isArray(b['collections']) && Array.isArray(b['parts'])) {
    const now: number[] = [];
    const parts: { date: string; poster: string }[] = [];
    for (const id of b['collections']) {
      const c = await tmdbGet(deps.http, deps.key, `/collection/${Number(id)}`);
      if (!c || !Array.isArray(c.parts)) return { reason: '', posters: null };
      for (const part of c.parts) {
        if (!part || !part.release_date) continue;
        now.push(Number(part.id));
        if (typeof part.poster_path === 'string') parts.push({ date: String(part.release_date), poster: part.poster_path });
      }
    }
    posters = parts.sort((x, y) => x.date.localeCompare(y.date)).map((p) => p.poster);
    const before = new Set(b['parts'].map(Number));
    const added = now.filter((id) => !before.has(id));
    if (added.length) return { reason: `${added.length} new film${added.length > 1 ? 's' : ''} in the franchise`, posters };
  }
  if (b['person'] && b['profile']) {
    const p = await tmdbGet(deps.http, deps.key, `/person/${Number(b['person'])}`);
    if (p && p.profile_path && p.profile_path !== b['profile']) return { reason: 'new profile photo', posters };
  }
  return { reason: '', posters };
}

async function changeFor(entry: { basis?: Record<string, any> }, deps: { http: HttpLike; key: string }): Promise<string> {
  return (await inspect(entry, deps)).reason;
}

function staleFile(): string {
  return path.join(process.env.DATA_DIR || '/data', 'art-stale.json');
}

async function readStale(store: StoreLike): Promise<Record<string, StaleEntry>> {
  try { const v = await store.get(STALE_KEY); if (v && typeof v === 'object') return v as Record<string, StaleEntry>; } catch { /* empty */ }
  return {};
}

async function checkSubjects(deps: { http: HttpLike; store: StoreLike; key: string; gapMs?: number; webhook?: string; skipHeroes?: boolean }): Promise<{ checked: number; stale: Record<string, StaleEntry>; added: string[] }> {
  const own = require('./own-art.ts');
  const entries: Record<string, { kind: string; basis?: Record<string, unknown> }> = own.allEntries();
  const stale = await readStale(deps.store);
  const added: string[] = [];
  const heroesToRedraw: string[] = [];
  let checked = 0;
  for (const [id, entry] of Object.entries(entries)) {
    if (entry.kind !== 'subject' || !entry.basis) continue;
    checked++;
    const { reason, posters } = await inspect(entry, deps);
    // The franchise's current posters feed its hero backdrop, so a new
    // film's poster appears there without a redraw by hand.
    if (posters && posters.length) {
      await require('./hero-art-service.ts').setSavedParts(id, posters);
      if (reason) heroesToRedraw.push(id);
    }
    if (reason && !stale[id]) { stale[id] = { reason, since: new Date().toISOString() }; added.push(id); }
    if (deps.gapMs) await new Promise((r) => setTimeout(r, deps.gapMs));
  }
  try { await deps.store.set(STALE_KEY, stale, 90 * 24 * 3600); } catch { /* best effort */ }
  try { fs.writeFileSync(staleFile(), JSON.stringify(stale, null, 1)); } catch { /* no data dir */ }
  if (added.length && deps.webhook) {
    const lines = added.slice(0, 20).map((id) => `- ${id.replace('folder-lelibrary-', '')}: ${(stale[id] as StaleEntry).reason}`);
    const more = added.length > 20 ? `\n...and ${added.length - 20} more` : '';
    try {
      await deps.http.post(deps.webhook, { content: `Folder art to redraw before the next release:\n${lines.join('\n')}${more}`, allowed_mentions: { parse: [] } }, { timeout: 10000 });
    } catch { /* the file and Redis still hold it */ }
  }
  if (heroesToRedraw.length && !deps.skipHeroes) void require('./hero-art-service.ts').warmHeroes(heroesToRedraw, 2000).catch(() => 0);
  return { checked, stale, added };
}

let timers: ReturnType<typeof setTimeout>[] = [];
function start(): void {
  const own = require('./own-art.ts');
  if (!own.liveArtKey() || !own.allEntries || Object.keys(own.allEntries()).length === 0) return;
  const http = require('axios') as HttpLike;
  const store = require('../runtime/cache.ts') as StoreLike;
  const key = own.liveArtKey();
  const warm = () => {
    void require('./live-art-service.ts').warmLiveArt()
      .then(() => require('./hero-art-service.ts').warmHeroes(own.liveFolderIds()))
      .catch(() => null);
  };
  // Every hero once after start (cached in Redis for a month after that).
  const warmAllHeroes = () => { void require('./hero-art-service.ts').warmHeroes(Object.keys(own.allEntries()), 3000).catch(() => 0); };
  const watch = () => {
    void checkSubjects({ http, store, key, gapMs: 300, webhook: String(process.env.ART_WATCH_WEBHOOK_URL || '').trim() }).catch(() => null);
  };
  if (own.liveArtEnabled()) {
    timers.push(setTimeout(warm, 2 * 60 * 1000));
    timers.push(setInterval(warm, HOUR_MS));
  }
  timers.push(setTimeout(warmAllHeroes, 15 * 60 * 1000));
  if (process.env.ART_WATCH !== 'off') {
    timers.push(setTimeout(watch, 10 * 60 * 1000));
    timers.push(setInterval(watch, DAY_MS));
  }
  for (const t of timers) (t as { unref?: () => void }).unref?.();
}

function stop(): void { for (const t of timers) clearTimeout(t as ReturnType<typeof setTimeout>); timers = []; }

export interface ArtWatchApi {
  start: typeof start;
  stop: typeof stop;
  checkSubjects: typeof checkSubjects;
  changeFor: typeof changeFor;
  readStale: typeof readStale;
}

module.exports = { start, stop, checkSubjects, changeFor, readStale } satisfies ArtWatchApi;
