/* Config-token compact format (shared browser + server).
 *
 * The install token is base64url(JSON). Full field names (provider, tmdbApiKey,
 * torboxApiKey, ...) make that JSON bulky, so the configure page encodes with
 * these SHORT keys and the server maps them back on decode. Old tokens that
 * still use the full names decode fine too (unknown/plain keys pass through).
 *
 * UMD: served to the browser as window.TOKEN_MAP, required by the server as a
 * CommonJS module — the encoder (browser) and decoder (server) always agree.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TOKEN_MAP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SHORT_TO_FULL = {
    p:   'provider',
    k:   'tmdbApiKey',
    tb:  'torboxApiKey',
    rd:  'rdApiKey',
    ad:  'adApiKey',
    pm:  'pmApiKey',
    c:   'rdCatalog',
    s:   'sortBy',
    l:   'lang',
    pp:  'posterProvider',
    et:  'erdbToken',
    rk:  'rpdbKey',
    fk:  'fanartKey',
    ok:  'omdbKey',
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
    fr:  'filterResolutions',
    fx:  'filterMaxSize',
    fo:  'filterCachedOnly'
  };

  var FULL_TO_SHORT = {};
  Object.keys(SHORT_TO_FULL).forEach(function (s) {
    FULL_TO_SHORT[SHORT_TO_FULL[s]] = s;
  });

  // Small arrays are packed into comma-separated strings to drop the JSON
  // array brackets/quoting (streamAddons ids, resolution labels and catalogue
  // keys never contain commas).
  var ARRAY_CSV = { streamAddons: true, filterResolutions: true, catalogOrder: true };

  function base64UrlEncode(str) {
    var b64;
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
  // kept — they mean "turn this off", which the server honours. Values the
  // addon never reads (quality/source/codec/HDR/audio filter chips, resolution
  // order, min size) are dropped by the caller — they live in the configure
  // page's draft instead.
  function encodeConfig(cfg) {
    var short = {};
    Object.keys(cfg || {}).forEach(function (full) {
      var v = cfg[full];
      if (v === undefined || v === null || v === '') return;
      if (Array.isArray(v) && v.length === 0) return;
      if (full === 'sortBy' && v === 'data_adicao') return;   // server default
      if (full === 'rdCatalog' && v === 'merge') return;      // server default
      var key = FULL_TO_SHORT[full] || full;
      if (Array.isArray(v) && ARRAY_CSV[full]) v = v.join(',');
      short[key] = v;
    });
    return base64UrlEncode(JSON.stringify(short));
  }

  // Reverse of encodeConfig: map short keys back to the canonical names and
  // unpack the CSV arrays. Unknown keys pass through untouched, so tokens
  // encoded before the compact format (full names) decode identically.
  function normalizeConfig(decoded) {
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
    var out = {};
    Object.keys(decoded).forEach(function (k) {
      out[SHORT_TO_FULL[k] || k] = decoded[k];
    });
    if (typeof out.streamAddons === 'string') out.streamAddons = out.streamAddons.split(',').filter(Boolean);
    if (typeof out.filterResolutions === 'string') out.filterResolutions = out.filterResolutions.split(',').filter(Boolean);
    if (typeof out.catalogOrder === 'string') out.catalogOrder = out.catalogOrder.split(',').filter(Boolean);
    return out;
  }

  return {
    SHORT_TO_FULL: SHORT_TO_FULL,
    FULL_TO_SHORT: FULL_TO_SHORT,
    encodeConfig: encodeConfig,
    normalizeConfig: normalizeConfig
  };
});
