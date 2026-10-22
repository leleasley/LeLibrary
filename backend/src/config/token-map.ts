/* Config-token compact format (shared server core + legacy browser).
 *
 * The install token is base64url(JSON). Full field names (provider, tmdbApiKey,
 * torboxApiKey, ...) make that JSON bulky, so the legacy configure page encodes
 * with these SHORT keys and the server maps them back on decode. Old tokens
 * that still use the full names decode fine too (unknown/plain keys pass
 * through). The frozen legacy page loads a type-stripped build of this module
 * at /token-map.js; that shim dies with the /configure cutover.
 */

const SHORT_TO_FULL: Record<string, string> = {
  p:   'provider',
  k:   'tmdbApiKey',
  tb:  'torboxApiKey',
  rd:  'rdApiKey',
  ad:  'adApiKey',
  pm:  'pmApiKey',
  c:   'rdCatalog',
  s:   'sortBy',
  l:   'lang',
  sq:  'searchScope',
  pp:  'posterProvider',
  pt:  'customPosterTemplate',
  et:  'erdbToken',
  rk:  'rpdbKey',
  fk:  'fanartKey',
  ok:  'omdbKey',
  tvdb: 'tvdbApiKey',
  snt: 'streamNoticeTypes',
  asr: 'aiostreamsRef',
  eb:  'enhanceBackground',
  el:  'enhanceLogo',
  ha:  'hideAnime',
  cm:  'catNameMovies',
  cs:  'catNameSeries',
  ca:  'catNameAnime',
  lm:  'libraryIdMode',
  sp:  'streamPreset',
  ss:  'streamSort',
  sf:  'streamFilters',
  lh:  'libHomeHidden',
  np:  'nuvioCollectionPacks',
  nco: 'nuvioCollectionOverrides',
  ir:  'importedRows',
  tm:  'catalogTrendingMovies',
  ts:  'catalogTrendingSeries',
  pmo: 'catalogPopularMovies',
  pms: 'catalogPopularSeries',
  mv:  'catalogMovies',
  sv:  'catalogSeries',
  av:  'catalogAnime',
  fv:  'catalogFranchises',
  pc:  'pinCollections',
  tnm: 'trendingMoviesName',
  tns: 'trendingSeriesName',
  pnm: 'popularMoviesName',
  pns: 'popularSeriesName',
  cn:  'collectionsName',
  co:  'catalogOrder',
  sa:  'streamAddons',
  cu:  'customStreams',
  fr:  'filterResolutions',
  fx:  'filterMaxSize',
  fo:  'filterCachedOnly',
};

const FULL_TO_SHORT: Record<string, string> = {};
for (const short of Object.keys(SHORT_TO_FULL)) {
  FULL_TO_SHORT[SHORT_TO_FULL[short] as string] = short;
}

// Small arrays are packed into comma-separated strings to drop the JSON
// array brackets/quoting (streamAddons ids, resolution labels and catalogue
// keys never contain commas).
const ARRAY_CSV: Record<string, boolean> = {
  streamAddons: true,
  streamNoticeTypes: true,
  filterResolutions: true,
  catalogOrder: true,
  libraryCatalogs: true,
  libHomeHidden: true,
  nuvioCollectionPacks: true,
};

function base64UrlEncode(str: unknown): string {
  let b64: string;
  if (typeof Buffer !== 'undefined') {
    b64 = Buffer.from(String(str), 'utf8').toString('base64');
  } else {
    b64 = btoa(unescape(encodeURIComponent(String(str))));
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// Encode a full-key config object into a compact base64url token. Omits
// empty / default values and packs the CSV arrays so the install URL stays
// as short as possible. Explicit `false` flags (catalogMovies: false, …) are
// kept: they mean "turn this off", which the server honours.
function encodeConfig(cfg: Record<string, any> | null | undefined): string {
  const short: Record<string, any> = {};
  for (const full of Object.keys(cfg || {})) {
    let v: any = (cfg as Record<string, any>)[full];
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (full === 'sortBy' && v === 'data_adicao') continue;   // server default
    if (full === 'rdCatalog' && v === 'merge') continue;      // server default
    const key = FULL_TO_SHORT[full] || full;
    if (Array.isArray(v) && ARRAY_CSV[full]) v = v.join(',');
    short[key] = v;
  }
  return base64UrlEncode(JSON.stringify(short));
}

// Reverse of encodeConfig: map short keys back to the canonical names and
// unpack the CSV arrays. Unknown keys pass through untouched, so tokens
// encoded before the compact format (full names) decode identically.
function normalizeConfig(decoded: unknown): Record<string, any> | null {
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const out: Record<string, any> = {};
  for (const k of Object.keys(decoded as Record<string, any>)) {
    out[SHORT_TO_FULL[k] || k] = (decoded as Record<string, any>)[k];
  }
  if (typeof out.streamAddons === 'string') out.streamAddons = out.streamAddons.split(',').filter(Boolean);
  if (typeof out.filterResolutions === 'string') out.filterResolutions = out.filterResolutions.split(',').filter(Boolean);
  if (typeof out.catalogOrder === 'string') out.catalogOrder = out.catalogOrder.split(',').filter(Boolean);
  if (typeof out.libraryCatalogs === 'string') out.libraryCatalogs = out.libraryCatalogs.split(',').filter(Boolean);
  if (typeof out.libHomeHidden === 'string') out.libHomeHidden = out.libHomeHidden.split(',').filter(Boolean);
  if (typeof out.nuvioCollectionPacks === 'string') out.nuvioCollectionPacks = out.nuvioCollectionPacks.split(',').filter(Boolean);
  return out;
}

export interface TokenMapApi {
  SHORT_TO_FULL: Record<string, string>;
  FULL_TO_SHORT: Record<string, string>;
  encodeConfig: typeof encodeConfig;
  normalizeConfig: typeof normalizeConfig;
}

module.exports = { SHORT_TO_FULL, FULL_TO_SHORT, encodeConfig, normalizeConfig } satisfies TokenMapApi;
