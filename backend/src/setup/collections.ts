// Stored setup documents are canonical: a folder source always names the real
// LeLibrary catalogue (`lib-<id>`). Older account exports, community packs and
// imported collections carried the internal routing id instead, which the
// studio would then display verbatim ("lelibrary-curated-movie,lib-trending_movies").
// Heal the document on save so reopening a setup shows plain catalogue names and
// a re-save never writes the internal form back. The collection plan applies the
// same upgrade on every push, so an un-reopened setup is fixed at install time
// even if it is never saved again.
const { upgradeCuratedSourceId } = require('../catalog/collection-plan.ts') as {
  upgradeCuratedSourceId: (catalogId: unknown, genre: unknown, type: unknown) => string;
};
const { getSourceDefinition } = require('../catalog/catalog-source-registry.ts') as {
  getSourceDefinition: (id: unknown) => { type?: string } | null;
};

function normaliseSource(source: unknown): unknown {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
  const record = source as Record<string, unknown>;
  const upgraded = upgradeCuratedSourceId(record['catalogId'], record['genre'], record['type']);
  if (!upgraded) return source;
  // The recovered source is authoritative: a document written before a source
  // changed media type can still claim the old one.
  const definition = getSourceDefinition(upgraded.slice(4));
  return {
    ...record,
    catalogId: upgraded,
    type: definition ? (definition.type === 'series' ? 'series' : 'movie') : record['type'],
  };
}

function normaliseFolder(folder: unknown): unknown {
  if (!folder || typeof folder !== 'object' || Array.isArray(folder)) return folder;
  const record = folder as Record<string, unknown>;
  if (!Array.isArray(record['catalogSources'])) return folder;
  return { ...record, catalogSources: record['catalogSources'].map(normaliseSource) };
}

function normaliseCollection(collection: unknown): unknown {
  if (!collection || typeof collection !== 'object' || Array.isArray(collection)) return collection;
  const record = collection as Record<string, unknown>;
  if (!Array.isArray(record['folders'])) return collection;
  return { ...record, folders: record['folders'].map(normaliseFolder) };
}

// Returns the config unchanged unless it carries a collections document.
function normaliseSetupConfigCollections<T>(config: T): T {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
  const record = config as Record<string, unknown>;
  if (!Array.isArray(record['collections'])) return config;
  return { ...record, collections: record['collections'].map(normaliseCollection) } as T;
}

export interface SetupCollectionsApi {
  normaliseSetupConfigCollections: <T>(config: T) => T;
}

module.exports = { normaliseSetupConfigCollections } satisfies SetupCollectionsApi;
