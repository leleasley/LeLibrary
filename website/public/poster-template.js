(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LePosterTemplate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ALLOWED = new Set(['imdbId', 'imdb_id', 'tmdbId', 'tmdb_id', 'type']);
  var IDENTIFIERS = new Set(['imdbId', 'imdb_id', 'tmdbId', 'tmdb_id']);

  function normalizeEncodedPlaceholders(value) {
    return String(value || '').replace(/%7b([^%{}]+)%7d/gi, function (_, name) {
      return '{' + name + '}';
    });
  }

  function validate(template) {
    var value = normalizeEncodedPlaceholders(String(template || '').trim());
    if (!value) return { ok: false, error: 'Enter a custom poster URL template.' };
    if (value.length > 2048) return { ok: false, error: 'The custom poster template is too long.' };
    if (/\s|[\u0000-\u001f\u007f]/.test(value)) return { ok: false, error: 'The template cannot contain spaces or control characters.' };
    var placeholders = [];
    value.replace(/\{([^{}]+)\}/g, function (_, name) { placeholders.push(name); return _; });
    var residue = value.replace(/\{[^{}]+\}/g, '');
    if (/[{}]/.test(residue)) return { ok: false, error: 'The template contains an incomplete placeholder.' };
    var unknown = placeholders.find(function (name) { return !ALLOWED.has(name); });
    if (unknown) return { ok: false, error: 'Unknown placeholder {' + unknown + '}.' };
    if (!placeholders.some(function (name) { return IDENTIFIERS.has(name); })) {
      return { ok: false, error: 'Include at least one IMDb or TMDB ID placeholder.' };
    }
    var parsed;
    try { parsed = new URL(value); } catch (_) { return { ok: false, error: 'Enter a complete HTTPS URL template.' }; }
    if (parsed.protocol !== 'https:') return { ok: false, error: 'Custom poster templates must use HTTPS.' };
    if (parsed.username || parsed.password) return { ok: false, error: 'URL usernames and passwords are not allowed.' };
    return { ok: true, value: value, placeholders: placeholders };
  }

  function imdbValue(value) {
    var match = String(value || '').match(/tt\d+/i);
    return match ? match[0].toLowerCase() : '';
  }

  function tmdbValue(value) {
    return /^\d+$/.test(String(value || '')) ? String(value) : '';
  }

  function resolve(template, media) {
    var checked = validate(template);
    if (!checked.ok) return null;
    media = media || {};
    var values = {
      imdbId: imdbValue(media.imdbId || media.id),
      imdb_id: imdbValue(media.imdbId || media.id),
      tmdbId: tmdbValue(media.tmdbId),
      tmdb_id: tmdbValue(media.tmdbId),
      type: media.type === 'movie' ? 'movie' : 'series'
    };
    for (var i = 0; i < checked.placeholders.length; i++) {
      if (!values[checked.placeholders[i]]) return null;
    }
    return checked.value.replace(/\{([^{}]+)\}/g, function (_, name) {
      return encodeURIComponent(values[name]);
    });
  }

  function apply(row, template) {
    if (!row || typeof row !== 'object') return row;
    var url = resolve(template, row);
    return url ? Object.assign({}, row, { poster: url, posterShape: 'poster' }) : row;
  }

  return { validate: validate, resolve: resolve, apply: apply };
});
