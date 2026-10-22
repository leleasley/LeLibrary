// @ts-nocheck
// The near-title fallback: only after every normal query found nothing, only
// with the file's release year, and only for a near-identical title. Real
// parser, stubbed TMDB. No network.
const test = require('node:test');
const assert = require('node:assert');
const resolve = require('../src/matching/resolve.ts');
const parser = require('../src/media/parser.ts');
const tmdb = require('../src/media/tmdb.ts');

function deps(results) {
  const queries = [];
  return {
    queries,
    parse: (name) => parser.guessMediaInfo(name),
    search: async (query, type, year) => { queries.push(`${query}|${year ?? ''}`); return results(query, year) || []; },
    pick: (query, candidates, year) => tmdb.pickBestResult(query, candidates, year),
    seasonCounts: async () => ({}),
    isAnimeCandidate: () => false,
    titleScore: (query, cand) => tmdb.titleScore(query, cand),
    findEpisode: async () => null,
  };
}

const movie = (id, title, year) => ({ id, title, release_date: `${year}-05-01`, vote_count: 500 });

test('"and" in the file finds a TMDB title written with "&"', async () => {
  const d = deps((q, year) => (q === 'Manny & Lo' && year === 1996 ? [movie(1, 'Manny & Lo', 1996)] : []));
  const r = await resolve.resolveMatch({ name: 'Manny.and.Lo.1996.1080p.AMZN.WEBRip.DDP2.0.x264-PLiSSKEN', mediaType: 'movie' }, d);
  assert.equal(r.ok, true);
  assert.equal(r.tmdbId, 1);
});

test('a performer or channel prefix before " - " can still reach the title', async () => {
  const d = deps((q, year) => (q === 'Sticks & Stones' && year === 2019 ? [movie(2, 'Dave Chappelle: Sticks & Stones', 2019)] : []));
  const r = await resolve.resolveMatch({ name: 'Dave Chapelle - Sticks and Stones (2019) 2160p HDR Netflix WEBRip', mediaType: 'movie' }, d);
  assert.equal(r.ok, true);
  assert.equal(r.tmdbId, 2);
  // The prefix alone is never searched: it would match unrelated specials.
  assert.ok(!d.queries.some((q) => q.startsWith('Dave Chapelle|')));
});

test('a one-letter typo resolves through a shorter query', async () => {
  const d = deps((q, year) => (q === 'Harry Potter And The Order Of The' && year === 2007
    ? [movie(3, 'Harry Potter and the Order of the Phoenix', 2007)] : []));
  const r = await resolve.resolveMatch({ name: 'Harry.Potter.And.The.Order.Of.The.Pheonix.2007.1080p.BluRay', mediaType: 'movie' }, d);
  assert.equal(r.ok, true);
  assert.equal(r.tmdbId, 3);
});

test('a near title from the wrong year, or a different title, is rejected', async () => {
  const wrongYear = deps((q) => (q === 'Manny & Lo' ? [movie(4, 'Manny & Lo', 2001)] : []));
  const a = await resolve.resolveMatch({ name: 'Manny.and.Lo.1996.1080p', mediaType: 'movie' }, wrongYear);
  assert.equal(a.ok, false);
  const different = deps((q, year) => (q === 'Harry Potter And The Order Of The' && year === 2007
    ? [movie(5, 'Harry Potter and the Order of the Phoenix: Behind the Magic', 2007)] : []));
  const b = await resolve.resolveMatch({ name: 'Harry.Potter.And.The.Order.Of.The.Pheonix.2007.1080p', mediaType: 'movie' }, different);
  assert.equal(b.ok, false);
});

test('no year means no fallback, and two equal answers stay unresolved', async () => {
  const noYear = deps(() => []);
  await resolve.resolveMatch({ name: 'Manny and Lo 1080p', mediaType: 'movie' }, noYear);
  assert.ok(!noYear.queries.some((q) => q.startsWith('Manny & Lo')));
  const tie = deps((q, year) => (q === 'Manny & Lo' && year === 1996 ? [movie(6, 'Manny & Lo', 1996), movie(7, 'Manny & Lo', 1996)] : []));
  const r = await resolve.resolveMatch({ name: 'Manny.and.Lo.1996.1080p', mediaType: 'movie' }, tie);
  assert.equal(r.ok, false);
});

test('parser: edition before year, aspect ratios, short titles and site prefixes', () => {
  const p = (n) => parser.guessMediaInfo(n);
  assert.deepEqual([p('Hancock EXTENDED 2008 1080p BluRay').title, p('Hancock EXTENDED 2008 1080p BluRay').year], ['Hancock', 2008]);
  const sex = p('The_Opposite_Of_Sex_(1998)_720x480_16x9.mp4');
  assert.equal(sex.isSeries, false);
  assert.equal(sex.year, 1998);
  for (const [name, title, year] of [['M.1931.PROPER.1080p.BluRay', 'M', 1931], ['X.2022.BluRay.1080p', 'X', 2022],
    ['W.(2008) WEBRip 1080p', 'W', 2008], ['Dual.2022.BluRay.1080p.DDP.5.1', 'Dual', 2022], ['K-9.1989.1080p.BluRay', 'K-9', 1989],
    ['11-14.2003.BDRip 1080p', '11-14', 2003], ['(Untitled) (2009) [1080p] [YTS.BZ]', 'Untitled', 2009]]) {
    const r = p(name);
    assert.equal(r && r.title, title, name);
    assert.equal(r.year, year, name);
    assert.equal(r.isSeries, false, name);
  }
  assert.equal(p('LAPUMiA.Org - Acredite.em.Mim.2018.1080p').title, 'Acredite Em Mim');
  assert.equal(p('VACATORRENT.COM..MKV.Os Simpsons 2021 1080p').title, 'Os Simpsons');
  // Unchanged: a real dated episode, a lone letter with no year, scene numbering.
  assert.equal(p('The Office US 11 14 2006 720p HDTV').airDate, '2006-11-14');
  assert.equal(p('X 1080p BluRay'), null);
  assert.equal(p('Some.Show.2x13.720p').episode, 13);
});

test('a full-name match beats a match on the part after " - "', async () => {
  const d = deps((q, year) => (q === 'Sticks & Stones' && year === 2019
    ? [movie(10, 'Sticks & Stones', 2019), movie(11, 'Sticks and Stones', 2019), movie(12, 'Dave Chappelle: Sticks & Stones', 2019)] : []));
  const r = await resolve.resolveMatch({ name: 'Dave Chapelle - Sticks and Stones (2019) 2160p', mediaType: 'movie' }, d);
  assert.equal(r.ok, true);
  assert.equal(r.tmdbId, 12);
});

test('very short titles need an exact title from the exact year', async () => {
  const loose = deps((q, year) => (q === 'M' ? [movie(20, 'Maciste in Hell', 1931), movie(21, 'My Leopold', 1931)] : []));
  assert.equal((await resolve.resolveMatch({ name: 'M.1931.PROPER.1080p.BluRay', mediaType: 'movie' }, loose)).ok, false);
  const exact = deps((q) => (q === 'X' ? [movie(22, 'Rubius X', 2022), movie(23, 'X', 2022)] : []));
  const r = await resolve.resolveMatch({ name: 'X.2022.BluRay.1080p', mediaType: 'movie' }, exact);
  assert.equal(r.tmdbId, 23);
  const wrongYear = deps((q) => (q === '11-14' ? [movie(24, 'Code 11-14', 2003), movie(25, '11:14', 2005)] : []));
  assert.equal((await resolve.resolveMatch({ name: '11-14.2003.BDRip 1080p', mediaType: 'movie' }, wrongYear)).ok, false);
});

test('rows still stored as series never resolve a rescued or short title to a TV show', async () => {
  const tv = (id, name, year) => ({ id, name, first_air_date: `${year}-01-01`, vote_count: 50 });
  const d = deps(() => [tv(30, 'Kamen Rider W', 2008), tv(31, 'Maria Wern', 2003), tv(32, 'Untitled Peaky Blinders Sequel', 2009)]);
  for (const name of ['W.(2008) WEBRip 1080p', 'M.1931.PROPER.1080p', '(Untitled) (2009) [1080p]', '11-14.2003.BDRip 1080p', 'Dual.2022.BluRay.1080p']) {
    const r = await resolve.resolveMatch({ name, mediaType: 'series' }, d);
    assert.equal(r.ok, false, name);
  }
});

test('the shared search cache keeps a mixed-script query apart from its English variant', async () => {
  const shared = { searches: new Map(), seasonCounts: new Map(), stats: { searchHits: 0, searchMisses: 0 } };
  const d = deps((q, year) => (q === 'Girl Vs Monster' && year === 2012 ? [movie(40, 'Girl vs. Monster', 2012)] : []));
  const r = await resolve.resolveMatch({ name: 'Девочка против монстра _ Girl Vs. Monster [2012, США, WEB-DL 1080p]', mediaType: 'movie' }, d, shared);
  assert.equal(r.ok, true);
  assert.equal(r.tmdbId, 40);
});

test('URL-encoded release names are decoded before parsing', () => {
  const a = parser.guessMediaInfo('Extracurricular%20Activities%202019%20AMZN%20WEB-DL%201080p.mkv');
  assert.deepEqual([a.title, a.year], ['Extracurricular Activities', 2019]);
  const b = parser.guessMediaInfo('My%20Dinner%20with%20Andre%20%281981_%5BCRITERION%5D_En%201.0');
  assert.equal(b.title, 'My Dinner With Andre');
  assert.equal(b.year, 1981);
  // A lone percent sign is left alone.
  assert.equal(parser.guessMediaInfo('100% Wolf 2020 1080p').title, '100% Wolf');
});

test('Russian voice-over and subtitle labels are not part of the title', () => {
  assert.equal(parser.guessMediaInfo('Тормоз  Brake   MVO Sub Rus + Original Eng').title, 'Тормоз Brake');
  assert.equal(parser.guessMediaInfo('Кузены  Родственники  Cousins [1989, WEB-DL 1080p] DVO + MVO + AVO').title, 'Кузены Родственники Cousins');
});
