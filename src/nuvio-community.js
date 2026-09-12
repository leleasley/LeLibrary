'use strict';

// Community packs can contain large collection bodies. Accept a bounded
// upstream document large enough for current packs, then strip the heavy
// bodies from LIST responses. Detail requests keep the full document and pass
// through the existing sanitizer/import pipeline.
const MAX_UPSTREAM_BYTES = 24 * 1024 * 1024;

function listParams(query = {}) {
  const sort = ['recent', 'popular', 'installed'].includes(String(query.sort)) ? String(query.sort) : 'popular';
  const type = ['pack', 'individual'].includes(String(query.type)) ? String(query.type) : '';
  const page = Math.min(Math.max(parseInt(query.page, 10) || 1, 1), 100);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 24, 1), 48);
  const search = String(query.search || '').trim().slice(0, 120);
  return { sort, page, limit, ...(type ? { type } : {}), ...(search ? { search } : {}) };
}

function transportCode(error) {
  const code = String(error?.code || '').toUpperCase();
  const allowed = new Set([
    'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
    'ECONNRESET', 'ECONNREFUSED', 'ERR_TLS_CERT_ALTNAME_INVALID',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_BAD_RESPONSE',
    'ERR_BAD_REQUEST', 'ERR_NETWORK', 'ERR_FR_TOO_MANY_REDIRECTS',
    'ERR_HTTP2_STREAM_ERROR',
  ]);
  return allowed.has(code) ? code : 'NETWORK';
}

function failurePayload({ status = 0, code = '' } = {}) {
  const upstreamStatus = Math.trunc(Number(status) || 0);
  if (upstreamStatus === 401 || upstreamStatus === 403) {
    return { status: 401, code: 'nuvio_session_expired', error: 'Your Nuvio session has expired. Reconnect Nuvio and try again.' };
  }
  if (upstreamStatus === 429) {
    return { status: 429, code: 'nuvio_rate_limited', error: 'Nuvio is receiving too many public-collection requests. Wait a minute and try again.' };
  }
  if (upstreamStatus) {
    return { status: 502, code: `nuvio_http_${upstreamStatus}`, error: `Nuvio rejected the public-collection request (HTTP ${upstreamStatus}).` };
  }
  const safeCode = transportCode({ code });
  return { status: 502, code: `nuvio_transport_${safeCode.toLowerCase()}`, error: `LeLibrary could not reach Nuvio (${safeCode}).` };
}

function compactListItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const output = { ...item };
  const compactEnvelope = (envelope) => {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return envelope;
    const collections = Array.isArray(envelope.collections)
      ? envelope.collections
      : envelope.collection && typeof envelope.collection === 'object' ? [envelope.collection] : [];
    const derivedStats = collections.length ? {
      collectionCount: collections.length,
      folderCount: collections.reduce((total, collection) => total + (Array.isArray(collection?.folders) ? collection.folders.length : 0), 0),
      sourceCount: collections.reduce((total, collection) => total + (Array.isArray(collection?.folders) ? collection.folders.reduce((count, folder) => count + (Array.isArray(folder?.catalogSources) ? folder.catalogSources.length : Array.isArray(folder?.sources) ? folder.sources.length : 0), 0) : 0), 0),
    } : null;
    if (derivedStats && (!output.stats || typeof output.stats !== 'object')) output.stats = derivedStats;
    const first = collections[0] || {};
    const summary = {
      ...envelope,
      coverImageUrl: envelope.coverImageUrl || first.coverImageUrl || first.backdropImageUrl || '',
    };
    delete summary.collection;
    delete summary.collections;
    delete summary.resources;
    return summary;
  };
  output.envelope = compactEnvelope(output.envelope);
  if (output.item && typeof output.item === 'object' && !Array.isArray(output.item)) {
    output.item = { ...output.item, envelope: compactEnvelope(output.item.envelope) };
  }
  return output;
}

function compactListPayload(value, depth = 0) {
  if (Array.isArray(value)) return value.map(compactListItem);
  if (!value || typeof value !== 'object' || depth > 3) return value;
  const output = { ...value };
  for (const key of ['items', 'collections', 'results', 'communityCollections', 'data', 'payload']) {
    if (!Object.prototype.hasOwnProperty.call(output, key)) continue;
    output[key] = Array.isArray(output[key])
      ? output[key].map(compactListItem)
      : compactListPayload(output[key], depth + 1);
  }
  return output;
}

module.exports = { MAX_UPSTREAM_BYTES, listParams, transportCode, failurePayload, compactListPayload };
