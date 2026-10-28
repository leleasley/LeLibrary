// @ts-nocheck
// Catalogue data fixes (2026-10-28): verified TMDB ids, aliases for exact
// duplicates, TV-only genres on series rows, distinct decade sources and the
// watch region derived from the setup language.
const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const { regionForLang } = require('../src/catalog/region.ts');
const { catalogs } = require('../src/catalog/catalogdefs.ts');
const { ALIASES, FIXES, MOVIE_GENRES, TV_GENRES } = require('../src/catalog/catalogdefs-fixes.ts');
const { getSourceDefinition, canonicalSourceId, listSources, validateSourceDefinitions } = require('../src/catalog/catalog-source-registry.ts');
const { listCuratedCollections, buildCuratedCollections } = require('../src/catalog/curated-collections.ts');
const { staticDefinition } = require('../src/import-sources/static-index.ts');
const { buildCatalogRows } = require('../src/catalog/libcatalog.ts');

test('regionForLang: plain English is GB, other languages use their own country', () => {
  assert.equal(regionForLang('en-US'), 'GB');
  assert.equal(regionForLang('en'), 'GB');
  assert.equal(regionForLang('pt-BR'), 'BR');
  assert.equal(regionForLang('es-ES'), 'ES');
  assert.equal(regionForLang('fr-FR'), 'FR');
  assert.equal(regionForLang('de-DE'), 'DE');
  assert.equal(regionForLang('it-IT'), 'IT');
  assert.equal(regionForLang('ja-JP'), 'JP');
  assert.equal(regionForLang('en-CA'), 'CA');
  assert.equal(regionForLang('pt_br'), 'BR');
  for (const bad of ['', null, undefined, 42, 'xx', 'fr-123', 'de-']) assert.equal(regionForLang(bad), 'GB');
});

test('every catalogue id is unique and every alias resolves to a real definition', () => {
  const ids = listSources({ includeUnavailable: true }).map((source) => source.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, Object.keys(catalogs).length);
  assert.deepEqual(validateSourceDefinitions().errors, []);
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    const own = getSourceDefinition(alias);
    const target = getSourceDefinition(canonical);
    assert.ok(own && target, `${alias} -> ${canonical}`);
    assert.equal(own.aliasOf, canonical);
    assert.equal(target.aliasOf, undefined, `${canonical} must not itself be an alias`);
    assert.equal(own.type, target.type);
    assert.equal(own.handler, target.handler);
    const { listName: _a, ...ownParams } = own.params;
    const { listName: _b, ...targetParams } = target.params;
    assert.deepEqual(ownParams, targetParams);
    assert.equal(canonicalSourceId(alias), canonical);
    assert.equal(canonicalSourceId(`lib-${alias}`), canonical);
    assert.ok(own.available);
  }
  assert.equal(canonicalSourceId('genre_action_movies'), 'genre_action_movies');
});

test('fixes keep each id, name, type and group (pushed folders resolve by them)', () => {
  for (const id of [...Object.keys(FIXES), ...Object.keys(ALIASES)]) {
    const def = catalogs[id];
    assert.ok(def, id);
    assert.ok(String(def.name || '').trim(), id);
    assert.ok(['movie', 'series'].includes(def.type), id);
  }
  assert.equal(catalogs.label_hbo_movies.type, 'movie');
  assert.equal(catalogs.label_hbo_movies.name, 'HBO');
  assert.notEqual(catalogs.label_hbo_movies.handler, 'tmdb_network', 'networks are TV-only');
});

test('no pack lists the same source twice (one folder per source)', () => {
  const packs = listCuratedCollections();
  for (const pack of packs) {
    const seen = new Map();
    for (const folder of pack.folders) {
      for (const source of folder.catalogSources) {
        const key = `${source.type}:${canonicalSourceId(source.catalogId)}`;
        assert.ok(!seen.has(key), `${pack.id}: ${key} in "${seen.get(key)}" and "${folder.title}"`);
        seen.set(key, folder.title);
      }
    }
  }
  for (const collection of buildCuratedCollections(packs.map((pack) => pack.id))) {
    const seen = new Set();
    for (const folder of collection.folders) {
      for (const source of folder.catalogSources) {
        const key = `${source.type}:${canonicalSourceId(source.catalogId)}`;
        assert.ok(!seen.has(key), `${collection.id}: ${key}`);
        seen.add(key);
      }
    }
  }
});

function genreIds(def) {
  const p = def.params || {};
  const raw = def.handler === 'tmdb_genre' ? (p.genreIds || [p.genreId])
    : def.handler === 'tmdb_discover' ? [p.tmdb?.with_genres] : [];
  return raw.filter((value) => value != null).flatMap((value) => String(value).split(/[|,]/)).map(Number);
}

test('series rows only use TV genre ids, movie rows only movie genre ids', () => {
  const tv = new Set(TV_GENRES);
  const movie = new Set(MOVIE_GENRES);
  for (const [id, def] of Object.entries(catalogs)) {
    for (const genre of genreIds(def)) {
      if (def.type === 'series') assert.ok(tv.has(genre), `${id} uses movie-only genre ${genre}`);
      else assert.ok(movie.has(genre), `${id} uses TV-only genre ${genre}`);
    }
  }
});

test('the wrong ids from the 2026-10-28 audit are gone', () => {
  const bad = {
    companyId: [293354, 270488, 220583, 11928, 15258],
    networkId: [280, 433, 101],
    providerId: [300, 127441, 3672, 2313],
    keywordId: [274770, 342626, 360877, 380334],
    genreId: [9805],
  };
  for (const [id, def] of Object.entries(catalogs)) {
    for (const [key, values] of Object.entries(bad)) {
      const value = def.params?.[key];
      if (value == null) continue;
      // DreamWorks Television (15258) is still right for the DreamWorks series row.
      if (id === 'studio_dreamworks_series') continue;
      // 300 IS Pluto TV: wrong for Shudder, right for the 5.8 Pluto TV rows.
      if (key === 'providerId' && id.startsWith('svc_pluto_tv_')) continue;
      for (const part of String(value).split(/[|,]/)) assert.ok(!values.includes(Number(part)), `${id}: ${key} ${part}`);
    }
  }
});

test('decade rows have distinct date ranges and Best of rows distinct lists', () => {
  for (const type of ['movie', 'series']) {
    const ranges = Object.entries(catalogs)
      .filter(([id, def]) => id.startsWith('decade_') && def.type === type)
      .map(([, def]) => {
        const t = def.params.tmdb;
        return `${t['primary_release_date.gte'] || t['first_air_date.gte']}..${t['primary_release_date.lte'] || t['first_air_date.lte']}`;
      });
    assert.ok(ranges.length >= 5);
    assert.equal(new Set(ranges).size, ranges.length, `${type} decade ranges repeat`);
  }
  const best = ['themed_rt_best_80s', 'themed_rt_best_90s', 'themed_rt_best_00s', 'themed_rt_best_10s']
    .map((id) => `${catalogs[id].params.user}/${catalogs[id].params.slug}`);
  assert.equal(new Set(best).size, 4);
  assert.match(best[0], /80s/);
  assert.match(best[1], /90s/);
  assert.match(best[2], /00s/);
  assert.match(best[3], /2010s/);
});

test('provider rows pass the region derived from the setup language', async () => {
  const providerRows = Object.entries(catalogs).filter(([, def]) => def.handler === 'tmdb_provider');
  assert.ok(providerRows.length > 20);
  const original = axios.get;
  const seen = [];
  axios.get = async (url, options) => {
    seen.push({ url, params: options?.params || {} });
    return { data: { results: [] } };
  };
  try {
    for (const [id, def] of providerRows) {
      for (const [lang, region] of [['en-US', 'GB'], ['pt-BR', 'BR'], ['ja-JP', 'JP']]) {
        seen.length = 0;
        await buildCatalogRows('synthetic-key', { id, ...def }, lang);
        const call = seen.find((entry) => entry.url.includes('/discover/'));
        assert.ok(call, id);
        assert.equal(call.params.watch_region, region, `${id} ${lang}`);
        assert.equal(String(call.params.with_watch_providers), String(def.params.providerId));
      }
      // The static (non-rotating) recipe uses the same region.
      const entry = staticDefinition(id, def, { region: 'DE' });
      assert.equal(entry.definition.params.filters.watch_region, 'DE');
    }
  } finally {
    axios.get = original;
  }
});
