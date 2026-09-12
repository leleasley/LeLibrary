'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMdblistListId, buildMdblistSourceDefinitions } = require('../src/import-sources/mdblist-source');

test('parses numeric MDBList ids and URLs containing an id', () => {
  assert.equal(parseMdblistListId('158684'), 158684);
  assert.equal(parseMdblistListId('https://mdblist.com/lists/example/158684'), 158684);
  assert.equal(parseMdblistListId('https://api.mdblist.com/lists/example?id=42'), 42);
  assert.equal(parseMdblistListId('https://example.com/lists/42'), null);
  assert.equal(parseMdblistListId('https://mdblist.com/lists/example/a-slug'), null);
});

test('builds stable typed source definitions without credentials', () => {
  const definitions = buildMdblistSourceDefinitions({ list: '158684', label: 'Weekend picks', mediaTypes: ['movie', 'series'] });
  assert.equal(definitions.length, 2);
  assert.deepEqual(definitions.map(row => row.mediaType), ['movie', 'series']);
  assert.ok(definitions.every(row => row.provider === 'mdblist' && row.params.listId === 158684));
  assert.ok(definitions.every(row => /^imp_[a-f0-9]{64}$/.test(row.id)));
  assert.notEqual(definitions[0].id, definitions[1].id);
  assert.deepEqual(definitions, buildMdblistSourceDefinitions({ list: '158684', label: 'Weekend picks', mediaTypes: ['movie', 'series'] }));
});

test('rejects missing list ids and media types', () => {
  assert.throws(() => buildMdblistSourceDefinitions({ list: 'not-a-list', mediaTypes: ['movie'] }), /numeric MDBList/);
  assert.throws(() => buildMdblistSourceDefinitions({ list: '42', mediaTypes: [] }), /Choose Movies/);
});
