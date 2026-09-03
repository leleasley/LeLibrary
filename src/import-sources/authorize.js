const { isImportedSourceId, normalizeImportedSourceDefinition } = require('./definition');

function resolveDefinitionFromScope(scope, sourceId, expectedMediaType) {
  if (!scope || scope.valid !== true || !isImportedSourceId(sourceId)) return null;
  if (!['movie', 'series'].includes(expectedMediaType)) return null;
  if (!scope.tokenId || String(scope.manifestTokenId || '') !== String(scope.tokenId)) return null;
  if (!['nuvio', 'stremio'].includes(scope.integration) || !scope.profileId) return null;
  for (const raw of Array.isArray(scope.sources) ? scope.sources : []) {
    try {
      const source = normalizeImportedSourceDefinition(raw);
      if (source.id === sourceId && source.signature === sourceId.slice(4) && source.mediaType === expectedMediaType) return source;
    } catch { /* invalid persisted definitions never authorize */ }
  }
  return null;
}

function resolveDefinitionFromScopeByLabel(scope, label, expectedMediaType) {
  if (!scope || scope.valid !== true) return null;
  if (!['movie', 'series'].includes(expectedMediaType)) return null;
  if (!scope.tokenId || String(scope.manifestTokenId || '') !== String(scope.tokenId)) return null;
  if (!['nuvio', 'stremio'].includes(scope.integration) || !scope.profileId) return null;
  const wanted = String(label || '').trim();
  if (!wanted || wanted.length > 160) return null;
  const lowered = wanted.toLowerCase();
  let fallback = null;
  for (const raw of Array.isArray(scope.sources) ? scope.sources : []) {
    try {
      const source = normalizeImportedSourceDefinition(raw);
      if (source.mediaType !== expectedMediaType) continue;
      if (String(source.label || '') === wanted) return source;
      if (!fallback && String(source.label || '').toLowerCase() === lowered) fallback = source;
    } catch { /* invalid persisted definitions never authorize */ }
  }
  return fallback;
}

module.exports = { resolveDefinitionFromScope, resolveDefinitionFromScopeByLabel };
