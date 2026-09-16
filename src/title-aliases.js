'use strict';

// Title aliases for matching release names to the canonical TMDB title.
//
// This is deliberately data, not code: short forms and shorthand that scene
// releases use for a show, mapped to the title a TMDB search will resolve. Add
// a row instead of another branch in the matcher. Keys and values are compared
// through normalizeTitle(), so punctuation and "&"/"and" do not matter.
//
// Values may be a plain string (applies to every media type) or an object with
// `movie` / `tv` scopes. The built-ins are TV-only because several short forms
// collide with real films ("Raw"), so they must never apply to a movie search.
//
// The auto-updating scene-mappings dataset (src/scene-mapping.js) covers the
// bulk of renamed shows; this table is for the handful of very short
// abbreviations it cannot derive. Operators can extend it with MATCH_ALIASES
// (a JSON object) or MATCH_ALIASES_PATH (a JSON file).

const fs = require('node:fs');

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function mediaKey(mediaType) {
  return mediaType === 'movie' ? 'movie' : 'tv';
}

const BUILTIN_ALIASES = {
  // WWE weekly shows: releases are often just "Raw" / "Smackdown".
  raw: { tv: 'WWE Raw' },
  wweraw: { tv: 'WWE Raw' },
  mondaynightraw: { tv: 'WWE Raw' },
  wwemondaynightraw: { tv: 'WWE Raw' },
  smackdown: { tv: 'WWE SmackDown' },
  fridaynightsmackdown: { tv: 'WWE SmackDown' },
  wwesmackdown: { tv: 'WWE SmackDown' },
  wwesmackdownlive: { tv: 'WWE SmackDown' },
  wwefridaynightsmackdown: { tv: 'WWE SmackDown' },
  // NXT is sometimes released without the WWE prefix.
  nxt: { tv: 'WWE NXT' },
  wwenxt: { tv: 'WWE NXT' },
};

function toMap(base) {
  if (base instanceof Map) return new Map(base);
  return new Map(Object.entries(base || {}));
}

function mergeAliases(base, overrides) {
  const next = toMap(base);
  if (!overrides || typeof overrides !== 'object') return next;
  for (const [key, value] of Object.entries(overrides)) {
    const normKey = normalizeTitle(key);
    if (!normKey) continue;
    if (typeof value === 'string' && value.trim()) next.set(normKey, value.trim());
    else if (value && typeof value === 'object') {
      const scoped = {};
      if (typeof value.tv === 'string' && value.tv.trim()) scoped.tv = value.tv.trim();
      if (typeof value.movie === 'string' && value.movie.trim()) scoped.movie = value.movie.trim();
      if (Object.keys(scoped).length) next.set(normKey, scoped);
    }
  }
  return next;
}

let aliasMap = mergeAliases(BUILTIN_ALIASES, null);

// Merge operator/user-supplied aliases (rawTitle -> canonical string or
// { movie, tv }). Exposed so account overrides can be layered in later.
function setAliases(overrides) {
  aliasMap = mergeAliases(aliasMap, overrides);
}

// Read MATCH_ALIASES (inline JSON) and MATCH_ALIASES_PATH (JSON file). Never
// throws: a bad config must not stop the addon booting.
function loadOperatorAliases() {
  const inline = process.env.MATCH_ALIASES;
  if (inline) {
    try { setAliases(JSON.parse(inline)); }
    catch (err) { console.warn('[Aliases] MATCH_ALIASES is not valid JSON:', err.message); }
  }
  const file = process.env.MATCH_ALIASES_PATH;
  if (file) {
    try { setAliases(JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch (err) { console.warn('[Aliases] MATCH_ALIASES_PATH could not be read:', err.message); }
  }
}

// Canonical title for a release name and media type, or null when there is no
// alias for that scope.
function resolveAlias(title, mediaType = 'tv') {
  if (!title) return null;
  const entry = aliasMap.get(normalizeTitle(title));
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  return entry[mediaKey(mediaType)] || null;
}

module.exports = { normalizeTitle, resolveAlias, setAliases, loadOperatorAliases, BUILTIN_ALIASES };
