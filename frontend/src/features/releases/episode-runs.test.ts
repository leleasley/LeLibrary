import { describe, expect, it } from 'vitest';
import type { DayEpisode } from '@/api/releases';
import { episodeCode, episodeLines } from '@/features/releases/episode-runs';

const ep = (season: number, episode: number, badges: Partial<DayEpisode['badges']> = {}): DayEpisode => ({
  id: season * 100 + episode, season, episode, name: `Episode ${episode}`, airDate: '2026-10-20',
  badges: { seriesPremiere: false, seasonPremiere: false, finale: false, ...badges },
});

describe('episodeLines', () => {
  it('collapses a binge drop into one run and keeps its badges', () => {
    const lines = episodeLines([1, 2, 3, 4, 5, 6, 7].map((n) => ep(2, n, { seasonPremiere: n === 1, finale: n === 7 })));
    expect(lines).toHaveLength(1);
    expect(episodeCode(lines[0]!)).toBe('S2E1–E7');
    expect(lines[0]).toMatchObject({ kind: 'run', count: 7, badges: { seasonPremiere: true, finale: true } });
  });

  it('keeps one or two episodes as separate rows', () => {
    const lines = episodeLines([ep(1, 4), ep(1, 5)]);
    expect(lines.map(episodeCode)).toEqual(['S1E4', 'S1E5']);
  });

  it('only joins consecutive episodes of the same season', () => {
    const lines = episodeLines([ep(1, 1), ep(1, 2), ep(1, 3), ep(1, 7), ep(2, 1)]);
    expect(lines.map(episodeCode)).toEqual(['S1E1–E3', 'S1E7', 'S2E1']);
  });
});
