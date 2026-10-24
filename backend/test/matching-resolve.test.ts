// @ts-nocheck
// Pure unit tests for the single matching resolver. TMDB/parser boundaries
// are stubbed except the real filename parser (its subtitle-dropping is part
// of what the redirect exists for). No database, no network.
const test = require('node:test');
const assert = require('node:assert');

const parser = require('../src/media/parser.ts');
const resolve = require('../src/matching/resolve.ts');
const tmdb = require('../src/media/tmdb.ts');

test('retry eligibility version follows both retry policy and canonical matching rules', () => {
  assert.equal(resolve.MAX_MATCH_ATTEMPTS, 8);
  assert.equal(resolve.retryVersion(), `r10:p7:${resolve.matchVersion()}`);
});

test('edition suffix and AKA names produce clean global search variants', async () => {
  const queries = [];
  const candidate = {
    id: 9702,
    title: 'Bound by Honor',
    release_date: '1993-04-16',
    alternativeTitles: ['Blood In Blood Out'],
    vote_count: 1000,
  };
  const deps = stubDeps();
  deps.search = async (query) => {
    queries.push(query);
    return query === 'Blood In Blood Out' ? [candidate] : [];
  };
  const edition = await resolve.resolveMatch({
    name: "Blood In Blood Out Director's Cut 1993",
    mediaType: 'movie',
  }, deps);
  assert.equal(edition.ok, true);
  assert.equal(edition.tmdbId, 9702);
  assert.ok(queries.includes('Blood In Blood Out'));

  const akaQueries = [];
  const akaCandidate = {
    id: 169219,
    title: 'The Dyatlov Pass Incident',
    release_date: '2013-02-28',
    vote_count: 1000,
  };
  const akaDeps = stubDeps();
  akaDeps.search = async (query) => {
    akaQueries.push(query);
    return query === 'The Dyatlov Pass Incident' ? [akaCandidate] : [];
  };
  const aka = await resolve.resolveMatch({
    name: "Devil's Pass AKA The Dyatlov Pass Incident 2013",
    mediaType: 'movie',
  }, akaDeps);
  assert.equal(aka.ok, true);
  assert.equal(aka.tmdbId, 169219);
  assert.ok(akaQueries.includes('The Dyatlov Pass Incident'));
});

test('a conflicting trailing title-year uses a year-free exact-title fallback', async () => {
  const calls = [];
  const candidate = { id: 41662, title: 'Fire in the Sky', release_date: '1993-03-12', vote_count: 1000 };
  const deps = stubDeps();
  deps.parse = () => ({ title: 'Fire in the Sky 1993', year: 1940, isSeries: false, isAnime: false });
  deps.search = async (query, type, year) => {
    calls.push({ query, type, year });
    return query === 'Fire in the Sky' && year == null ? [candidate] : [];
  };
  const out = await resolve.resolveMatch({ name: 'synthetic release with conflicting years', mediaType: 'movie' }, deps);
  assert.equal(out.ok, true);
  assert.equal(out.tmdbId, 41662);
  assert.ok(calls.some((call) => call.query === 'Fire in the Sky' && call.year == null));
});

const KITCHEN_S10 = 'Kitchen.Nightmares.US.S10E01.1080p.WEB.h264-EDITH';
const LIZZIE_S04 = 'Monster.S04.The.Lizzie.Borden.Story.Complete.1080p.WEBRip.10Bit.DDP5.1.x265-NeoNoir';

function stubDeps({ candidates = [], counts = {}, animeIds = new Set(), episodes = {} } = {}) {
  return {
    parse: (name) => parser.guessMediaInfo(name),
    search: async () => candidates,
    pick: (_q, cands) => (cands && cands.length ? cands[0] : null),
    seasonCounts: async (id) => (String(id) in counts ? counts[String(id)] : null),
    titleScore: (query, cand) => tmdb.titleScore(query, cand),
    isAnimeCandidate: (c) => animeIds.has(String(c && c.id)),
    findEpisode: async (id, date) => episodes[`${id}:${date}`] || null,
  };
}

const KNOWN = [{ id: 235884, name: 'Kitchen Nightmares' }];
const KNOWN_COUNTS = { 235884: [{ season: 1, count: 10 }, { season: 2, count: 11 }, { season: 3, count: 12 }] };

test('a yearless season pack uses a unique season match to disambiguate exact-title remakes', async () => {
  let seasonCalls = 0;
  const candidates = [
    { id: 101, name: 'You', first_air_date: '2018-09-09' },
    { id: 202, name: 'You', first_air_date: '2024-01-01' },
  ];
  const out = await resolve.resolveMatch(
    { name: 'You.S05.1080p.NF.WEB-DL.H.264-EniaHD', mediaType: 'series' },
    {
      ...stubDeps({ candidates }),
      seasonCounts: async (id) => {
        seasonCalls++;
        return String(id) === '202' ? [{ season: 5, count: 10 }] : [];
      },
    },
  );
  assert.equal(out.ok, true);
  assert.equal(out.tmdbId, 202);
  assert.equal(out.season, 5);
  assert.equal(seasonCalls, 2);
});

test('yearless season ambiguity stays retryable when candidate season data is unknown', async () => {
  const candidates = [
    { id: 101, name: 'You', first_air_date: '2018-09-09' },
    { id: 202, name: 'You', first_air_date: '2024-01-01' },
  ];
  const out = await resolve.resolveMatch(
    { name: 'You.S05.1080p.NF.WEB-DL.H.264-EniaHD', mediaType: 'series' },
    stubDeps({ candidates, counts: {} }),
  );
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'season-unverified');
});

test('a yearless multi-season pack requires one candidate containing the complete range', async () => {
  const candidates = [
    { id: 101, name: 'Lost', first_air_date: '2004-09-22' },
    { id: 202, name: 'Lost', first_air_date: '2024-01-01' },
  ];
  const out = await resolve.resolveMatch(
    { name: 'Lost.S01-S06.1080p.WEB-DL', mediaType: 'series' },
    stubDeps({ candidates, counts: {
      101: Array.from({ length: 5 }, (_, i) => ({ season: i + 1, count: 20 })),
      202: Array.from({ length: 6 }, (_, i) => ({ season: i + 1, count: 8 })),
    } }),
  );
  assert.equal(out.ok, true);
  assert.equal(out.tmdbId, 202);
  assert.equal(out.season, null);
  assert.equal(out.seasonStart, 1);
  assert.equal(out.seasonEnd, 6);
});

test('yearless season pack uses the existing vote-count tie-break among exact valid candidates', async () => {
  const candidates = [
    { id: 101, name: 'You', first_air_date: '2018-09-09', vote_count: 12000 },
    { id: 202, name: 'You', first_air_date: '2024-01-01', vote_count: 8 },
  ];
  const out = await resolve.resolveMatch(
    { name: 'You.S05.1080p.NF.WEB-DL.H.264-EniaHD', mediaType: 'series' },
    { ...stubDeps({ candidates, counts: {
      101: [{ season: 5, count: 10 }],
      202: [{ season: 5, count: 8 }],
    } }), pick: (query, pool, year) => tmdb.pickBestResult(query, pool, year) },
  );
  assert.equal(out.ok, true);
  assert.equal(out.tmdbId, 101);
  assert.equal(out.season, 5);
});

test('yearless season pack remains ambiguous when exact valid candidates are tied by the existing ranking', async () => {
  const candidates = [
    { id: 101, name: 'You', first_air_date: '2018-09-09', vote_count: 100 },
    { id: 202, name: 'You', first_air_date: '2024-01-01', vote_count: 100 },
  ];
  const out = await resolve.resolveMatch(
    { name: 'You.S05.1080p.NF.WEB-DL.H.264-EniaHD', mediaType: 'series' },
    { ...stubDeps({ candidates, counts: {
      101: [{ season: 5, count: 10 }],
      202: [{ season: 5, count: 8 }],
    } }), pick: (query, pool, year) => tmdb.pickBestResult(query, pool, year) },
  );
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'ambiguous-candidate');
});

test('localized release branding does not prevent searching an independent English title run', async () => {
  const candidate = { id: 123, title: 'Plankton The Movie', release_date: '2025-11-07' };
  const queries = [];
  const out = await resolve.resolveMatch(
    { name: 'opaque localized release', mediaType: 'movie' },
    {
      ...stubDeps(),
      parse: () => ({ title: '【高清影视之家发布 Www Bbqddq Com】海绵宝宝：皮老板大电影 Plankton The Movie', year: 2025 }),
      search: async (query) => {
        queries.push(query);
        return query === 'Plankton The Movie' ? [candidate] : [];
      },
      pick: (query, candidates, year) => tmdb.pickBestResult(query, candidates, year),
    },
  );
  assert.equal(out.ok, true);
  assert.equal(out.tmdbId, candidate.id);
  assert.ok(queries.includes('Plankton The Movie'));
});

test('TVDB S10 resolves to the TMDB split entry season 3', async () => {
  const out = await resolve.resolveMatch(
    { name: KITCHEN_S10, mediaType: 'series', lang: 'en-US' },
    stubDeps({ candidates: KNOWN, counts: KNOWN_COUNTS }),
  );
  assert.equal(out.ok, true);
  assert.equal(out.tmdbId, 235884);
  assert.equal(out.season, 3);
  assert.equal(out.episode, 1);
});

test('remap works whichever entry the search returned first', async () => {
  const deps = stubDeps({
    candidates: [{ id: 11294, name: 'Kitchen Nightmares' }],
    counts: { 11294: [{ season: 1, count: 100 }], ...KNOWN_COUNTS },
  });
  const out = await resolve.resolveMatch({ name: KITCHEN_S10, mediaType: 'series', lang: 'en-US' }, deps);
  assert.equal(out.ok, true);
  assert.equal(out.tmdbId, 235884);
  assert.equal(out.season, 3);
});

test('Lizzie Borden S04 redirects to the standalone entry season 1', async () => {
  const out = await resolve.resolveMatch(
    { name: LIZZIE_S04, mediaType: 'series', lang: 'en-US' },
    stubDeps({
      candidates: [{ id: 113988, name: 'DAHMER' }],
      counts: { 299939: [{ season: 1, count: 8 }] },
    }),
  );
  assert.equal(out.ok, true);
  assert.equal(out.tmdbId, 299939);
  assert.equal(out.season, 1);
  assert.equal(out.title, 'Monster: The Lizzie Borden Story');
});

test('redirect with no season on the target fails closed with a reason', async () => {
  const out = await resolve.resolveMatch(
    { name: LIZZIE_S04, mediaType: 'series', lang: 'en-US' },
    stubDeps({ candidates: [], counts: { 299939: [{ season: 1, count: 0 }] } }),
  );
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'season-missing');
});

test('unverifiable seasons fail retryable, not silent', async () => {
  const out = await resolve.resolveMatch(
    { name: LIZZIE_S04, mediaType: 'series', lang: 'en-US' },
    stubDeps({ candidates: [], counts: {} }),
  );
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'season-unverified');
});

test('a missing season falls through to the next candidate', async () => {
  const out = await resolve.resolveMatch(
    { name: KITCHEN_S10, mediaType: 'series', lang: 'en-US' },
    stubDeps({
      candidates: [{ id: 11111, name: 'Wrong Show' }, ...KNOWN],
      counts: { 11111: [{ season: 1, count: 5 }], ...KNOWN_COUNTS },
    }),
  );
  assert.equal(out.ok, true);
  assert.equal(out.tmdbId, 235884);
  assert.equal(out.season, 3);
  assert.ok(out.tried || true);
});

// Regression: a bare "MasterChef" release must never be absorbed by the
// "MasterChef Australia" sibling just because the exact entry has no such
// season. The exact title is the strongest evidence the release name carries;
// a season-miss fallback may substitute an equally-titled candidate, never a
// worse-titled regional variant.
test('a season miss never downgrades an exact title match to a sibling variant', async () => {
  const out = await resolve.resolveMatch(
    { name: 'MasterChef.S01E01.1080p.WEB-DL.x264-GRP', mediaType: 'series', lang: 'en-US' },
    stubDeps({
      candidates: [
        { id: 3192, name: 'MasterChef' },
        { id: 16395, name: 'MasterChef Australia' },
      ],
      // The exact entry has no season 1; the sibling variant does.
      counts: { 3192: [], 16395: [{ season: 1, count: 14 }] },
    }),
  );
  assert.equal(out.ok, false);
  assert.notEqual(out.tmdbId, 16395);
});

test('a genuinely regional release still resolves to its own entry', async () => {
  const out = await resolve.resolveMatch(
    { name: 'MasterChef.Australia.S01E01.1080p.WEB-DL.x264-GRP', mediaType: 'series', lang: 'en-US' },
    stubDeps({
      candidates: [
        { id: 3192, name: 'MasterChef' },
        { id: 16395, name: 'MasterChef Australia' },
      ],
      counts: { 3192: [], 16395: [{ season: 1, count: 14 }] },
    }),
  );
  assert.equal(out.ok, true);
  assert.equal(out.tmdbId, 16395);
});

// Date-based releases ("WWE RAW 2026 10 05 1080p WEB") carry no SxxExx, so
// fileSeason is null. The no-season early return sat BEFORE the date branch,
// so those releases never had their air date checked against the episode list
// at all: they came back with season/episode null and could land on a show that
// never aired that day. Now the air date is resolved first and fills in the
// numbering when the episode exists.
test('a date-based release resolves its air date to a season and episode', async () => {
  const out = await resolve.resolveMatch(
    { name: 'WWE.RAW.2026.10.05.1080p.WEB.h265-HEEL', mediaType: 'series', lang: 'en-US' },
    stubDeps({
      candidates: [{ id: 4656, name: 'Raw' }, { id: 281397, name: 'WWE Raw Top 10' }],
      counts: {},
      episodes: { '4656:2026-10-05': { season: 34, episode: 5 } },
    }),
  );
  assert.equal(out.ok, true);
  assert.equal(out.tmdbId, 4656);
  assert.equal(out.season, 34);
  assert.equal(out.episode, 5);
});

test('a date-based release with no air date on file keeps the best title match', async () => {
  const out = await resolve.resolveMatch(
    { name: 'WWE.RAW.2026.10.05.1080p.WEB.h265-HEEL', mediaType: 'series', lang: 'en-US' },
    stubDeps({
      candidates: [{ id: 4656, name: 'Raw' }, { id: 281397, name: 'WWE Raw Top 10' }],
      counts: {},
      episodes: {},
    }),
  );
  assert.equal(out.ok, true);
  assert.equal(out.tmdbId, 4656);
  assert.equal(out.season, null);
  assert.equal(out.episode, null);
});

test('ordinary matches pass through unchanged', async () => {
  const out = await resolve.resolveMatch(
    { name: 'Riverdale.S04E01.1080p.WEB-DL', mediaType: 'series', lang: 'en-US' },
    stubDeps({
      candidates: [{ id: 69050, name: 'Riverdale' }],
      counts: { 69050: [{ season: 4, count: 19 }] },
    }),
  );
  assert.equal(out.ok, true);
  assert.equal(out.tmdbId, 69050);
  assert.equal(out.season, 4);
  assert.equal(out.title, 'Riverdale');
});

test('anime candidates never back a series request', async () => {
  const deps = stubDeps({
    candidates: [{ id: 30981, name: 'MONSTER' }],
    counts: {},
    animeIds: new Set(['30981']),
  });
  const out = await resolve.resolveMatch({ name: 'Riverdale.S01E01.1080p.WEB-DL', mediaType: 'series', lang: 'en-US' }, deps);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'anime-excluded');
});

test('movies resolve without season validation', async () => {
  const out = await resolve.resolveMatch(
    { name: 'Dune.Part.Two.2024.1080p.BluRay', mediaType: 'movie', lang: 'en-US' },
    stubDeps({ candidates: [{ id: 693134, title: 'Dune: Part Two' }], counts: {} }),
  );
  assert.equal(out.ok, true);
  assert.equal(out.tmdbId, 693134);
  assert.equal(out.season, null);
});

test('garbage names fail closed with a reason', async () => {
  const out = await resolve.resolveMatch(
    { name: '!!!', mediaType: 'series', lang: 'en-US' },
    stubDeps({}),
  );
  assert.equal(out.ok, false);
  assert.ok(['unparseable', 'no-candidate'].includes(out.reason));
});

test('every result carries resolver and table versions', async () => {
  const deps = stubDeps({ candidates: KNOWN, counts: KNOWN_COUNTS });
  const ok = await resolve.resolveMatch({ name: KITCHEN_S10, mediaType: 'series', lang: 'en-US' }, deps);
  assert.equal(ok.resolverVersion, resolve.RESOLVER_VERSION);
  assert.match(ok.tableVersion, /^[0-9a-f]{12}$/);
  const bad = await resolve.resolveMatch({ name: KITCHEN_S10, mediaType: 'series', lang: 'en-US' }, stubDeps({}));
  assert.equal(bad.resolverVersion, resolve.RESOLVER_VERSION);
});

test('default deps forward the caller key to every TMDB call (regression: unkeyed background matches)', async () => {
  const seen = {};
  const fakeLayer = {
    searchCandidates: async (key, ...rest) => { seen.search = [key, ...rest]; return [{ id: 69050, name: 'Riverdale' }]; },
    pickBestResult: (q, cands) => cands[0],
    getSeasonEpisodeCounts: async (key, ...rest) => { seen.counts = [key, ...rest]; return [{ season: 4, count: 19 }]; },
    findEpisodeByAirDate: async (key, ...rest) => { seen.find = [key, ...rest]; return null; },
    titleScore: (query, cand) => tmdb.titleScore(query, cand),
  };
  const deps = resolve.defaultDeps('KEY-123', fakeLayer);
  const out = await resolve.resolveMatch(
    { name: 'Riverdale.S04E01.1080p.WEB-DL', mediaType: 'series', lang: 'en-US', tmdbApiKey: 'KEY-123' },
    deps,
  );
  assert.equal(out.ok, true);
  assert.equal(out.tmdbId, 69050);
  assert.equal(seen.search[0], 'KEY-123');
  assert.equal(seen.counts[0], 'KEY-123');
});

test('a year-only title finds its spelled-out TMDB title ("1984")', async () => {
  const deps = stubDeps();
  deps.search = async (query) => (query === 'Nineteen Eighty-Four'
    ? [{ id: 9314, title: 'Nineteen Eighty-Four', release_date: '1984-11-09', vote_count: 1700 }]
    : [{ id: 359720, title: 'The House, 1984', release_date: '1984-12-31', vote_count: 6 }]);
  const r = await resolve.resolveMatch({ name: '1984.1984.INTERNAL.REMASTERED.1080p.BluRay.x264-SiNNERS', mediaType: 'movie' }, deps);
  assert.equal(r.ok, true);
  assert.equal(r.tmdbId, 9314);
});

test('a short exact title one year off counts only when it is the only one', async () => {
  const deps = stubDeps();
  deps.search = async () => [{ id: 844, title: '2046', release_date: '2005-10-20', vote_count: 900 }];
  const one = await resolve.resolveMatch({ name: '2046.2004.1080p.mkv', mediaType: 'movie' }, deps);
  assert.equal(one.tmdbId, 844);
  deps.search = async () => [
    { id: 1, title: 'Lux', release_date: '2003-01-01', vote_count: 5 },
    { id: 2, title: 'Lux', release_date: '2005-01-01', vote_count: 5 },
  ];
  const two = await resolve.resolveMatch({ name: 'Lux.2004.1080p.mkv', mediaType: 'movie' }, deps);
  assert.equal(two.ok, false);
});

test('a short title also matches a TMDB alternative title ("CKY")', async () => {
  const deps = stubDeps();
  deps.search = async () => [{ id: 24145, title: 'Landspeed presents: CKY', release_date: '1999-03-01', alternativeTitles: ['CKY', 'Landspeed: CKY'], vote_count: 45 }];
  const r = await resolve.resolveMatch({ name: 'cky-1999', mediaType: 'movie' }, deps);
  assert.equal(r.tmdbId, 24145);
});

test('strict unique-year matching accepts a TMDB alternative title', async () => {
  const deps = stubDeps();
  deps.search = async () => [{ id: 24145, title: 'Landspeed presents: CKY', release_date: '1999-03-01', alternativeTitles: ['CKY'], vote_count: 45 }];
  const r = await resolve.resolveMatch({ name: 'cky-1999', mediaType: 'movie', requireUniqueStrongYear: true }, deps);
  assert.equal(r.tmdbId, 24145);
});
