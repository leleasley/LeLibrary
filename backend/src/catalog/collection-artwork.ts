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

function absoluteLocalArtwork(value, origin = '') {
  if (typeof value !== 'string') return '';
  const clean = versionLocalAsset(value.trim());
  // Generated covers (/art/generated/, catalog/generated-covers.ts) are served
  // by this host too, so they need the same origin.
  if (!clean.startsWith('/collection-assets/') && !clean.startsWith('/art/generated/')) return clean;
  return origin ? `${String(origin).replace(/\/+$/, '')}${clean}` : clean;
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
}

module.exports = { nuvioTileShape, normaliseNuvioArtwork, absoluteLocalArtwork, versionLocalAsset } satisfies CollectionArtworkApi;
