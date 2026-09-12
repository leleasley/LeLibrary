const crypto = require('crypto');
const formatter = require('../website/public/formatter');

const MAX_CUSTOM_STREAMS_BYTES = 256 * 1024;
const MAX_CUSTOM_STREAM_ROWS = 500;
const MAX_IDS_PER_ROW = 64;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_FILENAME_LENGTH = 255;
const MAX_BINGE_GROUP_LENGTH = 160;
const MAX_URL_LENGTH = 4096;
const MAX_EXPIRY_DURATION_MS = 24 * 60 * 60 * 1000;
const EXPIRY_CLOCK_GRACE_MS = 5 * 60 * 1000;
const ALLOWED_TYPES = new Set(['*', 'movie', 'series']);
const IMDB_ID_RE = /^tt\d+(?::\d+:\d+)?$/;

class CustomStreamValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'CustomStreamValidationError';
    this.code = 'CUSTOM_STREAMS_INVALID';
    this.statusCode = 400;
    this.details = details;
  }
}

function cleanText(value, max, field, { required = false } = {}) {
  const text = value == null ? '' : String(value).trim();
  if (required && !text) throw new CustomStreamValidationError(`${field} is required`);
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new CustomStreamValidationError(`${field} contains unsupported control characters`);
  }
  if (text.length > max) throw new CustomStreamValidationError(`${field} is too long (maximum ${max} characters)`);
  return text;
}

function normalizeUrl(value) {
  const raw = cleanText(value, MAX_URL_LENGTH, 'URL', { required: true });
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CustomStreamValidationError('URL must be a complete http:// or https:// address');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CustomStreamValidationError('URL must use http:// or https://');
  }
  if (parsed.username || parsed.password) {
    throw new CustomStreamValidationError('URL usernames and passwords are not supported');
  }
  if (parsed.hash) throw new CustomStreamValidationError('URL fragments are not supported');
  return parsed.href;
}

function normalizeIds(row) {
  const supplied = row.ids !== undefined ? row.ids : row.id !== undefined ? [row.id] : [];
  const values = typeof supplied === 'string' ? [supplied] : supplied;
  if (!Array.isArray(values)) throw new CustomStreamValidationError('IDs must be an array of IMDb IDs');
  if (values.length > MAX_IDS_PER_ROW) {
    throw new CustomStreamValidationError(`A stream can contain at most ${MAX_IDS_PER_ROW} IMDb IDs`);
  }
  const ids = [];
  for (const value of values) {
    let id = cleanText(value, 64, 'IMDb ID').toLowerCase();
    if (!id) continue;
    if (!IMDB_ID_RE.test(id)) {
      throw new CustomStreamValidationError(`Invalid IMDb ID "${id}"; use tt1234567 or tt1234567:1:2`);
    }
    const episode = id.match(/^(tt\d+):(\d+):(\d+)$/);
    if (episode) id = `${episode[1]}:${episode[2].replace(/^0+(?=\d)/, '')}:${episode[3].replace(/^0+(?=\d)/, '')}`;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function normalizeExpiresAt(value) {
  if (value === undefined || value === null || value === '') return null;
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new CustomStreamValidationError('Expiry must be a valid timestamp');
  }
  if (timestamp > Date.now() + MAX_EXPIRY_DURATION_MS + EXPIRY_CLOCK_GRACE_MS) {
    throw new CustomStreamValidationError('Expiry cannot be more than 24 hours away');
  }
  return timestamp;
}

function isActiveCustomStream(row, now = Date.now()) {
  if (!row || typeof row !== 'object') return false;
  if (row.expiresAt === undefined || row.expiresAt === null || row.expiresAt === '') return true;
  const timestamp = Number(row.expiresAt);
  return Number.isSafeInteger(timestamp) && timestamp > now;
}

function activeCustomStreams(rows, now = Date.now()) {
  return Array.isArray(rows) ? rows.filter(row => isActiveCustomStream(row, now)) : [];
}

function customStreamCatalogEntries(rows, type, now = Date.now()) {
  const wantedType = type === 'series' ? 'series' : 'movie';
  const entries = [];
  const seen = new Set();
  for (const row of activeCustomStreams(rows, now)) {
    if (row.type !== wantedType) continue;
    const ids = Array.isArray(row.ids) ? row.ids : typeof row.id === 'string' ? [row.id] : [];
    for (const rawId of ids) {
      const match = String(rawId || '').toLowerCase().match(/^(tt\d+)(?::\d+:\d+)?$/);
      if (!match || seen.has(match[1])) continue;
      seen.add(match[1]);
      entries.push({
        id: match[1],
        name: String(row.name || 'Custom Stream').trim() || 'Custom Stream',
        ...(Number.isSafeInteger(Number(row.tmdbId)) && Number(row.tmdbId) > 0 ? { tmdbId: Number(row.tmdbId) } : {}),
      });
    }
  }
  return entries;
}

function normalizeCustomStreamRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new CustomStreamValidationError('Each custom stream must be an object');
  }
  const type = cleanText(row.type || '*', 16, 'Type').toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    throw new CustomStreamValidationError('Type must be movie, series, or all');
  }
  const ids = normalizeIds(row);
  if (type === 'movie' && ids.some(id => id.split(':').length > 1)) {
    throw new CustomStreamValidationError('Episode IDs must use the Series type');
  }
  if (type === 'series' && ids.some(id => id.split(':').length !== 3)) {
    throw new CustomStreamValidationError('Mapped Series rows require an exact season and episode');
  }

  const normalized = {
    name: cleanText(row.name || row.label, MAX_NAME_LENGTH, 'Name', { required: true }),
    url: normalizeUrl(row.url),
    type,
  };
  if (ids.length) normalized.ids = ids;
  if (row.tmdbId !== undefined && row.tmdbId !== null && row.tmdbId !== '') {
    const tmdbId = Number(row.tmdbId);
    if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) throw new CustomStreamValidationError('TMDB ID must be a positive integer');
    normalized.tmdbId = tmdbId;
  }

  const expiresAt = normalizeExpiresAt(row.expiresAt);
  if (expiresAt !== null) normalized.expiresAt = expiresAt;

  const description = cleanText(row.description, MAX_DESCRIPTION_LENGTH, 'Description');
  const filename = cleanText(row.filename, MAX_FILENAME_LENGTH, 'Filename');
  const bingeGroup = cleanText(row.bingeGroup, MAX_BINGE_GROUP_LENGTH, 'Binge group');
  if (description) normalized.description = description;
  if (filename) normalized.filename = filename;
  if (bingeGroup) normalized.bingeGroup = bingeGroup;
  return normalized;
}

function normalizeCustomStreams(input, { allowPartial = false } = {}) {
  if (!Array.isArray(input)) throw new CustomStreamValidationError('Custom Streams must be an array');
  if (input.length > MAX_CUSTOM_STREAM_ROWS) {
    throw new CustomStreamValidationError(`Custom Streams supports at most ${MAX_CUSTOM_STREAM_ROWS} rows`);
  }

  const rows = [];
  const errors = [];
  input.forEach((row, index) => {
    try {
      rows.push(normalizeCustomStreamRow(row));
    } catch (err) {
      const message = err instanceof CustomStreamValidationError ? err.message : 'Invalid custom stream';
      errors.push({ index, message });
    }
  });
  if (errors.length && !allowPartial) {
    throw new CustomStreamValidationError(`Custom stream ${errors[0].index + 1}: ${errors[0].message}`, errors);
  }

  const bytes = Buffer.byteLength(JSON.stringify(rows), 'utf8');
  if (bytes > MAX_CUSTOM_STREAMS_BYTES) {
    throw new CustomStreamValidationError(`Custom Streams is too large (maximum ${MAX_CUSTOM_STREAMS_BYTES / 1024} KB)`);
  }
  return { rows, errors, bytes };
}

function validateCustomStreams(input) {
  return normalizeCustomStreams(input).rows;
}

function validateCustomStreamsConfig(config = {}) {
  if (!config || typeof config !== 'object' || !Object.prototype.hasOwnProperty.call(config, 'customStreams')) return config;
  const validated = { ...config, customStreams: validateCustomStreams(config.customStreams) };
  if (config.__configScope) {
    Object.defineProperty(validated, '__configScope', {
      value: config.__configScope, enumerable: false, configurable: true,
    });
  }
  return validated;
}

function customStreamsFingerprint(rows) {
  const active = activeCustomStreams(rows);
  if (active.length === 0) return 'none';
  return crypto.createHash('sha256').update(JSON.stringify(active)).digest('hex').slice(0, 16);
}

function hasCustomStreams(rows) {
  return activeCustomStreams(rows).some(row => typeof row.url === 'string');
}

function hasMappedCustomStreams(rows) {
  return activeCustomStreams(rows).some(row => typeof row === 'object'
    && ((Array.isArray(row.ids) && row.ids.length > 0) || typeof row.id === 'string'));
}

function requestIdentity({ type, id, ttId, imdbId, season, episode } = {}) {
  let base = String(ttId || imdbId || '').toLowerCase();
  let reqSeason = season;
  let reqEpisode = episode;
  const rawId = String(id || '').toLowerCase();
  if (rawId.startsWith('tt')) {
    const parts = rawId.split(':');
    base = parts[0];
    if (reqSeason == null || reqSeason === '') reqSeason = parts[1];
    if (reqEpisode == null || reqEpisode === '') reqEpisode = parts[2];
  }
  if (!/^tt\d+$/.test(base)) base = '';
  const isEpisode = reqSeason != null && reqSeason !== '' && reqEpisode != null && reqEpisode !== '';
  return {
    type: String(type || ''),
    ttId: base,
    season: isEpisode ? String(Number(reqSeason)) : '',
    episode: isEpisode ? String(Number(reqEpisode)) : '',
    exactId: base && isEpisode ? `${base}:${Number(reqSeason)}:${Number(reqEpisode)}` : base,
    isEpisode,
  };
}

function safeFilenameFromUrl(url) {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(segment).slice(0, MAX_FILENAME_LENGTH);
  } catch {
    return '';
  }
}

function streamFromRow(row, request, matchKind, config) {
  const filename = row.filename || safeFilenameFromUrl(row.url);
  let webReady = false;
  try {
    const parsed = new URL(row.url);
    webReady = parsed.protocol === 'https:' && /\.mp4$/i.test(parsed.pathname);
  } catch {}
  const behaviorHints = { notWebReady: !webReady };
  if (filename) behaviorHints.filename = filename;
  if (request.type === 'series') {
    behaviorHints.bingeGroup = row.bingeGroup || `custom:${crypto.createHash('sha256').update(`${row.name}|${row.url}`).digest('hex').slice(0, 16)}`;
  }
  let formatted = null;
  if (filename && config && typeof config === 'object') {
    const preset = formatter.presets?.[config.streamPreset] || formatter.presets?.lelibrary;
    formatted = formatter.formatStream(
      config.streamNameTemplate || preset?.name || '{addon.name}',
      config.streamDescTemplate || preset?.description || '{stream.filename}',
      filename, 'custom', 0,
      { addonName: row.name || 'Custom Stream', streamType: 'http' },
    );
  }
  return {
    name: formatted?.name || row.name || 'Custom',
    url: row.url,
    description: row.description || formatted?.description || `🎯 ${row.name || 'Custom Stream'}`,
    behaviorHints,
    _customStream: true,
    _customMatch: matchKind,
  };
}

function matchCustomStreams(rows, request = {}) {
  const identity = requestIdentity(request);
  const exact = [];
  const global = [];
  const seen = new Set();
  for (const raw of Array.isArray(rows) ? rows : []) {
    let row;
    try {
      row = normalizeCustomStreamRow(raw);
    } catch {
      continue;
    }
    if (!isActiveCustomStream(row)) continue;
    if (row.type !== '*' && row.type !== identity.type) continue;
    const ids = row.ids || [];
    let matchKind = '';
    if (ids.length === 0) matchKind = 'global';
    else if (identity.exactId && ids.includes(identity.exactId)) matchKind = 'exact';
    // Literal title-level series URLs are not episode URLs. Never fall back
    // from tt:s:e to a base tt mapping: that can play the wrong file.
    if (!matchKind || seen.has(row.url)) continue;
    seen.add(row.url);
    const stream = streamFromRow(row, identity, matchKind, request.config);
    if (matchKind === 'exact') exact.push(stream);
    else global.push(stream);
  }
  return { exact, global, streams: [...exact, ...global], identity };
}

module.exports = {
  MAX_CUSTOM_STREAMS_BYTES,
  MAX_CUSTOM_STREAM_ROWS,
  MAX_IDS_PER_ROW,
  IMDB_ID_RE,
  CustomStreamValidationError,
  normalizeCustomStreamRow,
  isActiveCustomStream,
  activeCustomStreams,
  customStreamCatalogEntries,
  normalizeCustomStreams,
  validateCustomStreams,
  validateCustomStreamsConfig,
  customStreamsFingerprint,
  hasCustomStreams,
  hasMappedCustomStreams,
  requestIdentity,
  matchCustomStreams,
};
