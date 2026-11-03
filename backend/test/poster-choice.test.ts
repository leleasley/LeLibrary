// @ts-nocheck
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withPosterChoice, toEngineConfig } = require('../src/setup/config-store.ts');
const { enhancedPosterUrl } = require('../src/catalog/franchise-collections.ts');

test('a chosen poster provider wins over other saved poster keys', () => {
  // The operator's 2026-11-03 setup: BetterPosters chosen, an old ERDB token still saved.
  const engine = toEngineConfig({ config: { posterProvider: 'betterposter' }, keys: { erdbToken: 'Tk-x', rpdbKey: 'r', tmdbApiKey: 't' } });
  assert.equal(engine.erdbToken, undefined);
  assert.equal(engine.rpdbKey, undefined);
  assert.equal(engine.tmdbApiKey, 't', 'other keys stay');
  assert.equal(withPosterChoice({ posterProvider: 'erdb', erdbToken: 'Tk-x', rpdbKey: 'r' }).erdbToken, 'Tk-x');
  assert.equal(withPosterChoice({ posterProvider: 'erdb', erdbToken: 'Tk-x', rpdbKey: 'r' }).rpdbKey, undefined);
  assert.equal(withPosterChoice({ posterProvider: 'rpdb', erdbToken: 'Tk-x', rpdbKey: 'r' }).rpdbKey, 'r');
});

test('no poster choice saved keeps the old behaviour (every key applies)', () => {
  const engine = toEngineConfig({ config: {}, keys: { erdbToken: 'Tk-x', rpdbKey: 'r' } });
  assert.equal(engine.erdbToken, 'Tk-x');
  assert.equal(engine.rpdbKey, 'r');
});

test('Movie Collections posters: BetterPosters and a working ERDB link', () => {
  assert.equal(enhancedPosterUrl(278, 'tt0111161', { posterProvider: 'betterposter' }), 'https://btttr.cc/poster/movie/tt0111161/auto~gr.png');
  const erdb = enhancedPosterUrl(278, 'tt0111161', { erdbToken: 'Tk-x' });
  // Never the old "/poster/tmdb:movie:<id>" form, which answered an HTML page.
  assert.ok(erdb && !erdb.includes('/poster/tmdb:movie:'), erdb);
  assert.ok(/\.jpg|\/art\/|erdb/i.test(erdb), erdb);
});

test('Movie Collections films get the asking setup\'s poster style, whoever built the list', () => {
  const { posterForVideo } = require('../src/catalog/franchise-collections.ts');
  // Built by another setup with ERDB posters baked in.
  const v = { tmdbId: 278, imdbId: 'tt0111161', posterPath: '/abc.jpg', thumbnail: 'https://easyratingsdb.com/x/poster/old' };
  assert.equal(posterForVideo(v, { posterProvider: 'betterposter' }), 'https://btttr.cc/poster/movie/tt0111161/auto~gr.png');
  assert.equal(posterForVideo(v, {}), 'https://image.tmdb.org/t/p/w342/abc.jpg', 'no style: plain TMDB, never the other setup\'s style');
  assert.equal(posterForVideo({ thumbnail: 'https://image.tmdb.org/t/p/w300/z.jpg' }, {}), 'https://image.tmdb.org/t/p/w300/z.jpg', 'older lists without posterPath keep their thumbnail');
});

test('a stored list is found whatever poster settings built it (latest copy)', async () => {
  const franchise = require('../src/catalog/franchise-collections.ts');
  const cache = require('../src/runtime/cache.ts');
  const metas = [{ id: 'torbox:collection:x-abc', name: 'X Collection', collectionId: 1, videos: [] }];
  await cache.set(cache.makeKey('cat', 'collections', 'latest', 'scope-poster-test', 'en-US'), { metas }, 60);
  const found = await franchise.ensureCollections({ userKey: 'scope-poster-test', lang: 'en-US', posterFp: 'a-different-style' });
  assert.equal(found.length, 1);
});
