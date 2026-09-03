// Nuvio folder artwork is presentation-only. Catalogue and meta poster
// providers (ERDB/RPDB/TMDB/etc.) remain independent of these URLs.
//
// Generated /covers assets were removed in favour of externally hosted
// collection artwork. Existing saved account documents can still contain the
// old paths, so suppress them instead of sending a dead URL to Nuvio.
function absoluteLocalArtwork(value, origin = '') {
  if (typeof value !== 'string') return '';
  const clean = value.trim();
  if (!clean.startsWith('/collection-assets/')) return clean;
  return origin ? `${String(origin).replace(/\/+$/, '')}${clean}` : clean;
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

module.exports = { normaliseNuvioArtwork, absoluteLocalArtwork };
