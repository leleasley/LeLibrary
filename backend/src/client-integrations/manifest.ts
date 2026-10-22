export interface ManifestModule {
  projectTypes: (manifest: any, types: string[]) => any;
  protocolManifest: (manifest: any, options?: { types?: string[]; idPrefixes?: string[] }) => any;
}

function projectTypes(manifest: any, types: string[]): any {
  const allowed = new Set(types);
  const resources = (manifest.resources || []).map((resource: any) => {
    if (typeof resource === 'string') return resource;
    if (!resource || typeof resource !== 'object') return null;
    const projectedTypes = Array.isArray(resource.types) ? resource.types.filter((type: string) => allowed.has(type)) : undefined;
    if (Array.isArray(resource.types) && (projectedTypes?.length ?? 0) === 0) return null;
    return { ...resource, ...(projectedTypes ? { types: projectedTypes } : {}) };
  }).filter(Boolean);
  const catalogs = (manifest.catalogs || []).filter((catalog: any) => allowed.has(catalog?.type));
  const prefixes = new Set(catalogs.flatMap((catalog: any) => String(catalog?.id || '').startsWith('torbox-') ? ['torbox:'] : []));
  for (const prefix of manifest.idPrefixes || []) {
    if (prefix === 'kitsu:' && !allowed.has('anime')) continue;
    prefixes.add(prefix);
  }
  return { ...manifest, types: (manifest.types || []).filter((type: string) => allowed.has(type)), resources, catalogs, idPrefixes: [...prefixes] };
}

function protocolManifest(manifest: any, { types = ['movie', 'series'], idPrefixes }: { types?: string[]; idPrefixes?: string[] } = {}): any {
  const projected = projectTypes(manifest, types);
  const prefixes = idPrefixes || projected.idPrefixes;
  const resources = projected.resources.map((resource: any) => resource && resource.name === 'stream'
    ? { ...resource, types: types.slice(), idPrefixes: prefixes.slice() }
    : resource);
  return { ...projected, resources, idPrefixes: prefixes.slice() };
}

module.exports = { projectTypes, protocolManifest } satisfies ManifestModule;
