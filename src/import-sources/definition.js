const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const PROVIDER_ENGINES = Object.freeze({
  tmdb: new Set(['discover', 'list', 'collection']),
  trakt: new Set(['list']),
});

const DISCOVER_FILTERS = new Set([
  'with_original_language', 'with_origin_country',
  'with_genres', 'without_genres',
  'with_keywords', 'without_keywords',
  'with_companies', 'without_companies',
  'with_networks', 'with_cast', 'with_crew', 'with_people',
  'vote_average.gte', 'vote_average.lte', 'vote_count.gte',
  'primary_release_date.gte', 'primary_release_date.lte',
  'first_air_date.gte', 'first_air_date.lte',
  'year', 'first_air_date_year',
  'with_watch_providers', 'without_watch_providers', 'watch_region',
  'with_runtime.gte', 'with_runtime.lte',
  'include_adult', 'include_video',
]);

const MOVIE_SORTS = new Set([
  'popularity.asc', 'popularity.desc', 'vote_average.asc', 'vote_average.desc',
  'vote_count.asc', 'vote_count.desc', 'primary_release_date.asc',
  'primary_release_date.desc', 'revenue.asc', 'revenue.desc',
  'original_title.asc', 'original_title.desc',
]);
const SERIES_SORTS = new Set([
  'popularity.asc', 'popularity.desc', 'vote_average.asc', 'vote_average.desc',
  'vote_count.asc', 'vote_count.desc', 'first_air_date.asc',
  'first_air_date.desc', 'name.asc', 'name.desc',
]);

class ImportedSourceValidationError extends Error {
  constructor(message, code = 'invalid_definition') {
    super(message);
    this.name = 'ImportedSourceValidationError';
    this.code = code;
  }
}

function ownKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ImportedSourceValidationError(`${label} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ImportedSourceValidationError(`${label} contains unsupported field "${key}"`, 'unsupported_field');
  }
}

function positiveInt(value, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0 || n > 2147483647) {
    throw new ImportedSourceValidationError(`${label} must be a positive 32-bit integer`);
  }
  return n;
}

function boundedNumber(value, label, min, max, integer = false) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new ImportedSourceValidationError(`${label} is outside its supported range`);
  }
  return n;
}

function normalizeIdExpression(value, label) {
  const clean = String(value).replace(/\s+/g, '');
  if (!/^\d+(?:[|,]\d+)*$/.test(clean) || clean.length > 500) {
    throw new ImportedSourceValidationError(`${label} must contain numeric IDs separated by comma or pipe`);
  }
  return clean;
}

function normalizeFilterValue(key, value) {
  if (['with_genres', 'without_genres', 'with_keywords', 'without_keywords',
    'with_companies', 'without_companies', 'with_networks', 'with_cast',
    'with_crew', 'with_people', 'with_watch_providers', 'without_watch_providers'].includes(key)) {
    return normalizeIdExpression(value, key);
  }
  if (key === 'with_original_language') {
    const clean = String(value).trim().toLowerCase();
    if (!/^[a-z]{2,3}$/.test(clean)) throw new ImportedSourceValidationError('Invalid original language');
    return clean;
  }
  if (key === 'with_origin_country' || key === 'watch_region') {
    const clean = String(value).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(clean)) throw new ImportedSourceValidationError(`Invalid ${key}`);
    return clean;
  }
  if (/date\.(?:gte|lte)$/.test(key)) {
    const clean = String(value).trim();
    const parsed = new Date(`${clean}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== clean) {
      throw new ImportedSourceValidationError(`Invalid ${key}`);
    }
    return clean;
  }
  if (key === 'year' || key === 'first_air_date_year') return boundedNumber(value, key, 1870, 2200, true);
  if (key === 'vote_average.gte' || key === 'vote_average.lte') return boundedNumber(value, key, 0, 10);
  if (key === 'vote_count.gte') return boundedNumber(value, key, 0, 10000000, true);
  if (key === 'with_runtime.gte' || key === 'with_runtime.lte') return boundedNumber(value, key, 0, 1440, true);
  if (key === 'include_adult' || key === 'include_video') {
    if (typeof value !== 'boolean') throw new ImportedSourceValidationError(`${key} must be boolean`);
    return value;
  }
  throw new ImportedSourceValidationError(`Unsupported discover filter "${key}"`, 'unsupported_filter');
}

function normalizeDiscoverParams(params, mediaType) {
  ownKeys(params, new Set(['sortBy', 'filters']), 'discover params');
  const sortBy = String(params.sortBy || 'popularity.desc').trim();
  const allowedSorts = mediaType === 'series' ? SERIES_SORTS : MOVIE_SORTS;
  if (!allowedSorts.has(sortBy)) throw new ImportedSourceValidationError(`Unsupported ${mediaType} sort "${sortBy}"`, 'unsupported_sort');
  const filters = params.filters == null ? {} : params.filters;
  ownKeys(filters, DISCOVER_FILTERS, 'discover filters');
  const normalized = {};
  for (const key of Object.keys(filters).sort()) normalized[key] = normalizeFilterValue(key, filters[key]);
  // These are the effective defaults used by the shared runtime. Including
  // them in the signature prevents a source which explicitly enables either
  // option from matching the default LeLibrary recipe.
  if (!Object.prototype.hasOwnProperty.call(normalized, 'include_adult')) normalized.include_adult = false;
  if (mediaType === 'movie' && !Object.prototype.hasOwnProperty.call(normalized, 'include_video')) normalized.include_video = false;
  if ((normalized.with_watch_providers || normalized.without_watch_providers) && !normalized.watch_region) normalized.watch_region = 'US';
  return { sortBy, filters: normalized };
}

function normalizeSemanticDefinition(input) {
  // `v` is accepted only so an already-normalized semantic value can be
  // canonicalised again. It is fixed below and cannot select another schema.
  ownKeys(input, new Set(['v', 'schemaVersion', 'id', 'signature', 'provider', 'engine', 'mediaType', 'params', 'label', 'provenance']), 'source definition');
  if (input.v != null && Number(input.v) !== SCHEMA_VERSION) throw new ImportedSourceValidationError('Unsupported semantic schema version');
  if (input.schemaVersion != null && Number(input.schemaVersion) !== SCHEMA_VERSION) throw new ImportedSourceValidationError('Unsupported source schema version');
  const provider = String(input.provider || '').trim().toLowerCase();
  const engine = String(input.engine || '').trim().toLowerCase();
  const mediaType = input.mediaType === 'series' ? 'series' : input.mediaType === 'movie' ? 'movie' : '';
  if (!PROVIDER_ENGINES[provider]?.has(engine)) throw new ImportedSourceValidationError('Unsupported provider/engine combination');
  if (!mediaType) throw new ImportedSourceValidationError('mediaType must be movie or series');
  const rawParams = input.params == null ? {} : input.params;
  let params;
  if (provider === 'tmdb' && engine === 'discover') {
    params = normalizeDiscoverParams(rawParams, mediaType);
  } else if (provider === 'tmdb' && engine === 'collection') {
    if (mediaType !== 'movie') throw new ImportedSourceValidationError('TMDB collections are movie-only');
    ownKeys(rawParams, new Set(['collectionId']), 'collection params');
    params = { collectionId: positiveInt(rawParams.collectionId, 'collectionId') };
  } else {
    ownKeys(rawParams, new Set(['listId']), 'list params');
    params = { listId: positiveInt(rawParams.listId, 'listId') };
  }
  return { v: SCHEMA_VERSION, provider, engine, mediaType, params };
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalValue(value[key]);
    return result;
  }
  return value;
}

function canonicalJson(input) {
  return JSON.stringify(canonicalValue(normalizeSemanticDefinition(input)));
}

function sourceSignature(input) {
  return crypto.createHash('sha256').update(canonicalJson(input), 'utf8').digest('hex');
}

function cleanLabel(value, fallback = 'Imported source') {
  const clean = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  return clean || fallback;
}

function normalizeImportedSourceDefinition(input) {
  const semantic = normalizeSemanticDefinition(input);
  const signature = sourceSignature(semantic);
  const expectedId = `imp_${signature}`;
  if (input.signature != null && String(input.signature) !== signature) throw new ImportedSourceValidationError('Stored signature does not match source recipe');
  if (input.id != null && String(input.id) !== expectedId) throw new ImportedSourceValidationError('Stored source id does not match source recipe');
  if (input.provenance != null) ownKeys(input.provenance, new Set(['adapter', 'originHash', 'importedLabel']), 'source provenance');
  const provenance = input.provenance
    ? {
      adapter: String(input.provenance.adapter || '').slice(0, 40),
      originHash: String(input.provenance.originHash || '').slice(0, 80),
      importedLabel: cleanLabel(input.provenance.importedLabel || input.label),
    }
    : { adapter: '', originHash: '', importedLabel: cleanLabel(input.label) };
  return {
    schemaVersion: SCHEMA_VERSION,
    id: expectedId,
    signature,
    provider: semantic.provider,
    engine: semantic.engine,
    mediaType: semantic.mediaType,
    params: semantic.params,
    label: cleanLabel(input.label),
    provenance,
  };
}

function isImportedSourceId(value) {
  return /^imp_[a-f0-9]{64}$/.test(String(value || ''));
}

module.exports = {
  SCHEMA_VERSION,
  DISCOVER_FILTERS,
  ImportedSourceValidationError,
  canonicalJson,
  sourceSignature,
  normalizeImportedSourceDefinition,
  normalizeSemanticDefinition,
  cleanLabel,
  isImportedSourceId,
};
