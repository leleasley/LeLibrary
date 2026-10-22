// Poster Studio controls, described once. The editor renders from this list;
// the option names, value lists, ranges and defaults all come from the shared
// pictorium-options module (verified against Pictorium 1.25.9), which also
// sanitizes and serializes them on the server.

export type Options = Record<string, string | number>;

export type Field =
  | { kind: 'seg'; key: string; label: string; hint?: string; options: [string, string][]; when?: (o: Options) => boolean }
  | { kind: 'toggle'; key: string; label: string; hint?: string; on?: string; off?: string; when?: (o: Options) => boolean }
  | { kind: 'select'; key: string; label: string; hint?: string; options: [string, string][]; when?: (o: Options) => boolean }
  | { kind: 'slider'; key: string; label: string; hint?: string; min: number; max: number; step: number; unit?: string; nullable?: boolean; when?: (o: Options) => boolean }
  | { kind: 'chips'; label: string; hint?: string; items: { key: string; label: string }[] }
  | { kind: 'order'; key: string; label: string; hint?: string; options: [string, string][]; noneLabel?: string; defaultOrder?: string[] }
  | { kind: 'formats'; key: string; label: string; hint?: string; options: [string, string][] }
  | { kind: 'color'; key: string; label: string; hint?: string }
  | { kind: 'nudge'; label: string; scale: string; x: string; y: string; scaleDefault: number; nullableScale?: boolean; base?: [number, number]; extra?: Field };

export interface Section {
  id: string;
  title: string;
  summary: string;
  open?: boolean;
  advanced?: boolean;
  fields: Field[];
}

// One-click looks. Each resets the style keys, then applies its own.
export const STYLE_KEYS = ['bs', 'rs', 'xbs', 'qbs', 'bfont', 'agebs', 'sepstyle'];
export const LOOKS: { id: string; label: string; note: string; patch: Options }[] = [
  { id: 'classic', label: 'Classic', note: 'Pictorium defaults', patch: {} },
  { id: 'clean', label: 'Clean', note: 'Minimal badges, quiet top', patch: { bs: 'minimal', qbs: 'mono', rs: 'default', ts: 30 } },
  { id: 'netflix', label: 'Streaming', note: 'Netflix-style ranks', patch: { rs: 'netflix-color', bfont: 'barlow-condensed' } },
  { id: 'glass', label: 'Glass', note: 'Frosted badges', patch: { bs: 'vetro', rs: 'vetro', xbs: 'vetro' } },
  { id: 'bold', label: 'Bold', note: 'Colour everywhere', patch: { bs: 'colored', rs: 'colored', qbs: 'color', bfont: 'oswald', sepstyle: 'bottom-color' } },
  { id: 'outlined', label: 'Outlined', note: 'Thin outlines', patch: { bs: 'bordo', rs: 'bordo', qbs: 'knockout', agebs: 'knockout' } },
];

const ON_OFF_NOTE = 'Off by default.';

export function buildSections(lists: {
  ratingSources: [string, string][];
  languages: [string, string][];
  regions: [string, string][];
  videoFormats: [string, string][];
}): Section[] {
  const countries = lists.regions.filter(([id]) => id && id !== 'GLOBAL');
  return [
    {
      id: 'badges', title: 'Badges', summary: 'Style, font and what they show', open: true,
      fields: [
        { kind: 'seg', key: 'bs', label: 'Badge style', options: [['shadow', 'Shadow'], ['pill', 'Pill'], ['bar', 'Bar'], ['colored', 'Colour'], ['bordo', 'Outlined'], ['vetro', 'Glass'], ['minimal', 'Minimal']] },
        { kind: 'seg', key: 'bfont', label: 'Font', options: [['inter', 'Inter'], ['barlow-condensed', 'Barlow Condensed'], ['oswald', 'Oswald']] },
        { kind: 'toggle', key: 'badges', label: 'Show badges', hint: 'Genre, rating and year, plus the age badge and bottom ratings.' },
        { kind: 'chips', label: 'Badge shows', items: [{ key: 'bg', label: 'Genre' }, { key: 'br', label: 'Rating' }, { key: 'by', label: 'Year' }, { key: 'bq', label: 'Quality' }] },
        { kind: 'seg', key: 'qbs', label: 'Quality badge', options: [['standard', 'Text'], ['mono', 'Mono icons'], ['color', 'Colour icons'], ['knockout', 'Knockout']] },
        { kind: 'seg', key: 'qmin', label: 'Show quality from', options: [['SD', 'Any'], ['HD', 'HD'], ['FHD', 'Full HD'], ['4K', '4K']] },
        { kind: 'formats', key: 'formats', label: 'Format marks', hint: 'Dolby Vision, HDR, Atmos and IMAX marks when the title has them.', options: lists.videoFormats },
        { kind: 'toggle', key: 'age', label: 'Age rating badge', on: '1', off: '', hint: ON_OFF_NOTE },
        { kind: 'select', key: 'agecountry', label: 'Age ratings from', options: countries, when: (o) => o.age === '1' },
        { kind: 'seg', key: 'agebs', label: 'Age badge style', options: [['standard', 'Standard'], ['knockout', 'Knockout']], when: (o) => o.age === '1' },
      ],
    },
    {
      id: 'ranking', title: 'Rankings and top badges', summary: 'Top 10 ribbons, extras and coming soon',
      fields: [
        { kind: 'toggle', key: 'ranking', label: 'Ranking badges' },
        { kind: 'seg', key: 'rs', label: 'Ranking style', hint: 'Automatic uses the Netflix ribbon when a title is ranked.', options: [['default', 'Automatic'], ['netflix', 'Netflix'], ['netflix-color', 'Netflix colour'], ['corner', 'Corner'], ['number', 'Number'], ['pill', 'Pill'], ['colored', 'Colour'], ['bordo', 'Outlined'], ['vetro', 'Glass']], when: (o) => o.ranking !== '0' },
        { kind: 'toggle', key: 'ribbon', label: 'Corner ribbon', hint: 'Off turns ribbons into centred badges.', when: (o) => o.ranking !== '0' },
        { kind: 'seg', key: 'xbs', label: 'Extra badge style', options: [['', 'Match ranking'], ['pill', 'Pill'], ['colored', 'Colour'], ['bordo', 'Outlined'], ['vetro', 'Glass'], ['corner', 'Corner']] },
        { kind: 'order', key: 'sash', label: 'Top badges, in priority order', hint: 'Tap to turn on in the order you want. Upcoming, ranking, new, awards and extras such as next episode.', options: [['upcoming', 'Upcoming'], ['rank', 'Ranking'], ['new', 'New'], ['award', 'Awards'], ['extra', 'Extras']], noneLabel: 'None', defaultOrder: ['upcoming', 'rank', 'new', 'award', 'extra'] },
        { kind: 'toggle', key: 'pre', label: 'Coming soon veil', on: '1', off: '', hint: 'Cinema-only films get a veil and ribbon.' },
        { kind: 'seg', key: 'df', label: 'Release date format', options: [['locale', 'Automatic'], ['dmy', '31/12'], ['mdy', '12/31'], ['iso', '2026-12-31']] },
      ],
    },
    {
      id: 'ratings', title: 'Ratings', summary: 'Sources, order and separate ratings',
      fields: [
        { kind: 'order', key: 'rsrc', label: 'Rating sources', hint: 'Order matters: separate ratings use the first five. None picked means IMDb then TMDB.', options: lists.ratingSources },
        { kind: 'toggle', key: 'cr', label: 'Extra provider row' },
        { kind: 'toggle', key: 'sep', label: 'Separate ratings', on: '1', off: '', hint: 'Up to five ratings with their own icons.' },
        { kind: 'seg', key: 'sepstyle', label: 'Separate ratings layout', options: [['column', 'Column'], ['bottom-bar', 'Bottom bar'], ['bottom-pills', 'Bottom pills'], ['bottom-mono', 'Mono icons'], ['bottom-color', 'Colour icons']], when: (o) => o.sep === '1' },
      ],
    },
    {
      id: 'background', title: 'Background and colour', summary: 'Layout, blur, shading and seasonal frames',
      fields: [
        { kind: 'seg', key: 'layout', label: 'Layout', options: [['standard', 'Standard'], ['fresh', 'Fresh'], ['provider-glass', 'Provider glass'], ['nuvio', 'Nuvio'], ['stremio', 'Stremio']] },
        { kind: 'seg', key: 'freshScope', label: 'Fresh layout for', options: [['ranked', 'Ranked titles'], ['all', 'Every title']], when: (o) => o.layout === 'fresh' },
        { kind: 'seg', key: 'theme', label: 'Seasonal frame', options: [['', 'None'], ['halloween', 'Halloween'], ['christmas', 'Christmas']] },
        { kind: 'toggle', key: 'be', label: 'Blurred backdrop' },
        { kind: 'slider', key: 'blur', label: 'Blur strength', min: 1, max: 100, step: 1, when: (o) => o.be !== '0' },
        { kind: 'slider', key: 'bf', label: 'Blur fade', min: 0, max: 100, step: 5, unit: '%', when: (o) => o.be !== '0' },
        { kind: 'slider', key: 'bd', label: 'Blur darkness', min: 0, max: 100, step: 5, unit: '%', when: (o) => o.be !== '0' },
        { kind: 'slider', key: 'tint', label: 'Scene tint', min: 0, max: 100, step: 5, unit: '%' },
        { kind: 'slider', key: 'gradHeight', label: 'Bottom gradient', min: 5, max: 100, step: 5, unit: '%' },
        { kind: 'slider', key: 'ts', label: 'Top shade', min: 0, max: 100, step: 5, unit: '%' },
        { kind: 'slider', key: 'tsh', label: 'Top shade height', hint: '0 turns the top shade off.', min: 0, max: 100, step: 5, unit: '%' },
        { kind: 'color', key: 'ac', label: 'Accent colour', hint: 'Automatic picks a colour from the genre.' },
        { kind: 'seg', key: 'tl', label: 'Top text', hint: 'Automatic adapts to the artwork.', options: [['', 'Automatic'], ['1', 'Light'], ['0', 'Dark']] },
        { kind: 'seg', key: 'bl', label: 'Bottom text', options: [['', 'Automatic'], ['1', 'Light'], ['0', 'Dark']] },
      ],
    },
    {
      id: 'logos', title: 'Title and network logos', summary: 'Show, hide and place logos',
      fields: [
        { kind: 'toggle', key: 'hideLogo', label: 'Hide the title logo', on: '1', off: '' },
        { kind: 'toggle', key: 'logoFit', label: 'Best-fit title logo', on: '1', off: '', hint: 'Sizes the logo to its shape.', when: (o) => o.hideLogo !== '1' },
        { kind: 'toggle', key: 'netLogo', label: 'Network or studio logo' },
        { kind: 'seg', key: 'netPos', label: 'Network logo position', options: [['', 'Automatic'], ['top', 'Top']], when: (o) => o.netLogo !== '0' },
        { kind: 'seg', key: 'side', label: 'Ribbon and logo side', hint: 'Automatic is left on posters.', options: [['', 'Automatic'], ['left', 'Left'], ['right', 'Right']] },
      ],
    },
    {
      id: 'language', title: 'Language and region', summary: 'Badge language and chart region',
      fields: [
        { kind: 'select', key: 'lang', label: 'Language', options: lists.languages.filter(([id]) => id) },
        { kind: 'select', key: 'region', label: 'Region', hint: 'Used for rankings, streaming quality and cinema dates.', options: lists.regions },
      ],
    },
    {
      id: 'finetune', title: 'Fine-tune', summary: 'Size and nudge each element', advanced: true,
      fields: [
        { kind: 'nudge', label: 'Title logo', scale: 'scale', x: 'ox', y: 'oy', scaleDefault: 100, nullableScale: true },
        { kind: 'nudge', label: 'Ranking badge', scale: 'tscale', x: 'tox', y: 'toy', scaleDefault: 100 },
        { kind: 'nudge', label: 'Extra badge', scale: 'exscale', x: 'exox', y: 'exoy', scaleDefault: 100, nullableScale: true },
        { kind: 'nudge', label: 'Genre and rating badge', scale: 'gscale', x: 'gox', y: 'goy', scaleDefault: 100 },
        // Pictorium places the quality badge at -10/+15 by default, so the
        // sliders show the nudge from there (see studioToQualityOffset).
        { kind: 'nudge', label: 'Quality badge', scale: 'qscale', x: 'qox', y: 'qoy', scaleDefault: 100, base: [-10, 15] },
        { kind: 'nudge', label: 'Separate ratings', scale: 'sepscale', x: 'sepox', y: 'sepoy', scaleDefault: 130 },
        { kind: 'nudge', label: 'Network logo', scale: 'netscale', x: 'nox', y: 'noy', scaleDefault: 100, extra: { kind: 'toggle', key: 'netFollow', label: 'Place freely', hint: 'Off follows the layout. On uses the two sliders as a position on the poster.', on: '0', off: '1' } },
      ],
    },
  ];
}

// Turning the age badge on picks a country, because Pictorium's own fallback
// is Italy: the region if one is set, else the browser's country, else GB.
export function guessAgeCountry(region: string, browserLanguages: readonly string[], known: [string, string][]): string {
  const ok = (code: string) => known.some(([id]) => id === code);
  if (region && region !== 'GLOBAL' && ok(region)) return region;
  for (const tag of browserLanguages) {
    const country = tag.split('-')[1]?.toUpperCase();
    if (country && ok(country)) return country;
  }
  return 'GB';
}

// The quality badge offset is stored as Pictorium reads it (0 = its default
// of -10/+15). The studio shows the nudge from that default instead.
export function shownOffset(stored: number, base: number): number {
  return stored === 0 ? 0 : stored - base;
}
export function storedOffset(shown: number, base: number): number {
  return shown === 0 ? 0 : shown + base;
}
