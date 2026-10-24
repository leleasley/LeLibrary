// @ts-nocheck
// Lightweight in-process metrics for the index-first engine. Structured,
// privacy-safe aggregate counters only: no titles, ids, keys or URLs.
const counters = {
  syncs: 0,
  syncErrors: 0,
  syncItemsScanned: 0,
  syncItemsAdded: 0,
  syncItemsChanged: 0,
  syncItemsRemoved: 0,
  syncItemsUnchanged: 0,
  matchQueued: 0,
  matchCompleted: 0,
  matchFailed: 0,
  tmdbCalls: 0,
  candidateSearches: 0,
  candidateSearchDedupeHits: 0,
  matchAttempts: 0,
  matchKeptPrevious: 0,
  probeUnchanged: 0,
  probeChanged: 0,
  probeUnknown: 0,
  matchTmdbHttpRequests: 0,
  tmdbHttpRequests: 0,
};

const timings = {
  syncMs: 0,
  providerMs: 0,
  matchMs: 0,
  catalogMs: 0,
  searchMs: 0,
  metaMs: 0,
};

const requests = {
  catalogIndexed: 0,
  catalogFallback: 0,
  searchIndexed: 0,
  searchFallback: 0,
  metaIndexed: 0,
  metaFallback: 0,
};

const recentSyncs = [];
const MAX_RECENT = 20;

function add(name, value = 1) {
  if (Object.hasOwn(counters, name)) counters[name] += value;
}

function time(name, ms) {
  if (Object.hasOwn(timings, name)) timings[name] = Math.round(ms);
}

function request(name) {
  if (Object.hasOwn(requests, name)) requests[name] += 1;
}

function recordSync(entry) {
  add('syncs');
  if (entry.error) add('syncErrors');
  add('syncItemsScanned', entry.scanned || 0);
  add('syncItemsAdded', entry.added || 0);
  add('syncItemsChanged', entry.changed || 0);
  add('syncItemsRemoved', entry.removed || 0);
  add('syncItemsUnchanged', entry.unchanged || 0);
  add('matchQueued', entry.pending || 0);
  add('matchCompleted', entry.matched || 0);
  add('matchFailed', entry.failed || 0);
  add('candidateSearches', entry.candidateSearches || 0);
  add('candidateSearchDedupeHits', entry.candidateSearchDedupeHits || 0);
  time('syncMs', entry.durationMs || 0);
  time('providerMs', entry.providerMs || 0);
  time('matchMs', entry.matchMs || 0);
  recentSyncs.unshift({
    at: new Date().toISOString(),
    scope: entry.scopeId,
    provider: entry.provider || null,
    durationMs: Math.round(entry.durationMs || 0),
    scanned: entry.scanned || 0,
    added: entry.added || 0,
    changed: entry.changed || 0,
    removed: entry.removed || 0,
    unchanged: entry.unchanged || 0,
    matched: entry.matched || 0,
    failed: entry.failed || 0,
    error: entry.error || null,
  });
  if (recentSyncs.length > MAX_RECENT) recentSyncs.length = MAX_RECENT;
}

function snapshot() {
  return {
    counters: { ...counters },
    timings: { ...timings },
    requests: { ...requests },
    recentSyncs: recentSyncs.slice(),
  };
}

export interface MetricsApi {
  add: any;
  time: any;
  request: any;
  recordSync: any;
  snapshot: any;
}

module.exports = { add, time, request, recordSync, snapshot } satisfies MetricsApi;
