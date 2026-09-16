const test = require('node:test');
const assert = require('node:assert');
const { isAnimeKeyword, normalizeForKeyword } = require('../src/library/identity/anime-titles');
const { similarity, bestMatch, isAnimeCandidate, normalize } = require('../src/library/identity/resolve');

test('anime keyword signals match franchises but not live-action lookalikes', () => {
  assert.strictEqual(isAnimeKeyword('One Piece'), true);
  assert.strictEqual(isAnimeKeyword('[SubsPlease] Frieren - 01 (1080p)'), true);
  assert.strictEqual(isAnimeKeyword('Demon Slayer Kimetsu no Yaiba'), true);
  assert.strictEqual(isAnimeKeyword('My Hero Academia S06'), true);
  assert.strictEqual(isAnimeKeyword('Spy x Family'), true);

  assert.strictEqual(isAnimeKeyword('Conan the Barbarian'), false);
  assert.strictEqual(isAnimeKeyword('Watergate'), false);
  assert.strictEqual(isAnimeKeyword('The Office'), false);
  assert.strictEqual(isAnimeKeyword('Another Life'), false);
  assert.strictEqual(isAnimeKeyword('Free Guy'), false);
  assert.strictEqual(isAnimeKeyword('The Gate'), false);
});

test('normalize collapses punctuation and case', () => {
  assert.strictEqual(normalize('Frieren: Beyond Journey\'s End'), 'frieren beyond journeys end');
  assert.strictEqual(normalizeForKeyword('Spy x Family'), 'spy x family');
});

test('similarity favours exact and containment, then token overlap', () => {
  assert.strictEqual(similarity('One Piece', 'One Piece'), 100);
  assert.strictEqual(similarity('One Piece', 'one  piece'), 100);
  assert.ok(similarity('Frieren', "Frieren: Beyond Journey's End") >= 80);
  assert.ok(similarity('One Piece', 'One Punch Man') < 70);
  assert.ok(similarity('The Office', 'Breaking Bad') < 40);
});

test('bestMatch picks the right candidate and uses the year to disambiguate', () => {
  const hit = bestMatch(
    [{ titles: ["Frieren: Beyond Journey's End"] }, { titles: ['One Piece'] }],
    ['Frieren'], null,
  );
  assert.ok(hit.confidence >= 80);
  assert.strictEqual(hit.candidate.titles[0], "Frieren: Beyond Journey's End");

  const remakes = bestMatch(
    [{ title: 'It', year: 1990 }, { title: 'It', year: 2017 }],
    ['It'], 2017,
  );
  assert.strictEqual(remakes.candidate.year, 2017);
});

test('isAnimeCandidate routes parser-anime and keyword candidates, not plain TV', () => {
  assert.strictEqual(isAnimeCandidate({ mediaType: 'anime', title: 'Anything' }), true);
  assert.strictEqual(isAnimeCandidate({ mediaType: 'series', title: 'Naruto Shippuden' }), true);
  assert.strictEqual(isAnimeCandidate({ mediaType: 'series', title: 'The Bear' }), false);
  assert.strictEqual(isAnimeCandidate({ mediaType: 'movie', title: 'Dune' }), false);
});

test('date-based owned entries are matched by air date, never treated as whole-series', () => {
  const { addOwnedEpisodeAvailability, addOwnedAirDates, ownedDateKey } = require('../src/builder');
  const eps = new Set();
  const dates = new Set();
  const dated = { season: null, episode: null, airDate: '2026-09-14' };
  addOwnedEpisodeAvailability(eps, dated);
  addOwnedAirDates(dates, dated);
  assert.strictEqual(eps.has('all'), false, 'a dated release must not mark the whole series owned');
  assert.ok(dates.has('2026-09-14'));
  assert.strictEqual(ownedDateKey('2026-09-14T00:00:00Z'), '2026-09-14');
  assert.strictEqual(ownedDateKey(''), null);

  // A genuine no-season/no-episode/no-date entry is a whole-series pack.
  const pack = new Set();
  addOwnedEpisodeAvailability(pack, { season: null, episode: null });
  assert.ok(pack.has('all'));

  // Numbered entries still resolve to their exact episode.
  const numbered = new Set();
  addOwnedEpisodeAvailability(numbered, { season: 2, episode: 5 });
  assert.ok(numbered.has('2:5'));
  assert.ok(!numbered.has('all'));
});
