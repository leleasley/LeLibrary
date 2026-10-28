// @ts-nocheck
// 5.8 packs: Streaming by Region, Seasonal, Horror Vault, Kids & Family,
// World TV, Anime Hub, Shared Universes, Cinephile, Moods, Based On,
// History & War, Sports & Music, Charts, and the persona bundles. These pin
// the data contract the pack picker relies on (Docs/plans/5.8-collections.md).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { catalogs } = require('../src/catalog/catalogdefs.ts');
const packDefs = require('../src/catalog/catalogdefs-packs.ts').catalogs;
const generatedTable = require('../src/catalog/catalogdefs-extra.ts').catalogs;
const { getSourceDefinition, canonicalSourceId, listSources } = require('../src/catalog/catalog-source-registry.ts');
const {
  listCuratedCollections, curatedCollectionsPayload, curatedFolderLabel, resolveCuratedSourceLabel,
  curatedSourceDisplayName, validateCuratedCollections, PACK_FILTERS,
} = require('../src/catalog/curated-collections.ts');
const { PERSONA_BUNDLES, PACK_COVERS } = require('../src/catalog/curated-packs-58.ts');
const { REGIONS, GLOBAL } = require('../src/catalog/curated-regions-58.ts');
const { parseCoverRequest } = require('../src/catalog/generated-covers.ts');
const { isRotationEligible } = require('../src/catalog/catalog-rotation.ts');
const { regionForLang } = require('../src/catalog/region.ts');

const NEW_PACK_IDS = ['streaming-region', 'seasonal', 'horror-vault', 'kids-family', 'world-tv', 'anime-hub',
  'shared-universes', 'cinephile', 'moods', 'based-on', 'history-war', 'sports-music', 'charts'];
const BUNDLE_IDS = PERSONA_BUNDLES.map((bundle) => bundle.id);
const packs = listCuratedCollections({});
const byId = new Map(packs.map((pack) => [pack.id, pack]));
const knownRegion = new Intl.DisplayNames(['en'], { type: 'region' });

test('the validator passes and every new pack and bundle is served', () => {
  const validation = validateCuratedCollections();
  assert.deepEqual(validation.errors, []);
  for (const id of [...NEW_PACK_IDS, ...BUNDLE_IDS]) assert.ok(byId.has(id), `${id} missing`);
  assert.deepEqual(BUNDLE_IDS.sort(), ['persona-anime', 'persona-binge', 'persona-cinephile', 'persona-family', 'persona-horror', 'persona-starter']);
});

test('new packs reference only existing, available catalogue ids', () => {
  for (const id of [...NEW_PACK_IDS, ...BUNDLE_IDS]) {
    for (const folder of byId.get(id).folders) {
      assert.ok(folder.catalogSources.length > 0, `${id}/${folder.id} has no source`);
      for (const source of folder.catalogSources) {
        const sourceId = source.catalogId.replace(/^lib-/, '');
        assert.ok(catalogs[sourceId], `${id}/${folder.id}: unknown catalogue ${sourceId}`);
        assert.equal(getSourceDefinition(sourceId)?.available, true, `${id}/${folder.id}: ${sourceId} unavailable`);
      }
    }
  }
});

test('the 5.8 catalogue ids are new and never collide', () => {
  const generated = require('../src/catalog/catalogdefs.ts');
  assert.ok(generated);
  for (const id of Object.keys(packDefs)) {
    assert.match(id, /^[a-z0-9_]+$/);
    assert.ok(!generatedTable[id], `${id} collides with an extra family row`);
    assert.equal(catalogs[id].name, packDefs[id].name, `${id} was overridden`);
  }
});

test('new catalogues add their own folder label and never change an existing one', () => {
  for (const id of Object.keys(packDefs)) {
    const type = packDefs[id].type === 'series' ? 'series' : 'movie';
    const plain = curatedSourceDisplayName(`lib-${id}`, type);
    const label = curatedFolderLabel(`lib-${id}`, type);
    // A label equal to the plain name means no other source shares it, so no
    // existing source had to take a qualifier because of this one.
    assert.equal(label, plain, `${id} shares its label "${plain}" with another catalogue`);
    assert.equal(resolveCuratedSourceLabel(label, type), id);
  }
});

test('no pack or bundle lists a catalogue source twice', () => {
  for (const pack of packs) {
    const seen = new Set();
    for (const folder of pack.folders) {
      for (const source of folder.catalogSources) {
        const key = `${source.type}:${canonicalSourceId(source.catalogId)}`;
        assert.ok(!seen.has(key), `${pack.id} lists ${key} twice`);
        seen.add(key);
      }
    }
  }
});

test('folder ids are unique across the packs that define folders', () => {
  const owners = new Map();
  for (const pack of packs) {
    if (pack.kind === 'bundle') continue;
    for (const folder of pack.folders) {
      assert.ok(!owners.has(folder.id), `${folder.id} defined by ${owners.get(folder.id)} and ${pack.id}`);
      owners.set(folder.id, pack.id);
    }
  }
});

test('persona bundles only reference folders defined by other packs', () => {
  const defined = new Map();
  for (const pack of packs) {
    if (pack.kind === 'bundle') continue;
    for (const folder of pack.folders) defined.set(folder.id, folder);
  }
  for (const definition of PERSONA_BUNDLES) {
    const bundle = byId.get(definition.id);
    assert.equal(bundle.kind, 'bundle');
    const refs = definition.sections.flatMap((section) => section.refs.map((ref) => `folder-lelibrary-${ref}`));
    assert.equal(new Set(refs).size, refs.length, `${definition.id} references a folder twice`);
    for (const ref of refs) assert.ok(defined.has(ref), `${definition.id} references unknown folder ${ref}`);
    for (const folder of bundle.folders) {
      const original = defined.get(folder.id);
      assert.ok(original, `${definition.id}: ${folder.id} is not a reference`);
      assert.equal(folder.title, original.title);
      // A bundle never brings a source the referenced folder does not have.
      const allowed = new Set(original.catalogSources.map((source) => source.catalogId));
      for (const source of folder.catalogSources) assert.ok(allowed.has(source.catalogId));
    }
    // Every section is a collection with folders.
    assert.ok(bundle.sections.length >= 3);
    for (const section of bundle.sections) assert.ok(section.folders.length > 0, `${definition.id}/${section.id} is empty`);
    assert.equal(bundle.collectionCount, bundle.sections.length);
  }
});

test('LeLibrary Special is the seven standard packs and the dead special-* list is gone', () => {
  const special = byId.get('lelibrary-special');
  assert.deepEqual(special.sections.map((section) => section.id), ['discover', 'streaming', 'franchises', 'genres', 'studios', 'themes', 'actors']);
  assert.equal(special.kind, 'bundle');
  for (const folder of special.folders) assert.ok(!/^folder-lelibrary-special-/.test(folder.id), folder.id);
  for (const id of NEW_PACK_IDS) {
    for (const folder of byId.get(id).folders) assert.ok(!special.folders.some((item) => item.id === folder.id), `${folder.id} leaked into Special`);
  }
});

test('regions are valid ISO 3166-1 codes and every provider folder is region-aware', () => {
  for (const [sourceId, regions] of Object.entries(REGIONS)) {
    assert.ok(Array.isArray(regions) && regions.length > 0, sourceId);
    for (const region of regions) {
      assert.match(region, /^[A-Z]{2}$/, `${sourceId}: ${region}`);
      assert.notEqual(knownRegion.of(region), region, `${sourceId}: ${region} is not a known region`);
    }
    assert.ok(!GLOBAL.has(sourceId), `${sourceId} is both global and regional`);
  }
  for (const pack of packs) {
    for (const folder of pack.folders) {
      const primary = getSourceDefinition(canonicalSourceId(folder.catalogSources[0].catalogId));
      if (folder.regions) for (const region of folder.regions) assert.match(region, /^[A-Z]{2}$/);
      if (primary?.handler !== 'tmdb_provider') continue;
      const id = primary.id.replace(/_series$/, '_movies');
      assert.ok(GLOBAL.has(id) || folder.regions, `${pack.id}/${folder.id}: provider folder without regions`);
    }
  }
  // Streaming by Region shows only services that exist in the region.
  const region = byId.get('streaming-region');
  const bbc = region.folders.find((folder) => folder.id === 'folder-lelibrary-sr-bbc-iplayer');
  assert.deepEqual(bbc.regions, ['GB']);
  const netflix = region.folders.find((folder) => folder.id === 'folder-lelibrary-sr-netflix');
  assert.equal(netflix.regions, undefined);
  // The older Streaming pack follows the same verified regions.
  const crave = byId.get('streaming').folders.find((folder) => folder.id === 'folder-lelibrary-streaming-crave');
  assert.deepEqual(crave.regions, ['CA']);
});

test('regional provider rows opt out of the daily rotation', () => {
  for (const [id, def] of Object.entries(packDefs)) {
    if (def.handler !== 'tmdb_provider') continue;
    assert.equal(def.params.stable, true, id);
    assert.equal(isRotationEligible({ id, ...catalogs[id] }), false, id);
  }
  // Older provider rows still rotate.
  assert.equal(isRotationEligible({ id: 'streaming_netflix_movies', ...catalogs.streaming_netflix_movies }), true);
});

test('needsMdblistKey marks key-backed lists and the Charts pack, nothing else', () => {
  for (const pack of packs) {
    for (const folder of pack.folders) {
      const keyed = folder.catalogSources.some((source) => {
        const definition = getSourceDefinition(source.catalogId.replace(/^lib-/, ''));
        return definition?.handler === 'mdb_list' && !!definition.params?.listId;
      });
      const expected = keyed || pack.requiresMdblistKey === true;
      assert.equal(folder.needsMdblistKey, expected, `${pack.id}/${folder.id}`);
    }
  }
  assert.equal(byId.get('charts').requiresMdblistKey, true);
  assert.ok(byId.get('charts').folders.every((folder) => folder.needsMdblistKey));
  assert.ok(byId.get('discover').folders.every((folder) => !folder.needsMdblistKey));
  // Every numeric MDBList row is one that needs the key.
  for (const source of listSources({ includeUnavailable: true })) {
    if (source.engine === 'mdb_list' && getSourceDefinition(source.id).params?.listId) assert.deepEqual(source.requirements, ['mdblistKey']);
  }
});

test('seasonal folders carry a valid yearly window', () => {
  const seasonal = byId.get('seasonal');
  assert.ok(seasonal.folders.length >= 5);
  for (const folder of seasonal.folders) {
    assert.ok(folder.season, folder.id);
    for (const day of [folder.season.from, folder.season.to]) {
      assert.match(day, /^\d{2}-\d{2}$/);
      const [month, date] = day.split('-').map(Number);
      assert.ok(month >= 1 && month <= 12 && date >= 1 && date <= 31, `${folder.id}: ${day}`);
    }
  }
  const windows = Object.fromEntries(seasonal.folders.map((folder) => [folder.title, folder.season]));
  assert.deepEqual(windows.Christmas, { from: '11-15', to: '01-06' });
  assert.deepEqual(windows.Halloween, { from: '10-01', to: '11-02' });
  assert.deepEqual(windows.Thanksgiving, { from: '11-01', to: '11-30' });
  assert.deepEqual(windows["Valentine's Day"], { from: '02-01', to: '02-15' });
  assert.deepEqual(windows.Summer, { from: '06-01', to: '08-31' });
  const thanksgiving = seasonal.folders.find((folder) => folder.title === 'Thanksgiving');
  assert.deepEqual(thanksgiving.regions, ['US', 'CA']);
});

test('pack covers are valid generated-cover URLs from four TMDB posters', () => {
  for (const id of [...NEW_PACK_IDS, ...BUNDLE_IDS]) assert.ok(PACK_COVERS[id], `${id} has no cover`);
  for (const pack of packs) {
    const posters = PACK_COVERS[pack.id];
    if (!posters) { assert.equal(pack.generatedCoverUrl, '', pack.id); continue; }
    assert.equal(posters.length, 4, pack.id);
    assert.equal(new Set(posters).size, 4, `${pack.id} repeats a poster`);
    for (const poster of posters) assert.match(poster, /^\/[A-Za-z0-9]+\.jpg$/);
    const url = new URL(pack.generatedCoverUrl, 'https://example.invalid');
    const [, , , kind, file] = url.pathname.split('/');
    const parsed = parseCoverRequest(kind, file, Object.fromEntries(url.searchParams));
    assert.equal(parsed.ok, true, `${pack.id}: ${parsed.error}`);
    assert.equal(parsed.spec.kind, 'poster');
    assert.deepEqual(parsed.spec.posters, posters);
  }
});

test('pack metadata uses the fixed kinds and filters', () => {
  for (const pack of packs) {
    assert.ok(['bundle', 'pack', 'single'].includes(pack.kind), pack.id);
    assert.ok(pack.filters.length > 0, `${pack.id} has no filter`);
    for (const filter of pack.filters) assert.ok(PACK_FILTERS.includes(filter), `${pack.id}: ${filter}`);
    assert.equal(pack.folderCount, pack.folders.length);
    for (const folder of pack.folders) {
      assert.ok(Array.isArray(folder.sourceIds) && folder.sourceIds.length > 0);
      for (const id of folder.sourceIds) assert.equal(id, canonicalSourceId(id));
    }
  }
});

test('the payload carries the alias map and stays additive', () => {
  const payload = curatedCollectionsPayload({});
  assert.equal(payload.aliases.collection_universe_star_wars, 'collection_star_wars');
  assert.ok(payload.collections.length === packs.length);
  const discover = payload.collections.find((pack) => pack.id === 'discover');
  for (const key of ['id', 'title', 'icon', 'category', 'refresh', 'description', 'coverImageUrl', 'backdropUrl', 'folderCount', 'settings', 'sections', 'folders', 'sources']) {
    assert.ok(key in discover, `legacy field ${key} missing`);
  }
});

test('Hide anime removes the anime rows of the new packs', () => {
  const hidden = listCuratedCollections({ hideAnime: true });
  const anime = hidden.find((pack) => pack.id === 'anime-hub');
  assert.equal(anime.folderCount, 0);
  const region = hidden.find((pack) => pack.id === 'streaming-region');
  assert.ok(!region.folders.some((folder) => folder.id === 'folder-lelibrary-sr-adn'));
  assert.ok(region.folders.some((folder) => folder.id === 'folder-lelibrary-sr-netflix'));
});

// The same table is pinned in the frontend (collections/region.test.ts).
test('region from language matches the frontend table for the seven setup languages', () => {
  const table = { 'en-US': 'GB', 'pt-BR': 'BR', 'es-ES': 'ES', 'fr-FR': 'FR', 'de-DE': 'DE', 'it-IT': 'IT', 'ja-JP': 'JP' };
  for (const [lang, region] of Object.entries(table)) assert.equal(regionForLang(lang), region, lang);
  assert.equal(regionForLang(''), 'GB');
  assert.equal(regionForLang('en'), 'GB');
});

test('the compact picker payload sends each folder once and rebuilds to the same folders', () => {
  const curated = require('../src/catalog/curated-collections.ts');
  const full = curated.curatedCollectionsPayload({});
  const compact = curated.curatedCollectionsPayload({ compact: true });
  assert.ok(JSON.stringify(compact).length < JSON.stringify(full).length * 0.75, 'clearly smaller');
  for (const pack of compact.collections) {
    const original = full.collections.find((p) => p.id === pack.id);
    const rebuilt = pack.folders.map((f) => (typeof f === 'string' ? compact.folderIndex[f] : f));
    assert.deepEqual(rebuilt.map((f) => f.id), original.folders.map((f) => f.id), pack.id);
    assert.equal(pack.sources, undefined, 'the unused per-pack source list is dropped');
  }
});

test('Hide anime takes anime folders out of the picker payload', () => {
  const curated = require('../src/catalog/curated-collections.ts');
  const anime = (payload) => payload.collections.find((p) => p.id === 'anime-hub');
  const all = curated.curatedCollectionsPayload({ compact: true });
  const hidden = curated.curatedCollectionsPayload({ compact: true, hideAnime: true });
  assert.ok((anime(hidden)?.folders.length ?? 0) < anime(all).folders.length);
});

test('curated folders without hand-made art carry a short generated cover, in the picker and in the push', () => {
  const curated = require('../src/catalog/curated-collections.ts');
  const index = curated.curatedCollectionsPayload({ compact: true }).folderIndex;
  const generated = Object.values(index).filter((f) => String(f.coverImageUrl).startsWith('/art/generated/'));
  assert.ok(generated.length > 250);
  for (const folder of generated) assert.match(folder.coverImageUrl, /^\/art\/generated\/(poster|wide)\/[a-f0-9]{24}\.jpg$/);
  const pushed = curated.buildCuratedCollections(['horror-vault']).flat().flatMap((c) => c.folders || []);
  assert.ok(pushed.length > 0);
  const byId = new Map(Object.values(index).map((f) => [f.id, f.coverImageUrl]));
  for (const folder of pushed) if (byId.has(folder.id)) assert.equal(folder.coverImageUrl, byId.get(folder.id), folder.id);
});
