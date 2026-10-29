// @ts-nocheck
// Shared compilation of an account Collection context into the small set of
// things the addon and its platform adapters need.  The editor stores a
// friendly document; neither app.ts nor the Nuvio push code should each invent
// their own interpretation of that document.

function sourceCatalogId(source = {}) {
  return String(source.catalogId || source.id || '').trim();
}

// Older pushes, imported documents and community exports carry the internal
// routing id inside the catalogue id (optionally with the real source id after
// a comma). Recover the source so reopening and re-pushing upgrades it to the
// manifest-exact contract instead of keeping the internal string. Shared with
// the setup store, which heals a stored document on save.
const LEGACY_CURATED_ID = /^lelibrary-curated-(movie|series)(?:,(lib-[a-z0-9_]+))?$/;

function upgradeCuratedSourceId(catalogId, genre, type) {
  const match = String(catalogId || '').trim().match(LEGACY_CURATED_ID);
  if (!match) return '';
  const raw = match[2] || String(genre || '').trim();
  if (raw.startsWith('lib-')) return raw;
  const { resolveCuratedSourceLabel } = require('./curated-collections.ts');
  const resolved = resolveCuratedSourceLabel(raw, match[1] || type);
  return resolved ? `lib-${resolved}` : '';
}

function companionGatewayLabel(binding = {}) {
  return `${String(binding.label || binding.addonName || binding.catalogId || 'External catalogue').slice(0, 100)} · ${String(binding.catalogId || '').slice(0, 240)}`.slice(0, 160);
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
    ...(typeof source.externalSourceId === 'string' && source.externalSourceId.trim()
      ? { externalSourceId: source.externalSourceId.trim() }
      : {}),
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

// The LeLibrary hub's Movies and Shows tiles use LeLibrary's own artwork, not
// a choice the person made: a setup saved before the current art keeps the old
// cover and no focus GIF in its document, so the current art is applied here,
// for every push and export. Mirrors frontend shared/collection-doc.ts.
const HUB_FOLDER_ART: Record<string, { coverImageUrl: string; focusGifUrl: string }> = {
  'folder-lelibrary-hub-movies': {
    coverImageUrl: '/collection-assets/collections/covers/lelibrary-hub-movies-v3.jpg',
    focusGifUrl: '/collection-assets/collections/gifs/lelibrary-hub-movies-focus-v3.gif',
  },
  'folder-lelibrary-hub-shows': {
    coverImageUrl: '/collection-assets/collections/covers/lelibrary-hub-shows-v3.jpg',
    focusGifUrl: '/collection-assets/collections/gifs/lelibrary-hub-shows-focus-v3.gif',
  },
};

// `generatedArt` maps folder id -> cover parts (TMDB poster/backdrop/logo paths
// from the folder's own catalogue, see generated-covers.ts collectGeneratedArt).
// Only folders without hand-made art use it; folders with art keep their URLs.
function compileCollectionPlan({ collections = [], homeRows = [], sources = [], externalSources = [], manifestId = '', integration = 'nuvio', hideAnime = false, generatedArt = null } = {}) {
  const safeCollections = Array.isArray(collections) ? collections : [];
  const safeHomeRows = Array.isArray(homeRows) ? homeRows : [];
  // LeLibrary Collections is a native collection, not a Home row. It is always
  // at the very bottom of the collections list. Previously it was toggled via
  // a pseudo Home row (catalogId torbox-collections) - that row is now removed
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
  const companionDefinitions = new Map();
  const usedCompanionDefinitions = new Map();
  for (const source of Array.isArray(sources) ? sources : []) {
    try {
      const normalized = require('../import-sources/definition.ts').normalizeImportedSourceDefinition(source);
      importedDefinitions.set(normalized.id, normalized);
    } catch {
      warnings.push('An invalid imported source definition was ignored.');
    }
  }
  for (const binding of Array.isArray(externalSources) ? externalSources : []) {
    const id = String(binding?.id || '').trim();
    if (!/^ext_[a-f0-9]{64}$/.test(id) || binding?.resolution !== 'companion') continue;
    companionDefinitions.set(id, binding);
  }

  function visit(source, placement = 'folder') {
    const normalized = cloneSource(source, manifestId);
    if (!normalized.catalogId) return normalized;
    // Older hosted exports persisted the compact private reference inside the
    // catalogue id. Recover it before validation so reopening and re-pushing
    // an old setup upgrades it to the exact manifest-id + genre contract.
    const legacyPrivateRef = normalized.catalogId.match(/^lelibrary-import-(movie|series),(imp_[a-f0-9]{64})$/);
    if (legacyPrivateRef && isLeLibrarySource(source, manifestId)) {
      normalized.catalogId = legacyPrivateRef[2];
      normalized.type = legacyPrivateRef[1];
    }
    const legacyCuratedRef = normalized.catalogId.match(LEGACY_CURATED_ID);
    if (legacyCuratedRef && isLeLibrarySource(source, manifestId)) {
      const recovered = upgradeCuratedSourceId(normalized.catalogId, normalized.genre, normalized.type);
      if (recovered) {
        normalized.catalogId = recovered;
        const { getSourceDefinition } = require('./catalog-source-registry.ts');
        const definition = getSourceDefinition(recovered.slice(4));
        if (definition) normalized.type = definition.type === 'series' ? 'series' : 'movie';
      }
    }
    if (hideAnime && isAnimeSource(source)) return { ...normalized, catalogId: '' };
    const own = isLeLibrarySource(source, manifestId);
    if (placement === 'home' && own) selectedCatalogIds.add(normalized.catalogId);
    if (normalized.catalogId.startsWith('lib-') && isLeLibrarySource(source, manifestId)) {
      const libraryId = normalized.catalogId.slice(4);
      libraryIds.add(libraryId);
      if (placement === 'home') homeLibraryIds.add(libraryId);
      else folderLibraryIds.add(libraryId);
      // Nuvio folders share one compact catalogue per media type. The manifest
      // advertises that exact id and nothing else, so the folder source's
      // catalogue id MUST be it: Nuvio resolves a folder source against the
      // installed manifest, and a comma-suffixed internal id is shown raw and
      // only loads through a client-side fallback. The original source travels
      // in `genre`, which Nuvio renders on the folder tab and the catalogue
      // handler resolves back through the shared label index. This keeps a
      // 90-folder setup to two addon catalogues without a mobile Nuvio crash
      // from an oversized manifest.
      if (placement === 'folder' && integration === 'nuvio') {
        const { curatedFolderLabel } = require('./curated-collections.ts');
        const { getSourceDefinition } = require('./catalog-source-registry.ts');
        const definition = getSourceDefinition(libraryId);
        if (definition) normalized.type = definition.type === 'series' ? 'series' : 'movie';
        normalized.catalogId = `lelibrary-curated-${normalized.type}`;
        normalized.genre = (curatedFolderLabel(`lib-${libraryId}`, normalized.type) || `lib-${libraryId}`).slice(0, 160);
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
      // exact and carry a human-readable genre: Nuvio renders each folder
      // source tab as "<catalog name> · <genre>", so an opaque imp_* hash
      // would be visible in the UI. The server resolves the human label back
      // to the signed definition (hashes remain accepted for old pushes).
      normalized.catalogId = `lelibrary-import-${normalized.type}`;
      normalized.genre = String(definition.label || definition.id).slice(0, 160);
    }
    if (normalized.externalSourceId) {
      const binding = companionDefinitions.get(normalized.externalSourceId);
      const exact = binding
        && String(binding.addonId || '') === normalized.addonId
        && String(binding.catalogId || '') === normalized.catalogId
        && String(binding.mediaType || '') === normalized.type
        && String(binding.genre || '') === normalized.genre;
      if (!exact) {
        warnings.push('A missing or mismatched companion addon reference was ignored.');
        normalized.catalogId = '';
        return normalized;
      }
      if (typeof binding.manifestUrl === 'string' && binding.manifestUrl) {
        externalAddons.set(`${normalized.addonId}\u0000${binding.manifestUrl}`, { addonId: normalized.addonId, addonUrl: binding.manifestUrl });
      }
      importedTypes.add(normalized.type);
      usedCompanionDefinitions.set(binding.id, {
        ...binding,
        gatewayLabel: companionGatewayLabel(binding),
      });
    }
    if (!isLeLibrarySource(source, manifestId) && normalized.addonId && normalized.addonUrl) {
      externalAddons.set(`${normalized.addonId}\u0000${normalized.addonUrl}`, { addonId: normalized.addonId, addonUrl: normalized.addonUrl });
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
      const hubArt = HUB_FOLDER_ART[String(folder?.id || '')];
      const folderId = folder?.id || `folder-${ci}-${fi}`;
      const merged = { ...folder, ...(hubArt ? { ...hubArt, focusGifEnabled: true } : {}) };
      const parts = generatedArt && typeof generatedArt === 'object' ? generatedArt[folderId] : null;
      const generated = parts && !require('./generated-covers.ts').folderHasArt(merged)
        ? require('./generated-covers.ts').generatedFolderArtwork(merged, parts)
        : {};
      return ({
      ...merged,
      ...generated,
      id: folderId,
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
    externalAddons: [...externalAddons.values()],
    importedTypes: [...importedTypes].sort(),
    externalBindings: [...usedCompanionDefinitions.values()],
    warnings,
    nativeFranchiseCollection: nativeFranchiseRow && {
      enabled: nativeFranchiseRow.row?.enabled !== false,
      order: nativeFranchiseRow.order,
    },
  };
}

export interface CollectionPlanApi {
  compileCollectionPlan: any;
  upgradeCuratedSourceId: any;
  isLeLibrarySource: any;
  isAnimeSource: any;
  sourceCatalogId: any;
  companionGatewayLabel: any;
}

module.exports = { compileCollectionPlan, upgradeCuratedSourceId, isLeLibrarySource, isAnimeSource, sourceCatalogId, companionGatewayLabel } satisfies CollectionPlanApi;
