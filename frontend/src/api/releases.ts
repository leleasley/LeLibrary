import { apiClient } from '@/api/client';

// Typed Releases client. Response JSON is untrusted: every shape is normalised
// before it reaches a component. No API key or TMDB credential ever reaches the
// browser; the server owns the shared TMDB key.
export type ReleaseStatus = 'released' | 'releasing_today' | 'upcoming' | 'unknown';
export type ReleaseMediaType = 'movie' | 'tv';

export interface EpisodeBadges {
  seriesPremiere: boolean;
  seasonPremiere: boolean;
  finale: boolean;
}

export interface NextEpisode {
  airDate: string | null;
  season: number | null;
  episode: number | null;
  name: string | null;
}

export interface ReleaseListItem {
  type: ReleaseMediaType;
  id: number;
  title: string;
  poster: string | null;
  backdrop: string | null;
  genres: string[];
  year: number | null;
  status: ReleaseStatus;
  /** Primary display date (movie digital/release, tv next/first air). */
  date: string | null;
  releaseDate: string | null;
  digitalDate: string | null;
  theatricalDate: string | null;
  physicalDate: string | null;
  firstAirDate: string | null;
  nextEpisode: NextEpisode | null;
  enriched: boolean;
}

export interface MovieListResponse {
  region: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
  count: number;
  total: number;
  results: ReleaseListItem[];
}

export interface DayEpisode {
  id: number;
  season: number;
  episode: number;
  name: string | null;
  airDate: string;
  badges: EpisodeBadges;
}

export interface DayShow {
  type: 'tv';
  id: number;
  title: string;
  poster: string | null;
  status: string | null;
  network: string | null;
  popularity: number | null;
  showType: string | null;
  language: string | null;
  premiereDay: boolean;
  episodes: DayEpisode[];
}

export interface DayFacets {
  types: Record<string, number>;
  languages: Record<string, number>;
}

export interface DayResponse {
  region: string;
  date: string;
  sort: 'popularity' | 'name';
  notable: boolean;
  language: string | null;
  types: string[];
  total: number;
  totalAll: number;
  facets: DayFacets;
  shows: DayShow[];
}

/** One cell of the week strip: how many shows air, and how many are notable. */
export interface WeekDay {
  date: string;
  total: number;
  premieres: number;
}

export interface WeekResponse {
  region: string;
  from: string;
  to: string;
  days: WeekDay[];
}

export type SearchSource = 'cache' | 'local' | 'tmdb';export interface SearchResponse {
  query: string;
  region: string;
  source: SearchSource;
  results: ReleaseListItem[];
}

export interface SeasonSummary {
  season: number;
  name: string | null;
  airDate: string | null;
  episodeCount: number | null;
  poster: string | null;
  overview: string | null;
  isSpecials: boolean;
  episodesFetched: boolean;
}

export interface EpisodeSummary {
  id: number;
  season: number;
  episode: number;
  name: string | null;
  airDate: string | null;
  runtime: number | null;
  status: ReleaseStatus;
  badges: EpisodeBadges;
}

export interface SeasonEpisodesResponse {
  showId: number;
  season: number;
  count: number;
  fetched: boolean;
  stale?: boolean;
  error?: string;
  episodes: EpisodeSummary[];
}

export interface MovieDetail {
  type: 'movie';
  id: number;
  title: string;
  overview: string | null;
  poster: string | null;
  backdrop: string | null;
  genres: string[];
  year: number | null;
  status: ReleaseStatus;
  date: string | null;
  releaseDate: string | null;
  digitalDate: string | null;
  theatricalDate: string | null;
  physicalDate: string | null;
  region: string;
}

export interface TvDetail {
  type: 'tv';
  id: number;
  title: string;
  overview: string | null;
  poster: string | null;
  backdrop: string | null;
  genres: string[];
  year: number | null;
  status: ReleaseStatus;
  date: string | null;
  firstAirDate: string | null;
  nextEpisode: NextEpisode | null;
  lastEpisode: NextEpisode | null;
  showStatus: string | null;
  numberOfSeasons: number | null;
  episodeRunTime: number | null;
  networks: string[];
  seasons: SeasonSummary[];
  region: string;
}

export type TitleDetail = MovieDetail | TvDetail;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : value;
}

function asStatus(value: unknown): ReleaseStatus {
  return value === 'released' || value === 'releasing_today' || value === 'upcoming' || value === 'unknown'
    ? value
    : 'unknown';
}

function normalizeBadges(value: unknown): EpisodeBadges {
  const record = asRecord(value);
  return {
    seriesPremiere: record['seriesPremiere'] === true,
    seasonPremiere: record['seasonPremiere'] === true,
    finale: record['finale'] === true,
  };
}

function normalizeNextEpisode(value: unknown): NextEpisode | null {
  const record = asRecord(value);
  const airDate = asString(record['airDate']);
  if (!airDate) return null;
  return {
    airDate,
    season: asNumber(record['season']),
    episode: asNumber(record['episode']),
    name: asString(record['name']),
  };
}

function normalizeListItem(value: unknown): ReleaseListItem | null {
  const record = asRecord(value);
  const type = record['type'] === 'tv' ? 'tv' : record['type'] === 'movie' ? 'movie' : null;
  const id = asNumber(record['id']);
  const title = asString(record['title']);
  if (!type || id === null || !title) return null;
  return {
    type,
    id,
    title,
    poster: asString(record['poster']),
    backdrop: asString(record['backdrop']),
    genres: asStringArray(record['genres']),
    year: asNumber(record['year']),
    status: asStatus(record['status']),
    date: asIsoDate(record['date']),
    releaseDate: asIsoDate(record['releaseDate']),
    digitalDate: asIsoDate(record['digitalDate']),
    theatricalDate: asIsoDate(record['theatricalDate']),
    physicalDate: asIsoDate(record['physicalDate']),
    firstAirDate: asIsoDate(record['firstAirDate']),
    nextEpisode: normalizeNextEpisode(record['nextEpisode']),
    enriched: record['enriched'] === true,
  };
}

export function normalizeMovieListResponse(payload: unknown): MovieListResponse {
  const record = asRecord(payload);
  const rawResults = Array.isArray(record['results']) ? record['results'] : [];
  const results = rawResults.flatMap((item) => {
    const normalized = normalizeListItem(item);
    return normalized ? [normalized] : [];
  });
  return {
    region: asString(record['region']) ?? '',
    from: asString(record['from']) ?? '',
    to: asString(record['to']) ?? '',
    page: asNumber(record['page']) ?? 1,
    pageSize: asNumber(record['pageSize']) ?? 24,
    count: asNumber(record['count']) ?? results.length,
    total: asNumber(record['total']) ?? results.length,
    results,
  };
}

function asCountMap(value: unknown): Record<string, number> {
  const record = asRecord(value);
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(record)) {
    const count = asNumber(raw);
    if (count !== null) out[key] = count;
  }
  return out;
}

export function normalizeDayResponse(payload: unknown): DayResponse {
  const record = asRecord(payload);
  const rawShows = Array.isArray(record['shows']) ? record['shows'] : [];
  const shows = rawShows.flatMap((entry): DayShow[] => {
    const show = asRecord(entry);
    const id = asNumber(show['id']);
    const title = asString(show['title']);
    if (id === null || !title) return [];
    const rawEpisodes = Array.isArray(show['episodes']) ? show['episodes'] : [];
    const episodes = rawEpisodes.flatMap((episodeEntry): DayEpisode[] => {
      const episode = asRecord(episodeEntry);
      const episodeId = asNumber(episode['id']);
      const airDate = asIsoDate(episode['airDate']);
      const season = asNumber(episode['season']);
      const number = asNumber(episode['episode']);
      if (episodeId === null || !airDate || season === null || number === null) return [];
      return [{
        id: episodeId,
        season,
        episode: number,
        name: asString(episode['name']),
        airDate,
        badges: normalizeBadges(episode['badges']),
      }];
    });
    return [{
      type: 'tv',
      id,
      title,
      poster: asString(show['poster']),
      status: asString(show['status']),
      network: asString(show['network']),
      popularity: asNumber(show['popularity']),
      showType: asString(show['showType']),
      language: asString(show['language']),
      premiereDay: show['premiereDay'] === true,
      episodes,
    }];
  });
  const rawFacets = asRecord(record['facets']);
  const types = Array.isArray(record['types']) ? record['types'].filter((value): value is string => typeof value === 'string') : [];
  return {
    region: asString(record['region']) ?? '',
    date: asString(record['date']) ?? '',
    sort: record['sort'] === 'name' ? 'name' : 'popularity',
    notable: record['notable'] === true,
    language: asString(record['language']),
    types,
    total: asNumber(record['total']) ?? shows.length,
    totalAll: asNumber(record['totalAll']) ?? shows.length,
    facets: { types: asCountMap(rawFacets['types']), languages: asCountMap(rawFacets['languages']) },
    shows,
  };
}

// The week strip is decoration over a real list, so it degrades to fewer cells
// rather than failing: junk rows are dropped and bad counts read as zero.
export function normalizeWeekResponse(payload: unknown): WeekResponse {
  const record = asRecord(payload);
  const rawDays = Array.isArray(record['days']) ? record['days'] : [];
  const days = rawDays.flatMap((entry): WeekDay[] => {
    const day = asRecord(entry);
    const date = asIsoDate(day['date']);
    if (!date) return [];
    return [{
      date,
      total: asNumber(day['total']) ?? 0,
      premieres: asNumber(day['premieres']) ?? 0,
    }];
  });
  return {
    region: asString(record['region']) ?? '',
    from: asIsoDate(record['from']) ?? '',
    to: asIsoDate(record['to']) ?? '',
    days,
  };
}

export function normalizeSearchResponse(payload: unknown): SearchResponse {
  const record = asRecord(payload);
  const rawResults = Array.isArray(record['results']) ? record['results'] : [];
  const results = rawResults.flatMap((item) => {
    const normalized = normalizeListItem(item);
    return normalized ? [normalized] : [];
  });
  const source = record['source'] === 'cache' || record['source'] === 'local' ? record['source'] : 'tmdb';
  return {
    query: asString(record['query']) ?? '',
    region: asString(record['region']) ?? '',
    source,
    results,
  };
}

export function normalizeTitleDetail(payload: unknown): TitleDetail | null {
  const record = asRecord(payload);
  const id = asNumber(record['id']);
  const title = asString(record['title']);
  if (id === null || !title) return null;
  if (record['type'] === 'movie') {
    return {
      type: 'movie',
      id,
      title,
      overview: asString(record['overview']),
      poster: asString(record['poster']),
      backdrop: asString(record['backdrop']),
      genres: asStringArray(record['genres']),
      year: asNumber(record['year']),
      status: asStatus(record['status']),
      date: asIsoDate(record['date']),
      releaseDate: asIsoDate(record['releaseDate']),
      digitalDate: asIsoDate(record['digitalDate']),
      theatricalDate: asIsoDate(record['theatricalDate']),
      physicalDate: asIsoDate(record['physicalDate']),
      region: asString(record['region']) ?? '',
    };
  }
  if (record['type'] !== 'tv') return null;
  const rawSeasons = Array.isArray(record['seasons']) ? record['seasons'] : [];
  const seasons = rawSeasons.flatMap((entry): SeasonSummary[] => {
    const season = asRecord(entry);
    const number = asNumber(season['season']);
    if (number === null) return [];
    return [{
      season: number,
      name: asString(season['name']),
      airDate: asIsoDate(season['airDate']),
      episodeCount: asNumber(season['episodeCount']),
      poster: asString(season['poster']),
      overview: asString(season['overview']),
      isSpecials: season['isSpecials'] === true,
      episodesFetched: season['episodesFetched'] === true,
    }];
  });
  return {
    type: 'tv',
    id,
    title,
    overview: asString(record['overview']),
    poster: asString(record['poster']),
    backdrop: asString(record['backdrop']),
    genres: asStringArray(record['genres']),
    year: asNumber(record['year']),
    status: asStatus(record['status']),
    date: asIsoDate(record['date']),
    firstAirDate: asIsoDate(record['firstAirDate']),
    nextEpisode: normalizeNextEpisode(record['nextEpisode']),
    lastEpisode: normalizeNextEpisode(record['lastEpisode']),
    showStatus: asString(record['showStatus']),
    numberOfSeasons: asNumber(record['numberOfSeasons']),
    episodeRunTime: asNumber(record['episodeRunTime']),
    networks: asStringArray(record['networks']),
    seasons: seasons.sort((a, b) => (Number(a.isSpecials) - Number(b.isSpecials)) || (a.season - b.season)),
    region: asString(record['region']) ?? '',
  };
}

export function normalizeSeasonEpisodes(payload: unknown): SeasonEpisodesResponse {
  const record = asRecord(payload);
  const rawEpisodes = Array.isArray(record['episodes']) ? record['episodes'] : [];
  const episodes = rawEpisodes.flatMap((entry): EpisodeSummary[] => {
    const episode = asRecord(entry);
    const id = asNumber(episode['id']);
    const number = asNumber(episode['episode']);
    const season = asNumber(episode['season']);
    if (id === null || number === null || season === null) return [];
    return [{
      id,
      season,
      episode: number,
      name: asString(episode['name']),
      airDate: asIsoDate(episode['airDate']),
      runtime: asNumber(episode['runtime']),
      status: asStatus(episode['status']),
      badges: normalizeBadges(episode['badges']),
    }];
  });
  return {
    showId: asNumber(record['showId']) ?? 0,
    season: asNumber(record['season']) ?? 0,
    count: asNumber(record['count']) ?? episodes.length,
    fetched: record['fetched'] !== false,
    ...(record['stale'] === true ? { stale: true } : {}),
    ...(asString(record['error']) ? { error: asString(record['error']) as string } : {}),
    episodes,
  };
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

export async function fetchMovies(
  input: { region: string; from: string; to: string; page: number; signal?: AbortSignal },
): Promise<MovieListResponse> {
  const suffix = query({ region: input.region, from: input.from, to: input.to, page: input.page });
  const payload = await apiClient.get<unknown>(`/api/releases/movies${suffix}`, input.signal ? { signal: input.signal } : {});
  return normalizeMovieListResponse(payload);
}

export interface DayQuery {
  region: string;
  date: string;
  sort?: 'popularity' | 'name';
  language?: string | null;
  types?: string[];
  notable?: boolean;
  signal?: AbortSignal;
}

export async function fetchDay(input: DayQuery): Promise<DayResponse> {
  const suffix = query({
    region: input.region,
    date: input.date,
    sort: input.sort,
    language: input.language ?? undefined,
    type: input.types && input.types.length ? input.types.join(',') : undefined,
    notable: input.notable === undefined ? undefined : (input.notable ? 'true' : 'false'),
  });
  const payload = await apiClient.get<unknown>(`/api/releases/tv/day${suffix}`, input.signal ? { signal: input.signal } : {});
  return normalizeDayResponse(payload);
}

// Counts for the strip. It shares the day view's filters so the numbers beside
// a day always match the list that day will show.
export async function fetchWeek(input: {
  region: string;
  from: string;
  days: number;
  language?: string | null;
  types?: string[];
  notable?: boolean;
  signal?: AbortSignal;
}): Promise<WeekResponse> {
  const suffix = query({
    region: input.region,
    from: input.from,
    days: input.days,
    language: input.language ?? undefined,
    type: input.types && input.types.length ? input.types.join(',') : undefined,
    notable: input.notable === undefined ? undefined : (input.notable ? 'true' : 'false'),
  });
  const payload = await apiClient.get<unknown>(`/api/releases/tv/week${suffix}`, input.signal ? { signal: input.signal } : {});
  return normalizeWeekResponse(payload);
}

export async function fetchSearch(
  input: { region: string; q: string; signal?: AbortSignal },
): Promise<SearchResponse> {
  const suffix = query({ region: input.region, q: input.q });
  const payload = await apiClient.get<unknown>(`/api/releases/search${suffix}`, input.signal ? { signal: input.signal } : {});
  return normalizeSearchResponse(payload);
}

export async function fetchTitle(
  input: { region: string; type: ReleaseMediaType; id: number; signal?: AbortSignal },
): Promise<TitleDetail | null> {
  const suffix = query({ region: input.region });
  const payload = await apiClient.get<unknown>(`/api/releases/title/${input.type}/${input.id}${suffix}`, input.signal ? { signal: input.signal } : {});
  return normalizeTitleDetail(payload);
}

export async function fetchSeasonEpisodes(
  input: { id: number; season: number; signal?: AbortSignal },
): Promise<SeasonEpisodesResponse> {
  const payload = await apiClient.get<unknown>(`/api/releases/title/tv/${input.id}/season/${input.season}`, input.signal ? { signal: input.signal } : {});
  return normalizeSeasonEpisodes(payload);
}

export interface ReleasesConfig {
  regions: string[];
  windowPastDays: number;
  windowFutureDays: number;
  maxRangeDays: number;
}

export function normalizeReleasesConfig(payload: unknown): ReleasesConfig {
  const record = asRecord(payload);
  const regions = Array.isArray(record['regions'])
    ? record['regions'].filter((value): value is string => typeof value === 'string')
    : [];
  return {
    regions: regions.length ? regions : ['GB', 'US'],
    windowPastDays: asNumber(record['windowPastDays']) ?? 7,
    windowFutureDays: asNumber(record['windowFutureDays']) ?? 14,
    maxRangeDays: asNumber(record['maxRangeDays']) ?? 92,
  };
}

// The background sync only caches a rolling window, so the browser bounds its
// date pickers to that window rather than offering empty ranges.
export async function fetchReleasesConfig(signal?: AbortSignal): Promise<ReleasesConfig> {
  const payload = await apiClient.get<unknown>('/api/releases/config', signal ? { signal } : {});
  return normalizeReleasesConfig(payload);
}
