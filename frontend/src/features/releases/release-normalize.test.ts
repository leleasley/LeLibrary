import { describe, expect, it } from 'vitest';
import {
  normalizeMovieListResponse,
  normalizeDayResponse,
  normalizeSearchResponse,
  normalizeTitleDetail,
  normalizeSeasonEpisodes,
  normalizeWeekResponse,
} from '@/api/releases';
import { normalizeFeatures } from '@/api/features';
import { releaseLabel, relativeDay, relativeWhen, isOutToday, daysUntil, todayIso, addDaysIso } from '@/features/releases/release-format';

describe('releases response normalisation', () => {
  it('normalises a movie list and drops rows without an id or title', () => {
    const result = normalizeMovieListResponse({
      region: 'GB', from: '2026-06-01', to: '2026-06-30', page: 2, pageSize: 24, count: 1, total: 30,
      results: [
        { type: 'movie', id: 101, title: 'Wicked', poster: 'https://image.tmdb.org/t/p/w342/a.jpg', status: 'released', digitalDate: '2026-06-10' },
        { type: 'movie', title: 'No id' },
        { type: 'movie', id: 102 },
        'garbage',
      ],
    });
    expect(result.region).toBe('GB');
    expect(result.page).toBe(2);
    expect(result.total).toBe(30);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.status).toBe('released');
    expect(result.results[0]?.nextEpisode).toBeNull();
  });

  it('coerces an unknown status value to unknown and never invents a date', () => {
    const result = normalizeMovieListResponse({
      results: [{ type: 'movie', id: 1, title: 'Mystery', status: 'released-soon', digitalDate: null }],
    });
    expect(result.results[0]?.status).toBe('unknown');
    expect(result.results[0]?.digitalDate).toBeNull();
  });

  it('normalises the TV day view with grouped episodes and badges', () => {
    const result = normalizeDayResponse({
      region: 'GB', date: '2026-10-07', count: 2,
      shows: [
        {
          type: 'tv', id: 900, title: 'The Show', poster: null, status: 'Returning Series',
          episodes: [
            { id: 5001, season: 2, episode: 1, name: 'Return', airDate: '2026-10-07', badges: { seasonPremiere: true } },
            { id: 5002, season: 2, episode: 2, name: 'Next', airDate: '2026-10-07', badges: {} },
            { id: 5003, season: 2, episode: 3, airDate: 'not-a-date' },
          ],
        },
        { id: 901 },
      ],
    });
    expect(result.shows).toHaveLength(1);
    expect(result.shows[0]?.episodes).toHaveLength(2);
    expect(result.shows[0]?.episodes[0]?.badges.seasonPremiere).toBe(true);
    expect(result.shows[0]?.episodes[1]?.badges.finale).toBe(false);
  });

  it('normalises a search response and defaults an unknown source to tmdb', () => {
    const result = normalizeSearchResponse({
      query: 'wicked', region: 'GB', source: 'weird',
      results: [{ type: 'tv', id: 5, title: 'Show', status: 'upcoming', nextEpisode: { airDate: '2026-12-01', season: 1, episode: 1, name: 'Pilot' } }],
    });
    expect(result.source).toBe('tmdb');
    expect(result.results[0]?.nextEpisode?.airDate).toBe('2026-12-01');
  });

  it('normalises movie vs tv detail and rejects junk', () => {
    expect(normalizeTitleDetail({ type: 'movie', id: 1, title: 'X' })).toMatchObject({ type: 'movie', status: 'unknown' });
    const tv = normalizeTitleDetail({
      type: 'tv', id: 900, title: 'Show',
      seasons: [
        { season: 2, episodes: [{ id: 1, episode: 1, airDate: '2026-01-01', badges: { seriesPremiere: true } }] },
        { season: 1, episodes: [] },
      ],
    });
    expect(tv).toMatchObject({ type: 'tv' });
    if (tv && tv.type === 'tv') {
      expect(tv.seasons.map((season) => season.season)).toEqual([1, 2]);
    }
    expect(normalizeTitleDetail({ type: 'movie', title: 'no id' })).toBeNull();
    expect(normalizeTitleDetail(null)).toBeNull();
  });
});

describe('normalizeFeatures', () => {
  it('reads the releases flag defensively', () => {
    expect(normalizeFeatures({ releases: true })).toEqual({ releases: true, savedSetups: false });
    expect(normalizeFeatures({ releases: 'yes' })).toEqual({ releases: false, savedSetups: false });
    expect(normalizeFeatures(null)).toEqual({ releases: false, savedSetups: false });
  });

  it('reads the self-host saved-setups flag defensively', () => {
    expect(normalizeFeatures({ savedSetups: true })).toEqual({ releases: false, savedSetups: true });
    expect(normalizeFeatures({ savedSetups: 'yes' })).toEqual({ releases: false, savedSetups: false });
  });
});

describe('normalizeWeekResponse', () => {
  it('keeps one entry per day and coerces the counts', () => {
    const result = normalizeWeekResponse({
      region: 'GB', from: '2026-10-12', to: '2026-10-18',
      days: [
        { date: '2026-10-12', total: 22, totalAll: 40, premieres: 3 },
        { date: '2026-10-13', total: '18', premieres: null },
        { date: 'not-a-date', total: 5 },
        'garbage',
      ],
    });
    expect(result.region).toBe('GB');
    expect(result.days.map((day) => day.date)).toEqual(['2026-10-12', '2026-10-13']);
    expect(result.days[0]).toEqual({ date: '2026-10-12', total: 22, premieres: 3 });
    // A malformed count reads as zero rather than NaN reaching the strip.
    expect(result.days[1]).toEqual({ date: '2026-10-13', total: 0, premieres: 0 });
  });

  it('survives a payload that is not a week at all', () => {
    expect(normalizeWeekResponse(null).days).toEqual([]);
    expect(normalizeWeekResponse({ days: 'nope' }).days).toEqual([]);
  });
});

describe('release status labels', () => {
  const today = todayIso();

  it('treats the past as Released', () => {
    expect(releaseLabel('released', addDaysIso(today, -3))).toBe('Released');
  });

  it('names a title that is out today, whatever its status', () => {
    expect(releaseLabel('releasing_today', today)).toBe('Out today');
    expect(releaseLabel('released', today)).toBe('Out today');
    expect(releaseLabel('upcoming', today)).toBe('Out today');
  });

  it('isOutToday follows the date, not just the status', () => {
    expect(isOutToday('released', today)).toBe(true);
    expect(isOutToday('releasing_today', null)).toBe(true);
    expect(isOutToday('released', addDaysIso(today, -1))).toBe(false);
    expect(isOutToday('upcoming', addDaysIso(today, 1))).toBe(false);
    expect(isOutToday('unknown', null)).toBe(false);
  });

  it('spells out the near future', () => {
    expect(releaseLabel('upcoming', addDaysIso(today, 1))).toBe('Releasing tomorrow');
    expect(releaseLabel('upcoming', addDaysIso(today, 3))).toBe('Releasing in 3 days');
    expect(releaseLabel('upcoming', addDaysIso(today, 13))).toBe('Releasing in 13 days');
    expect(releaseLabel('upcoming', addDaysIso(today, 40))).toBe('Upcoming');
  });

  it('reports unknown and missing dates without inventing one', () => {
    expect(releaseLabel('unknown', null)).toBe('Date unknown');
    expect(releaseLabel('upcoming', null)).toBe('Upcoming');
    expect(releaseLabel('released', null)).toBe('Released');
  });

  it('daysUntil and relativeDay are calendar based', () => {
    expect(daysUntil('2026-06-15', '2026-06-14')).toBe(1);
    expect(daysUntil('2026-06-14', '2026-06-15')).toBe(-1);
    expect(relativeDay('2026-06-15')).toMatch(/in \d+ days|today|tomorrow|ago|^$/);
  });

  it('relativeWhen is the card-ready form of relativeDay', () => {
    expect(relativeWhen(today)).toBe('Today');
    expect(relativeWhen(addDaysIso(today, 1))).toBe('Tomorrow');
    expect(relativeWhen(addDaysIso(today, -1))).toBe('Yesterday');
    expect(relativeWhen(addDaysIso(today, 3))).toBe('In 3 days');
    expect(relativeWhen(addDaysIso(today, -4))).toBe('4 days ago');
    // Far dates and missing dates carry no hint rather than a misleading one.
    expect(relativeWhen(addDaysIso(today, 200))).toBe('');
    expect(relativeWhen(null)).toBe('');
  });
});

describe('search results and seasons', () => {
  it('keeps the baseline date and enrichment flag on search results', () => {
    const result = normalizeSearchResponse({
      query: 'doctor who', region: 'GB', source: 'tmdb',
      results: [
        { type: 'tv', id: 57243, title: 'Doctor Who', firstAirDate: '2005-03-26', status: 'released', date: '2005-03-26', enriched: false },
        { type: 'movie', id: 967941, title: 'Wicked: For Good', releaseDate: '2025-11-19', status: 'upcoming', date: '2025-11-19', enriched: true },
      ],
    });
    expect(result.results[0]?.date).toBe('2005-03-26');
    expect(result.results[0]?.enriched).toBe(false);
    expect(result.results[1]?.date).toBe('2025-11-19');
    expect(result.results[1]?.enriched).toBe(true);
  });

  it('normalises a tv detail seasons list without episodes', () => {
    const detail = normalizeTitleDetail({
      type: 'tv', id: 456, title: 'The Simpsons',
      seasons: [
        { season: 0, name: 'Specials', airDate: null, episodeCount: 4, isSpecials: true },
        { season: 1, name: 'Season 1', airDate: '1989-12-17', episodeCount: 13, isSpecials: false, episodesFetched: true },
      ],
    });
    expect(detail).toMatchObject({ type: 'tv' });
    if (detail && detail.type === 'tv') {
      expect(detail.seasons.map((season) => season.season)).toEqual([1, 0]);
      expect(detail.seasons[1]?.isSpecials).toBe(true);
      expect(detail.seasons[0]?.airDate).toBe('1989-12-17');
    }
  });

  it('normalises lazy season episodes and drops junk', () => {
    const season = normalizeSeasonEpisodes({
      showId: 456, season: 1, count: 2, fetched: true,
      episodes: [
        { id: 1, season: 1, episode: 1, name: 'Pilot', airDate: '1989-12-17', runtime: 23, status: 'released', badges: { seriesPremiere: true } },
        { id: 2, season: 1, episode: 2, airDate: 'not-a-date' },
        'garbage',
      ],
    });
    expect(season.episodes).toHaveLength(2);
    expect(season.episodes[0]?.badges.seriesPremiere).toBe(true);
    expect(season.episodes[0]?.runtime).toBe(23);
    // A malformed date is treated as unknown, and the string entry is dropped.
    expect(season.episodes[1]?.airDate).toBeNull();
    expect(season.episodes[1]?.status).toBe('unknown');
  });

  it('marks a null episode date unknown', () => {
    const season = normalizeSeasonEpisodes({
      showId: 1, season: 3, count: 1, fetched: true,
      episodes: [{ id: 9, season: 3, episode: 1, name: 'TBA', airDate: null, runtime: null, status: 'unknown', badges: {} }],
    });
    expect(season.episodes[0]?.airDate).toBeNull();
    expect(season.episodes[0]?.status).toBe('unknown');
  });

  it('normalises day facets, totals and premiere flag', () => {
    const day = normalizeDayResponse({
      region: 'GB', date: '2026-10-08', sort: 'name', notable: true, language: 'en', types: ['Scripted'],
      total: 3, totalAll: 9,
      facets: { types: { Scripted: 5, Reality: 4 }, languages: { en: 9 } },
      shows: [{ type: 'tv', id: 1, title: 'X', premiereDay: true, showType: 'Scripted', language: 'en', popularity: 12, episodes: [] }],
    });
    expect(day.total).toBe(3);
    expect(day.totalAll).toBe(9);
    expect(day.sort).toBe('name');
    expect(day.facets.types.Scripted).toBe(5);
    expect(day.facets.languages.en).toBe(9);
    expect(day.shows[0]?.premiereDay).toBe(true);
    expect(day.shows[0]?.showType).toBe('Scripted');
  });
});
