// @ts-nocheck
// All matching data in one place: split-season maps and standalone-entry
// title redirects. This is deliberately data, not code: the next show TMDB
// splits (or lists a season as its own entry) is one row here, not a branch
// in the matcher. Operators can extend or override with MATCH_TABLES (inline
// JSON) or MATCH_TABLES_PATH (JSON file); env-provided rows win over
// built-ins for the same key.
const crypto = require('crypto');
const fs = require('node:fs');
const { normalizeTitle } = require('../media/title-aliases.ts');

// TVDB/Sonarr keep one continuous numbering while TMDB splits a show into
// two entries. Keyed by EVERY involved TMDB id (not just the source entry):
// search may return either entry first, and the trigger must not depend on
// which one it happened to be (prod: direct hits on 235884 kept the TVDB
// season and every episode was filtered everywhere).
// Shape: { [tmdbId]: { [fileSeason]: { tmdbId, season } } }.
const BUILTIN_SPLIT_SEASONS = {
  // Kitchen Nightmares US: 2007-2014 run (11294, seasons 1-7) + 2023 revival
  // (235884, seasons 1-3). TVDB S08/S09/S10 are the revival's S01/S02/S03.
  11294: {
    8: { tmdbId: 235884, season: 1 },
    9: { tmdbId: 235884, season: 2 },
    10: { tmdbId: 235884, season: 3 },
  },
  235884: {
    8: { tmdbId: 235884, season: 1 },
    9: { tmdbId: 235884, season: 2 },
    10: { tmdbId: 235884, season: 3 },
  },
};

// Anthology seasons TMDB lists as standalone entries while scene/Sonarr keep
// numbering the parent show. The parser drops the subtitle ("Monster S04 The
// Lizzie Borden Story" parses as title "Monster", season 4), so the bare
// title can never resolve. Each row redirects one (title, fileSeason) pair,
// gated on a filename substring so a future real season on the parent entry
// is untouched. Rows carry the curated display name: a day-one entry can
// miss the candidate list entirely, and rows must never be nameless.
// Shape: [{ title, fileSeason, contains, tmdbId, season, name }].
const BUILTIN_TITLE_REDIRECTS = [
  {
    title: 'monster',
    fileSeason: 4,
    contains: 'lizzieborden',
    tmdbId: 299939,
    season: 1,
    name: 'Monster: The Lizzie Borden Story',
  },
];

function readEnvTables() {
  let fromEnv = null;
  try {
    if (process.env.MATCH_TABLES) fromEnv = JSON.parse(process.env.MATCH_TABLES);
  } catch { fromEnv = null; }
  if (!fromEnv && process.env.MATCH_TABLES_PATH) {
    try {
      fromEnv = JSON.parse(fs.readFileSync(process.env.MATCH_TABLES_PATH, 'utf8'));
    } catch { fromEnv = null; }
  }
  return fromEnv && typeof fromEnv === 'object' ? fromEnv : null;
}

// Env split rows merge per show id (an operator row for one show never wipes
// another show's built-ins). Env redirect rows REPLACE the built-in list when
// provided: appending would silently double-match the same title.
function mergeTables() {
  const splitSeasons = JSON.parse(JSON.stringify(BUILTIN_SPLIT_SEASONS));
  let titleRedirects = BUILTIN_TITLE_REDIRECTS.map((r) => ({ ...r }));
  const env = readEnvTables();
  if (env) {
    if (env.splitSeasons && typeof env.splitSeasons === 'object') {
      for (const [showId, seasons] of Object.entries(env.splitSeasons)) {
        if (!seasons || typeof seasons !== 'object') continue;
        splitSeasons[String(showId)] = { ...(splitSeasons[String(showId)] || {}) };
        for (const [fileSeason, target] of Object.entries(seasons)) {
          if (!target || typeof target !== 'object') continue;
          const tmdbId = parseInt(target.tmdbId, 10);
          const season = parseInt(target.season, 10);
          if (!Number.isInteger(tmdbId) || !Number.isInteger(season)) continue;
          splitSeasons[String(showId)][String(parseInt(fileSeason, 10))] = { tmdbId, season };
        }
      }
    }
    if (Array.isArray(env.titleRedirects)) {
      const clean = [];
      for (const row of env.titleRedirects) {
        if (!row || typeof row !== 'object') continue;
        const fileSeason = parseInt(row.fileSeason, 10);
        const tmdbId = parseInt(row.tmdbId, 10);
        const season = parseInt(row.season, 10);
        if (typeof row.title !== 'string' || !Number.isInteger(fileSeason)) continue;
        if (typeof row.contains !== 'string' || !Number.isInteger(tmdbId)) continue;
        if (!Number.isInteger(season)) continue;
        clean.push({
          title: row.title,
          fileSeason,
          contains: row.contains,
          tmdbId,
          season,
          name: typeof row.name === 'string' ? row.name : null,
        });
      }
      titleRedirects = clean;
    }
  }
  return { splitSeasons, titleRedirects };
}

let cached = null;
function tables() {
  if (!cached) cached = mergeTables();
  return cached;
}

// Test seam: reset the memoized merge (env changes between tests).
function resetTablesForTests() {
  cached = null;
}

// Raw merged split-season map (builder re-exports it for remaining table
// consumers and existing tests; decisions go through lookupSplitSeason).
function splitSeasons() {
  return tables().splitSeasons;
}

function tableVersion() {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(tables()))
    .digest('hex')
    .slice(0, 12);
}

// A (matchedShowId, filenameSeason) that really belongs to a split-off entry
// returns { tmdbId, season }, otherwise null. Pure function.
function lookupSplitSeason(matchedId, season) {
  if (matchedId == null || season == null) return null;
  const show = tables().splitSeasons[String(matchedId).trim()];
  if (!show) return null;
  const target = show[String(parseInt(season, 10))];
  return target ? { tmdbId: target.tmdbId, season: target.season } : null;
}

// A (raw filename, parsed title, file season) carrying a known standalone
// subtitle returns { tmdbId, season, name }, otherwise null. Pure function.
function lookupTitleRedirect(name, title, season) {
  if (!name || !title || season == null) return null;
  const normName = normalizeTitle(name);
  const normTitle = normalizeTitle(title);
  const fileSeason = parseInt(season, 10);
  for (const row of tables().titleRedirects) {
    if (normTitle !== normalizeTitle(row.title)) continue;
    if (fileSeason !== row.fileSeason) continue;
    if (!normName.includes(normalizeTitle(row.contains))) continue;
    return { tmdbId: row.tmdbId, season: row.season, name: row.name || null };
  }
  return null;
}

export interface TablesApi {
  lookupSplitSeason: any;
  lookupTitleRedirect: any;
  splitSeasons: any;
  tableVersion: any;
  resetTablesForTests: any;
}

module.exports = {
  lookupSplitSeason,
  lookupTitleRedirect,
  splitSeasons,
  tableVersion,
  resetTablesForTests,
} satisfies TablesApi;
