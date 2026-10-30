// @ts-nocheck
// ── Curated catalog source registry ───────────────────────────
//
// This is the single backend-facing contract for selectable LeLibrary sources.
// The generated catalogdefs table holds the implementation details; callers
// use this registry for stable ids, labels, categories and availability.

const { catalogs } = require('./catalogdefs.ts');

const HANDLERS = new Set([
  'tmdb_source', 'tmdb_provider', 'tmdb_genre', 'tmdb_company',
  'tmdb_person', 'tmdb_keyword', 'tmdb_collection', 'tmdb_network',
  'tmdb_discover', 'mdb_list', 'trakt',
]);

// The Home picker's "Suggested" shelf: rows that suit most Homes and work
// with just the TMDB key (or no key at all). Order is the shelf order.
const FEATURED_IDS = new Set([
  'now_playing_movies', 'upcoming_movies', 'airing_today_series',
  'new_latest_releases_movies', 'chart_watched_week_movies',
  'chart_moviemeter_movies', 'trending_imdb_top100_movies',
  'chart_imdb_top_shows_series', 'chart_metacritic_movies',
  'chart_bluray_movies', 'streaming_latest_netflix_movies',
  'streaming_latest_netflix_series', 'streaming_latest_disney_series',
  'anime_new_series', 'chart_trending_anime_series', 'themed_mindfuck',
])

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

// Rows whose plain name is shared with a sibling get a clearer one.
const NAME_OVERRIDES = {
  collection_mcu: 'Marvel Cinematic Universe',
  themed_horror_classics_movies: 'Horror Classics',
  themed_modern_horror_movies: 'Modern Horror',
  studio_dc_animation_movies: 'DC Animation',
  studio_dc_animation_series: 'DC Animation',
  studio_marvel_animation_movies: 'Marvel Animation',
  studio_marvel_animation_series: 'Marvel Animation',
};

// Kept working for saved setups, never offered in the pickers: private
// numeric MDBList lists that all read "Horror", and an MDBList copy of
// TMDB's Airing Today row.
const PICKER_HIDDEN = new Set([
  'mdblist_list_106567_movies', 'mdblist_list_120687_movies',
  'mdblist_list_28062_movies', 'mdblist_list_4853_movies',
  'new_latest_airing_shows_series',
]);

function displayName(source) {
  if (NAME_OVERRIDES[source?.id]) return NAME_OVERRIDES[source.id];
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
  // "Action", "Action" and "Action" were the popular, newest and best-rated
  // rows of one genre or studio.
  const id = String(source?.id || '');
  if (name && /_latest_(?:movies|series)$/.test(id)) return `Latest ${name}`;
  if (name && /_toprated_(?:movies|series)$/.test(id)) return `Top Rated ${name}`;
  return name;
}

// Countries a row has titles in, when it is regional: the streaming
// services table (keyed by the movie row) and the MDBList charts that are
// one country's top 10. No entry = everywhere.
function sourceRegions(source) {
  const { REGIONS, GLOBAL } = require('./curated-regions-58.ts');
  const movieId = String(source.id).replace(/_series$/, '_movies');
  if (GLOBAL.has(movieId)) return null;
  const listed = REGIONS[source.id] || REGIONS[movieId];
  if (Array.isArray(listed)) return listed;
  if (/ in Canada$/i.test(String(source.params?.listName || ''))) return ['CA'];
  return null;
}

function getSourceDefinition(id) {
  // Keep older saved folders working after the streaming source IDs were
  // renamed. New manifests and the wizard only publish the clean IDs.
  const sourceId = String(id || '').replace(/^lib-/, '').replace(/^snoak_/, 'streaming_');
  const definition = catalogs[sourceId];
  if (!definition) return null;
  return { id: sourceId, ...definition, ...availability(definition) };
}

// An alias is an old id kept working for saved setups and pushed folders; it
// serves exactly its canonical definition. Unknown ids come back unchanged.
function canonicalSourceId(id) {
  const sourceId = String(id || '').replace(/^lib-/, '').replace(/^snoak_/, 'streaming_');
  return catalogs[sourceId]?.aliasOf || sourceId;
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
      ...(source.aliasOf ? { aliasOf: source.aliasOf } : {}),
      available: source.available,
      unavailableReason: source.reason,
    }))
    .sort((a, b) => Number(b.featured) - Number(a.featured) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

// What the Home row and folder pickers offer: one row per real source.
// Aliases and the hidden rows still serve saved setups, they are just not
// offered again.
function listPickerSources() {
  return listSources()
    .filter((source) => !source.aliasOf && !PICKER_HIDDEN.has(source.id))
    .map((source) => {
      const regions = sourceRegions(getSourceDefinition(source.id));
      return regions ? { ...source, regions } : source;
    });
}

function validateSourceDefinitions() {
  const errors = [];
  for (const [id, definition] of Object.entries(catalogs)) {
    if (!/^[a-z0-9_]+$/.test(id)) errors.push(`${id}: invalid source id`);
    if (!String(definition?.name || '').trim()) errors.push(`${id}: missing display name`);
    if (!['movie', 'series'].includes(definition?.type)) errors.push(`${id}: invalid media type`);
    if (!HANDLERS.has(definition?.handler)) errors.push(`${id}: unsupported handler`);
    if (definition?.aliasOf && (!catalogs[definition.aliasOf] || catalogs[definition.aliasOf].aliasOf)) errors.push(`${id}: unresolvable alias`);
  }
  return { ok: errors.length === 0, errors, total: Object.keys(catalogs).length };
}

export interface CatalogSourceRegistryApi {
  getSourceDefinition: any;
  canonicalSourceId: any;
  listSources: any;
  listPickerSources: any;
  validateSourceDefinitions: any;
}

module.exports = { getSourceDefinition, canonicalSourceId, listSources, listPickerSources, validateSourceDefinitions } satisfies CatalogSourceRegistryApi;
