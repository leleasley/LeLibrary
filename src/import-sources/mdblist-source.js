'use strict';

const { normalizeImportedSourceDefinition, cleanLabel } = require('./definition');

function parseMdblistListId(value) {
  const input = String(value || '').trim();
  if (/^\d{1,10}$/.test(input)) return Number(input);
  let url;
  try { url = new URL(input); } catch { return null; }
  if (!/(^|\.)mdblist\.com$/i.test(url.hostname)) return null;
  // Accept URLs whose list id is present as a path segment or explicit query
  // value. Slug-only URLs cannot be resolved without spending an API call.
  const queryId = url.searchParams.get('list') || url.searchParams.get('list_id') || url.searchParams.get('id');
  const pathId = url.pathname.split('/').find(segment => /^\d{1,10}$/.test(segment));
  const id = queryId && /^\d{1,10}$/.test(queryId) ? Number(queryId) : pathId ? Number(pathId) : null;
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

function buildMdblistSourceDefinitions({ list, label, mediaTypes } = {}) {
  const listId = parseMdblistListId(list);
  if (!listId) {
    const error = new Error('Enter a numeric MDBList list ID or a MDBList URL containing the ID');
    error.code = 'invalid_mdblist_id';
    throw error;
  }
  const requested = Array.isArray(mediaTypes) ? mediaTypes : [];
  const types = [...new Set(requested.filter(type => type === 'movie' || type === 'series'))];
  if (!types.length) {
    const error = new Error('Choose Movies, Series, or both');
    error.code = 'invalid_media_type';
    throw error;
  }
  const baseLabel = cleanLabel(label, `MDBList ${listId}`);
  return types.map(mediaType => normalizeImportedSourceDefinition({
    provider: 'mdblist',
    engine: 'list',
    mediaType,
    params: { listId },
    label: types.length > 1 ? `${baseLabel} — ${mediaType === 'movie' ? 'Movies' : 'Series'}` : baseLabel,
    provenance: { adapter: 'wizard-mdblist', originHash: '', importedLabel: baseLabel },
  }));
}

module.exports = { parseMdblistListId, buildMdblistSourceDefinitions };
