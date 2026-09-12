const test = require('node:test');
const assert = require('node:assert/strict');
const posters = require('../website/public/poster-template');

test('custom poster templates resolve documented placeholders', () => {
  const template = 'https://posters.example/poster/{imdb_id}.jpg?tmdb={tmdbId}&type={type}';
  assert.equal(
    posters.resolve(template, { id: 'tt0133093', tmdbId: 603, type: 'movie' }),
    'https://posters.example/poster/tt0133093.jpg?tmdb=603&type=movie'
  );
  assert.equal(posters.resolve('https://posters.example/{tmdb_id}/{type}.jpg', { tmdbId: 1396, type: 'series' }), 'https://posters.example/1396/series.jpg');
});

test('browser-encoded braces still produce a live custom poster URL', () => {
  const template = 'https://lambda.example/poster/%7Bimdb_id%7D.svg?type={type}';
  assert.equal(posters.validate(template).ok, true);
  assert.equal(posters.resolve(template, { imdbId: 'tt0133093', type: 'movie' }), 'https://lambda.example/poster/tt0133093.svg?type=movie');
});

test('custom poster validation rejects unsafe and unusable templates', () => {
  for (const template of [
    'http://posters.example/{imdbId}.jpg',
    'https://user:pass@posters.example/{imdbId}.jpg',
    'https://posters.example/same.jpg',
    'https://posters.example/{unknown}.jpg',
    'https://posters.example/{imdbId}.jpg bad',
  ]) assert.equal(posters.validate(template).ok, false, template);
});

test('rows fall back unchanged when a required identifier is unavailable', () => {
  const row = { id: 'torbox:movie:603', tmdbId: 603, type: 'movie', poster: 'tmdb.jpg' };
  assert.equal(posters.apply(row, 'https://posters.example/{imdbId}.jpg'), row);
  assert.equal(posters.apply(row, 'https://posters.example/{tmdbId}.jpg').poster, 'https://posters.example/603.jpg');
});

test('metadata enhancement applies a custom poster without changing identity', async () => {
  const { enhanceMeta } = require('../src/builder');
  const meta = { id: 'tt0133093', imdbId: 'tt0133093', tmdbId: 603, type: 'movie', poster: 'tmdb.jpg' };
  await enhanceMeta(meta, {
    posterProvider: 'custom',
    customPosterTemplate: 'https://posters.example/{imdb_id}/{tmdb_id}/{type}.jpg',
  });
  assert.equal(meta.poster, 'https://posters.example/tt0133093/603/movie.jpg');
  assert.equal(meta.id, 'tt0133093');
  assert.equal(meta.tmdbId, 603);
});

test('custom poster edits change the non-secret artwork cache fingerprint', () => {
  const { posterFp } = require('../app');
  const first = posterFp({ posterProvider: 'custom', customPosterTemplate: 'https://one.example/{imdbId}.jpg' });
  const second = posterFp({ posterProvider: 'custom', customPosterTemplate: 'https://two.example/{imdbId}.jpg' });
  const cleared = posterFp({ posterProvider: '' });
  assert.notEqual(first, second);
  assert.notEqual(second, cleared);
});
