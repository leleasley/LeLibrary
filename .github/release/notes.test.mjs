import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintSection, parseChangelog, preflight, renderNotes, trimChangelog } from './notes.mjs';

const CHANGELOG = `# Changelog

## [1.2.0]

### New

- Added a thing.

## [1.1.0]

### Fixes

- Fixed a thing.
`;

function fixture({ changelog = CHANGELOG, app = '1.2.0', frontend = '1.2.0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'notes-'));
  writeFileSync(join(root, 'CHANGELOG.md'), changelog);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: app }));
  if (frontend) {
    mkdirSync(join(root, 'frontend'));
    writeFileSync(join(root, 'frontend/package.json'), JSON.stringify({ version: frontend }));
  }
  return root;
}

test('parses only the requested section', () => {
  const [latest, older] = parseChangelog(CHANGELOG);
  assert.equal(latest.version, '1.2.0');
  assert.equal(latest.body, '### New\n\n- Added a thing.');
  assert.equal(older.version, '1.1.0');
});

test('passes when tag, both package versions and the newest section agree', () => {
  assert.deepEqual(preflight({ tag: 'v1.2.0', root: fixture({ changelog: trimChangelog(CHANGELOG) }) }).problems, []);
});

test('trim keeps only the newest section and points at GitHub Releases', () => {
  const trimmed = trimChangelog(CHANGELOG);
  assert.deepEqual(parseChangelog(trimmed).map((s) => s.version), ['1.2.0']);
  assert.match(trimmed, /^# Changelog\n/);
  assert.match(trimmed, /github\.com\/leleasley\/LeLibrary\/releases/);
  assert.ok(!trimmed.includes('Fixed a thing'));
  assert.equal(trimChangelog(trimmed), trimmed, 'trimming twice changes nothing');
});

test('a branch push accepts notes for the next version before the bump; a tag never does', () => {
  const root = fixture({ changelog: trimChangelog(CHANGELOG), app: '1.1.0', frontend: '1.1.0' });
  assert.deepEqual(preflight({ root }).problems, []);
  assert.match(preflight({ tag: 'v1.2.0', root }).problems.join('\n'), /package\.json is 1\.1\.0/);
  const older = fixture({ changelog: trimChangelog(CHANGELOG), app: '1.3.0', frontend: '1.3.0' });
  assert.match(preflight({ root: older }).problems.join('\n'), /expected \[1\.3\.0\]/);
});

test('fails while an older section is still in the CHANGELOG', () => {
  assert.match(preflight({ tag: 'v1.2.0', root: fixture() }).problems.join('\n'), /older sections \(1\.1\.0\).*trim/);
});

test('fails on a version mismatch anywhere', () => {
  assert.match(preflight({ tag: 'v1.3.0', root: fixture() }).problems.join('\n'), /expected 1\.3\.0/);
  assert.match(preflight({ tag: 'v1.2.0', root: fixture({ frontend: '1.1.0' }) }).problems.join('\n'), /frontend\/package\.json/);
});

test('fails when the section is missing or not the newest', () => {
  const root = fixture({ app: '1.1.0', frontend: '1.1.0' });
  assert.match(preflight({ tag: 'v1.1.0', root }).problems.join('\n'), /newest CHANGELOG section is \[1\.2\.0\]/);
});

test('enforces ASCII, no dashes and group headings', () => {
  const problems = lintSection({ version: '9.9.9', body: `- A ${String.fromCodePoint(0x2014)} B\n- café` });
  assert.equal(problems.length, 3);
});

test('notes drop the header and add install + compare footer', () => {
  const [section] = parseChangelog(CHANGELOG);
  const notes = renderNotes({ section, tag: 'v1.2.0', digest: 'sha256:abc', previous: 'v1.1.0' });
  assert.ok(!notes.includes('## [1.2.0]'));
  assert.match(notes, /docker pull ghcr\.io\/leleasley\/lelibrary:v1\.2\.0/);
  assert.match(notes, /sha256:abc/);
  assert.match(notes, /compare\/v1\.1\.0\.\.\.v1\.2\.0/);
  assert.ok(!notes.includes('Fixed a thing'));
});
