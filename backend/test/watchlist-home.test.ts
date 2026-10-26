// @ts-nocheck
const { test } = require('node:test');
const assert = require('node:assert/strict');
const wh = require('../src/setup/watchlist-home.ts');
const { getConfiguredManifest } = require('../app.ts');

const BASE = 'http://localhost:7860';
const conns = [{ provider: 'simkl', type: 'movie', name: 'Simkl' }, { provider: 'simkl', type: 'series', name: 'Simkl' }];
const scope = (tier) => ({ type: 'config', uuid: '00000000-0000-4000-8000-000000000000', tier });
const base = { provider: 'torbox', torboxApiKey: 'tb-test', tmdbApiKey: 'tmdb-test' };
const homeRow = (id) => ({ id: `row-${id}`, title: id, source: { kind: 'catalog', id, catalogId: id, type: 'movie', addonId: '' }, enabled: true, order: 0 });

function watchlistRows(config, homeRows = []) {
  const m = getConfiguredManifest(BASE, config, { integration: 'nuvio', watchlist: conns, homeRows });
  return Object.fromEntries(m.catalogs.filter((c) => c.id.startsWith('torbox-watchlist-')).map((c) => [c.id, c.showInHome]));
}

test('older Settle In setups keep their watchlists on Nuvio Home', () => {
  const seen = watchlistRows({ ...base, __configScope: scope('partial') });
  assert.deepEqual(seen, { 'torbox-watchlist-simkl-movie': undefined, 'torbox-watchlist-simkl-series': undefined });
});

test('saved with the new picker, only the picked watchlist reaches Nuvio Home', () => {
  const picked = [homeRow('torbox-watchlist-simkl-movie')];
  const seen = watchlistRows({ ...base, __configScope: scope('full'), watchlistHomeManaged: true, collectionHomeRows: picked }, picked);
  assert.equal(seen['torbox-watchlist-simkl-movie'], undefined);
  assert.equal(seen['torbox-watchlist-simkl-series'], false);
});

test('Quick Look ignores the marker (it has no Home picker)', () => {
  const seen = watchlistRows({ ...base, __configScope: scope('quick'), watchlistHomeManaged: true });
  assert.equal(seen['torbox-watchlist-simkl-series'], undefined);
});

test('the editor shows an older setup its connected watchlists as picked Home rows', () => {
  const config = { collectionHomeRows: [homeRow('torbox-movies')] };
  const ids = wh.connectedWatchlistIds({ keys: { watchlist: { simkl: { access_token: 'x' } }, mdblistKey: 'k' } });
  assert.deepEqual(ids, ['torbox-watchlist-simkl-movie', 'torbox-watchlist-simkl-series', 'torbox-watchlist-mdblist-movie', 'torbox-watchlist-mdblist-series']);
  const view = wh.withLegacyWatchlistRows(config, 'partial', ids);
  assert.deepEqual(view.collectionHomeRows.map((r) => r.source.catalogId), ['torbox-movies', ...ids]);
  assert.equal(view.collectionHomeRows[1].order, 1);
  assert.equal(wh.withLegacyWatchlistRows({ ...config, watchlistHomeManaged: true }, 'partial', ids).collectionHomeRows.length, 1, 'marked setups are left alone');
  assert.equal(wh.withLegacyWatchlistRows(config, 'quick', ids), config, 'Quick Look is left alone');
});
