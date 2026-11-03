// Ratchet for `@ts-nocheck` (audit B18). `npm run typecheck` is a hard gate,
// but it only covers files that are actually checked. The files below were
// unchecked when this guard landed; they are the established pattern and stay
// as they are. A NEW server file must be typed instead, and a file that drops
// its `@ts-nocheck` must also leave this list so it cannot slip back.
// Tests are not covered: they are allowed to stay unchecked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCAN = ['app.ts', 'index.ts', 'src'];
const DIRECTIVE = /^\s*\/\/\s*@ts-nocheck\b/m;

const ALLOWED = new Set([
  'src/catalog/builder.ts',
  'src/catalog/catalog-cache.ts',
  'src/catalog/catalog-quick-picks.ts',
  'src/catalog/catalog-rotation.ts',
  'src/catalog/catalog-source-registry.ts',
  'src/catalog/catalogdefs-59.ts',
  'src/catalog/catalogdefs-extra.ts',
  'src/catalog/catalogdefs-fixes.ts',
  'src/catalog/catalogdefs-packs.ts',
  'src/catalog/catalogdefs.ts',
  'src/catalog/collection-artwork.ts',
  'src/catalog/collection-cache-warm.ts',
  'src/catalog/collection-plan.ts',
  'src/catalog/curated-collections.ts',
  'src/catalog/curated-covers-58.ts',
  'src/catalog/curated-folder-art-58.ts',
  'src/catalog/curated-packs-58.ts',
  'src/catalog/curated-packs-59.ts',
  'src/catalog/curated-regions-58.ts',
  'src/catalog/discovery.ts',
  'src/catalog/franchise-collections.ts',
  'src/catalog/libcatalog.ts',
  'src/catalog/nuvio-badge-packs.ts',
  'src/catalog/nuvio-badges.ts',
  'src/catalog/nuvio-community.ts',
  'src/catalog/nuvio-library-collections.ts',
  'src/client-integrations/adapters/fusion.ts',
  'src/client-integrations/adapters/generic.ts',
  'src/client-integrations/adapters/nuvio.ts',
  'src/client-integrations/adapters/stremio.ts',
  'src/client-integrations/adapters/strmr.ts',
  'src/client-integrations/adapters/vidi.ts',
  'src/client-integrations/adapters/wuplay.ts',
  'src/import-sources/definition.ts',
  'src/import-sources/static-index.ts',
  'src/library/catalog.ts',
  'src/library/db.ts',
  'src/library/diff.ts',
  'src/library/engine.ts',
  'src/library/identity/anime-titles.ts',
  'src/library/identity/providers.ts',
  'src/library/identity/resolve.ts',
  'src/library/matcher.ts',
  'src/library/metrics.ts',
  'src/library/search.ts',
  'src/library/store.ts',
  'src/library/sync.ts',
  'src/library/util.ts',
  'src/matching/resolve.ts',
  'src/matching/tables.ts',
  'src/media/custom-streams.ts',
  'src/media/id-map.ts',
  'src/media/identity.ts',
  'src/media/parser.ts',
  'src/media/scene-mapping.ts',
  'src/media/search.ts',
  'src/media/title-aliases.ts',
  'src/media/tmdb.ts',
  'src/providers/alldebrid.ts',
  'src/providers/premiumize.ts',
  'src/providers/realdebrid.ts',
  'src/providers/torbox.ts',
  'src/releases/sync.ts',
  'src/routes/releases.ts',
  'src/runtime/artwork-cache.ts',
  'src/runtime/cache.ts',
  'src/runtime/configstore.ts',
  'src/runtime/jobs.ts',
  'src/runtime/pictorium-warm.ts',
  'src/runtime/pictorium.ts',
  'src/runtime/refresh.ts',
  'src/setup/pending-push.ts',
  'src/streams/knabenPlayback.ts',
]);

function walk(rel: string, out: string[] = []): string[] {
  const abs = path.join(ROOT, rel);
  if (fs.statSync(abs).isDirectory()) {
    for (const entry of fs.readdirSync(abs)) walk(path.posix.join(rel, entry), out);
  } else if (/\.(ts|js|cjs)$/.test(rel)) {
    out.push(rel);
  }
  return out;
}

function uncheckedFiles(): string[] {
  return SCAN.flatMap((entry) => walk(entry))
    .filter((rel) => DIRECTIVE.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')))
    .sort();
}

test('no new server file opts out of the typecheck with @ts-nocheck', () => {
  const added = uncheckedFiles().filter((rel) => !ALLOWED.has(rel));
  assert.deepEqual(added, [], `new @ts-nocheck files (type them instead):\n${added.join('\n')}`);
});

test('files that are now typed leave the @ts-nocheck allowlist', () => {
  const present = new Set(uncheckedFiles());
  const stale = [...ALLOWED].filter((rel) => !present.has(rel));
  assert.deepEqual(stale, [], `remove from ALLOWED in test/ts-nocheck-guard.test.ts:\n${stale.join('\n')}`);
});
