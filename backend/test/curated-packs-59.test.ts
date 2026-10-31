// @ts-nocheck
const { test } = require('node:test');
const assert = require('node:assert/strict');
const curated = require('../src/catalog/curated-collections.ts');
const { PACKS_59 } = require('../src/catalog/curated-packs-59.ts');
const { getSourceDefinition } = require('../src/catalog/catalog-source-registry.ts');
const { catalogs } = require('../src/catalog/catalogdefs-59.ts');

const listed = new Map(curated.listCuratedCollections().map((p) => [p.id, p]));

test('every 5.9 pack is listed with every folder it references (none dropped as a duplicate)', () => {
  for (const def of PACKS_59) {
    const pack = listed.get(def.id);
    assert.ok(pack, `${def.id} listed`);
    for (const section of def.sections) {
      const shown = pack.sections.find((s) => s.id === section.id);
      assert.equal(shown.folders.length, section.refs.length, `${def.id}/${section.id} kept every folder`);
    }
  }
  assert.equal(listed.has('library-59'), false, 'the defining library is never listed');
});

test('every 5.9 catalogue is available and every folder has fallback art', () => {
  for (const id of Object.keys(catalogs)) assert.equal(getSourceDefinition(id).available, true, id);
  const { FOLDER_ART } = require('../src/catalog/curated-folder-art-58.ts');
  for (const def of PACKS_59) {
    for (const section of def.sections) for (const ref of section.refs) {
      const id = `folder-lelibrary-${ref}`;
      assert.ok(curated.curatedFolderById(id), `${id} defined`);
    }
  }
  const lib = curated.curatedFolderById('folder-lelibrary-sh-venom');
  assert.ok(FOLDER_ART['folder-lelibrary-sh-venom'] && lib);
});

test('checked TMDB sources: wider Batman and Spider-Man, Pokemon films, director credits only', () => {
  assert.equal(getSourceDefinition('collection_batman').params.collectionId, '120794|263|948485');
  assert.equal(getSourceDefinition('collection_spider_man').params.collectionId, '556|125574|531241');
  assert.equal(String(getSourceDefinition('anime_pokemon_movies').params.collectionId).split('|').length, 6);
  assert.equal(getSourceDefinition('director_sergio_leone_movies').params.director, true);
  // Anime film sagas carry "anime" in their ids, so Hide anime removes them.
  for (const id of ['anime_pokemon_movies', 'anime_dragon_ball_movies', 'anime_naruto_movies']) assert.ok(catalogs[id], id);
  const hidden = curated.curatedCollectionsPayload({ compact: true, hideAnime: true }).collections.find((p) => p.id === 'anime-hub');
  const all = curated.curatedCollectionsPayload({ compact: true }).collections.find((p) => p.id === 'anime-hub');
  assert.ok(hidden.folders.length < all.folders.length);
});

export interface CuratedPacks59TestModule {};
