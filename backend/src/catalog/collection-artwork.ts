// @ts-nocheck
// Nuvio folder artwork is presentation-only. Catalogue and meta poster
// providers (ERDB/RPDB/TMDB/etc.) remain independent of these URLs.
//
// Generated /covers assets were removed in favour of externally hosted
// collection artwork. Existing saved account documents can still contain the
// old paths, so suppress them instead of sending a dead URL to Nuvio.

// Local collection/people artwork is served with a 30-day immutable cache and
// sits behind Cloudflare, so an optimised asset keeps being served under the
// old URL until the cache expires. Versioning the URL (also rewriting an older
// ?v=) forces every client and CDN to fetch the current, smaller file. Keep in
// step with curated-collections.ts COLLECTION_ASSET_VERSION.
const ASSET_VERSION = '3';
function versionLocalAsset(value) {
  if (typeof value !== 'string' || !value.includes('/collection-assets/')) return value;
  if (/[?&]v=\d+/.test(value)) return value.replace(/([?&]v=)\d+/, `$1${ASSET_VERSION}`);
  return value + (value.includes('?') ? '&' : '?') + `v=${ASSET_VERSION}`;
}

// 5.8 retired the community artwork in /collection-assets/. A saved setup or
// an older push can still name one of those files (relative, or as a full
// link to this host): send the art that replaced it instead of a redirect.
function upgradeRetiredArtwork(value, origin = '') {
  let pathPart = value;
  const host = String(origin || '').replace(/\/+$/, '');
  if (host && value.startsWith(host + '/collection-assets/')) pathPart = value.slice(host.length);
  if (!pathPart.startsWith('/collection-assets/')) return value;
  const { retiredArtworkTarget } = require('./curated-collections.ts');
  return retiredArtworkTarget(pathPart) || value;
}

// Paths this host serves: the Hub art, generated covers and LeLibrary's own
// folder art (fixed files and the Live route). They need the same origin.
const LOCAL_ART = ['/collection-assets/', '/art/generated/', '/collection-art/', '/art/folder/'];

function absoluteLocalArtwork(value, origin = '') {
  if (typeof value !== 'string') return '';
  const clean = versionLocalAsset(upgradeRetiredArtwork(value.trim(), origin));
  if (!LOCAL_ART.some((prefix) => clean.startsWith(prefix))) return clean;
  return origin ? `${String(origin).replace(/\/+$/, '')}${clean}` : clean;
}

// A saved setup's collections as the editor should see them: every artwork
// link full (this host's origin) and every retired community file swapped for
// the art that replaced it. Returns new objects; the saved config is untouched.
const FOLDER_ART_FIELDS = ['coverImageUrl', 'focusGifUrl', 'heroBackdropUrl', 'heroVideoUrl', 'titleLogoUrl'];
function upgradeCollectionArtwork(collections, origin = '') {
  if (!Array.isArray(collections)) return collections;
  return collections.map((collection) => {
    if (!collection || typeof collection !== 'object') return collection;
    const out = { ...collection };
    if (typeof out.backdropUrl === 'string' && out.backdropUrl) out.backdropUrl = absoluteLocalArtwork(out.backdropUrl, origin);
    if (Array.isArray(out.folders)) {
      out.folders = out.folders.map((folder) => {
        if (!folder || typeof folder !== 'object') return folder;
        const next = { ...folder };
        for (const key of FOLDER_ART_FIELDS) {
          if (typeof next[key] === 'string' && next[key]) next[key] = absoluteLocalArtwork(next[key], origin);
        }
        return next;
      });
    }
    return out;
  });
}

// Nuvio's tile shapes are POSTER, LANDSCAPE and SQUARE (TV also accepts the
// mobile spellings poster/wide/square). LeLibrary's editor says PORTRAIT;
// Nuvio TV rejects that value outright, so every folder sent to Nuvio goes
// through this. Unknown values become POSTER, matching Nuvio's own default.
function nuvioTileShape(value: unknown): 'POSTER' | 'LANDSCAPE' | 'SQUARE' {
  const shape = String(value || '').trim().toLowerCase();
  if (shape === 'landscape' || shape === 'wide') return 'LANDSCAPE';
  if (shape === 'square') return 'SQUARE';
  return 'POSTER';
}

function normaliseNuvioArtwork(folder = {}, origin = '') {
  const isLegacyGeneratedCover = typeof folder.coverImageUrl === 'string' &&
    folder.coverImageUrl.startsWith('/covers/');

  const coverImageUrl = isLegacyGeneratedCover ? '' : absoluteLocalArtwork(folder.coverImageUrl, origin);
  const focusGifUrl = isLegacyGeneratedCover ? '' : absoluteLocalArtwork(folder.focusGifUrl, origin);

  return {
    coverImageUrl,
    focusGifUrl,
    focusGifEnabled: !isLegacyGeneratedCover && folder.focusGifEnabled === true && !!focusGifUrl,
  };
}

export interface CollectionArtworkApi {
  normaliseNuvioArtwork: any;
  nuvioTileShape: any;
  absoluteLocalArtwork: any;
  versionLocalAsset: any;
  upgradeCollectionArtwork: any;
}

module.exports = {
  upgradeCollectionArtwork, nuvioTileShape, normaliseNuvioArtwork, absoluteLocalArtwork, versionLocalAsset } satisfies CollectionArtworkApi;
