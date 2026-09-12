(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LePictoriumOptions = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Curated subset of Pictorium's stable poster query contract. Only these
  // keys are ever forwarded, so a crafted config cannot turn the proxy into a
  // generic image fetcher or exceed Pictorium's limits.
  var BADGE_STYLES = ['shadow', 'pill', 'bar', 'colored', 'bordo', 'vetro'];
  var RANK_STYLES = ['default', 'bar', 'colored', 'pill', 'netflix'];
  var SIDES = ['left', 'right'];

  var RATING_SOURCES = [
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
  var REGIONS = [
    ['', 'Automatic'],
    ['GB', 'United Kingdom'], ['US', 'United States'], ['CA', 'Canada'], ['AU', 'Australia'],
    ['IE', 'Ireland'], ['FR', 'France'], ['DE', 'Germany'], ['ES', 'Spain'], ['IT', 'Italy'],
    ['BR', 'Brazil'], ['MX', 'Mexico'], ['IN', 'India'], ['JP', 'Japan'], ['KR', 'South Korea'], ['IL', 'Israel'],
  ];

  // Artwork/metadata language. Empty falls back to the instance default.
  var LANGUAGES = [
    ['', 'Automatic'],
    ['en', 'English'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['it', 'Italian'],
    ['pt', 'Portuguese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['he', 'Hebrew'], ['hi', 'Hindi'],
  ];

  var DEFAULTS = Object.freeze({
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
  });

  function flag(value, fallback) {
    if (value === '0' || value === 0 || value === false) return '0';
    if (value === '1' || value === 1 || value === true) return '1';
    return fallback;
  }

  function clampInt(value, min, max, fallback) {
    var n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function hex(value) {
    var v = String(value || '').trim();
    if (!v) return '';
    if (/^[0-9a-fA-F]{6}$/.test(v)) return '#' + v.toLowerCase();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
    return '';
  }

  function code(value, len, upper) {
    var v = String(value || '').trim();
    if (!v) return '';
    var re = len === 2 ? /^[a-zA-Z]{2}$/ : /^[a-zA-Z]{3,}$/;
    if (!re.test(v)) return '';
    return upper ? v.toUpperCase() : v.toLowerCase();
  }

  var RATING_ALIASES = { tomatoesaudience: 'popcorntime', popcorn: 'popcorntime', rtaudience: 'popcorntime', audience: 'popcorntime', myanimelist: 'mal' };

  function sourceList(value) {
    var raw = Array.isArray(value) ? value.join(',') : String(value || '');
    var wanted = {};
    raw.split(',').forEach(function (part) {
      var id = String(part || '').trim().toLowerCase();
      if (!id) return;
      id = RATING_ALIASES[id] || id;
      wanted[id] = true;
    });
    var list = [];
    RATING_SOURCES.forEach(function (source) {
      if (wanted[source[0]]) list.push(source[0]);
    });
    return list;
  }

  function sanitize(input) {
    var raw = input && typeof input === 'object' ? input : {};
    var out = {};
    for (var key in DEFAULTS) out[key] = DEFAULTS[key];
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
    out.rsrc = sourceList(raw.rsrc).join(',');
    out.side = SIDES.indexOf(String(raw.side || '')) !== -1 ? String(raw.side) : '';
    out.gradHeight = clampInt(raw.gradHeight, 5, 100, DEFAULTS.gradHeight);
    out.blur = clampInt(raw.blur, 0, 30, DEFAULTS.blur);
    out.ac = hex(raw.ac);
    // Pictorium's own language default is Italian, so never send an empty one.
    out.lang = code(raw.lang, 2, false) || DEFAULTS.lang;
    out.region = code(raw.region, 2, true) || DEFAULTS.region;
    return out;
  }

  function toQuery(input) {
    var o = sanitize(input);
    // Pictorium only applies the standalone badges=0 switch to an explicit
    // artwork request, but naming one would starve its metadata and rating
    // fetch. The genre/rating/year components are always honored, so a hidden
    // main badge is emitted as all three components off while the stored
    // preferences stay untouched for when it is turned back on.
    var emit = { bg: o.bg, by: o.by, br: o.br };
    if (o.badges === '0') { emit.bg = '0'; emit.by = '0'; emit.br = '0'; }
    var parts = [];
    function add(key, value) { if (value !== '' && value != null) parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value))); }
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
    return parts.join('&');
  }

  function fromQuery(qs) {
    var input = {};
    if (qs && typeof qs === 'object' && !(qs instanceof URLSearchParams)) {
      // Express exposes req.query as an object; accept it directly.
      for (var k in qs) {
        if (!Object.prototype.hasOwnProperty.call(qs, k)) continue;
        var v = qs[k];
        input[k] = Array.isArray(v) ? v[0] : v;
      }
    } else {
      try {
        new URLSearchParams(String(qs || '').replace(/^\?/, '')).forEach(function (value, key) { input[key] = value; });
      } catch (_) { /* keep defaults */ }
    }
    return sanitize(input);
  }

  return { DEFAULTS: DEFAULTS, BADGE_STYLES: BADGE_STYLES, RANK_STYLES: RANK_STYLES, RATING_SOURCES: RATING_SOURCES, REGIONS: REGIONS, LANGUAGES: LANGUAGES, sanitize: sanitize, toQuery: toQuery, fromQuery: fromQuery };
});
