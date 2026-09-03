// ── Curated catalog source registry ───────────────────────────
//
// This is the single backend-facing contract for selectable LeLibrary sources.
// The generated catalogdefs table holds the implementation details; callers
// use this registry for stable ids, labels, categories and availability.

const { catalogs } = require('./catalogdefs');

const HANDLERS = new Set([
  'tmdb_source', 'tmdb_provider', 'tmdb_genre', 'tmdb_company',
  'tmdb_person', 'tmdb_keyword', 'tmdb_collection', 'tmdb_network',
  'mdb_list', 'trakt',
]);

const FEATURED_IDS = new Set([
  'now_playing_movies', 'upcoming_movies', 'trending_movies',
  'trending_series', 'tmdb_popular_movies', 'tmdb_popular_series',
  'trending_imdb_top100_movies', 'genre_action_movies',
  'genre_comedy_movies', 'genre_horror_movies', 'genre_scifi_movies',
  'collection_marvel_universe_mdb', 'streaming_netflix_movies',
  'trakt_trending_movies', 'trakt_trending_series',
  'trakt_popular_movies', 'trakt_popular_series',
  'trakt_anticipated_movies', 'trakt_anticipated_series',
]);

function cleanCategory(value) {
  return String(value || 'Other').replace(/^[^\w]+\s*/u, '').trim() || 'Other';
}

function availability(definition) {
  if (!definition || !HANDLERS.has(definition.handler)) return { available: false, reason: 'Unsupported source engine' };
  if (definition.deferred || definition.handler === 'trakt') return { available: false, reason: 'Not available yet' };
  if (definition.params?.needsSource) return { available: false, reason: 'Source is not configured' };
  return { available: true, reason: null };
}

function requirements(definition) {
  // Numeric MDBList lists are private API resources. Public slug exports do
  // not need a user key. This reports only the capability, never a secret.
  return definition?.handler === 'mdb_list' && definition.params?.listId ? ['mdblistKey'] : [];
}

function displayName(source) {
  // MDBList-backed streaming rows carry their precise public list label (for
  // example “Latest Netflix Movies” and “Top 10 Netflix Movies in Canada”).
  // Provider rows otherwise share a short provider name, so add the media type
  // to make folder-editor sources unambiguous.
  if (typeof source?.params?.listName === 'string' && source.params.listName.trim()) {
    return source.params.listName.trim();
  }
  const name = String(source?.name || source?.id || '').trim();
  if (cleanCategory(source?.group) === 'Streaming' && name) {
    return `${name} ${source.type === 'series' ? 'Shows' : 'Movies'}`;
  }
  return name;
}

function getSourceDefinition(id) {
  // Keep older saved folders working after the streaming source IDs were
  // renamed. New manifests and the wizard only publish the clean IDs.
  const sourceId = String(id || '').replace(/^lib-/, '').replace(/^snoak_/, 'streaming_');
  const definition = catalogs[sourceId];
  if (!definition) return null;
  return { id: sourceId, ...definition, ...availability(definition) };
}

function listSources({ includeUnavailable = false } = {}) {
  return Object.keys(catalogs).map(getSourceDefinition)
    .filter(Boolean)
    .filter((source) => includeUnavailable || source.available)
    .map((source) => ({
      id: source.id,
      catalogId: `lib-${source.id}`,
      name: displayName(source),
      type: source.type === 'series' ? 'series' : 'movie',
      group: source.group || 'Other',
      category: cleanCategory(source.group),
      icon: source.icon || '🎬',
      engine: source.handler,
      requirements: requirements(source),
      featured: FEATURED_IDS.has(source.id),
      available: source.available,
      unavailableReason: source.reason,
    }))
    .sort((a, b) => Number(b.featured) - Number(a.featured) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

function validateSourceDefinitions() {
  const errors = [];
  for (const [id, definition] of Object.entries(catalogs)) {
    if (!/^[a-z0-9_]+$/.test(id)) errors.push(`${id}: invalid source id`);
    if (!String(definition?.name || '').trim()) errors.push(`${id}: missing display name`);
    if (!['movie', 'series'].includes(definition?.type)) errors.push(`${id}: invalid media type`);
    if (!HANDLERS.has(definition?.handler)) errors.push(`${id}: unsupported handler`);
  }
  return { ok: errors.length === 0, errors, total: Object.keys(catalogs).length };
}

module.exports = { getSourceDefinition, listSources, validateSourceDefinitions };
