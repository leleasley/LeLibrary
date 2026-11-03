// Central query keys so invalidation stays precise and refactors stay safe.

/** The TV calendar filters that change what the server returns. */
export interface ReleaseTvFilterKey {
  notable: boolean;
  types: readonly string[];
  language: string | null;
}
export const queryKeys = {
  status: ['status'] as const,
  // The banner/footer pill: seeded from boot data, polled on its own.
  statusPill: ['status', 'pill'] as const,
  features: ['features'] as const,
  savedSetups: ['setup', 'saved'] as const,
  releasesConfig: ['releases', 'config'] as const,
  releasesMovies: (region: string, from: string, to: string) =>
    ['releases', 'movies', region, from, to] as const,
  releasesDay: (region: string, date: string, filters: ReleaseTvFilterKey & { sort: string }) =>
    ['releases', 'day', region, date, filters.notable, filters.types.join('|'), filters.language, filters.sort] as const,
  // The week strip ignores sort, so sorting the list never refetches the strip.
  releasesWeek: (region: string, from: string, filters: ReleaseTvFilterKey) =>
    ['releases', 'week', region, from, filters.notable, filters.types.join('|'), filters.language] as const,
  releasesSearch: (region: string, query: string) => ['releases', 'search', region, query] as const,
  releasesTitle: (region: string, type: string, id: number) => ['releases', 'title', region, type, id] as const,
  releasesSeason: (id: number, season: number) => ['releases', 'season', id, season] as const,
} as const;
