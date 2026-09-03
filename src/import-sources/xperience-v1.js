const crypto = require('crypto');
const net = require('net');
const { normalizeImportedSourceDefinition, cleanLabel } = require('./definition');
const { exactStaticMatch } = require('./static-index');

const MAX_COLLECTIONS = 250;
const MAX_FOLDERS = 5000;
const MAX_REFERENCES = 10000;
const MAX_DEFINITIONS = 5000;

const FILTER_MAP = Object.freeze({
  withOriginalLanguage: 'with_original_language', withOriginCountry: 'with_origin_country',
  withGenres: 'with_genres', withoutGenres: 'without_genres',
  withKeywords: 'with_keywords', withoutKeywords: 'without_keywords',
  withCompanies: 'with_companies', withoutCompanies: 'without_companies',
  withNetworks: 'with_networks', withCast: 'with_cast', withCrew: 'with_crew', withPeople: 'with_people',
  voteAverageGte: 'vote_average.gte', voteAverageLte: 'vote_average.lte', voteCountGte: 'vote_count.gte',
  withWatchProviders: 'with_watch_providers', withoutWatchProviders: 'without_watch_providers', watchRegion: 'watch_region',
  withRuntimeGte: 'with_runtime.gte', withRuntimeLte: 'with_runtime.lte',
  includeAdult: 'include_adult', includeVideo: 'include_video',
});
const DISCOVER_KEYS = new Set(['filters', 'sort_by', 'sortBy']);

function sha(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function stableOrigin(kind, value) {
  return `sha256:${sha(`xperience-v1|${kind}|${String(value)}`)}`;
}

function safeArtwork(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || net.isIP(url.hostname)) return '';
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host === 'xperience-app.com' || host.endsWith('.xperience-app.com')) return '';
    const secretNames = /^(?:key|token|access_token|api_key|apikey|signature|sig|auth)$/i;
    for (const key of url.searchParams.keys()) if (secretNames.test(key)) return '';
    return url.toString().slice(0, 2048);
  } catch { return ''; }
}

function presentation(source, allowed, defaults = {}) {
  const out = { ...defaults };
  for (const [target, names] of Object.entries(allowed)) {
    for (const name of names) {
      if (source?.[name] == null) continue;
      out[target] = source[name];
      break;
    }
  }
  return out;
}

function labelMaps(config) {
  const overrides = plainObject(config.catalog_name_overrides) ? config.catalog_name_overrides : {};
  const custom = new Map();
  for (const row of Array.isArray(config.custom_lists) ? config.custom_lists.slice(0, MAX_DEFINITIONS) : []) {
    if (!plainObject(row) || typeof row.id !== 'string') continue;
    custom.set(row.id, row);
  }
  return { overrides, custom };
}

function sourceLabel(catalogId, source, maps, fallback) {
  const label = cleanLabel(maps.overrides[catalogId] || maps.custom.get(catalogId)?.label || source?.title || source?.sourceTitle || source?.name || fallback, fallback);
  if (label === catalogId || /app\.xperience/i.test(label) || /^tmdb\s+discover\s+[a-z0-9_-]{6,}(?:\s+(?:movies|series))?$/i.test(label)) return fallback;
  return label;
}

function discoverRecipe(catalogId, mediaType, config) {
  const all = config.discover_catalogs;
  const raw = plainObject(all) ? all[catalogId] : null;
  if (!plainObject(raw)) throw Object.assign(new Error('Missing TMDB Discover definition'), { code: 'missing_recipe' });
  for (const key of Object.keys(raw)) if (!DISCOVER_KEYS.has(key)) throw Object.assign(new Error(`Unsupported TMDB Discover field "${key}"`), { code: 'unsupported_field' });
  if (!plainObject(raw.filters || {})) throw Object.assign(new Error('Discover filters must be an object'), { code: 'invalid_recipe' });
  const filters = {};
  for (const [key, value] of Object.entries(raw.filters || {})) {
    let mapped = FILTER_MAP[key];
    if (key === 'releaseDateGte') mapped = mediaType === 'series' ? 'first_air_date.gte' : 'primary_release_date.gte';
    if (key === 'releaseDateLte') mapped = mediaType === 'series' ? 'first_air_date.lte' : 'primary_release_date.lte';
    if (key === 'year') mapped = mediaType === 'series' ? 'first_air_date_year' : 'year';
    if (!mapped) throw Object.assign(new Error(`Unsupported Xperience filter "${key}"`), { code: 'unsupported_filter' });
    filters[mapped] = value;
  }
  const originalSort = raw.sort_by || raw.sortBy || 'popularity.desc';
  // A published Xperience v1 preset family serialised the movie release-date
  // sort on TV Discover sources. TMDB's equivalent TV semantic is explicitly
  // first_air_date in the same direction; translate only this exact legacy
  // pair and leave every other unsupported TV sort to validation.
  const sortBy = mediaType === 'series' && /^primary_release_date\.(asc|desc)$/.test(originalSort)
    ? originalSort.replace('primary_release_date', 'first_air_date')
    : originalSort;
  return {
    definition: { provider: 'tmdb', engine: 'discover', mediaType, params: { sortBy, filters } },
    compatibility: sortBy !== originalSort ? 'xperience_v1_tv_release_sort' : '',
  };
}

function recipeFor(catalogId, type, config) {
  const mediaType = type === 'series' ? 'series' : 'movie';
  let match = catalogId.match(/^tmdb_discover_([A-Za-z0-9_-]{6,160})_(movies|series)$/);
  if (match) return discoverRecipe(catalogId, match[2] === 'series' ? 'series' : 'movie', config);
  match = catalogId.match(/^tmdb_list_(\d{1,10})_(movies|series)$/);
  if (match) return { definition: { provider: 'tmdb', engine: 'list', mediaType: match[2] === 'series' ? 'series' : 'movie', params: { listId: Number(match[1]) } }, compatibility: '' };
  match = catalogId.match(/^tmdb_collection_(\d{1,10})_movies$/);
  if (match) return { definition: { provider: 'tmdb', engine: 'collection', mediaType: 'movie', params: { collectionId: Number(match[1]) } }, compatibility: '' };
  match = catalogId.match(/^trakt_list_(\d{1,10})_(movies|series)$/);
  if (match) return { definition: { provider: 'trakt', engine: 'list', mediaType: match[2] === 'series' ? 'series' : 'movie', params: { listId: Number(match[1]) } }, compatibility: '' };
  throw Object.assign(new Error('Unsupported Xperience source family'), { code: 'unsupported_family' });
}

function fallbackLabel(recipe) {
  if (recipe.provider === 'trakt') return 'Trakt List';
  if (recipe.engine === 'collection') return 'TMDB Collection';
  if (recipe.engine === 'list') return 'TMDB List';
  return 'TMDB Discover';
}

// Presentation-only category for the import review. This never participates
// in recipe resolution or matching, so opaque Xperience ids remain untrusted.
function reviewCategory(catalogId, recipe = null) {
  if (recipe) {
    if (recipe.provider === 'trakt') return 'Trakt public lists';
    if (recipe.engine === 'collection') return 'TMDB collections';
    if (recipe.engine === 'list') return 'TMDB public lists';
    return 'TMDB Discover';
  }
  const id = String(catalogId || '').toLowerCase();
  if (id.startsWith('streaming')) return 'Streaming services';
  if (id.startsWith('snoak')) return 'Snoak catalogues';
  if (id.startsWith('kb')) return 'Knowledge-base catalogues';
  if (id.startsWith('mdblist')) return 'MDBList catalogues';
  if (id.startsWith('actor')) return 'TMDB actors';
  if (id.startsWith('genre')) return 'TMDB genres';
  if (id.startsWith('studio')) return 'TMDB studios';
  if (id.startsWith('collection')) return 'TMDB collections';
  if (id.startsWith('label')) return 'TMDB labels';
  if (id.startsWith('themed')) return 'TMDB themed catalogues';
  if (id.startsWith('trakt')) return 'Trakt catalogues';
  if (id.startsWith('tmdb') || /^(trending|now|upcoming|on_|airing|new)/.test(id)) return 'TMDB built-in catalogues';
  return 'Xperience catalogues';
}

function compileReference(raw, config, maps, definitions, review, contextLabel, compatibilityTranslations) {
  if (!plainObject(raw)) return null;
  const catalogId = String(raw.catalogId || raw.catalog_id || raw.id || '').trim();
  if (!catalogId || catalogId.length > 240) return null;
  const type = raw.type === 'series' || /_series$/.test(catalogId) ? 'series' : 'movie';
  try {
    const generated = recipeFor(catalogId, type, config);
    const recipe = generated.definition;
    if (generated.compatibility) compatibilityTranslations?.add(`${generated.compatibility}:${catalogId}`);
    const custom = maps.custom.get(catalogId);
    if (custom?.provider != null && String(custom.provider).toLowerCase() !== recipe.provider) {
      throw Object.assign(new Error('Custom list provider does not match its source id'), { code: 'provider_mismatch' });
    }
    if (custom?.mediaType != null && String(custom.mediaType).toLowerCase() !== recipe.mediaType) {
      throw Object.assign(new Error('Custom list media type does not match its source id'), { code: 'media_type_mismatch' });
    }
    const label = sourceLabel(catalogId, raw, maps, fallbackLabel(recipe));
    const normalized = normalizeImportedSourceDefinition({
      ...recipe,
      label,
      provenance: { adapter: 'xperience-v1', originHash: stableOrigin('source', catalogId), importedLabel: label },
    });
    const existing = exactStaticMatch(normalized);
    review.push({ label, category: reviewCategory(catalogId, recipe), provider: normalized.provider, mediaType: normalized.mediaType, status: existing ? 'library_match' : 'private_imported', context: contextLabel, recipeKey: normalized.signature });
    if (existing) {
      return { catalogId: existing.catalogId, type: normalized.mediaType, title: label, _import: { adapter: 'xperience-v1', originHash: normalized.provenance.originHash, signature: normalized.signature } };
    }
    definitions.set(normalized.id, normalized);
    return { catalogId: normalized.id, type: normalized.mediaType, title: label, _import: { adapter: 'xperience-v1', originHash: normalized.provenance.originHash, signature: normalized.signature } };
  } catch (error) {
    const label = sourceLabel(catalogId, raw, maps, 'Unsupported imported source');
    review.push({ label, category: reviewCategory(catalogId), provider: 'unknown', mediaType: type, status: 'unsupported', reason: error.code || 'unsupported', context: contextLabel, recipeKey: stableOrigin('source', catalogId) });
    return { unsupported: true, title: label, type, reason: error.code || 'unsupported', _import: { adapter: 'xperience-v1', originHash: stableOrigin('source', catalogId) } };
  }
}

function convertFolder(raw, collectionIndex, folderIndex, config, maps, definitions, review, counters, compatibilityTranslations) {
  const folderIdentity = raw.id || raw.folderId || `${collectionIndex}|${folderIndex}|${raw.title || raw.name || ''}`;
  const originHash = stableOrigin('folder', folderIdentity);
  const rawSources = Array.isArray(raw.catalogSources) ? raw.catalogSources : [];
  counters.references += rawSources.length;
  if (counters.references > MAX_REFERENCES) throw Object.assign(new Error('Too many source references'), { code: 'import_too_large' });
  const compiled = rawSources.map(source => compileReference(source, config, maps, definitions, review, cleanLabel(raw.title || raw.name, 'Folder'), compatibilityTranslations)).filter(Boolean);
  const supported = compiled.filter(source => !source.unsupported);
  const unsupported = compiled.filter(source => source.unsupported);
  const fields = presentation(raw, {
    title: ['title', 'name'], tileShape: ['tileShape'], hideTitle: ['hideTitle'],
    focusGifEnabled: ['focusGifEnabled'], showAllTab: ['showAllTab'],
  }, { title: 'Folder', tileShape: 'LANDSCAPE', hideTitle: false, focusGifEnabled: false });
  const coverImageUrl = safeArtwork(raw.customCoverImageUrl || raw.coverImageUrl || raw.cover);
  const focusGifUrl = safeArtwork(raw.focusGifUrl);
  const heroBackdropUrl = safeArtwork(raw.heroBackdropUrl || raw.backdropUrl);
  const titleLogoUrl = safeArtwork(raw.titleLogoUrl);
  return {
    id: `folder-import-${originHash.slice(-24)}`,
    title: cleanLabel(fields.title, 'Folder').slice(0, 80),
    tileShape: ['PORTRAIT', 'LANDSCAPE', 'SQUARE'].includes(fields.tileShape) ? fields.tileShape : 'LANDSCAPE',
    hideTitle: fields.hideTitle === true,
    coverImageUrl,
    focusGifEnabled: fields.focusGifEnabled === true && !!focusGifUrl,
    focusGifUrl,
    heroBackdropUrl,
    titleLogoUrl,
    enabled: raw.enabled !== false && supported.length > 0,
    catalogSources: supported,
    _import: {
      adapter: 'xperience-v1', originHash,
      upstreamSourceIds: supported.map(source => source.catalogId),
      unsupported: unsupported.map(source => ({ title: source.title, reason: source.reason })),
    },
  };
}

function convertCollection(raw, index, config, maps, definitions, review, counters, compatibilityTranslations) {
  const identity = raw.id || raw.collectionId || `${index}|${raw.title || raw.name || ''}`;
  const originHash = stableOrigin('collection', identity);
  const rawFolders = Array.isArray(raw.folders) ? raw.folders : [];
  counters.folders += rawFolders.length;
  if (counters.folders > MAX_FOLDERS) throw Object.assign(new Error('Too many folders'), { code: 'import_too_large' });
  const fields = presentation(raw, {
    title: ['title', 'name'], tileShape: ['tileShape'], pinToTop: ['pinToTop'],
    focusGlowEnabled: ['focusGlowEnabled'], showAllTab: ['showAllTab'], viewMode: ['viewMode'], hideTitle: ['hideTitle'],
  }, { title: 'Imported collection', tileShape: 'LANDSCAPE', pinToTop: false, focusGlowEnabled: true, showAllTab: true, viewMode: 'TABBED_GRID', hideTitle: false });
  return {
    id: `collection-import-${originHash.slice(-24)}`,
    title: cleanLabel(fields.title, 'Imported collection').slice(0, 80),
    tileShape: ['PORTRAIT', 'LANDSCAPE', 'SQUARE'].includes(fields.tileShape) ? fields.tileShape : 'LANDSCAPE',
    pinToTop: fields.pinToTop === true,
    focusGlowEnabled: fields.focusGlowEnabled !== false,
    showAllTab: fields.showAllTab !== false,
    viewMode: ['TABBED_GRID', 'GRID'].includes(fields.viewMode) ? fields.viewMode : 'TABBED_GRID',
    hideTitle: fields.hideTitle === true,
    heroBackdropUrl: safeArtwork(raw.backdropImageUrl || raw.heroBackdropUrl || raw.backdropUrl),
    folders: rawFolders.map((folder, fi) => convertFolder(folder || {}, index, fi, config, maps, definitions, review, counters, compatibilityTranslations)),
    _import: { adapter: 'xperience-v1', originHash },
  };
}

function convertHomeRows(rawRows, config, maps, definitions, review, compatibilityTranslations) {
  return (Array.isArray(rawRows) ? rawRows : []).slice(0, 500).map((row, index) => {
    const source = plainObject(row?.source) ? row.source : row;
    const compiled = compileReference(source || {}, config, maps, definitions, review, 'Home', compatibilityTranslations);
    if (!compiled) return null;
    const isPrivate = String(compiled.catalogId || '').startsWith('imp_');
    if (isPrivate || compiled.unsupported) {
      review.push({
        label: cleanLabel(row.title || row.name || compiled.title, 'Imported row'),
        category: isPrivate ? reviewCategory('', definitions.get(compiled.catalogId)) : reviewCategory(source?.catalogId || source?.id),
        provider: isPrivate ? (definitions.get(compiled.catalogId)?.provider || 'unknown') : 'unknown',
        mediaType: compiled.type,
        status: 'needs_review',
        reason: isPrivate ? 'private_home_rows_not_supported' : compiled.reason,
        context: 'Home',
        recipeKey: stableOrigin('home-review', row.id || `${index}|${source?.catalogId || ''}`),
      });
    }
    return {
      id: `home-import-${stableOrigin('home', row.id || `${index}|${source?.catalogId || ''}`).slice(-24)}`,
      title: cleanLabel(row.title || row.name || compiled.title, 'Imported row').slice(0, 80),
      source: compiled.unsupported ? { catalogId: '', type: compiled.type } : compiled,
      enabled: row.enabled !== false && !compiled.unsupported && !isPrivate,
      order: index,
      _import: { adapter: 'xperience-v1', originHash: stableOrigin('home', row.id || `${index}|${source?.catalogId || ''}`), needsReview: isPrivate || compiled.unsupported, reason: isPrivate ? 'private_home_rows_not_supported' : compiled.reason },
    };
  }).filter(Boolean);
}

function convertXperienceV1(document) {
  // Xperience's published v1 export uses `exportType`; earlier fixture/export
  // variants used `type`. Accept either exact marker, but never let a
  // conflicting pair broaden the accepted document shape.
  const declaredType = plainObject(document)
    ? (document.type == null ? document.exportType : document.type)
    : null;
  const conflictingType = plainObject(document)
    && document.type != null && document.exportType != null
    && document.type !== document.exportType;
  if (!plainObject(document) || conflictingType || declaredType !== 'xperienceProfile' || Number(document.exportVersion) !== 1) {
    throw Object.assign(new Error('This is not a supported Xperience v1 profile export'), { code: 'unsupported_export' });
  }
  const config = plainObject(document.config) ? document.config : null;
  if (!config) throw Object.assign(new Error('Xperience export is missing its configuration'), { code: 'invalid_export' });
  const collectionsRaw = Array.isArray(config.collections) ? config.collections : [];
  if (collectionsRaw.length > MAX_COLLECTIONS) throw Object.assign(new Error('Too many collections'), { code: 'import_too_large' });
  const maps = labelMaps(config);
  const definitions = new Map();
  const review = [];
  const counters = { folders: 0, references: 0 };
  const compatibilityTranslations = new Set();
  const collections = collectionsRaw.map((collection, index) => convertCollection(collection || {}, index, config, maps, definitions, review, counters, compatibilityTranslations));
  const rawHome = config.home_rows || config.homeRows || config.home?.rows || [];
  const homeRows = convertHomeRows(rawHome, config, maps, definitions, review, compatibilityTranslations);
  if (definitions.size > MAX_DEFINITIONS) throw Object.assign(new Error('Too many imported source definitions'), { code: 'import_too_large' });
  // A source can be referenced by several folders. Review and summary counts
  // describe unique source recipes/origins, not folder reference count.
  const uniqueReview = [];
  const seenReview = new Set();
  for (const item of review) {
    const key = `${item.status}|${item.recipeKey || ''}`;
    if (seenReview.has(key)) continue;
    seenReview.add(key);
    uniqueReview.push(item);
  }
  const sourceReview = uniqueReview.filter(item => item.status !== 'needs_review');
  const warnings = [];
  const unsupported = sourceReview.filter(item => item.status === 'unsupported');
  const needsReview = homeRows.filter(row => row._import?.needsReview);
  if (unsupported.length) warnings.push(`${unsupported.length} source${unsupported.length === 1 ? '' : 's'} could not be converted exactly.`);
  if (compatibilityTranslations.size) warnings.push(`${compatibilityTranslations.size} legacy Xperience TV date sort${compatibilityTranslations.size === 1 ? ' was' : 's were'} translated to TMDB first-air-date order.`);
  if (needsReview.length) warnings.push(`${needsReview.length} private or unsupported Home row${needsReview.length === 1 ? '' : 's'} require review and were disabled.`);
  return {
    adapter: 'xperience-v1',
    profileName: cleanLabel(document.name || config.profile_name || config.profileName || config.name, 'Imported Xperience profile').slice(0, 80),
    importRoot: stableOrigin('profile', document.id || document.profileId || document.profile_id || 'profile'),
    collections,
    homeRows,
    sources: [...definitions.values()].sort((a, b) => a.id.localeCompare(b.id)),
    review: uniqueReview,
    warnings,
    summary: {
      sourcesFound: sourceReview.length,
      libraryMatches: sourceReview.filter(item => item.status === 'library_match').length,
      privateSources: sourceReview.filter(item => item.status === 'private_imported').length,
      unsupported: unsupported.length,
      needsReview: needsReview.length,
      requiresXperience: 0,
      collections: collections.length,
      folders: counters.folders,
    },
  };
}

module.exports = { convertXperienceV1, safeArtwork, recipeFor, reviewCategory, MAX_COLLECTIONS, MAX_FOLDERS, MAX_REFERENCES, MAX_DEFINITIONS };
