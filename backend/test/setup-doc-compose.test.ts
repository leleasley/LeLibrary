// @ts-nocheck
// SETUP.md shows the whole compose file inline for self-hosters. It must stay
// byte-for-byte the same as compose.example.yml, or people copy a stale file.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');

test('the compose file in SETUP.md matches compose.example.yml', () => {
  const doc = fs.readFileSync(path.join(root, 'SETUP.md'), 'utf8');
  const section = doc.slice(doc.indexOf('### 2. Create `compose.yml`'));
  const match = section.match(/```yaml\n([\s\S]*?)\n```/);
  assert.ok(match, 'SETUP.md has a yaml block under "Create compose.yml"');
  const example = fs.readFileSync(path.join(root, 'compose.example.yml'), 'utf8').replace(/\n+$/, '');
  assert.strictEqual(match[1], example);
});

test('the example uses the published image and keeps the database private', () => {
  const example = fs.readFileSync(path.join(root, 'compose.example.yml'), 'utf8');
  assert.match(example, /image: ghcr\.io\/leleasley\/lelibrary:latest/);
  const postgres = example.slice(example.indexOf('  postgres:'), example.indexOf('  redis:'));
  assert.doesNotMatch(postgres, /^\s+ports:/m);
});
