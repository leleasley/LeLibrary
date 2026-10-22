import type { DayEpisode, EpisodeBadges } from '@/api/releases';

// A whole season dropped in one day reads as one line, not seven. Consecutive
// episodes of the same season collapse into a run once there are at least
// MIN_RUN of them; shorter groups keep one row per episode (with titles).
// A run keeps every badge any of its episodes had.
export const MIN_RUN = 3;

export type EpisodeLine =
  | { kind: 'single'; episode: DayEpisode }
  | { kind: 'run'; season: number; from: number; to: number; count: number; badges: EpisodeBadges };

export function episodeLines(episodes: DayEpisode[]): EpisodeLine[] {
  const sorted = [...episodes].sort((a, b) => a.season - b.season || a.episode - b.episode);
  const lines: EpisodeLine[] = [];
  let run: DayEpisode[] = [];
  const flush = () => {
    if (run.length >= MIN_RUN) {
      const first = run[0]!;
      const last = run[run.length - 1]!;
      lines.push({
        kind: 'run', season: first.season, from: first.episode, to: last.episode, count: run.length,
        badges: {
          seriesPremiere: run.some((e) => e.badges.seriesPremiere),
          seasonPremiere: run.some((e) => e.badges.seasonPremiere),
          finale: run.some((e) => e.badges.finale),
        },
      });
    } else {
      for (const episode of run) lines.push({ kind: 'single', episode });
    }
    run = [];
  };
  for (const episode of sorted) {
    const prev = run[run.length - 1];
    if (prev && (episode.season !== prev.season || episode.episode !== prev.episode + 1)) flush();
    run.push(episode);
  }
  flush();
  return lines;
}

export function episodeCode(line: EpisodeLine): string {
  return line.kind === 'single'
    ? `S${line.episode.season}E${line.episode.episode}`
    : `S${line.season}E${line.from}–E${line.to}`;
}
