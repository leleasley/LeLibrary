const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalJson,
  normalizeImportedSourceDefinition,
  ImportedSourceValidationError,
} = require('../src/import-sources/definition');
const { exactStaticMatch, buildStaticSignatureIndex } = require('../src/import-sources/static-index');

test('imported source canonical JSON and full SHA-256 id are deterministic', () => {
  const a = normalizeImportedSourceDefinition({
    provider: 'tmdb', engine: 'discover', mediaType: 'movie',
    params: { filters: { with_genres: '28', 'vote_count.gte': 100 }, sortBy: 'popularity.desc' },
    label: 'Action one', provenance: { adapter: 'xperience-v1', originHash: 'one' },
  });
  const b = normalizeImportedSourceDefinition({
    label: 'A completely different label', mediaType: 'movie', engine: 'discover', provider: 'tmdb',
    params: { sortBy: 'popularity.desc', filters: { 'vote_count.gte': 100, with_genres: 28 } },
    provenance: { adapter: 'another-importer', originHash: 'two' },
  });
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(a.signature, b.signature);
  assert.match(a.signature, /^[a-f0-9]{64}$/);
  assert.equal(a.id, `imp_${a.signature}`);
});

test('unknown recipe and provenance fields are rejected', () => {
  assert.throws(() => normalizeImportedSourceDefinition({
    provider: 'tmdb', engine: 'discover', mediaType: 'movie',
    params: { filters: { imaginary_filter: true } },
  }), error => error instanceof ImportedSourceValidationError && error.code === 'unsupported_field');
  assert.throws(() => normalizeImportedSourceDefinition({
    provider: 'tmdb', engine: 'list', mediaType: 'movie', params: { listId: 1 },
    provenance: { adapter: 'xperience-v1', requestHeaders: { authorization: 'secret' } },
  }), /unsupported field/);
});

test('static source matching uses exact effective recipes, never titles', () => {
  const exact = normalizeImportedSourceDefinition({
    provider: 'tmdb', engine: 'collection', mediaType: 'movie',
    params: { collectionId: 1742094 }, label: 'Not called Alien',
  });
  const different = normalizeImportedSourceDefinition({
    provider: 'tmdb', engine: 'collection', mediaType: 'movie',
    params: { collectionId: 573693 }, label: 'Alien',
  });
  assert.equal(exactStaticMatch(exact).catalogId, 'lib-collection_alien');
  assert.notEqual(exactStaticMatch(different).catalogId, 'lib-collection_alien');
});

test('TMDB network signatures include the runtime sort semantics', () => {
  const index = buildStaticSignatureIndex({
    sorted_network: { name: 'Network', type: 'series', handler: 'tmdb_network', params: { networkId: 49, sort: 'vote_average.desc' } },
  });
  const exact = normalizeImportedSourceDefinition({ provider: 'tmdb', engine: 'discover', mediaType: 'series', params: { sortBy: 'vote_average.desc', filters: { with_networks: 49 } } });
  const different = normalizeImportedSourceDefinition({ provider: 'tmdb', engine: 'discover', mediaType: 'series', params: { sortBy: 'popularity.desc', filters: { with_networks: 49 } } });
  assert.equal(index.has(exact.signature), true);
  assert.equal(index.has(different.signature), false);
});
