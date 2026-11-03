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
