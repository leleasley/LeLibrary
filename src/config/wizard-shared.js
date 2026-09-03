// Wizard shared util — git-tracked, self-host safe
// No dependency on src/accounts; browser gets it as UMD at /wizard-shared.js
// and server can require() it. Mirrors token-map so configure.html stays untouched.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WIZARD_SHARED = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Re-export token helpers via lazy require (server) / globals (browser)
  function getTokenMap() {
    if (typeof require === 'function') {
      try { return require('../../website/public/token-map'); } catch {}
    }
    if (typeof self !== 'undefined' && self.TOKEN_MAP) return self.TOKEN_MAP;
    if (typeof window !== 'undefined' && window.TOKEN_MAP) return window.TOKEN_MAP;
    return null;
  }

  function encodeConfig(cfg) {
    var tm = getTokenMap();
    if (tm && tm.encodeConfig) return tm.encodeConfig(cfg);
    // fallback simple base64url
    var b64 = (typeof Buffer !== 'undefined')
      ? Buffer.from(JSON.stringify(cfg || {}), 'utf8').toString('base64')
      : btoa(unescape(encodeURIComponent(JSON.stringify(cfg || {}))));
    return b64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
  }

  function normalizeConfig(decoded) {
    var tm = getTokenMap();
    if (tm && tm.normalizeConfig) return tm.normalizeConfig(decoded);
    return decoded;
  }

  function decodeConfig(str) {
    if (!str || typeof str !== 'string' || str.length > 2048) return null;
    try {
      var padded = str + '=='.slice(0, (4 - (str.length % 4)) % 4);
      var standard = padded.replace(/-/g,'+').replace(/_/g,'/');
      var json = JSON.parse((typeof Buffer !== 'undefined')
        ? Buffer.from(standard, 'base64').toString('utf8')
        : decodeURIComponent(escape(atob(standard))));
      return normalizeConfig(json);
    } catch { return null; }
  }

  // poster fingerprint — must match app.js:posterFp()
  function hashShort(s) {
    var h = 0; for (var i=0;i<s.length;i++) h = ((h<<5)-h+s.charCodeAt(i))|0;
    return (h>>>0).toString(36);
  }
  function posterFp(config) {
    var erdbToken='', rpdbKey='', fanartKey='', omdbKey='', posterProvider='', eb=false, el=false;
    if (config) {
      erdbToken = config.erdbToken || '';
      rpdbKey = config.rpdbKey || '';
      fanartKey = config.fanartKey || '';
      omdbKey = config.omdbKey || '';
      posterProvider = config.posterProvider || '';
      eb = !!config.enhanceBackground;
      el = !!config.enhanceLogo;
    }
    return hashShort([posterProvider, erdbToken, rpdbKey, fanartKey, omdbKey, eb?1:0, el?1:0].join('|'));
  }

  // Build a full config object from wizard form state.
  // Mirrors website/public/configure.js:getCurrentConfig() field list so tokens
  // produced by the wizard are byte-compatible with the public configure flow.
  function buildWizardConfig(form) {
    if (!form || typeof form !== 'object') return {};
    var cfg = {};
    // primitive copy — caller passes the exact shape; we just trim/skip empties
    for (var k in form) {
      if (!Object.prototype.hasOwnProperty.call(form, k)) continue;
      var v = form[k];
      if (v === undefined || v === null) continue;
      if (typeof v === 'string' && v.trim() === '' && k !== 'libraryIdMode') continue;
      if (Array.isArray(v) && v.length === 0 && k !== 'streamAddons' && k !== 'filterResolutions') {
        // keep intentional empty arrays for clearing server state elsewhere
        // but don't bloat token; the caller decides.
        continue;
      }
      cfg[k] = v;
    }
    return cfg;
  }

  function applyWizardConfig(config, defaults) {
    // Merge config onto defaults, returning a shallow copy.
    var out = {};
    if (defaults && typeof defaults === 'object') for (var k in defaults) out[k] = defaults[k];
    if (config && typeof config === 'object') for (var k2 in config) out[k2] = config[k2];
    return out;
  }

  var defaults = {
    provider: 'none', rdCatalog: 'merge', sortBy: 'data_adicao', lang: 'en-US',
    posterProvider: '', streamPreset: 'lelibrary', streamSort: '',
    catalogTrendingMovies: false, catalogTrendingSeries: false,
    catalogPopularMovies: false, catalogPopularSeries: false,
    catalogMovies: true, catalogSeries: true, catalogAnime: true, catalogFranchises: true,
  };

  return {
    encodeConfig: encodeConfig,
    decodeConfig: decodeConfig,
    normalizeConfig: normalizeConfig,
    posterFp: posterFp,
    buildWizardConfig: buildWizardConfig,
    applyWizardConfig: applyWizardConfig,
    defaults: defaults
  };
});
