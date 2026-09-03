const test = require('node:test');
const assert = require('node:assert/strict');

const { normalize, resultScore, extractYear, GENRES } = require('../src/search');

test('normalize strips case, diacritics and punctuation', () => {
  assert.equal(normalize('  Batman  '), 'batman');
  assert.equal(normalize('BATMAN'), 'batman');
  assert.equal(normalize('Déjà Vu'), 'deja vu');
  assert.equal(normalize("Spider-Man: No Way Home"), 'spider man no way home');
  assert.equal(normalize(''), '');
});

test('resultScore ranks exact > prefix > contains > token overlap', () => {
  const q = 'batman';
  assert.ok(resultScore(q, { title: 'Batman' }) > resultScore(q, { title: 'Batman Begins' }));
  assert.ok(resultScore(q, { title: 'Batman Begins' }) > resultScore(q, { title: 'The Brave and the Bold: Batman' }));
  const q2 = 'dark knight';
  const contains = resultScore(q2, { title: 'The Dark Knight Rises' });
  const token = resultScore(q2, { title: 'Darkness Falls: Knight of the Realm' });
  assert.ok(contains > token);
});

test('original titles never outrank the display title match', () => {
  const q = 'batman';
  const display = resultScore(q, { title: 'Batman' });
  const originalOnly = resultScore(q, { title: 'Der Dunkle Ritter', original_title: 'Batman' });
  assert.ok(display > originalOnly);
});

test('extractYear pulls a trailing year off the query', () => {
  assert.deepEqual(extractYear('batman 2022'), { text: 'batman', year: '2022' });
  assert.deepEqual(extractYear('ghost in the shell 1995'), { text: 'ghost in the shell', year: '1995' });
  assert.deepEqual(extractYear('inception'), { text: 'inception', year: null });
  assert.deepEqual(extractYear('2022'), { text: '2022', year: null });
  assert.deepEqual(extractYear('the year 1999 film'), { text: 'the year 1999 film', year: null });
});

test('genre table maps standard names to TMDB ids per media type', () => {
  assert.deepEqual(GENRES.action, { movie: 28, tv: 10759 });
  assert.deepEqual(GENRES.horror, { movie: 27, tv: null });
  assert.deepEqual(GENRES['sci fi'], GENRES.scifi);
  assert.deepEqual(GENRES.kids, { movie: null, tv: 10762 });
});

test('genre table covers the common genres', () => {
  const names = ['action', 'comedy', 'horror', 'thriller', 'crime', 'scifi', 'animation', 'fantasy', 'drama', 'mystery'];
  for (const n of names) assert.ok(GENRES[n], `missing genre: ${n}`);
});
