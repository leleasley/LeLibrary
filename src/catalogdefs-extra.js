// ── Extra catalog source families (hand-maintained) ──────────
//
// Deterministic source families that do not come from an Xperience export:
// film directors, decades, original-language and origin-country rows. They are
// merged into src/catalogdefs.js so the generated file stays the single source
// of truth for callers, and scripts/gen-catalogdefs.js spreads these back in on
// a regeneration.
//
// Every row uses handlers the runtime already implements. Decades/languages/
// countries use the generic `tmdb_discover` handler (src/libcatalog.js), while
// directors reuse the existing `tmdb_person` handler with `director: true`
// (mapped to TMDB's with_crew filter).
//
// Director TMDB ids were resolved from Wikidata (P4985) and spot-checked
// against TMDB. Re-check before adding rows; a wrong id silently builds the
// wrong catalogue.

const DIRECTOR_GROUP = '🎬 Directors';
const DECADE_GROUP = '📅 Decades';
const WORLD_GROUP = '🌍 World Cinema';

// [key, display name, tmdb person id]
const DIRECTORS = [
  ['nolan', 'Christopher Nolan', 525],
  ['spielberg', 'Steven Spielberg', 488],
  ['tarantino', 'Quentin Tarantino', 138],
  ['scorsese', 'Martin Scorsese', 1032],
  ['fincher', 'David Fincher', 7467],
  ['kubrick', 'Stanley Kubrick', 240],
  ['villeneuve', 'Denis Villeneuve', 137427],
  ['ridley_scott', 'Ridley Scott', 578],
  ['cameron', 'James Cameron', 2710],
  ['peter_jackson', 'Peter Jackson', 108],
  ['wes_anderson', 'Wes Anderson', 5655],
  ['bong_joon_ho', 'Bong Joon-ho', 21684],
  ['tim_burton', 'Tim Burton', 510],
  ['hitchcock', 'Alfred Hitchcock', 2636],
  ['david_lynch', 'David Lynch', 5602],
  ['pt_anderson', 'Paul Thomas Anderson', 4762],
  ['guy_ritchie', 'Guy Ritchie', 956],
  ['zack_snyder', 'Zack Snyder', 15217],
  ['michael_bay', 'Michael Bay', 865],
  ['clint_eastwood', 'Clint Eastwood', 190],
  ['james_gunn', 'James Gunn', 15218],
  ['taika_waititi', 'Taika Waititi', 55934],
  ['jordan_peele', 'Jordan Peele', 291263],
  ['robert_eggers', 'Robert Eggers', 138781],
  ['ari_aster', 'Ari Aster', 1145520],
  ['greta_gerwig', 'Greta Gerwig', 45400],
  ['sofia_coppola', 'Sofia Coppola', 1769],
  ['kathryn_bigelow', 'Kathryn Bigelow', 14392],
  ['spike_lee', 'Spike Lee', 5281],
  ['guillermo_del_toro', 'Guillermo del Toro', 10828],
  ['edgar_wright', 'Edgar Wright', 11090],
  ['matthew_vaughn', 'Matthew Vaughn', 957],
  ['sam_raimi', 'Sam Raimi', 7623],
  ['roland_emmerich', 'Roland Emmerich', 6046],
  ['tony_scott', 'Tony Scott', 893],
  ['john_carpenter', 'John Carpenter', 11770],
  ['george_miller', 'George Miller', 20629],
  ['francis_ford_coppola', 'Francis Ford Coppola', 1776],
  ['m_night_shyamalan', 'M. Night Shyamalan', 11614],
  ['gore_verbinski', 'Gore Verbinski', 1704],
  ['nicolas_winding_refn', 'Nicolas Winding Refn', 21183],
  ['darren_aronofsky', 'Darren Aronofsky', 6431],
  ['alejandro_gonzalez_inarritu', 'Alejandro González Iñárritu', 223],
  ['alfonso_cuaron', 'Alfonso Cuarón', 11218],
  ['joel_coen', 'Joel Coen', 1223],
  ['the_wachowskis', 'The Wachowskis', 9340],
  ['rob_reiner', 'Rob Reiner', 3026],
  ['chris_columbus', 'Chris Columbus', 10965],
  ['jon_favreau', 'Jon Favreau', 15277],
  ['jj_abrams', 'J.J. Abrams', 15344],
];

// [key, label, startYear, endYear, includeSeries]
const DECADES = [
  ['2020s', '2020s', 2020, 2029, true],
  ['2010s', '2010s', 2010, 2019, true],
  ['2000s', '2000s', 2000, 2009, true],
  ['1990s', '1990s', 1990, 1999, true],
  ['1980s', '1980s', 1980, 1989, true],
  ['1970s', '1970s', 1970, 1979, false],
  ['1960s', '1960s', 1960, 1969, false],
  ['1950s', '1950s', 1950, 1959, false],
];

// [key, iso639 code, label]
const LANGUAGES = [
  ['english', 'en', 'English'],
  ['spanish', 'es', 'Spanish'],
  ['french', 'fr', 'French'],
  ['german', 'de', 'German'],
  ['italian', 'it', 'Italian'],
  ['portuguese', 'pt', 'Portuguese'],
  ['japanese', 'ja', 'Japanese'],
  ['korean', 'ko', 'Korean'],
  ['chinese', 'zh', 'Chinese'],
  ['hindi', 'hi', 'Hindi'],
  ['tamil', 'ta', 'Tamil'],
  ['telugu', 'te', 'Telugu'],
  ['malayalam', 'ml', 'Malayalam'],
  ['russian', 'ru', 'Russian'],
  ['turkish', 'tr', 'Turkish'],
  ['arabic', 'ar', 'Arabic'],
  ['thai', 'th', 'Thai'],
  ['indonesian', 'id', 'Indonesian'],
  ['dutch', 'nl', 'Dutch'],
  ['swedish', 'sv', 'Swedish'],
  ['danish', 'da', 'Danish'],
  ['polish', 'pl', 'Polish'],
];

// [key, iso3166 code, label]
const COUNTRIES = [
  ['united_states', 'US', 'United States'],
  ['united_kingdom', 'GB', 'United Kingdom'],
  ['canada', 'CA', 'Canada'],
  ['australia', 'AU', 'Australia'],
  ['france', 'FR', 'France'],
  ['germany', 'DE', 'Germany'],
  ['italy', 'IT', 'Italy'],
  ['spain', 'ES', 'Spain'],
  ['japan', 'JP', 'Japan'],
  ['south_korea', 'KR', 'South Korea'],
  ['india', 'IN', 'India'],
  ['china', 'CN', 'China'],
  ['mexico', 'MX', 'Mexico'],
  ['brazil', 'BR', 'Brazil'],
  ['argentina', 'AR', 'Argentina'],
  ['sweden', 'SE', 'Sweden'],
  ['denmark', 'DK', 'Denmark'],
  ['norway', 'NO', 'Norway'],
  ['netherlands', 'NL', 'Netherlands'],
  ['ireland', 'IE', 'Ireland'],
  ['new_zealand', 'NZ', 'New Zealand'],
  ['turkey', 'TR', 'Turkey'],
  ['thailand', 'TH', 'Thailand'],
  ['poland', 'PL', 'Poland'],
];

function discoverRow(name, type, tmdb, icon, group) {
  return {
    name,
    type,
    group,
    handler: 'tmdb_discover',
    params: { apiType: type === 'series' ? 'tv' : 'movie', tmdb },
    icon,
  };
}

function buildCatalogs() {
  const catalogs = {};

  for (const [key, name, personId] of DIRECTORS) {
    catalogs[`director_${key}_movies`] = {
      name,
      type: 'movie',
      group: DIRECTOR_GROUP,
      handler: 'tmdb_person',
      params: { personId, director: true },
      icon: '🎬',
    };
  }

  for (const [key, label, start, end, includeSeries] of DECADES) {
    const gte = `${start}-01-01`;
    const lte = `${end}-12-31`;
    catalogs[`decade_${key}_movies`] = discoverRow(label, 'movie', {
      sort_by: 'popularity.desc',
      'primary_release_date.gte': gte,
      'primary_release_date.lte': lte,
    }, '📅', DECADE_GROUP);
    if (includeSeries) {
      catalogs[`decade_${key}_series`] = discoverRow(label, 'series', {
        sort_by: 'popularity.desc',
        'first_air_date.gte': gte,
        'first_air_date.lte': lte,
      }, '📅', DECADE_GROUP);
    }
  }

  for (const [key, code, label] of LANGUAGES) {
    catalogs[`language_${key}_movies`] = discoverRow(label, 'movie', {
      sort_by: 'popularity.desc',
      with_original_language: code,
    }, '🌍', WORLD_GROUP);
    catalogs[`language_${key}_series`] = discoverRow(label, 'series', {
      sort_by: 'popularity.desc',
      with_original_language: code,
    }, '🌍', WORLD_GROUP);
  }

  for (const [key, code, label] of COUNTRIES) {
    catalogs[`country_${key}_movies`] = discoverRow(label, 'movie', {
      sort_by: 'popularity.desc',
      with_origin_country: code,
    }, '🌍', WORLD_GROUP);
  }

  return catalogs;
}

module.exports = { catalogs: buildCatalogs() };
