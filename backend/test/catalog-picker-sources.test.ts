// @ts-nocheck
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { listPickerSources, listSources, getSourceDefinition } = require('../src/catalog/catalog-source-registry.ts');

const picker = listPickerSources();
const byId = new Map(picker.map((s) => [s.id, s]));

test('the pickers offer no aliases and no hidden rows, but those ids still resolve', () => {
  const aliases = listSources().filter((s) => s.aliasOf);
  assert.ok(aliases.length > 0);
  for (const alias of aliases) {
    assert.equal(byId.has(alias.id), false, alias.id);
    assert.ok(getSourceDefinition(alias.id), `${alias.id} still resolves`);
  }
  for (const id of ['mdblist_list_106567_movies', 'new_latest_airing_shows_series']) {
    assert.equal(byId.has(id), false);
    assert.ok(getSourceDefinition(id));
  }
});

test('no two picker rows in one group share a name and type', () => {
  const seen = new Map();
  for (const s of picker) {
    const key = `${s.category}|${s.type}|${s.name.toLowerCase()}`;
    assert.equal(seen.has(key), false, `${s.id} and ${seen.get(key)} are both "${s.name}"`);
    seen.set(key, s.id);
  }
  assert.equal(byId.get('genre_action_latest_movies').name, 'Latest Action');
  assert.equal(byId.get('genre_action_toprated_movies').name, 'Top Rated Action');
  assert.equal(byId.get('genre_action_movies').name, 'Action');
});

test('regional rows carry their countries; global and plain rows carry none', () => {
  assert.equal(byId.get('streaming_netflix_movies').regions, undefined);
  assert.equal(byId.get('genre_action_movies').regions, undefined);
  assert.deepEqual(byId.get('streaming_netflix_top10_movies').regions, ['CA']);
  const regional = picker.filter((s) => Array.isArray(s.regions));
  assert.ok(regional.length > 20);
  for (const s of regional) for (const c of s.regions) assert.match(c, /^[A-Z]{2}$/);
});

test('every suggested row exists and needs no MDBList key', () => {
  const featured = picker.filter((s) => s.featured);
  assert.ok(featured.length >= 12);
  for (const s of featured) assert.deepEqual(s.requirements, [], s.id);
});

export interface CatalogPickerSourcesTestModule {};
