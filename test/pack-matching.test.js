const test = require('node:test');
const assert = require('node:assert/strict');

const { guessMediaInfo } = require('../src/parser');
const { summarizePackEpisodes, shouldProbeEpisodeNamedPack, addOwnedEpisodeAvailability, isEpisodePackMisreadAsMovie, mergePackEpisodeRange, embeddedPackEntry } = require('../src/builder');

// A bare torrent name ("Kitchen.Nightmares", 30GB pack) parses as a
// non-series title: this is the gap the pack fallback closes. Inner files
// carry the real season/episode info.
test('bare pack name parses without series info', () => {
  const info = guessMediaInfo('Kitchen.Nightmares');
  assert.equal(info.isSeries, false);
  assert.equal(info.season, null);
  assert.equal(info.title, 'Kitchen Nightmares');
});

const BTW_S01 = [
  'Kitchen.Nightmares.US.S01E01.Peters.HULU.WEBRip.AAC2.0.H.264-BTW.mkv',
  'Kitchen.Nightmares.US.S01E02.Dillons.HULU.WEBRip.AAC2.0.H.264-BTW.mkv',
  'Kitchen.Nightmares.US.S01E03.The.Mixing.Bowl.HULU.WEBRip.AAC2.0.H.264-BTW.mkv',
  'Kitchen.Nightmares.US.S01E04.Seascape.HULU.WEBRip.AAC2.0.H.264-BTW.mkv',
  'Kitchen.Nightmares.US.S01E05.Olde.Stone.Mill.HULU.WEBRip.AAC2.0.H.264-BTW.mkv',
  'Kitchen.Nightmares.US.S01E06.Sebastians.HULU.WEBRip.AAC2.0.H.264-BTW.mkv',
];

test('full-season inner files summarize to a season pack', () => {
  assert.deepEqual(summarizePackEpisodes(BTW_S01), {
    title: 'Kitchen Nightmares Us',
    year: null,
    season: 1,
    seasonStart: null,
    seasonEnd: null,
    episode: null,
    isAnime: false,
  });
});

test('single distinct episode resolves exactly', () => {
  assert.deepEqual(summarizePackEpisodes(['Some.Show.S02E05.1080p.mkv']), {
    title: 'Some Show',
    year: null,
    season: 2,
    seasonStart: null,
    seasonEnd: null,
    episode: 5,
    isAnime: false,
  });
});

test('episodes across seasons resolve as the whole show', () => {
  const summary = summarizePackEpisodes([
    'Some.Show.S01E01.1080p.mkv',
    'Some.Show.S02E01.1080p.mkv',
  ]);
  assert.equal(summary.title, 'Some Show');
  assert.equal(summary.season, null);
  assert.equal(summary.seasonStart, 1);
  assert.equal(summary.seasonEnd, 2);
  assert.equal(summary.episode, null);
});

test('South Park S00-S26 boxset retains specials and every owned season', () => {
  const info = guessMediaInfo('South Park (1997) - S00 - S26 Boxset');
  assert.equal(info.title, 'South Park');
  assert.equal(info.year, 1997);
  assert.equal(info.isSeries, true);
  assert.equal(info.season, null);
  assert.equal(info.seasonStart, 0);
  assert.equal(info.seasonEnd, 26);

  const available = new Set();
  addOwnedEpisodeAvailability(available, info);
  assert.equal(available.size, 27);
  assert.equal(available.has('season:0'), true);
  assert.equal(available.has('season:26'), true);
  assert.equal(available.has('season:27'), false);
  assert.equal(available.has('all'), false);
});

test('Bobs Burgers season range is not reduced to its first season', () => {
  const compact = guessMediaInfo("Bob's Burgers (2011) S01-S14 Boxset");
  assert.equal(compact.title, "Bob's Burgers");
  assert.equal(compact.seasonStart, 1);
  assert.equal(compact.seasonEnd, 14);

  const written = guessMediaInfo('Bobs.Burgers.Seasons.1-15.Complete');
  assert.equal(written.title, 'Bobs Burgers');
  assert.equal(written.seasonStart, 1);
  assert.equal(written.seasonEnd, 15);
});

test('misleading Bobs Burgers episode name is promoted from its inner multi-season files', () => {
  const outer = guessMediaInfo('Bobs Burgers ➡️ S03E05');
  const item = {
    name: 'Bobs Burgers ➡️ S03E05',
    files: [
      { name: 'Bobs.Burgers.S01E01.1080p.mkv' },
      { name: 'Bobs.Burgers.S03E05.An.Indecent.Thanksgiving.Proposal.PROPER.1080p.WEB-DL.DD5.1.H264-iT00NZ.mkv' },
      { name: 'Bobs.Burgers.S08E21.1080p.mkv' },
    ],
  };
  assert.equal(outer.season, 3);
  assert.equal(outer.episode, 5);
  assert.equal(shouldProbeEpisodeNamedPack(item, outer), true);
  const summary = summarizePackEpisodes(item.files.map(file => file.name));
  assert.equal(summary.title, 'Bobs Burgers');
  assert.equal(summary.season, null);
  assert.equal(summary.seasonStart, 1);
  assert.equal(summary.seasonEnd, 8);
  assert.equal(summary.episode, null);
});

test('ordinary single episodes do not trigger a pack file inspection', () => {
  const info = guessMediaInfo('Bobs.Burgers.S03E05.1080p.mkv');
  assert.equal(shouldProbeEpisodeNamedPack({
    name: 'Bobs.Burgers.S03E05.1080p.mkv',
    size: 900 * 1024 * 1024,
    files: [{ name: 'Bobs.Burgers.S03E05.1080p.mkv' }],
  }, info), false);
});

test('pack summaries ignore episode-shaped extras from another title', () => {
  const summary = summarizePackEpisodes([
    'Bobs.Burgers.S01E01.1080p.mkv',
    'Bobs.Burgers.S01E02.1080p.mkv',
    'Unrelated.Bonus.Show.S09E09.mkv',
  ]);
  assert.equal(summary.title, 'Bobs Burgers');
  assert.equal(summary.season, 1);
  assert.equal(summary.seasonStart, null);
  assert.equal(summary.seasonEnd, null);
});

test('split-show inner seasons survive aggregation for the remap', () => {
  // TVDB S10 inners aggregate to season 10; remapSplitSeason (tested in
  // split-shows.test.js) then moves them to the 2023 entry downstream.
  const summary = summarizePackEpisodes([
    'Kitchen.Nightmares.US.S10E01.1080p.WEB.h264-EDITH.mkv',
    'Kitchen.Nightmares.US.S10E02.1080p.WEB.h264-EDITH.mkv',
  ]);
  assert.equal(summary.season, 10);
  assert.equal(summary.episode, null);
});

test('movie and junk inner files are ignored', () => {
  assert.equal(summarizePackEpisodes([]), null);
  assert.equal(summarizePackEpisodes(['Dune.Part.Two.2024.1080p.mkv']), null);
  assert.equal(summarizePackEpisodes(['Some.Show.S01E01.sample.mkv']), null);
  assert.equal(summarizePackEpisodes([null, undefined, 42]), null);
});

test('absolute-numbered anime inners keep episode with null season', () => {
  const summary = summarizePackEpisodes(['[SubsPlease] One Piece - 101 [1080p].mkv']);
  assert.equal(summary.episode, 101);
  assert.equal(summary.season, null);
  assert.equal(summary.isAnime, true);
});

test('a bare TV pack cannot leak into Movies through a weak title match', async () => {
  const info = guessMediaInfo('American Dad! (2005)');
  const item = {
    source: 'torrent', id: 'synthetic-american-dad', name: 'American Dad! (2005)',
    files: [
      { name: 'American.Dad.S01E01.1080p.mkv' },
      { name: 'American.Dad.S01E02.1080p.mkv' },
    ],
  };
  assert.equal(await isEpisodePackMisreadAsMovie(item, { provider: 'torbox' }, info, {
    id: 655797, title: 'American Dad: The New CIA',
  }), true);
});

test('an exact movie title never pays for ambiguous pack inspection', async () => {
  const info = guessMediaInfo('Spider-Man Brand New Day 2026 1080p WEB-DL');
  assert.equal(await isEpisodePackMisreadAsMovie({
    source: 'torrent', id: 'synthetic-spider-man', name: 'Spider-Man Brand New Day',
  }, { provider: 'torbox' }, info, {
    id: 969681, title: 'Spider-Man: Brand New Day', release_date: '2026-07-31',
  }), false);
});

test('a ranged pack keeps its second episode when only one inner file is listed', () => {
  const parsed = guessMediaInfo('The.Day.Of.The.Jackal.S01E03-04.2160p.NOW.WEB-DL.DDP5.1.H.265-G66.Proper');
  assert.equal(parsed.episode, 3);
  assert.equal(parsed.episodeEnd, 4);
  const summary = summarizePackEpisodes(['The.Day.Of.The.Jackal.S01E03.2160p.NOW.WEB-DL.DDP5.1.H.265-G66.mkv']);
  assert.equal(summary.episode, 3);
  assert.deepEqual(mergePackEpisodeRange(parsed, summary), { episode: 3, episodeEnd: 4 });
  const available = new Set();
  addOwnedEpisodeAvailability(available, { season: parsed.season, ...mergePackEpisodeRange(parsed, summary) });
  assert.equal(available.has('1:3'), true);
  assert.equal(available.has('1:4'), true);
});

test('a ranged pack unions a probe that reveals the later episode', () => {
  const parsed = guessMediaInfo('The.Day.Of.The.Jackal.S01E07-08.2160p.NOW.WEB-DL.ITA-ENG.DDP5');
  const summary = summarizePackEpisodes(['The.Day.Of.The.Jackal.S01E08.2160p.NOW.WEB-DL.ITA-ENG.DDP5.mkv']);
  assert.deepEqual(mergePackEpisodeRange(parsed, summary), { episode: 7, episodeEnd: 8 });
});

test('a probe without an outer range keeps its single episode', () => {
  const parsed = guessMediaInfo('Some.Show.S01E03.2160p.WEB-DL');
  const summary = summarizePackEpisodes(['Some.Show.S01E03.2160p.WEB-DL.mkv']);
  assert.deepEqual(mergePackEpisodeRange(parsed, summary), { episode: 3, episodeEnd: null });
});

test('a season pack misnamed as one episode is widened from its embedded files', () => {
  const files = Array.from({ length: 10 }, (_, i) => ({
    name: `American.Horror.Story.S08E${String(i + 1).padStart(2, '0')}.2160p.HULU.WEB-DL.mkv`,
  }));
  const item = { name: 'American.Horror.Story.S08E07.2160p.HULU.WEB-DL.mkv', files };
  const entry = embeddedPackEntry({ item, season: 8, seasonStart: null, seasonEnd: null, episode: 7, episodeEnd: null });
  assert.equal(entry.season, 8);
  assert.equal(entry.episode, null);
  const available = new Set();
  addOwnedEpisodeAvailability(available, entry);
  assert.equal(available.has('season:8'), true);
});

test('multiple releases of a single episode are not widened', () => {
  const item = { name: 'Show.S03E01.1080p.mkv', files: [{ name: 'Show.S03E01.1080p.mkv' }, { name: 'Show.S03E01.2160p.mkv' }] };
  assert.equal(embeddedPackEntry({ item, season: 3, episode: 1 }).episode, 1);
});

test('an episode plus a sample is not widened', () => {
  const item = { name: 'Show.S03E01.1080p.mkv', files: [{ name: 'Show.S03E01.1080p.mkv' }, { name: 'Sample.mkv' }] };
  assert.equal(embeddedPackEntry({ item, season: 3, episode: 1 }).episode, 1);
});

test('a pack from a different season does not widen the episode', () => {
  const item = { name: 'Show.S01E01.mkv', files: [{ name: 'Show.S02E01.mkv' }, { name: 'Show.S02E02.mkv' }] };
  const entry = embeddedPackEntry({ item, season: 1, episode: 1 });
  assert.equal(entry.season, 1);
  assert.equal(entry.episode, 1);
});

test('an item with no embedded file list is left untouched', () => {
  const entry = embeddedPackEntry({ item: { name: 'American.Horror.Story.S03E01.mkv' }, season: 3, episode: 1 });
  assert.equal(entry.episode, 1);
});
