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
const axios = require('axios');

const QUEUE = [];
const SEEN = new Map();     // path -> last enqueue time
const ACTIVE = new Set();   // paths currently queued/running
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

function enqueue(paths) {
  if (!enabled()) return 0;
  const now = Date.now();
  let added = 0;
  for (const p of Array.isArray(paths) ? paths : [paths]) {
    if (typeof p !== 'string' || !p.startsWith('/')) continue;
    if (ACTIVE.has(p)) continue;
    const seen = SEEN.get(p);
    if (seen && now - seen < DEDUPE_MS) continue;
    SEEN.set(p, now);
    ACTIVE.add(p);
    QUEUE.push(p);
    added++;
  }
  if (added) {
    pruneSeen(now);
    pump();
  }
  return added;
}

function pump() {
  while (running < CONCURRENCY && QUEUE.length) {
    const p = QUEUE.shift();
    running++;
    const url = `${origin()}${p}${p.includes('?') ? '&' : '?'}warm=1`;
    axios.get(url, { timeout: 60000, validateStatus: () => true, responseType: 'arraybuffer' })
      .catch(() => { /* best effort */ })
      .finally(() => { running--; ACTIVE.delete(p); pump(); });
  }
}

function stats() {
  return { queued: QUEUE.length, active: running, concurrency: CONCURRENCY, enabled: enabled() };
}

module.exports = { enqueue, enabled, stats };
