// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');

// Owned-catalog poster parity: every grid path must apply the full provider
// precedence (custom > pictorium > erdb > rpdb > betterposter > fanart), and
// anime rows must use TV provider URLs (TMDB TV ids in a 'movie' slot 404).
const { applyPosterEnhance } = require('../src/library/catalog.ts');

const animeRow = () => ({
  id: 'torbox:series:65956', type: 'series', catalogType: 'anime',
  name: 'My Hero Academia', tmdbId: 65956, imdbId: 'tt5626028',
  poster: 'https://image.tmdb.org/t/p/w500/anime.jpg', posterShape: 'poster',
});
const movieRow = () => ({
  id: 'torbox:movie:27205', type: 'movie', catalogType: 'movie',
  name: 'Inception', tmdbId: 27205, imdbId: 'tt1375666',
  poster: 'https://image.tmdb.org/t/p/w500/movie.jpg', posterShape: 'poster',
});

test('anime rows get TV provider URLs, movies keep movie URLs', async () => {
  const out = await applyPosterEnhance(
    [animeRow(), movieRow()],
    { erdbToken: 'erdb-test-token' },
  );
  assert.match(out[0].poster, /tv/, 'anime ERDB url must target tv');
  assert.doesNotMatch(out[0].poster, /movie/, 'anime ERDB url must not target movie');
  assert.match(out[1].poster, /movie/, 'movie ERDB url must target movie');
});

test('pictorium covers anime rows (not just movies/series)', async () => {
  const out = await applyPosterEnhance(
    [animeRow()],
    { posterProvider: 'pictorium', pictorium: { enabled: true, token: 'tok123', origin: 'https://img.test', options: {} } },
  );
  assert.match(out[0].poster, /\/pictorium\/series\//);
});

test('betterposter covers owned rows via the stored imdb id', async () => {
  const out = await applyPosterEnhance([animeRow()], { posterProvider: 'betterposter' });
  assert.ok(out[0].poster.startsWith('https://btttr.cc/poster/tv/tt5626028/'), out[0].poster);
});

test('no poster provider configured leaves rows untouched', async () => {
  const before = animeRow().poster;
  const out = await applyPosterEnhance([animeRow()], {});
  assert.equal(out[0].poster, before);
});

export interface PosterParityTestModule {};
