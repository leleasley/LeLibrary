'use strict';
// Watchlist rows on Nuvio Home for Home-managed setups (Settle In, Move In).
//
// Setups saved with the watchlist-aware Home picker carry
// `watchlistHomeManaged: true`: their watchlist rows reach Nuvio Home only
// when picked as Home rows, like every other row. Older setups have no marker
// and keep their watchlists on Home. When one of those opens in the editor,
// its connected watchlists are added as picked Home rows, so the picker shows
// what Nuvio already shows and a save keeps it that way.

const { readWatchlist } = require('./connections.ts');

const MARKER = 'watchlistHomeManaged';

const ROWS: { id: string; provider: string; type: 'movie' | 'series'; title: string }[] = [
  { id: 'torbox-watchlist-simkl-movie', provider: 'simkl', type: 'movie', title: '🎬 Simkl Watchlist' },
  { id: 'torbox-watchlist-simkl-series', provider: 'simkl', type: 'series', title: '📺 Simkl Watchlist' },
  { id: 'torbox-watchlist-trakt-movie', provider: 'trakt', type: 'movie', title: '🎬 Trakt Watchlist' },
  { id: 'torbox-watchlist-trakt-series', provider: 'trakt', type: 'series', title: '📺 Trakt Watchlist' },
  { id: 'torbox-watchlist-mdblist-movie', provider: 'mdblist', type: 'movie', title: '🎯 MDBList Watchlist' },
  { id: 'torbox-watchlist-mdblist-series', provider: 'mdblist', type: 'series', title: '📺 MDBList Watchlist' },
];

function isHomeManagedTier(tier: unknown): boolean {
  return tier === 'partial' || tier === 'full';
}

// Watchlist catalogue ids this setup's manifest advertises.
function connectedWatchlistIds(opened: { keys?: Record<string, unknown> } | null): string[] {
  const keys = (opened && opened.keys) || {};
  const on = new Set<string>();
  for (const provider of ['simkl', 'trakt']) if (readWatchlist(opened, provider)) on.add(provider);
  if (typeof keys['mdblistKey'] === 'string' && keys['mdblistKey']) on.add('mdblist');
  return ROWS.filter((row) => on.has(row.provider)).map((row) => row.id);
}

// The editor's view of an unmarked Home-managed setup: its connected
// watchlists appended as picked Home rows. Anything else is returned as is.
function withLegacyWatchlistRows(config: Record<string, unknown>, tier: unknown, connectedIds: string[]): Record<string, unknown> {
  if (!isHomeManagedTier(tier) || config[MARKER] === true || connectedIds.length === 0) return config;
  const rows = Array.isArray(config['collectionHomeRows']) ? (config['collectionHomeRows'] as any[]) : [];
  const present = new Set(rows.map((row) => String((row && row.source && (row.source.id || row.source.catalogId)) || '')));
  const added = ROWS.filter((row) => connectedIds.includes(row.id) && !present.has(row.id)).map((row, index) => ({
    id: `row-${row.id}`,
    title: row.title,
    source: { kind: 'catalog', id: row.id, catalogId: row.id, type: row.type, addonId: '', addonUrl: '' },
    enabled: true,
    limit: 20,
    order: rows.length + index,
    customTitle: false,
  }));
  if (!added.length) return config;
  return { ...config, collectionHomeRows: [...rows, ...added] };
}

// Manifest rule: false keeps a watchlist row off Nuvio Home.
function watchlistOnHome(config: Record<string, unknown>, homeManaged: boolean, selected: Set<string>, id: string): boolean {
  if (!homeManaged || config[MARKER] !== true) return true;
  return selected.has(id);
}

export interface WatchlistHomeApi {
  MARKER: string;
  ROWS: typeof ROWS;
  connectedWatchlistIds: typeof connectedWatchlistIds;
  withLegacyWatchlistRows: typeof withLegacyWatchlistRows;
  watchlistOnHome: typeof watchlistOnHome;
}

module.exports = { MARKER, ROWS, connectedWatchlistIds, withLegacyWatchlistRows, watchlistOnHome } satisfies WatchlistHomeApi;
