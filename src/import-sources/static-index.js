const { catalogs } = require('../catalogdefs');
const { normalizeImportedSourceDefinition } = require('./definition');

function staticDefinition(id, def) {
  if (!def || def.deferred || def.params?.needsSource || !['movie', 'series'].includes(def.type)) return null;
  const p = def.params || {};
  const mediaType = def.type === 'series' ? 'series' : 'movie';
  let candidate = null;
  switch (def.handler) {
    case 'tmdb_collection':
      candidate = { provider: 'tmdb', engine: 'collection', mediaType, params: { collectionId: p.collectionId } };
      break;
    case 'tmdb_list':
      candidate = { provider: 'tmdb', engine: 'list', mediaType, params: { listId: p.listId } };
      break;
    case 'trakt_list':
      candidate = { provider: 'trakt', engine: 'list', mediaType, params: { listId: p.listId } };
      break;
    case 'tmdb_discover':
      candidate = { provider: 'tmdb', engine: 'discover', mediaType, params: { sortBy: p.tmdb?.sort_by || p.sort, filters: { ...(p.tmdb || {}) } } };
      if (candidate.params.filters) delete candidate.params.filters.sort_by;
      break;
    case 'tmdb_genre':
      candidate = { provider: 'tmdb', engine: 'discover', mediaType, params: { sortBy: p.sort, filters: { with_genres: p.genreIds ? p.genreIds.join(',') : p.genreId } } };
      break;
    case 'tmdb_company':
      candidate = { provider: 'tmdb', engine: 'discover', mediaType, params: { sortBy: p.sort, filters: { with_companies: p.companyId } } };
      break;
    case 'tmdb_keyword':
      candidate = { provider: 'tmdb', engine: 'discover', mediaType, params: { sortBy: p.sort, filters: { with_keywords: p.keywordId } } };
      break;
    case 'tmdb_network':
      // The legacy generated HBO movie row is declared as movie but its
      // handler is TV-only. It cannot be an exact semantic match.
      if (def.type !== 'series') return null;
      candidate = { provider: 'tmdb', engine: 'discover', mediaType: 'series', params: { sortBy: p.sort, filters: { with_networks: p.networkId } } };
      break;
    case 'tmdb_person':
      candidate = { provider: 'tmdb', engine: 'discover', mediaType: 'movie', params: { filters: { [p.director ? 'with_crew' : 'with_cast']: p.personId } } };
      break;
    case 'tmdb_provider':
      candidate = { provider: 'tmdb', engine: 'discover', mediaType, params: { sortBy: p.sort, filters: { with_watch_providers: p.providerId, watch_region: 'US' } } };
      break;
    default:
      return null;
  }
  try {
    const normalized = normalizeImportedSourceDefinition({ ...candidate, label: def.name || id, provenance: { adapter: 'lelibrary-static', originHash: id } });
    return { catalogId: `lib-${id}`, id, definition: normalized };
  } catch {
    return null;
  }
}

function buildStaticSignatureIndex(sourceCatalogs = catalogs) {
  const bySignature = new Map();
  for (const id of Object.keys(sourceCatalogs).sort()) {
    const entry = staticDefinition(id, sourceCatalogs[id]);
    if (!entry) continue;
    const existing = bySignature.get(entry.definition.signature);
    if (!existing || entry.catalogId.localeCompare(existing.catalogId) < 0) bySignature.set(entry.definition.signature, entry);
  }
  return bySignature;
}

const STATIC_SIGNATURE_INDEX = buildStaticSignatureIndex();

function exactStaticMatch(definition) {
  const normalized = normalizeImportedSourceDefinition(definition);
  return STATIC_SIGNATURE_INDEX.get(normalized.signature) || null;
}

module.exports = { staticDefinition, buildStaticSignatureIndex, exactStaticMatch, STATIC_SIGNATURE_INDEX };
