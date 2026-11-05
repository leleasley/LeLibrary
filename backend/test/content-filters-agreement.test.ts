// @ts-nocheck
'use strict';
// The setup UI's content-filter list and the server's must not drift: the slugs
// are saved in configs, so a rename would silently stop filtering. The frontend
// module cannot be imported here (it uses path aliases), so its source is read
// and its `{ id, label }` pairs compared.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const backend = require('../src/catalog/content-filters.ts');

test('frontend and backend content-filter categories agree', () => {
  const file = path.join(__dirname, '..', '..', 'frontend', 'src', 'features', 'setup', 'shared', 'content-filters.ts');
  const source = readFileSync(file, 'utf8');
  const pairs = [...source.matchAll(/\{ id: '([a-z]+)', label: '([^']+)' \}/g)].map((match) => ({ id: match[1], label: match[2] }));
  assert.ok(pairs.length > 0, 'the frontend category table was not found');
  assert.deepEqual(pairs, backend.CONTENT_CATEGORIES.map(({ id, label }) => ({ id, label })));
});
