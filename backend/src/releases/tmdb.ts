// Server-side TMDB client for the hosted Releases feature.
//
// The key is a shared, server-only credential: it is never accepted from a
// user, never returned to the browser and never logged. Requests are bounded
// by retry-with-backoff on 429/5xx, honouring Retry-After. The HTTP transport
// is injectable so tests exercise backoff and error handling with no network.
const axios = require('axios');

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

export interface TmdbTransportResponse {
  status: number;
  headers?: Record<string, unknown>;
  data: any;
}

export type TmdbTransport = (
  path: string,
  params: Record<string, string | number>,
) => Promise<TmdbTransportResponse>;

export interface TmdbClientDeps {
  apiKey: string;
  transport?: TmdbTransport;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  baseUrl?: string;
}

export interface TmdbClient {
  request: (path: string, params?: Record<string, string | number>) => Promise<any>;
  discoverMovies: (opts: { region: string; from: string; to: string; page?: number }) => Promise<any>;
  movieReleaseDates: (id: number) => Promise<any>;
  movieDetail: (id: number) => Promise<any>;
  discoverTv: (opts: { from: string; to: string; page?: number }) => Promise<any>;
  airingToday: (opts?: { page?: number }) => Promise<any>;
  onTheAir: (opts?: { page?: number }) => Promise<any>;
  tvDetail: (id: number) => Promise<any>;
  tvSeason: (id: number, season: number) => Promise<any>;
  searchMulti: (query: string, page?: number) => Promise<any>;
  calls: () => number;
  resetCalls: () => void;
}

// Retry-After is either a whole number of seconds or an HTTP date.
function parseRetryAfter(header: unknown): number | null {
  if (header === undefined || header === null) return null;
  const raw = Array.isArray(header) ? header[0] : header;
  const value = String(raw).trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Math.min(Number(value), 120);
  const when = Date.parse(value);
  if (Number.isNaN(when)) return null;
  const seconds = Math.ceil((when - Date.now()) / 1000);
  if (seconds <= 0) return 0;
  return Math.min(seconds, 120);
}

function backoffDelay(
  attempt: number,
  retryAfterSeconds: number | null,
  baseMs = 500,
  maxMs = 15000,
): number {
  if (retryAfterSeconds !== null) return Math.min(retryAfterSeconds * 1000, maxMs);
  const exponent = Math.max(0, attempt);
  return Math.min(baseMs * 2 ** exponent, maxMs);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function defaultTransport(baseUrl: string): TmdbTransport {
  return async (path, params) => {
    const response = await axios.get(`${baseUrl}${path}`, {
      params,
      timeout: 15000,
      validateStatus: () => true,
    });
    return { status: response.status, headers: response.headers, data: response.data };
  };
}

function createTmdbClient(deps: TmdbClientDeps): TmdbClient {
  const apiKey = String(deps.apiKey || '').trim();
  if (!apiKey) throw new Error('createTmdbClient requires an API key');
  const baseUrl = deps.baseUrl || TMDB_BASE_URL;
  const transport = deps.transport || defaultTransport(baseUrl);
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxRetries = typeof deps.maxRetries === 'number' ? deps.maxRetries : 4;
  let callCount = 0;

  async function request(path: string, params: Record<string, string | number> = {}): Promise<any> {
    const query: Record<string, string | number> = { ...params, api_key: apiKey };
    let attempt = 0;
    for (;;) {
      callCount++;
      let response: TmdbTransportResponse;
      try {
        response = await transport(path, query);
      } catch (error) {
        if (attempt >= maxRetries) throw error;
        await sleep(backoffDelay(attempt, null));
        attempt++;
        continue;
      }
      if (response.status >= 200 && response.status < 300) return response.data;
      if (attempt < maxRetries && isRetryableStatus(response.status)) {
        const retryAfter = parseRetryAfter(response.headers && response.headers['retry-after']);
        await sleep(backoffDelay(attempt, retryAfter));
        attempt++;
        continue;
      }
      const message = (response.data && response.data.status_message)
        || `TMDB request failed (${response.status})`;
      const error = new Error(message) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
  }

  return {
    request,
    discoverMovies: ({ region, from, to, page = 1 }) => request('/discover/movie', {
      with_release_type: 4,
      region,
      'release_date.gte': from,
      'release_date.lte': to,
      sort_by: 'primary_release_date.asc',
      include_adult: 'false',
      page,
    }),
    movieReleaseDates: (id: number) => request(`/movie/${id}/release_dates`),
    movieDetail: (id: number) => request(`/movie/${id}`),
    discoverTv: ({ from, to, page = 1 }) => request('/discover/tv', {
      'air_date.gte': from,
      'air_date.lte': to,
      sort_by: 'popularity.desc',
      include_adult: 'false',
      page,
    }),
    airingToday: ({ page = 1 } = {}) => request('/tv/airing_today', { page }),
    onTheAir: ({ page = 1 } = {}) => request('/tv/on_the_air', { page }),
    tvDetail: (id: number) => request(`/tv/${id}`),
    tvSeason: (id: number, season: number) => request(`/tv/${id}/season/${season}`),
    searchMulti: (query: string, page = 1) => request('/search/multi', {
      query,
      include_adult: 'false',
      page,
    }),
    calls: () => callCount,
    resetCalls: () => { callCount = 0; },
  };
}

module.exports = {
  TMDB_BASE_URL,
  createTmdbClient,
  parseRetryAfter,
  backoffDelay,
  isRetryableStatus,
};
