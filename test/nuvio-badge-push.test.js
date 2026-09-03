const test = require('node:test');
const assert = require('node:assert/strict');
const { PACKS, resolveBadgePackUrl, buildBadgeImport, applyBadgeImportToBlob } = require('../src/nuvio-badge-packs');

test('badge pack table covers the browser picker ids', () => {
  for (const id of ['lelibrary-premium', 'nard-full', 'nard-slim', 'better-colored', 'better-mono', 'elite', 'minimal-white', 'minimal-mixed', 'custom']) {
    assert.ok(PACKS.some((p) => p.id === id), `missing pack ${id}`);
  }
});

test('badge URL resolution prefers the saved choice', () => {
  assert.equal(resolveBadgePackUrl('elite', '', 'https://lelibrary.uk'), 'https://raw.githubusercontent.com/leonevz/Elite-Badges/main/badges.json');
  assert.equal(resolveBadgePackUrl('lelibrary-premium', '', 'https://lelibrary.uk'), 'https://lelibrary.uk/api/nuvio-badges/lelibrary-premium.json');
  assert.equal(resolveBadgePackUrl('custom', 'https://example.com/badges.json', 'https://lelibrary.uk'), 'https://example.com/badges.json');
  assert.equal(resolveBadgePackUrl('custom', 'not a url', 'https://lelibrary.uk'), '');
  assert.equal(resolveBadgePackUrl('nope', '', 'https://lelibrary.uk'), 'https://lelibrary.uk/api/nuvio-badges/lelibrary-premium.json');
});

test('badge import build sanitises and bounds manifests', () => {
  const manifest = {
    filters: [
      { id: 'a', groupId: 'g', name: 'A', pattern: 'REMUX', imageURL: 'https://x/y.png', isEnabled: true, evil: 'drop me' },
      { id: 'b', name: 'empty pattern', pattern: '', imageURL: 'https://x/z.png' },
    ],
    groups: [{ id: 'g', name: 'G' }],
  };
  const imp = buildBadgeImport(manifest, 'https://example.com/badges.json');
  assert.equal(imp.sourceUrl, 'https://example.com/badges.json');
  assert.equal(imp.isActive, true);
  assert.equal(imp.filters.length, 1);
  assert.equal(imp.filters[0].evil, undefined);
  assert.equal(imp.groups.length, 1);
  assert.throws(() => buildBadgeImport({ filters: [] }, 'https://example.com/b.json'), /no usable badges/);
});

test('badge blob splice replaces only the badge rules', () => {
  const blob = {
    version: 1,
    features: {
      tmdb_settings: { tmdb_enabled: { type: 'boolean', value: true } },
      stream_badge_settings: {
        show_addon_logo: { type: 'boolean', value: false },
        stream_badge_rules: { type: 'string', value: JSON.stringify({ imports: [{ sourceUrl: 'https://old.example/b.json', filters: [], groups: [], isActive: true }] }) },
      },
    },
  };
  const imp = { sourceUrl: 'https://new.example/b.json', filters: [{ id: 'a' }], groups: [], isActive: true };
  const next = applyBadgeImportToBlob(blob, imp);
  assert.deepEqual(next.features.tmdb_settings, blob.features.tmdb_settings);
  assert.deepEqual(next.features.stream_badge_settings.show_addon_logo, { type: 'boolean', value: false });
  const rules = JSON.parse(next.features.stream_badge_settings.stream_badge_rules.value);
  assert.equal(rules.imports.length, 1);
  assert.equal(rules.imports[0].sourceUrl, 'https://new.example/b.json');
  // Original blob untouched.
  assert.ok(String(blob.features.stream_badge_settings.stream_badge_rules.value).includes('old.example'));
});

test('badge blob splice creates a missing badge feature', () => {
  const next = applyBadgeImportToBlob({ version: 1, features: {} }, { sourceUrl: 'https://new.example/b.json', filters: [{ id: 'a' }], groups: [], isActive: true });
  const rules = JSON.parse(next.features.stream_badge_settings.stream_badge_rules.value);
  assert.equal(rules.imports[0].sourceUrl, 'https://new.example/b.json');
});
