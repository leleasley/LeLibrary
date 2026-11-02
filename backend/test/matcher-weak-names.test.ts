// @ts-nocheck
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const tmdb = require('../src/media/tmdb.ts');
const matcher = require('../src/library/matcher.ts');
const resolve = require('../src/matching/resolve.ts');
const parser = require('../src/media/parser.ts');

// Names the operator found failing on 2026-11-02. Synthetic TMDB answers, no
// network: S4: The Bob Lazar Story (a film read as season 4), The First Time
// (no year, several films) and Tormoz Brake (no year, a mostly Russian name).
const searched = [];
function deps(candidates) {
  return {
    parse: (name) => parser.guessMediaInfo(name),
    search: async (query, type, year) => { searched.push({ query, type, year }); return candidates; },
    pick: (_query, rows) => rows[0] || null,
    titleScore: (query, candidate) => tmdb.titleScore(query, candidate),
    seasonCounts: async () => null,
    isAnimeCandidate: () => false,
    findEpisode: async () => null,
  };
}

test('a film whose title starts like a season is retried as that film', async () => {
  const name = 'S4.The.Bob.Lazar.Story.2026.1080p.WEB.H264-OUTPOST31';
  const parsed = parser.guessMediaInfo(name);
  assert.equal(parsed.isSeries, true, 'the parser still reads S4 as a season (S02.Show.Name stays a show)');
  const film = matcher.leadingSeasonFilm(name, parsed);
  assert.equal(film.title, 'S4 The Bob Lazar Story');
  assert.equal(film.year, 2026);
  assert.equal(film.isSeries, false);
  searched.length = 0;
  const out = await resolve.resolveMatch({ name, mediaType: 'movie', requireUniqueStrongYear: true, parsed: film },
    deps([{ id: 900, title: 'S4: The Bob Lazar Story', release_date: '2026-03-01' }]));
  assert.equal(out.ok, true);
  assert.equal(out.tmdbId, 900);
  assert.equal(searched[0].query.toLowerCase().includes('s4'), true, 'S4 is part of the search');
});

test('the leading-season film reading needs a leading marker, a matching season and a year', () => {
  assert.equal(matcher.leadingSeasonFilm('Breaking.Bad.S04.1080p', parser.guessMediaInfo('Breaking.Bad.S04.1080p')), null, 'not leading');
  assert.equal(matcher.leadingSeasonFilm('S02.The.Long.Running.Show.1080p.WEB-DL', parser.guessMediaInfo('S02.The.Long.Running.Show.1080p.WEB-DL')), null, 'no year');
  assert.equal(matcher.leadingSeasonFilm('S01E02.Show.Name.2020', { title: 'Show Name', year: 2020, season: 1, episode: 2 }), null, 'an episode is a show');
});

test('a yearless outer name falls back to its one dated main video', () => {
  const files = (names) => names.map(([name, size]) => ({ name, size }));
  assert.deepEqual(matcher.weakOuterFilm('The First Time', parser.guessMediaInfo('The First Time'), files([['The.First.Time.2012.BDRip.1080p.ylnian.mkv', 8e9]])),
    { title: 'The First Time', year: 2012 });
  assert.deepEqual(matcher.weakOuterFilm('Тормоз Brake MVO Sub Rus + Original Eng', parser.guessMediaInfo('Тормоз Brake MVO Sub Rus + Original Eng'),
    files([['Brake.2012.BDRip.x264.MVO.eng.mkv', 2e9], ['Brake.rus.srt', 1e5]])), { title: 'Brake', year: 2012 });
  // An outer name with its own year is trusted as it is.
  assert.equal(matcher.weakOuterFilm('Brake 2012', parser.guessMediaInfo('Brake 2012'), files([['Brake.2012.mkv', 2e9]])), null);
  // Two big films inside: no single main video, no guess.
  assert.equal(matcher.weakOuterFilm('Two Films', parser.guessMediaInfo('Two Films'), files([['Alpha.2010.mkv', 4e9], ['Beta.2011.mkv', 4e9]])), null);
  // The main video must be dated.
  assert.equal(matcher.weakOuterFilm('Something', parser.guessMediaInfo('Something'), files([['Something.1080p.mkv', 4e9]])), null);
});

test('The First Time resolves once the inner year picks one of several films', async () => {
  // TMDB really has two 2012 films of that name (2,187 votes against 2).
  const out = await resolve.resolveMatch({ name: 'The First Time 2012', mediaType: 'movie' },
    deps([{ id: 84199, title: 'The First Time', release_date: '2012-10-19', vote_count: 2187 }, { id: 1023026, title: 'The First Time', release_date: '2012-07-01', vote_count: 2 }, { id: 3, title: 'The First Time', release_date: '2009-01-01', vote_count: 50 }]));
  assert.equal(out.ok, true);
  assert.equal(out.tmdbId, 84199);
});

test('failed rows get one more try under the new retry version', () => {
  assert.match(resolve.retryVersion(), /^r11:/);
});
