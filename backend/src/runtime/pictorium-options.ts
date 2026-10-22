// Curated subset of Pictorium's stable poster query contract. Only these
// keys are ever forwarded, so a crafted config cannot turn the proxy into a
// generic image fetcher or exceed Pictorium's limits.
//
// Server core (the artwork proxy sanitizes through here). The frozen legacy
// /configure page loads a type-stripped build of this module at
// /pictorium-options.js; that shim dies with the /configure cutover.
const BADGE_STYLES: string[] = ['shadow', 'pill', 'bar', 'colored', 'bordo', 'vetro', 'minimal'];
// `bar` was removed upstream (it renders as `default`); old configs map to it.
const RANK_STYLES: string[] = ['default', 'colored', 'pill', 'bordo', 'vetro', 'netflix', 'netflix-color', 'corner', 'number'];
const SIDES: string[] = ['left', 'right'];

// Standalone extra-badge style (`xbs`). Empty means automatic: the extra
// badge keeps rendering with the ranking style, exactly like Pictorium
// without the parameter.
const EXTRA_BADGE_STYLES: string[] = ['default', 'pill', 'colored', 'bordo', 'vetro', 'corner', 'follow-rank'];
// Badge text font (`bfont`). `inter` is the historical rendering.
const BADGE_FONTS: string[] = ['inter', 'barlow-condensed', 'oswald'];
// Streaming quality badge icons (`qbs`). `standard` is the satin text pill.
const QUALITY_BADGE_STYLES: string[] = ['standard', 'mono', 'color', 'knockout'];
// Separate ratings column layout (`sepstyle`). `column` is the historical
// right-hand column; the rest render along the bottom.
const SEPARATE_RATINGS_STYLES: string[] = ['column', 'bottom-bar', 'bottom-pills', 'bottom-mono', 'bottom-color'];
// Minimum streaming quality tier (`qmin`). `SD` shows every badge.
const QMIN_TIERS: string[] = ['SD', 'HD', 'FHD', '4K'];
// Top sash buckets (`sash`), in Pictorium's default order. Unlisted buckets
// are off; an empty selection means the default order.
const SASH_BUCKETS: string[] = ['upcoming', 'rank', 'new', 'award', 'extra'];
// Network logo placement (`netPos`). Empty means automatic mirroring.
const NET_POSITIONS: string[] = ['top'];

// Pictorium 1.25.2-1.25.9 additions (verified against v1.25.9 source).
// Age badge style (`agebs`), seasonal frame (`theme`, empty = none), poster
// layout (`layout`), which titles get the Fresh layout (`freshScope`), date
// format on the upcoming badge (`df`), video format marks (`formats`) and the
// light/dark override for the top and bottom chrome (`tl` / `bl`).
const AGE_BADGE_STYLES: string[] = ['standard', 'knockout'];
const THEMES: string[] = ['halloween', 'christmas'];
const LAYOUTS: string[] = ['standard', 'fresh', 'provider-glass', 'nuvio', 'stremio'];
const FRESH_SCOPES: string[] = ['ranked', 'all'];
const DATE_FORMATS: string[] = ['locale', 'dmy', 'mdy', 'iso'];
const VIDEO_FORMATS: [string, string][] = [['dv', 'Dolby Vision'], ['hdr', 'HDR'], ['hdr10plus', 'HDR10+'], ['atmos', 'Dolby Atmos'], ['imax', 'IMAX']];
const POLARITY: string[] = ['1', '0'];

const RATING_SOURCES: [string, string][] = [
  ['imdb', 'IMDb'],
  ['tmdb', 'TMDB'],
  ['mdblist', 'MDBList'],
  ['tomatoes', 'Rotten Tomatoes'],
  ['popcorntime', 'RT audience'],
  ['letterboxd', 'Letterboxd'],
  ['metacritic', 'Metacritic'],
  ['metacriticuser', 'Metacritic users'],
  ['trakt', 'Trakt'],
  ['simkl', 'Simkl'],
  ['filmweb', 'Filmweb'],
  ['filmwebcritics', 'Filmweb critics'],
  ['rogerebert', 'Roger Ebert'],
  ['mal', 'MyAnimeList'],
  ['anilist', 'AniList'],
  ['kitsu', 'Kitsu'],
];

// Regions Pictorium drives its ranking charts, streaming quality and cinema
// detection from (JustWatch). Empty falls back to the instance default.
const REGIONS: [string, string][] = [
  ['', 'Automatic'], ['GLOBAL', 'Worldwide'],
  ['GB', 'United Kingdom'], ['US', 'United States'], ['CA', 'Canada'], ['AU', 'Australia'],
  ['FR', 'France'], ['DE', 'Germany'], ['ES', 'Spain'], ['IT', 'Italy'], ['PT', 'Portugal'],
  ['NL', 'Netherlands'], ['SE', 'Sweden'], ['PL', 'Poland'], ['CZ', 'Czechia'], ['RO', 'Romania'],
  ['TR', 'Turkey'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['IN', 'India'], ['JP', 'Japan'],
  ['KR', 'South Korea'], ['IL', 'Israel'], ['SA', 'Saudi Arabia'],
]

// Artwork/metadata language. Empty falls back to the instance default.
const LANGUAGES: [string, string][] = [
  ['', 'Automatic'],
  ['en', 'English'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['es-419', 'Spanish (Latin America)'],
  ['it', 'Italian'], ['pt', 'Portuguese'], ['pt-br', 'Portuguese (Brazil)'], ['nl', 'Dutch'], ['sv', 'Swedish'],
  ['pl', 'Polish'], ['cs', 'Czech'], ['ro', 'Romanian'], ['tr', 'Turkish'], ['ar', 'Arabic'],
  ['he', 'Hebrew'], ['ja', 'Japanese'], ['ko', 'Korean'], ['vi', 'Vietnamese'],
]

export interface PictoriumPrefs {
  badges: string;
  ranking: string;
  bg: string;
  by: string;
  br: string;
  bq: string;
  bs: string;
  rs: string;
  rsrc: string;
  gradHeight: number;
  be: string;
  blur: number;
  netLogo: string;
  side: string;
  ac: string;
  pre: string;
  lang: string;
  region: string;
  // Pictorium 1.24-1.25 additions. Numeric transform fields emit only when
  // they differ from Pictorium's own defaults, so configs saved before
  // these existed keep producing byte-identical poster URLs.
  ribbon: string;
  xbs: string;
  bfont: string;
  qbs: string;
  cr: string;
  sep: string;
  sepstyle: string;
  sepscale: number;
  sepox: number;
  sepoy: number;
  exscale: string | number;
  exox: number;
  exoy: number;
  gscale: number;
  gox: number;
  goy: number;
  qscale: number;
  qox: number;
  qoy: number;
  netscale: number;
  nox: number;
  noy: number;
  netPos: string;
  tscale: number;
  tox: number;
  toy: number;
  ts: number;
  tint: number;
  bf: number;
  bd: number;
  qmin: string;
  sash: string;
  // Pictorium 1.25.2-1.25.9. Same rule: defaults never reach the URL.
  tsh: number;
  age: string;
  agecountry: string;
  agebs: string;
  theme: string;
  netFollow: string;
  scale: string | number;
  ox: number;
  oy: number;
  hideLogo: string;
  logoFit: string;
  layout: string;
  freshScope: string;
  tl: string;
  bl: string;
  formats: string;
  df: string;
}

const DEFAULTS: PictoriumPrefs = Object.freeze({
  badges: '1',
  ranking: '1',
  bg: '1',
  by: '1',
  br: '1',
  bq: '1',
  bs: 'shadow',
  rs: 'default',
  rsrc: '',
  gradHeight: 30,
  be: '1',
  blur: 5,
  netLogo: '1',
  side: '',
  ac: '',
  pre: '1',
  lang: 'en',
  region: '',
  ribbon: '1',
  xbs: '',
  bfont: 'inter',
  qbs: 'standard',
  cr: '1',
  sep: '',
  sepstyle: 'column',
  sepscale: 130,
  sepox: 0,
  sepoy: 0,
  exscale: '',
  exox: 0,
  exoy: 0,
  gscale: 100,
  gox: 0,
  goy: 0,
  qscale: 100,
  qox: 0,
  qoy: 0,
  netscale: 100,
  nox: 0,
  noy: 0,
  netPos: '',
  tscale: 100,
  tox: 0,
  toy: 0,
  ts: 50,
  tint: 20,
  bf: 50,
  bd: 30,
  qmin: 'SD',
  sash: '',
  tsh: 25,
  age: '',
  agecountry: '',
  agebs: 'standard',
  theme: '',
  netFollow: '1',
  scale: '',
  ox: 0,
  oy: 0,
  hideLogo: '',
  logoFit: '',
  layout: 'standard',
  freshScope: 'ranked',
  tl: '',
  bl: '',
  formats: '',
  df: 'locale',
});

function flag(value: unknown, fallback: string): string {
  if (value === '0' || value === 0 || value === false) return '0';
  if (value === '1' || value === 1 || value === true) return '1';
  return fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function hex(value: unknown): string {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^[0-9a-fA-F]{6}$/.test(v)) return '#' + v.toLowerCase();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  const short = /^#?([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(v);
  if (short) return ('#' + short[1] + short[1] + short[2] + short[2] + short[3] + short[3]).toLowerCase();
  return '';
}
function listed(value: unknown, list: [string, string][], upper: boolean): string {
  const v = String(value || '').trim();
  const norm = upper ? v.toUpperCase() : v.toLowerCase();
  return list.some((entry) => entry[0] === norm) ? norm : '';
}
function oneOf(value: unknown, list: string[], fallback: string): string {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return list.indexOf(v) !== -1 ? v : fallback;
}
function on(value: unknown): string {
  return value === '1' || value === 1 || value === true ? '1' : '';
}


const RATING_ALIASES: Record<string, string> = {
  tomatoesaudience: 'popcorntime',
  popcorn: 'popcorntime',
  rtaudience: 'popcorntime',
  audience: 'popcorntime',
  myanimelist: 'mal',
};

function sourceList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join(',') : String(value || '');
  const wanted: Record<string, boolean> = {};
  raw.split(',').forEach((part: string) => {
    let id = String(part || '').trim().toLowerCase();
    if (!id) return;
    id = RATING_ALIASES[id] || id;
    wanted[id] = true;
  });
  // Order matters upstream: it decides which five separate ratings show and
  // in what order, so keep the user's order (known sources only, de-duped).
  return Object.keys(wanted).filter((id) => RATING_SOURCES.some((source) => source[0] === id));
}

function sanitize(input: unknown): PictoriumPrefs {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: PictoriumPrefs = { ...DEFAULTS };
  out.badges = flag(raw.badges, DEFAULTS.badges);
  out.ranking = flag(raw.ranking, DEFAULTS.ranking);
  out.bg = flag(raw.bg, DEFAULTS.bg);
  out.by = flag(raw.by, DEFAULTS.by);
  out.br = flag(raw.br, DEFAULTS.br);
  out.bq = flag(raw.bq, DEFAULTS.bq);
  out.be = flag(raw.be, DEFAULTS.be);
  out.netLogo = flag(raw.netLogo, DEFAULTS.netLogo);
  out.pre = raw.pre === undefined || raw.pre === null
    ? DEFAULTS.pre
    : (raw.pre === '1' || raw.pre === 1 || raw.pre === true ? '1' : '');
  out.bs = BADGE_STYLES.indexOf(String(raw.bs || '')) !== -1 ? String(raw.bs) : DEFAULTS.bs;
  out.rs = RANK_STYLES.indexOf(String(raw.rs || '')) !== -1 ? String(raw.rs) : DEFAULTS.rs;
  // Upstream accepts 1-100 (0 renders as 1); `be=0` is how blur is turned off.
  out.rsrc = sourceList(raw.rsrc).join(',');
  out.side = SIDES.indexOf(String(raw.side || '')) !== -1 ? String(raw.side) : '';
  out.gradHeight = clampInt(raw.gradHeight, 5, 100, DEFAULTS.gradHeight);
  out.blur = clampInt(raw.blur, 1, 100, DEFAULTS.blur);
  out.ac = hex(raw.ac);
  // Pictorium's own language default is Italian, so never send an empty one.
  out.lang = listed(raw.lang, LANGUAGES, false) || DEFAULTS.lang;
  out.region = listed(raw.region, REGIONS, true) || DEFAULTS.region;
  out.ribbon = flag(raw.ribbon, DEFAULTS.ribbon);
  out.xbs = EXTRA_BADGE_STYLES.indexOf(String(raw.xbs || '')) !== -1 ? String(raw.xbs) : DEFAULTS.xbs;
  out.bfont = BADGE_FONTS.indexOf(String(raw.bfont || '')) !== -1 ? String(raw.bfont) : DEFAULTS.bfont;
  out.qbs = QUALITY_BADGE_STYLES.indexOf(String(raw.qbs || '')) !== -1 ? String(raw.qbs) : DEFAULTS.qbs;
  out.cr = flag(raw.cr, DEFAULTS.cr);
  out.sep = raw.sep === undefined || raw.sep === null
    ? DEFAULTS.sep
    : (raw.sep === '1' || raw.sep === 1 || raw.sep === true ? '1' : '');
  out.sepstyle = SEPARATE_RATINGS_STYLES.indexOf(String(raw.sepstyle || '').toLowerCase()) !== -1 ? String(raw.sepstyle).toLowerCase() : DEFAULTS.sepstyle;
  out.sepscale = scalePct(raw.sepscale, DEFAULTS.sepscale);
  out.sepox = offsetPx(raw.sepox);
  out.sepoy = offsetPx(raw.sepoy);
  out.exscale = scalePctOrEmpty(raw.exscale);
  out.exox = offsetPx(raw.exox);
  out.exoy = offsetPx(raw.exoy);
  out.gscale = scalePct(raw.gscale, DEFAULTS.gscale);
  out.gox = offsetPx(raw.gox);
  out.goy = offsetPx(raw.goy);
  out.qscale = scalePct(raw.qscale, DEFAULTS.qscale);
  out.qox = offsetPx(raw.qox);
  out.qoy = offsetPx(raw.qoy);
  out.netscale = scalePct(raw.netscale, DEFAULTS.netscale);
  out.nox = offsetPx(raw.nox);
  out.noy = offsetPx(raw.noy);
  out.netPos = NET_POSITIONS.indexOf(String(raw.netPos || '').toLowerCase()) !== -1
    ? String(raw.netPos).toLowerCase()
    : DEFAULTS.netPos;
  out.tscale = scalePct(raw.tscale, DEFAULTS.tscale);
  out.tox = offsetPx(raw.tox);
  out.toy = offsetPx(raw.toy);
  out.ts = clampInt(raw.ts, 0, 100, DEFAULTS.ts);
  out.tint = clampInt(raw.tint, 0, 100, DEFAULTS.tint);
  out.bf = clampInt(raw.bf, 0, 100, DEFAULTS.bf);
  out.bd = clampInt(raw.bd, 0, 100, DEFAULTS.bd);
  out.qmin = QMIN_TIERS.indexOf(String(raw.qmin || '').toUpperCase()) !== -1
    ? String(raw.qmin).toUpperCase()
    : DEFAULTS.qmin;
  out.sash = sashList(raw.sash);
  out.tsh = clampInt(raw.tsh, 0, 100, DEFAULTS.tsh);
  out.age = on(raw.age);
  out.agecountry = /^[A-Za-z]{2}$/.test(String(raw.agecountry || '').trim()) ? String(raw.agecountry).trim().toUpperCase() : '';
  out.agebs = oneOf(raw.agebs, AGE_BADGE_STYLES, DEFAULTS.agebs);
  out.theme = oneOf(raw.theme, THEMES, '');
  out.netFollow = flag(raw.netFollow, DEFAULTS.netFollow);
  out.scale = scalePctOrEmpty(raw.scale);
  out.ox = offsetPx(raw.ox);
  out.oy = offsetPx(raw.oy);
  out.hideLogo = on(raw.hideLogo);
  out.logoFit = on(raw.logoFit);
  out.layout = oneOf(raw.layout, LAYOUTS, DEFAULTS.layout);
  out.freshScope = oneOf(raw.freshScope, FRESH_SCOPES, DEFAULTS.freshScope);
  out.tl = POLARITY.indexOf(String(raw.tl ?? '')) !== -1 ? String(raw.tl) : '';
  out.bl = POLARITY.indexOf(String(raw.bl ?? '')) !== -1 ? String(raw.bl) : '';
  out.formats = formatList(raw.formats);
  out.df = oneOf(raw.df, DATE_FORMATS, DEFAULTS.df);
  return out;
}

// Video format marks: `none`, or a subset of the known formats in canonical
// order. Empty means Pictorium's automatic choice.
function formatList(value: unknown): string {
  const raw = String(Array.isArray(value) ? value.join(',') : (value || '')).toLowerCase();
  if (raw.trim() === 'none') return 'none';
  const wanted = raw.split(',').map((part) => part.trim());
  const picked = VIDEO_FORMATS.map((entry) => entry[0]).filter((id) => wanted.indexOf(id) !== -1);
  return picked.length === VIDEO_FORMATS.length ? '' : picked.join(',');
}

// Badge/group scale, percent. Pictorium clamps to 10-200 and treats 0 or
// garbage as its own default, so mirror that here.
function scalePct(value: unknown, fallback: number): number {
  const n = parseInt(String(value), 10);
  if (!Number.isFinite(n) || n === 0) return fallback;
  return Math.max(10, Math.min(200, n));
}

// Nullable variant for the extra badge: absent or invalid means Pictorium's
// legacy ranking-style fallback, which an explicit value must not override.
function scalePctOrEmpty(value: unknown): string | number {
  if (value === '' || value == null) return '';
  const n = parseInt(String(value), 10);
  if (!Number.isFinite(n) || n === 0) return '';
  return Math.max(10, Math.min(200, n));
}

// Pixel offsets. Pictorium clamps to +-2000; garbage means no nudge.
function offsetPx(value: unknown): number {
  const n = parseInt(String(value), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-2000, Math.min(2000, n));
}

// Top sash order: valid buckets only, de-duplicated, canonical order.
// Empty (or the full default order) means Pictorium's default.
function sashList(value: unknown): string {
  const raw = Array.isArray(value) ? value.join(',') : String(value || '');
  if (raw.trim().toLowerCase() === 'none') return 'none';
  // Order is priority upstream, so keep the user's order; unlisted buckets are
  // off. The full default order collapses to empty (Pictorium's default).
  const wanted: string[] = [];
  raw.split(',').forEach((part: string) => {
    const id = String(part || '').trim().toLowerCase();
    if (id && SASH_BUCKETS.indexOf(id) !== -1 && wanted.indexOf(id) === -1) wanted.push(id);
  });
  if (wanted.length === 0) return '';
  return wanted.join(',') === SASH_BUCKETS.join(',') ? '' : wanted.join(',');
}

// `upstream` is the final request to Pictorium. Our own proxy URLs round-trip
// through fromQuery, so `sash=none` only becomes Pictorium's empty `sash=`
// (every top badge off) on the way out.
function toQuery(input: unknown, opts: { upstream?: boolean } = {}): string {
  const o = sanitize(input);
  // Pictorium only applies the standalone badges=0 switch to an explicit
  // artwork request, but naming one would starve its metadata and rating
  // fetch. The genre/rating/year components are always honored, so a hidden
  // main badge is emitted as all three components off while the stored
  // preferences stay untouched for when it is turned back on.
  const emit: { bg: string; by: string; br: string } = { bg: o.bg, by: o.by, br: o.br };
  if (o.badges === '0') { emit.bg = '0'; emit.by = '0'; emit.br = '0'; }
  const parts: string[] = [];
  function add(key: string, value: unknown): void {
    if (value !== '' && value != null) parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  }
  add('badges', o.badges);
  add('ranking', o.ranking);
  add('bg', emit.bg);
  add('by', emit.by);
  add('br', emit.br);
  add('bq', o.bq);
  add('bs', o.bs);
  add('rs', o.rs);
  add('rsrc', o.rsrc);
  add('gradHeight', o.gradHeight);
  add('be', o.be);
  add('blur', o.blur);
  add('netLogo', o.netLogo);
  add('side', o.side);
  add('ac', o.ac);
  add('pre', o.pre);
  add('lang', o.lang);
  add('region', o.region);
  if (o.ribbon === '0') add('ribbon', o.ribbon);
  if (o.xbs) add('xbs', o.xbs);
  if (o.bfont !== 'inter') add('bfont', o.bfont);
  if (o.qbs !== 'standard') add('qbs', o.qbs);
  if (o.cr === '0') add('cr', o.cr);
  if (o.sep === '1') add('sep', o.sep);
  if (o.sepstyle !== 'column') add('sepstyle', o.sepstyle);
  if (o.sepscale !== 130) add('sepscale', o.sepscale);
  if (o.sepox !== 0) add('sepox', o.sepox);
  if (o.sepoy !== 0) add('sepoy', o.sepoy);
  if (o.exscale !== '') add('exscale', o.exscale);
  if (o.exox !== 0) add('exox', o.exox);
  if (o.exoy !== 0) add('exoy', o.exoy);
  if (o.gscale !== 100) add('gscale', o.gscale);
  if (o.gox !== 0) add('gox', o.gox);
  if (o.goy !== 0) add('goy', o.goy);
  if (o.qscale !== 100) add('qscale', o.qscale);
  if (o.qox !== 0) add('qox', o.qox);
  if (o.qoy !== 0) add('qoy', o.qoy);
  if (o.netscale !== 100) add('netscale', o.netscale);
  if (o.nox !== 0) add('nox', o.nox);
  if (o.noy !== 0) add('noy', o.noy);
  if (o.netPos) add('netPos', o.netPos);
  if (o.tscale !== 100) add('tscale', o.tscale);
  if (o.tox !== 0) add('tox', o.tox);
  if (o.toy !== 0) add('toy', o.toy);
  if (o.ts !== 50) add('ts', o.ts);
  if (o.tint !== 20) add('tint', o.tint);
  if (o.bf !== 50) add('bf', o.bf);
  if (o.bd !== 30) add('bd', o.bd);
  if (o.qmin !== 'SD') add('qmin', o.qmin);
  if (o.sash === 'none') parts.push(opts.upstream ? 'sash=' : 'sash=none');
  else if (o.sash) add('sash', o.sash);
  if (o.tsh !== 25) add('tsh', o.tsh);
  if (o.age === '1') {
    add('age', '1');
    // Pictorium's own fallback country is Italy, so without a choice the age
    // badge follows the chosen region instead of showing Italian ratings.
    const ageCountry = o.agecountry || (o.region && o.region !== 'GLOBAL' ? o.region : '');
    if (ageCountry) add('agecountry', ageCountry);
    if (o.agebs !== 'standard') add('agebs', o.agebs);
  }
  if (o.theme) add('theme', o.theme);
  // Free network placement only means something with an explicit position.
  if (o.netFollow === '0') add('netFollow', '0');
  if (o.scale !== '') add('scale', o.scale);
  if (o.ox !== 0) add('ox', o.ox);
  if (o.oy !== 0) add('oy', o.oy);
  if (o.hideLogo === '1') add('hideLogo', '1');
  if (o.logoFit === '1') add('logoFit', '1');
  if (o.layout !== 'standard') {
    add('layout', o.layout);
    if (o.layout === 'fresh' && o.freshScope !== 'ranked') add('freshScope', o.freshScope);
  }
  if (o.tl) add('tl', o.tl);
  if (o.bl) add('bl', o.bl);
  if (o.formats) add('formats', o.formats);
  if (o.df !== 'locale') add('df', o.df);
  return parts.join('&');
}

function fromQuery(qs: unknown): PictoriumPrefs {
  const input: Record<string, unknown> = {};
  if (qs && typeof qs === 'object' && !(qs instanceof URLSearchParams)) {
    // Express exposes req.query as an object; accept it directly.
    for (const k in qs as Record<string, unknown>) {
      if (!Object.prototype.hasOwnProperty.call(qs, k)) continue;
      const v = (qs as Record<string, unknown>)[k];
      input[k] = Array.isArray(v) ? v[0] : v;
    }
  } else {
    try {
      new URLSearchParams(String(qs || '').replace(/^\?/, '')).forEach((value: string, key: string) => { input[key] = value; });
    } catch { /* keep defaults */ }
  }
  return sanitize(input);
}

export interface PictoriumOptionsApi {
  DEFAULTS: PictoriumPrefs;
  BADGE_STYLES: string[];
  RANK_STYLES: string[];
  EXTRA_BADGE_STYLES: string[];
  BADGE_FONTS: string[];
  QUALITY_BADGE_STYLES: string[];
  SEPARATE_RATINGS_STYLES: string[];
  QMIN_TIERS: string[];
  SASH_BUCKETS: string[];
  NET_POSITIONS: string[];
  RATING_SOURCES: [string, string][];
  REGIONS: [string, string][];
  LANGUAGES: [string, string][];
  AGE_BADGE_STYLES: string[];
  THEMES: string[];
  LAYOUTS: string[];
  FRESH_SCOPES: string[];
  DATE_FORMATS: string[];
  VIDEO_FORMATS: [string, string][];
  sanitize: typeof sanitize;
  toQuery: typeof toQuery;
  fromQuery: typeof fromQuery;
}

module.exports = {
  DEFAULTS, BADGE_STYLES, RANK_STYLES, EXTRA_BADGE_STYLES, BADGE_FONTS,
  QUALITY_BADGE_STYLES, SEPARATE_RATINGS_STYLES, QMIN_TIERS, SASH_BUCKETS,
  NET_POSITIONS, RATING_SOURCES, REGIONS, LANGUAGES, AGE_BADGE_STYLES, THEMES, LAYOUTS,
  FRESH_SCOPES, DATE_FORMATS, VIDEO_FORMATS, sanitize, toQuery, fromQuery,
} satisfies PictoriumOptionsApi;
