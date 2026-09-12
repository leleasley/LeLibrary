'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('artwork step uses a contained preview and balanced provider layout', () => {
  const html = fs.readFileSync(path.join(root, 'src/accounts/web/wizard.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/accounts/web/wizard-premium.css'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'src/accounts/web/wizard.js'), 'utf8');

  assert.match(html, /class="artwork-preview-head"/);
  assert.match(html, /wizard-premium\.css\?v=56/);
  assert.match(css, /#panel-5 \.poster-provider-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /#panel-5 \.artwork-preview\{position:sticky/);
  assert.match(css, /#panel-5 \.artwork-controls>\.switch-stack\{display:grid;grid-template-columns:1fr 1fr/);
  assert.match(js, /aria-pressed=/);
  assert.match(js, /poster-provider-status/);
});
