// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const { withoutTmdbAnime } = require('../src/library/catalog.ts');

test('Hide anime drops rows TMDB identifies as anime and keeps the rest', () => {
  const rows = [
    { id: 1, match_meta: { name: 'Your Name.', isJapaneseAnimation: true } },
    { id: 2, match_meta: { name: 'Oppenheimer', isJapaneseAnimation: false } },
    { id: 3, match_meta: JSON.stringify({ name: 'My Neighbor Totoro', isJapaneseAnimation: true }) },
    { id: 4, match_meta: { name: 'Matched before the flag existed' } },
    { id: 5, match_meta: null },
  ];
  assert.deepEqual(withoutTmdbAnime(rows).map((row) => row.id), [2, 4, 5]);
  assert.deepEqual(withoutTmdbAnime(null), []);
});

const { isTmdbAnimeItem } = require('../src/media/tmdb.ts');

test('TMDB anime check: Japanese plus the Animation genre, nothing else', () => {
  assert.equal(isTmdbAnimeItem({ original_language: 'ja', genre_ids: [16, 18] }), true);
  assert.equal(isTmdbAnimeItem({ original_language: 'ja', genres: [{ id: 16, name: 'Animation' }] }), true);
  assert.equal(isTmdbAnimeItem({ original_language: 'ja', genre_ids: [18] }), false, 'Japanese live action stays');
  assert.equal(isTmdbAnimeItem({ original_language: 'en', genre_ids: [16] }), false, 'Western animation stays');
  assert.equal(isTmdbAnimeItem(null), false);
});
