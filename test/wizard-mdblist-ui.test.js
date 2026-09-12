'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('Collection Wizard exposes a native token-scoped MDBList source builder', () => {
  const html = fs.readFileSync(path.join(root, 'src/accounts/web/wizard.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'src/accounts/web/wizard.js'), 'utf8');
  assert.match(html, /id="mdblistSourceId"/);
  assert.match(html, /src="\/mdblist\.svg"/);
  assert.match(html, /id="mdblistSourceMovies"/);
  assert.match(html, /id="mdblistSourceSeries"/);
  assert.match(html, /stays private to this collection setup/);
  assert.match(html, /class="mdblist-source-actions"/);
  assert.match(js, /\/api\/account\/collections\/mdblist-source/);
  assert.match(js, /state\.sourceDefinitions\.push\(definition\)/);
  assert.match(js, /folderSourceSelection\.add\(key\)/);
});

test('folder editor uses the roomy sectioned workspace', () => {
  const html = fs.readFileSync(path.join(root, 'src/accounts/web/wizard.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/accounts/web/wizard-premium.css'), 'utf8');
  assert.match(html, /Make this folder yours/);
  assert.match(html, /folder-editor-section/);
  assert.match(html, /Name and layout/);
  assert.match(html, /Your changes apply when this setup is saved/);
  assert.match(css, /width:min\(1080px/);
  assert.match(css, /grid-template-columns:300px minmax\(0,1fr\)/);
  assert.match(css, /\.source-picker-modal \.folder-source-choice/);
  assert.match(css, /\.mdblist-media-types input/);
  assert.match(css, /grid-template-rows:auto auto auto minmax\(0,1fr\) auto!important/);
  assert.match(css, /\.source-picker-modal \.source-picker-list\{min-width:0!important;min-height:0!important/);
  assert.match(css, /overflow-y:scroll!important/);
});

test('Quick Packs use a searchable responsive library modal', () => {
  const html = fs.readFileSync(path.join(root, 'src/accounts/web/wizard.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'src/accounts/web/wizard.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/accounts/web/wizard.css'), 'utf8');
  assert.match(html, /id="wizardPackLibraryModal"/);
  assert.match(html, /id="wizardPackSearch"/);
  assert.match(html, /id="wizardPackCategory"/);
  assert.match(html, /Find your next collection/);
  assert.match(html, /id="wizardSystemPacksSection"/);
  assert.match(html, /id="wizardSinglePacksSection"/);
  assert.match(html, /Focused single-folder starters/);
  assert.match(html, /LeLibrary essentials/);
  assert.doesNotMatch(html, /id="wizardPacks" class="pack-grid"/);
  assert.match(js, /function openPackLibrary\(\)/);
  assert.match(js, /function searchPacks\(value\)/);
  assert.match(js, /function filterPacks\(value\)/);
  assert.match(js, /openPackLibrary:openPackLibrary/);
  assert.match(js, /function normalizeSystemCollectionOrder\(\)/);
  assert.match(js, /legacyHubMovieCollection/);
  assert.match(js, /LeLibrary Movie Collections/);
  assert.match(js, /\(state\.platform\|\|'nuvio'\)===\'nuvio\'/);
  assert.match(js, /collectionPacks=visible\.filter/);
  assert.match(js, /starters=visible\.filter/);
  assert.match(js, /normalizeSystemCollectionOrder\(\);openCollectionIds\.clear/);
  assert.match(css, /\.quick-pack-library-grid\{display:grid;grid-template-columns:repeat\(4/);
  assert.match(css, /@media\(max-width:560px\).*\.quick-pack-library-grid\{grid-template-columns:1fr/s);
  const premiumCss = fs.readFileSync(path.join(root, 'src/accounts/web/wizard-premium.css'), 'utf8');
  assert.match(premiumCss, /\.quick-pack-library \.pack-card\{flex-direction:column!important/);
  assert.match(premiumCss, /\.quick-pack-library>\.quick-pack-library-scroll\{overflow-x:hidden!important/);
  assert.match(premiumCss, /\.app-modal\.quick-pack-library-modal\{position:fixed!important;inset:0!important/);
});
