// @ts-nocheck
'use strict';
// Relative requires must resolve. The v5.5 restructure moved backend/src/**
// into domain folders, and a stale require only fails on the request that
// reaches it: `require('./public/poster-template')` survived that move and
// broke the custom-poster save path with no test coverage. This guard walks the
// server tree and fails on any dangling relative require.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCAN = [path.join(ROOT, 'app.ts'), path.join(ROOT, 'index.ts'), path.join(ROOT, 'src')];

// Modules that are intentionally absent from the public tree and required
// inside a try/catch or behind a hosted-only branch that cannot run here.
const OPTIONAL = new Set([
  // Accounts-era extension, removed in v5.5 (guarded elsewhere).
  '../accounts/encrypt',
  '../accounts/external-catalog',
  '../hosted',
  // Private addon identity: present on dev/prod, absent from a public clone,
  // where the manifest falls back to the generic self-hosted identity.
  './src/registry.ts',
  '../registry.ts',
]);

const REQUIRE = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function walk(target, out = []) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) walk(path.join(target, entry), out);
  } else if (/\.(ts|js|cjs)$/.test(target)) {
    out.push(target);
  }
  return out;
}

function resolves(fromDir, spec) {
  const base = path.resolve(fromDir, spec);
  return [
    base,
    `${base}.ts`,
    `${base}.js`,
    `${base}.cjs`,
    `${base}.json`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.js'),
  ].some((candidate) => fs.existsSync(candidate));
}

test('every relative require in the server tree resolves', () => {
  const missing = [];
  for (const file of SCAN.flatMap((entry) => walk(entry))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(REQUIRE)) {
      const spec = match[1];
      if (OPTIONAL.has(spec)) continue;
      if (!resolves(path.dirname(file), spec)) {
        missing.push(`${path.relative(ROOT, file)}: ${spec}`);
      }
    }
  }
  assert.deepEqual(missing, [], `dangling relative requires:\n${missing.join('\n')}`);
});
