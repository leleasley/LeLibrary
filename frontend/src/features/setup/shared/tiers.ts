// The three setup tiers. Marketing names are what a user sees; the ids are what
// the backend stores. Tier only decides how much of the config is filled in, not
// how security works: every tier gets the same UUID + password.
export type TierId = 'quick' | 'partial' | 'full';

export interface TierDefinition {
  id: TierId;
  name: string;
  tagline: string;
  covers: string[];
  // Number of sections on the tier's page, password included. Verified against
  // the section id arrays in setup-flow.test.ts — update both together.
  steps: number;
  recommended?: boolean;
}

export const TIERS: TierDefinition[] = [
  {
    id: 'quick',
    name: 'Quick Look',
    tagline: 'Connect your debrid library and get started.',
    covers: [
      'Connect TorBox, Real-Debrid, AllDebrid or Premiumize',
      'Match titles and choose your poster artwork',
      'Set how your library streams look',
    ],
    steps: 4,
  },
  {
    id: 'partial',
    name: 'Settle In',
    tagline: 'Make your library fit your home screen.',
    covers: [
      'Everything in Quick Look',
      'Choose and order your Home rows',
      'Tune library playback, artwork and filters',
    ],
    steps: 7,
    recommended: true,
  },
  {
    id: 'full',
    name: 'Move In',
    tagline: 'Organize your library and shape the whole experience.',
    covers: [
      'Everything in Settle In',
      'Organize your library into collections',
      'Choose collection artwork and push to Nuvio',
    ],
    steps: 8,
  },
];

export function tierById(id: string | undefined): TierDefinition | undefined {
  return TIERS.find((tier) => tier.id === id);
}
