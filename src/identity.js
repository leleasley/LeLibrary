// Public media identity for the new Collections domain. Provider identities
// (torbox:, rd-, ad-, etc.) must never be used as collection item IDs.

function normalizeImdbId(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (/^tt\d+$/.test(raw)) return raw;
  if (/^\d{6,9}$/.test(raw)) return `tt${raw}`;
  return null;
}

function normalizeKitsuId(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (/^kitsu:\d+$/.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `kitsu:${raw}`;
  return null;
}

function normalizePublicId(value, source = '') {
  const kind = String(source || '').toLowerCase();
  if (kind === 'kitsu' || String(value || '').toLowerCase().startsWith('kitsu:')) {
    return normalizeKitsuId(value);
  }
  return normalizeImdbId(value);
}

function isPublicCollectionId(value) {
  const id = String(value || '').toLowerCase();
  return !!normalizeImdbId(id) || !!normalizeKitsuId(id);
}

module.exports = { normalizeImdbId, normalizeKitsuId, normalizePublicId, isPublicCollectionId };
