// @ts-nocheck
// Background warmer for Pictorium posters.
//
// Pictorium composes a poster from scratch on first request (0.8-4s for the
// ones we measured). Requesting 10-50 of those synchronously when Nuvio opens a
// catalogue is what makes the grid crawl. Instead the proxy serves the normal
// TMDB poster immediately and asks this module to render the Pictorium version
// in the background; the next request (and every restart after, via the Redis
// poster cache) gets the rendered image.
//
// Requests are bounded and de-duplicated, and go back through the proxy with
// ?warm=1 so the exact same caching path is used.
//
// Two classes of work share this queue, and they are not equal:
//   - bulk warm (a catalogue page, a warm cycle): nice to have, nobody waits
//   - interactive (someone has this poster on screen right now): they are
//     waiting, so it jumps the queue and an already-queued copy is promoted
//     rather than left behind the bulk run. Without this, opening a 40-poster
//     grid meant the poster you were looking at could be render #39.
const axios = require('axios');

const QUEUE = [];
const SEEN = new Map();     // path -> last enqueue time
const ACTIVE = new Set();   // paths currently queued/running
const RUNNING = new Set();  // paths being rendered right now
let running = 0;

const CONCURRENCY = Math.max(1, parseInt(process.env.PICTORIUM_WARM_CONCURRENCY, 10) || 3);
const DEDUPE_MS = Math.max(60000, parseInt(process.env.PICTORIUM_WARM_DEDUPE_MS, 10) || 30 * 60 * 1000);

function enabled() {
  return process.env.PICTORIUM_WARM !== '0';
}

function origin() {
  return process.env.PICTORIUM_WARM_ORIGIN || `http://127.0.0.1:${process.env.PORT || 7860}`;
}

function pruneSeen(now) {
  if (SEEN.size < 5000) return;
  for (const [p, ts] of SEEN) {
    if (now - ts > DEDUPE_MS) SEEN.delete(p);
  }
}

// `priority` is for a render someone is waiting on: it goes to the front, and a
// copy already queued is moved up instead of being skipped.
function enqueue(paths, { priority = false } = {}) {
  if (!enabled()) return 0;
  const now = Date.now();
  let added = 0;
  for (const p of Array.isArray(paths) ? paths : [paths]) {
    if (typeof p !== 'string' || !p.startsWith('/')) continue;
    if (RUNNING.has(p)) continue;
    if (ACTIVE.has(p)) {
      if (priority) {
        const at = QUEUE.indexOf(p);
        if (at > 0) { QUEUE.splice(at, 1); QUEUE.unshift(p); }
      }
      continue;
    }
    const seen = SEEN.get(p);
    if (seen && now - seen < DEDUPE_MS && !priority) continue;
    SEEN.set(p, now);
    ACTIVE.add(p);
    if (priority) QUEUE.unshift(p);
    else QUEUE.push(p);
    added++;
  }
  if (added || priority) {
    pruneSeen(now);
    pump();
  }
  return added;
}

function pump() {
  while (running < CONCURRENCY && QUEUE.length) {
    const p = QUEUE.shift();
    running++;
    RUNNING.add(p);
    const url = `${origin()}${p}${p.includes('?') ? '&' : '?'}warm=1`;
    axios.get(url, { timeout: 60000, validateStatus: () => true, responseType: 'arraybuffer' })
      .catch(() => { /* best effort */ })
      .finally(() => { running--; RUNNING.delete(p); ACTIVE.delete(p); pump(); });
  }
}

function stats() {
  return { queued: QUEUE.length, active: running, concurrency: CONCURRENCY, enabled: enabled() };
}

// Queue order, for tests and diagnostics. Not used on the request path.
function pending() {
  return QUEUE.slice();
}

export interface PictoriumWarmApi {
  enqueue: any;
  enabled: any;
  stats: any;
  pending: any;
}

module.exports = { enqueue, enabled, stats, pending } satisfies PictoriumWarmApi;