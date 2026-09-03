// Shared compilation of an account Collection context into the small set of
// things the addon and its platform adapters need.  The editor stores a
// friendly document; neither app.js nor the Nuvio push code should each invent
// their own interpretation of that document.

function sourceCatalogId(source = {}) {
  return String(source.catalogId || source.id || '').trim();
}

function isLeLibrarySource(source = {}, manifestId = '') {
  const addonId = String(source.addonId || '').trim();
  return !addonId || addonId === manifestId || addonId === 'community.lelibrary' || addonId === 'community.lelibrary.dev';
}

function cloneSource(source = {}, manifestId = '') {
  const catalogId = sourceCatalogId(source);
  // A saved wizard document can outlive a prod ↔ dev switch. Treat every
  // recognised LeLibrary identity as the addon being installed right now;
  // retaining `community.lelibrary` while only `community.lelibrary.dev` is
  // installed makes Nuvio report “Addon not found” for My Movies/Shows.
  const addonId = isLeLibrarySource(source, manifestId)
    ? manifestId
    : String(source.addonId || '').trim();
  return {
    addonId,
    addonUrl: typeof source.addonUrl === 'string' ? source.addonUrl.trim() : '',
    catalogId,
    type: source.type === 'series' ? 'series' : 'movie',
    genre: typeof source.genre === 'string' ? source.genre : '',
  };
}

function isAnimeSource(source = {}) {
  if (String(source.type || '').toLowerCase() === 'anime') return true;
  const identity = [sourceCatalogId(source), source.title, source.name, source.category, source.provider, source.addonId]
    .filter(Boolean).join(' ').toLowerCase();
  // Imported addons commonly use dotted package ids (for example
  // `org.stremio.anime`) rather than human-readable catalogue names.
  return /(anime|ghibli|kitsu|anilist|myanimelist|animedb)/.test(identity);
}

function isAnimeFolder(folder = {}) {
  return isAnimeSource(folder) || isAnimeSource({
    title: folder.title,
    name: folder.name,
    category: folder.category,
  });
}

function isAnimeCollection(collection = {}) {
  if (isAnimeSource(collection) || isAnimeSource({
    title: collection.title,
    name: collection.name,
    category: collection.category,
  })) return true;
  // A community collection is one selectable unit. If any of its folders is
  // anime, Hide Anime must remove the whole imported collection rather than
  // leaving a half-empty shell behind.
  return (Array.isArray(collection.folders) ? collection.folders : []).some((folder) =>
    isAnimeFolder(folder) || (Array.isArray(folder?.catalogSources) ? folder.catalogSources : []).some(isAnimeSource)
  );
}

function compileCollectionPlan({ collections = [], homeRows = [], sources = [], manifestId = '', integration = 'nuvio', hideAnime = false } = {}) {
  const safeCollections = Array.isArray(collections) ? collections : [];
  const safeHomeRows = Array.isArray(homeRows) ? homeRows : [];
  // LeLibrary Collections is a native collection, not a Home row. It is always
  // at the very bottom of the collections list. Previously it was toggled via
  // a pseudo Home row (catalogId torbox-collections) — that row is now removed
  // from the Home UI and filtered here. For backward compatibility, an existing
  // stored home row with torbox-collections still controls the toggle, but when
  // absent the franchise is disabled. It is an opt-in Quick Pack, never an
  // implicit collection added just because a user imported another setup.
  const nativeFranchiseRowFromHome = safeHomeRows
    .map((row, index) => ({
      row,
      index,
      catalogId: sourceCatalogId(row?.source || {}),
      order: Number.isFinite(Number(row?.order)) ? Number(row.order) : index,
    }))
    .filter(({ catalogId }) => catalogId === 'torbox-collections')
    .sort((a, b) => a.order - b.order)[0] || null;
  const nativeFranchiseRow = nativeFranchiseRowFromHome || { row: { enabled: false }, order: Number.MAX_SAFE_INTEGER };
  const libraryIds = new Set();
  const folderLibraryIds = new Set();
  const homeLibraryIds = new Set();
  const selectedCatalogIds = new Set();
  const externalAddons = new Map();
  const importedTypes = new Set();
  const warnings = [];
  const importedDefinitions = new Map();
  for (const source of Array.isArray(sources) ? sources : []) {
    try {
      const normalized = require('./import-sources/definition').normalizeImportedSourceDefinition(source);
      importedDefinitions.set(normalized.id, normalized);
    } catch {
      warnings.push('An invalid imported source definition was ignored.');
    }
  }

  function visit(source, placement = 'folder') {
    const normalized = cloneSource(source, manifestId);
    if (!normalized.catalogId) return normalized;
    if (hideAnime && isAnimeSource(source)) return { ...normalized, catalogId: '' };
    const own = isLeLibrarySource(source, manifestId);
    if (placement === 'home' && own) selectedCatalogIds.add(normalized.catalogId);
    if (normalized.catalogId.startsWith('lib-') && isLeLibrarySource(source, manifestId)) {
      const libraryId = normalized.catalogId.slice(4);
      libraryIds.add(libraryId);
      if (placement === 'home') homeLibraryIds.add(libraryId);
      else folderLibraryIds.add(libraryId);
      // Nuvio folders share one compact catalogue per media type. The original
      // lib id travels in genre, which the handler resolves back to the source.
      // This keeps a 90-folder setup to two addon catalogues, avoiding a mobile
      // Nuvio crash from an oversized manifest.
      if (placement === 'folder' && integration === 'nuvio') {
        normalized.catalogId = source.title
          ? `lelibrary-curated-${normalized.type},lib-${libraryId}`
          : `lelibrary-curated-${normalized.type}`;
        normalized.genre = source.title ? String(source.title).slice(0, 160) : `lib-${libraryId}`;
      }
    }
    if (normalized.catalogId.startsWith('imp_') && own) {
      const definition = importedDefinitions.get(normalized.catalogId);
      if (!definition || definition.mediaType !== normalized.type) {
        warnings.push('A missing or mismatched private imported source reference was ignored.');
        normalized.catalogId = '';
        return normalized;
      }
      // Phase 1 reconstructs Nuvio's native folders exactly. Stremio has no
      // folder equivalent, so do not advertise a misleading flat Home row.
      if (integration !== 'nuvio' || placement !== 'folder') {
        warnings.push('Private imported sources are currently available in Nuvio folders only.');
        normalized.catalogId = '';
        return normalized;
      }
      importedTypes.add(normalized.type);
      // Nuvio resolves a folder source against the installed manifest before
      // applying extras. A comma-suffixed internal id is therefore shown as a
      // raw name and never reaches the addon. Keep the manifest catalogue id
      // exact and carry the opaque, authorised source reference in `genre`.
      normalized.catalogId = `lelibrary-import-${normalized.type}`;
      normalized.genre = definition.id;
    }
    if (!isLeLibrarySource(source, manifestId) && normalized.addonId && normalized.addonUrl) {
      externalAddons.set(normalized.addonId, normalized.addonUrl);
    }
    return normalized;
  }

  const normalizedHomeRows = safeHomeRows.map((row, index) => ({
    ...row,
    enabled: row?.enabled !== false,
    order: Number.isFinite(Number(row?.order)) ? Number(row.order) : index,
    source: visit(row?.source || {}, 'home'),
  // `torbox-collections` is the backing catalogue for native Nuvio folders.
  // It returns every franchise film, so exposing it on Home flattens a proper
  // folder collection into one misleading film row.
  })).filter((row) => row.source.catalogId && !(integration === 'nuvio' && row.source.catalogId === 'torbox-collections'));

  const normalizedCollections = safeCollections.map((collection, ci) => {
    if (hideAnime && isAnimeCollection(collection)) return null;
    return ({
    ...collection,
    folders: (Array.isArray(collection?.folders) ? collection.folders : []).map((folder, fi) => {
      if (hideAnime && isAnimeFolder(folder)) return null;
      return ({
      ...folder,
      id: folder?.id || `folder-${ci}-${fi}`,
      catalogSources: (Array.isArray(folder?.catalogSources) ? folder.catalogSources : [])
        .map((source) => visit(source, 'folder'))
        // A flat torbox-collections source exposes every owned franchise film
        // as one list. Franchise navigation is only supported by Nuvio's
        // native generated collection, never by a configurable folder.
        .filter((source) => source.catalogId && !(integration === 'nuvio' && source.catalogId === 'torbox-collections')),
    });
    }).filter((folder) => folder && (!hideAnime || folder.catalogSources.length) && !(folder?._import?.adapter === 'xperience-v1' && folder.enabled === false)),
  });
  }).filter((collection) => collection && (collection.folders.length > 0 || collection?._import?.adapter !== 'xperience-v1'));

  return {
    collections: normalizedCollections,
    homeRows: normalizedHomeRows.sort((a, b) => a.order - b.order),
    libraryIds: [...libraryIds],
    folderLibraryIds: [...folderLibraryIds],
    homeLibraryIds: [...homeLibraryIds],
    selectedCatalogIds: [...selectedCatalogIds],
    externalAddons: [...externalAddons.entries()].map(([addonId, addonUrl]) => ({ addonId, addonUrl })),
    importedTypes: [...importedTypes].sort(),
    warnings,
    nativeFranchiseCollection: nativeFranchiseRow && {
      enabled: nativeFranchiseRow.row?.enabled !== false,
      order: nativeFranchiseRow.order,
    },
  };
}

module.exports = { compileCollectionPlan, isLeLibrarySource, isAnimeSource, sourceCatalogId };
