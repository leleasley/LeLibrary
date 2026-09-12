'use strict';

function projectTypes(manifest, types) {
  const allowed = new Set(types);
  const resources = (manifest.resources || []).map(resource => {
    if (typeof resource === 'string') return resource;
    if (!resource || typeof resource !== 'object') return null;
    const projectedTypes = Array.isArray(resource.types) ? resource.types.filter(type => allowed.has(type)) : undefined;
    if (Array.isArray(resource.types) && projectedTypes.length === 0) return null;
    return { ...resource, ...(projectedTypes ? { types: projectedTypes } : {}) };
  }).filter(Boolean);
  const catalogs = (manifest.catalogs || []).filter(catalog => allowed.has(catalog?.type));
  const prefixes = new Set(catalogs.flatMap(catalog => String(catalog?.id || '').startsWith('torbox-') ? ['torbox:'] : []));
  for (const prefix of manifest.idPrefixes || []) {
    if (prefix === 'kitsu:' && !allowed.has('anime')) continue;
    prefixes.add(prefix);
  }
  return { ...manifest, types: (manifest.types || []).filter(type => allowed.has(type)), resources, catalogs, idPrefixes: [...prefixes] };
}

function protocolManifest(manifest, { types = ['movie', 'series'], idPrefixes } = {}) {
  const projected = projectTypes(manifest, types);
  const prefixes = idPrefixes || projected.idPrefixes;
  const resources = projected.resources.map(resource => resource && resource.name === 'stream'
    ? { ...resource, types: types.slice(), idPrefixes: prefixes.slice() }
    : resource);
  return { ...projected, resources, idPrefixes: prefixes.slice() };
}

module.exports = { projectTypes, protocolManifest };
