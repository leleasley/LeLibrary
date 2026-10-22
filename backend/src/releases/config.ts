// Env-derived settings for the Releases feature. Pure enough to unit-test:
// every value is read once per call, with documented defaults.
const validate = require('./validate.ts');

export interface ReleasesSettings {
  regions: string[];
  windowPastDays: number;
  windowFutureDays: number;
  nearDays: number;
  syncIntervalMs: number;
  nearIntervalMs: number;
  detailTtlMs: number;
  staleDays: number;
  concurrency: number;
  maxPages: number;
  maxTvDetails: number;
  sliceDays: number;
  searchDetails: number;
  searchTtlSeconds: number;
  maxRangeDays: number;
  maxPage: number;
  notableMinPopularity: number;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number.parseInt(String(process.env[name] || ''), 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(raw, min), max);
}

function releasesSettings(): ReleasesSettings {
  return {
    regions: validate.parseAllowedRegions(process.env.RELEASES_REGIONS, ['GB', 'US']),
    windowPastDays: intEnv('RELEASES_WINDOW_PAST_DAYS', 7, 0, 60),
    windowFutureDays: intEnv('RELEASES_WINDOW_FUTURE_DAYS', 60, 1, 365),
    nearDays: intEnv('RELEASES_NEAR_DAYS', 7, 1, 60),
    syncIntervalMs: intEnv('RELEASES_SYNC_INTERVAL', 21600, 300, 86400) * 1000,
    nearIntervalMs: intEnv('RELEASES_NEAR_INTERVAL', 10800, 300, 86400) * 1000,
    detailTtlMs: intEnv('RELEASES_DETAIL_TTL', 86400, 3600, 2592000) * 1000,
    staleDays: intEnv('RELEASES_STALE_DAYS', 30, 7, 180),
    concurrency: intEnv('RELEASES_CONCURRENCY', 4, 1, 12),
    maxPages: intEnv('RELEASES_MAX_PAGES', 5, 1, 40),
    maxTvDetails: intEnv('RELEASES_MAX_TV_DETAILS', 60, 1, 500),
    sliceDays: intEnv('RELEASES_MOVIE_SLICE_DAYS', 14, 1, 60),
    searchDetails: intEnv('RELEASES_SEARCH_DETAILS', 5, 1, 10),
    searchTtlSeconds: intEnv('RELEASES_SEARCH_TTL', 300, 30, 3600),
    maxRangeDays: intEnv('RELEASES_MAX_RANGE_DAYS', 92, 1, 366),
    maxPage: intEnv('RELEASES_MAX_PAGE', 20, 1, 100),
    notableMinPopularity: intEnv('RELEASES_NOTABLE_MIN_POPULARITY', 50, 0, 100000),
  };
}

module.exports = { releasesSettings };
