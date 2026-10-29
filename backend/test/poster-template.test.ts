// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const posters = require('../src/media/poster-template.ts');

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
  const { enhanceMeta } = require('../src/catalog/builder.ts');
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
  const { posterFp } = require('../app.ts');
  const first = posterFp({ posterProvider: 'custom', customPosterTemplate: 'https://one.example/{imdbId}.jpg' });
  const second = posterFp({ posterProvider: 'custom', customPosterTemplate: 'https://two.example/{imdbId}.jpg' });
  const cleared = posterFp({ posterProvider: '' });
  assert.notEqual(first, second);
  assert.notEqual(second, cleared);
});

export interface PosterTemplateTestTestModule {};

// ── Posters+ and Nuvio-style placeholders (5.8) ───────────────────────
const LINK = 'https://postersplus.elfhosted.com/poster?tmdb_id={tmdb_id?}&imdb_id={imdb_id?}&stremio_id={id}&type={type}&shape={shape}&vpcb=e0b84f&access_key=SECRETKEY&tmdb_key=TMDBKEY';

test('optional placeholders are sent empty instead of dropping the poster', () => {
  const t = 'https://p.example/poster?tmdb_id={tmdb_id?}&imdb_id={imdb_id?}&stremio_id={id}&type={type}&shape={shape}';
  assert.equal(posters.resolve(t, { tmdbId: 278, imdbId: 'tt0111161', type: 'movie' }),
    'https://p.example/poster?tmdb_id=278&imdb_id=tt0111161&stremio_id=tt0111161&type=movie&shape=poster');
  // No IMDb id: still a poster, the Stremio id falls back to tmdb:<id>.
  assert.equal(posters.resolve(t, { tmdbId: 1396, type: 'series' }),
    'https://p.example/poster?tmdb_id=1396&imdb_id=&stremio_id=tmdb%3A1396&type=series&shape=poster');
  // No identifier with a value at all: no poster (the row keeps its own).
  assert.equal(posters.resolve('https://p.example/poster?tmdb_id={tmdb_id?}', { type: 'movie' }), null);
  // Required placeholders keep their old rule.
  assert.equal(posters.resolve('https://p.example/{tmdbId}.jpg', { imdbId: 'tt1' }), null);
  assert.equal(posters.validate('https://p.example/poster?x={kitsu_id?}&tmdb_id={tmdb_id}').ok, false);
});

test('a Posters+ copied link becomes a template, keeping its style and keys', () => {
  const checked = posters.fromPostersPlus(LINK);
  assert.equal(checked.ok, true);
  const url = posters.resolve(checked.value, { tmdbId: 278, imdbId: 'tt0111161', type: 'movie' });
  assert.match(url, /^https:\/\/postersplus\.elfhosted\.com\/poster\?tmdb_id=278&imdb_id=tt0111161&stremio_id=tt0111161&type=movie&shape=poster&vpcb=e0b84f&access_key=SECRETKEY&tmdb_key=TMDBKEY$/);
  // Encoded braces (some clients copy them that way) and other clients' placeholders.
  const encoded = posters.fromPostersPlus('https://pp.example/poster?tmdb_id=%7Btmdb_id%7D&type=%7Btype%7D&anilist={anilist_id?}&access_key=k');
  assert.equal(encoded.ok, true);
  assert.ok(!encoded.value.includes('anilist'));
  // A bare instance address gets the documented Nuvio identifier set.
  const bare = posters.fromPostersPlus('https://pp.example/?access_key=k');
  assert.equal(bare.ok, true);
  assert.equal(posters.resolve(bare.value, { tmdbId: 5, type: 'movie' }), 'https://pp.example/poster?tmdb_id=5&imdb_id=&stremio_id=tmdb%3A5&type=movie&shape=poster&access_key=k');
  for (const bad of ['', 'not a link', 'http://pp.example/poster?tmdb_id={tmdb_id}', 'https://pp.example/logo?tmdb_id={tmdb_id}']) {
    assert.equal(posters.fromPostersPlus(bad).ok, false, bad);
  }
});

test('Posters+ reaches every catalogue path as a custom template', () => {
  const { posterEnhance, posterFp } = require('../src/runtime/cache-fingerprint.ts');
  const enhance = posterEnhance({ posterProvider: 'postersplus', postersPlusUrl: LINK });
  assert.equal(enhance.posterProvider, 'custom');
  assert.ok(enhance.customPosterTemplate.startsWith('https://postersplus.elfhosted.com/poster?'));
  // A broken link falls back to TMDB posters, never a broken image.
  assert.deepEqual(
    [posterEnhance({ posterProvider: 'postersplus', postersPlusUrl: 'nope' }).posterProvider, posterEnhance({ posterProvider: 'postersplus' }).customPosterTemplate],
    ['', ''],
  );
  // Changing the link (a new style) changes the catalogue cache identity.
  assert.notEqual(posterFp({ posterProvider: 'postersplus', postersPlusUrl: LINK }), posterFp({ posterProvider: 'postersplus', postersPlusUrl: LINK + '&vpct=000000' }));
  // Other providers are untouched.
  assert.equal(posterEnhance({ posterProvider: 'custom', customPosterTemplate: 'https://x.example/{tmdbId}.jpg' }).customPosterTemplate, 'https://x.example/{tmdbId}.jpg');
});
