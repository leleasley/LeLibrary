// Central query keys so invalidation stays precise and refactors stay safe.
export const queryKeys = {
  status: ['status'] as const,
  account: ['account'] as const,
  accountMe: ['account', 'me'] as const,
  tokens: ['account', 'tokens'] as const,
  token: (id: string) => ['account', 'tokens', id] as const,
  collections: ['collections'] as const,
  collectionsConfig: (tokenId: string) => ['collections', 'config', tokenId] as const,
  library: (tokenId: string) => ['library', tokenId] as const,
  features: ['features'] as const,
  savedSetups: ['setup', 'saved'] as const,
  releasesConfig: ['releases', 'config'] as const,
  releasesMovies: (region: string, from: string, to: string) =>
    ['releases', 'movies', region, from, to] as const,
  releasesDay: (region: string, date: string) => ['releases', 'day', region, date] as const,
  releasesWeek: (region: string, from: string) => ['releases', 'week', region, from] as const,
  releasesSearch: (region: string, query: string) => ['releases', 'search', region, query] as const,
  releasesTitle: (region: string, type: string, id: number) => ['releases', 'title', region, type, id] as const,
  releasesSeason: (id: number, season: number) => ['releases', 'season', id, season] as const,
} as const;
