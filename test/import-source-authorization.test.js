const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeImportedSourceDefinition } = require('../src/import-sources/definition');
const { resolveDefinitionFromScope } = require('../src/import-sources/authorize');

const movie = normalizeImportedSourceDefinition({
  provider: 'tmdb', engine: 'list', mediaType: 'movie', params: { listId: 123 }, label: 'Private list',
});

function scope(overrides = {}) {
  return {
    valid: true, tokenId: 'token-a', manifestTokenId: 'token-a',
    integration: 'nuvio', profileId: 'profile-a', sources: [movie], ...overrides,
  };
}

test('private source resolution requires exact token context, signature and type', () => {
  assert.equal(resolveDefinitionFromScope(scope(), movie.id, 'movie').id, movie.id);
  assert.equal(resolveDefinitionFromScope(scope(), movie.id, 'series'), null);
  assert.equal(resolveDefinitionFromScope(scope({ manifestTokenId: 'token-b' }), movie.id, 'movie'), null);
  assert.equal(resolveDefinitionFromScope(scope({ sources: [] }), movie.id, 'movie'), null);
  assert.equal(resolveDefinitionFromScope(scope(), `imp_${'f'.repeat(64)}`, 'movie'), null);
});

test('cross-account/profile shaped scopes cannot authorize another token', () => {
  assert.equal(resolveDefinitionFromScope(scope({ tokenId: 'account-b-token', manifestTokenId: 'token-a' }), movie.id, 'movie'), null);
  assert.equal(resolveDefinitionFromScope(scope({ valid: false }), movie.id, 'movie'), null);
  assert.equal(resolveDefinitionFromScope(scope({ profileId: '' }), movie.id, 'movie'), null);
});

test('tampered stored full signatures do not authorize', () => {
  assert.equal(resolveDefinitionFromScope(scope({ sources: [{ ...movie, signature: '0'.repeat(64) }] }), movie.id, 'movie'), null);
});
