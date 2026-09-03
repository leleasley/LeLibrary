const { normalizeImportedSourceDefinition, isImportedSourceId } = require('./definition');

function same(valueA, valueB) {
  return JSON.stringify(valueA) === JSON.stringify(valueB);
}

function importKey(value) {
  return value?._import?.adapter && value?._import?.originHash
    ? `${value._import.adapter}:${value._import.originHash}`
    : '';
}

function mergeFolder(existing, incoming) {
  if (!existing) return incoming;
  const previousBaseline = Array.isArray(existing._import?.upstreamSourceIds) ? existing._import.upstreamSourceIds : [];
  const currentIds = (existing.catalogSources || []).map(source => source.catalogId);
  const sourcesUntouched = same(previousBaseline, currentIds);
  const presentation = {
    title: existing.title, tileShape: existing.tileShape, hideTitle: existing.hideTitle,
    coverImageUrl: existing.coverImageUrl, focusGifEnabled: existing.focusGifEnabled,
    focusGifUrl: existing.focusGifUrl, heroBackdropUrl: existing.heroBackdropUrl,
    titleLogoUrl: existing.titleLogoUrl, enabled: existing.enabled,
  };
  const merged = {
    ...incoming,
    ...presentation,
    catalogSources: sourcesUntouched ? incoming.catalogSources : existing.catalogSources,
    _import: { ...incoming._import },
  };
  if (!sourcesUntouched) merged._import.userSourcesPreserved = true;
  return merged;
}

function mergeCollection(existing, incoming) {
  if (!existing) return incoming;
  const existingFolders = new Map((existing.folders || []).map(folder => [importKey(folder), folder]).filter(([key]) => key));
  const used = new Set();
  const folders = (incoming.folders || []).map(folder => {
    const key = importKey(folder);
    if (key) used.add(key);
    return mergeFolder(existingFolders.get(key), folder);
  });
  for (const folder of existing.folders || []) {
    const key = importKey(folder);
    if (key && !used.has(key)) folders.push({ ...folder, _import: { ...folder._import, orphaned: true } });
    else if (!key) folders.push(folder);
  }
  return {
    ...incoming,
    title: existing.title,
    tileShape: existing.tileShape,
    pinToTop: existing.pinToTop,
    focusGlowEnabled: existing.focusGlowEnabled,
    showAllTab: existing.showAllTab,
    viewMode: existing.viewMode,
    hideTitle: existing.hideTitle,
    heroBackdropUrl: existing.heroBackdropUrl,
    folders,
  };
}

function mergeHomeRows(existingRows, incomingRows) {
  const existingByKey = new Map((existingRows || []).map(row => [importKey(row), row]).filter(([key]) => key));
  const used = new Set();
  const merged = (incomingRows || []).map(row => {
    const key = importKey(row);
    const old = existingByKey.get(key);
    if (key) used.add(key);
    return old ? { ...row, title: old.title, enabled: old.enabled, order: old.order, customTitle: old.customTitle } : row;
  });
  for (const row of existingRows || []) {
    const key = importKey(row);
    if (!key || !used.has(key)) merged.push(key ? { ...row, _import: { ...row._import, orphaned: true } } : row);
  }
  return merged.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function collectReferencedImportedIds(collections, homeRows) {
  const ids = new Set();
  for (const collection of collections || []) for (const folder of collection.folders || []) {
    for (const source of folder.catalogSources || []) if (isImportedSourceId(source.catalogId)) ids.add(source.catalogId);
  }
  for (const row of homeRows || []) if (isImportedSourceId(row?.source?.catalogId)) ids.add(row.source.catalogId);
  return ids;
}

function mergeImportedPlan(existing = {}, incoming = {}) {
  const existingCollections = Array.isArray(existing.collections) ? existing.collections : [];
  const existingByKey = new Map(existingCollections.map(collection => [importKey(collection), collection]).filter(([key]) => key));
  const used = new Set();
  const collections = (incoming.collections || []).map(collection => {
    const key = importKey(collection);
    if (key) used.add(key);
    return mergeCollection(existingByKey.get(key), collection);
  });
  for (const collection of existingCollections) {
    const key = importKey(collection);
    if (key && !used.has(key)) collections.push({ ...collection, _import: { ...collection._import, orphaned: true } });
    else if (!key) collections.push(collection);
  }
  const homeRows = mergeHomeRows(existing.home_rows || existing.homeRows || [], incoming.homeRows || []);
  const sourceMap = new Map();
  for (const source of existing.sources || []) {
    try { const normalized = normalizeImportedSourceDefinition(source); sourceMap.set(normalized.id, normalized); } catch {}
  }
  for (const source of incoming.sources || []) {
    const normalized = normalizeImportedSourceDefinition(source);
    const old = sourceMap.get(normalized.id);
    if (old && old.label !== old.provenance?.importedLabel) normalized.label = old.label;
    normalized.provenance.importedLabel = source.label;
    sourceMap.set(normalized.id, normalized);
  }
  const referenced = collectReferencedImportedIds(collections, homeRows);
  const sources = [...sourceMap.values()].filter(source => referenced.has(source.id)).sort((a, b) => a.id.localeCompare(b.id));
  const result = { collections, home_rows: homeRows, sources };
  return { ...result, changed: !same({ collections: existingCollections, home_rows: existing.home_rows || existing.homeRows || [], sources: existing.sources || [] }, result) };
}

module.exports = { mergeImportedPlan, collectReferencedImportedIds };
