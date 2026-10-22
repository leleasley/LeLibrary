// Pure release-status and badge derivations. These are the rules the API and
// the frontend must agree on, so they live in one place and are unit-tested.
//
// TMDB digital release dates are community-contributed and frequently missing.
// A missing date is ALWAYS "unknown", never "released".
export type MovieStatus = 'released' | 'releasing_today' | 'upcoming' | 'unknown';

export interface ReleaseDateSet {
  digital: string | null;
  theatrical: string | null;
  physical: string | null;
}

const UNKNOWN_DATES: ReleaseDateSet = { digital: null, theatrical: null, physical: null };

// This is a DIGITAL-releases browser, so the digital date is authoritative: a
// title can be out in cinemas but still "upcoming" until its digital release.
// A digital date today or in the past counts as released. Only when there is no
// digital date at all do we fall back to the earliest physical/cinema date.
// A missing date is always "unknown".
function deriveMovieStatus(dates: ReleaseDateSet, today: string): MovieStatus {
  const digital = dates.digital;
  if (digital) return digital <= today ? 'released' : 'upcoming';
  const known = [dates.theatrical, dates.physical]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (known.length === 0) return 'unknown';
  return known.some((date) => date <= today) ? 'released' : 'upcoming';
}

export interface TmdbReleaseEntry {
  type?: number;
  release_date?: string;
}

export interface TmdbRegionReleaseDates {
  iso_3166_1?: string;
  release_dates?: TmdbReleaseEntry[];
}

function earliest(current: string | null, candidate: string): string | null {
  const value = candidate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return current;
  if (!current) return value;
  return value < current ? value : current;
}

// TMDB /movie/{id}/release_dates returns every country. Prefer the requested
// region, then US, then the first country with any dates.
function pickRegionDates(results: unknown, region: string): ReleaseDateSet {
  if (!Array.isArray(results) || results.length === 0) return { ...UNKNOWN_DATES };
  const list = results as TmdbRegionReleaseDates[];
  const chosen = list.find((entry) => entry && entry.iso_3166_1 === region)
    || list.find((entry) => entry && entry.iso_3166_1 === 'US')
    || list[0];
  const out: ReleaseDateSet = { ...UNKNOWN_DATES };
  if (!chosen || !Array.isArray(chosen.release_dates)) return out;
  for (const release of chosen.release_dates) {
    if (!release || typeof release.type !== 'number' || typeof release.release_date !== 'string') continue;
    if (release.type === 4) out.digital = earliest(out.digital, release.release_date);
    if (release.type === 3 || release.type === 2) out.theatrical = earliest(out.theatrical, release.release_date);
    if (release.type === 5) out.physical = earliest(out.physical, release.release_date);
  }
  return out;
}

export interface EpisodeBadgeInput {
  season: number;
  episode: number;
  /** Episode equals TMDB's last_episode_to_air for the whole show. */
  isLastEpisodeOfSeries?: boolean;
  /** Show status is Ended or Canceled. */
  showEnded?: boolean;
}

export interface EpisodeBadges {
  seriesPremiere: boolean;
  seasonPremiere: boolean;
  finale: boolean;
}

// Premiere badges are structural (S1E1 / Ex01). A finale is only claimed when
// the episode is TMDB's final episode for an ended/cancelled show; mid-run
// season finales are deliberately not marked.
function deriveEpisodeBadges(input: EpisodeBadgeInput): EpisodeBadges {
  const season = Number(input.season);
  const episode = Number(input.episode);
  const seriesPremiere = season === 1 && episode === 1;
  const seasonPremiere = season > 1 && episode === 1;
  const finale = !!(input.isLastEpisodeOfSeries && input.showEnded);
  return { seriesPremiere, seasonPremiere, finale };
}

export interface NextEpisode {
  airDate: string | null;
  season: number | null;
  episode: number | null;
  name: string | null;
}

// Build the "next episode" summary from a TMDB /tv/{id} payload. Returns null
// when TMDB has no next episode (finished/unknown schedule).
function pickNextEpisode(detail: unknown): NextEpisode | null {
  if (!detail || typeof detail !== 'object') return null;
  const next = (detail as Record<string, unknown>)['next_episode_to_air'];
  if (!next || typeof next !== 'object') return null;
  const record = next as Record<string, unknown>;
  const airDate = typeof record['air_date'] === 'string' ? record['air_date'].slice(0, 10) : null;
  if (!airDate) return null;
  return {
    airDate,
    season: typeof record['season_number'] === 'number' ? record['season_number'] : null,
    episode: typeof record['episode_number'] === 'number' ? record['episode_number'] : null,
    name: typeof record['name'] === 'string' ? record['name'] : null,
  };
}

// TV "has it been released" for search/title results: released once any episode
// has aired, upcoming when the next episode is in the future, unknown when TMDB
// gives no air dates at all.
function deriveTvStatus(nextAirDate: string | null, lastAirDate: string | null, today: string): MovieStatus {
  if (lastAirDate && lastAirDate <= today) return 'released';
  if (nextAirDate && nextAirDate <= today) return 'released';
  if (nextAirDate) return 'upcoming';
  return 'unknown';
}

// Baseline status from a single display date (search payload release_date /
// first_air_date). Null date is unknown, never released.
function deriveStatusFromDate(date: string | null, today: string): MovieStatus {
  if (!date) return 'unknown';
  return date <= today ? 'released' : 'upcoming';
}

module.exports = {
  UNKNOWN_DATES,
  deriveMovieStatus,
  deriveStatusFromDate,
  pickRegionDates,
  deriveEpisodeBadges,
  pickNextEpisode,
  deriveTvStatus,
};
