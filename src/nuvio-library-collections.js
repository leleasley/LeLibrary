// Nuvio-specific projection of LeLibrary's already-built, debrid-owned
// franchise metas.  This module deliberately does not ask TMDB for a
// collection's parts: `metas[].videos` is the owned-only membership compiled
// by src/collections.js.

const LIBRARY_COLLECTION_ID = 'collection-lelibrary-franchises';
const LELIBRARY_HUB_ID = 'collection-lelibrary-hub';

// One declared addon catalogue backs every native Nuvio franchise folder.
// The stable genre value identifies the TMDB collection without advertising a
// separate addon catalogue for every franchise.
function catalogIdForCollection() {
  return 'torbox-collections';
}

function catalogGenreForCollection(collectionId) {
  return `collection-${Number(collectionId)}`;
}

function folderIdForCollection(collectionId) {
  return `lelibrary-tmdb-${Number(collectionId)}`;
}

function filmMeta(video, libraryIdMode = '') {
  return {
    id: libraryIdMode === 'tt' && video.imdbId
      ? video.imdbId
      : `torbox:movie:${String(video.id).split(':').pop()}`,
    type: 'movie',
    name: video.title,
    poster: video.thumbnail ? video.thumbnail.replace('/w300', '/w500') : null,
    releaseInfo: String(video.released || '').slice(0, 4) || undefined,
    released: video.released || undefined,
  };
}

function collectionCatalogMetas(metas, collectionId, libraryIdMode = '') {
  const collection = (metas || []).find((meta) => String(meta.collectionId) === String(collectionId));
  return (collection?.videos || []).map((video) => filmMeta(video, libraryIdMode)).filter((meta) => meta.poster);
}

function buildLibraryCollection(metas, addonId, config = {}) {
  const folders = (metas || [])
    .filter((meta) => Number.isFinite(Number(meta.collectionId)))
    .map((meta) => ({
      id: folderIdForCollection(meta.collectionId),
      title: String(meta.name || 'Collection').replace(/\s+Collection\s*$/i, '').trim() || meta.name,
      tileShape: 'PORTRAIT',
      hideTitle: false,
      focusGifEnabled: false,
      coverImageUrl: meta.poster || '',
      focusGifUrl: '',
      // Production's proven addon-folder contract. Current Nuvio still
      // supports catalogSources as its backwards-compatible representation;
      // use it alone rather than emitting two competing source forms.
      // This endpoint is owned-only and never resolves a TMDB collection.
      catalogSources: [{
        addonId,
        type: 'movie',
        catalogId: catalogIdForCollection(),
        genre: catalogGenreForCollection(meta.collectionId),
      }],
    }));
  return {
    focusGlowEnabled: true,
    id: LIBRARY_COLLECTION_ID,
    // This is a native Nuvio collection, not a normal editable Home catalogue.
    title: 'LeLibrary Collections',
    // The franchise collection is a generated library projection — it is never
    // user-pinnable. Nuvio honours pinToTop independently of array order, so
    // an accidental true here overrides mergeCollectionsInPlace's bottom-slot
    // placement and floats the row to the very top of the app.
    pinToTop: false,
    showAllTab: true,
    viewMode: 'TABBED_GRID',
    folders,
  };
}

// sync_push_collections replaces the complete document. Preserve unrelated
// collections byte-for-byte. When both native LeLibrary entries are enabled,
// keep them together at the bottom: Hub first, then Movie Collections.
function mergeCollectionsInPlace(existing, generated, { removeMissing = () => false } = {}) {
  const requested = (generated || []).filter(Boolean);
  const managed = new Set(requested.map((item) => String(item.id)));
  const out = [];
  for (const item of (existing || [])) {
    const id = String(item?.id || '');
    if (managed.has(id) || removeMissing(item)) {
      continue;
    }
    out.push(item);
  }
  const franchise = requested.find((item) => String(item?.id) === LIBRARY_COLLECTION_ID);
  const hub = requested.find((item) => String(item?.id) === LELIBRARY_HUB_ID);
  const others = requested.filter((item) => {
    const id = String(item?.id);
    return id !== LIBRARY_COLLECTION_ID && id !== LELIBRARY_HUB_ID;
  });
  // A Hub by itself remains a normal user-positioned collection. Pairing it
  // with the generated franchise collection makes a deliberate LeLibrary
  // section at the bottom of the Nuvio Collections page.
  const tail = franchise ? [...(hub ? [{ ...hub, pinToTop: false }] : []), franchise] : (hub ? [hub] : []);
  return [...out, ...others, ...tail];
}

module.exports = {
  LIBRARY_COLLECTION_ID,
  LELIBRARY_HUB_ID,
  catalogIdForCollection,
  catalogGenreForCollection,
  folderIdForCollection,
  filmMeta,
  collectionCatalogMetas,
  buildLibraryCollection,
  mergeCollectionsInPlace,
};
