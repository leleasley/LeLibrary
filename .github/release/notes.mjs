#!/usr/bin/env node
// Release notes + release preflight, used by CI and the tag workflow.
//
//   node .github/release/notes.mjs check  [vX.Y.Z]   versions agree, section is valid
//   node .github/release/notes.mjs notes  vX.Y.Z [--digest sha256:...] > release-notes.md
//   node .github/release/notes.mjs trim                 keep only the newest section
//
// CHANGELOG.md holds only the version being released: every earlier version
// already has its notes on GitHub Releases. After adding the new section, run
// `trim` to drop the previous one; `check` fails while an older one is left.
//
// `check` with no tag lints the newest CHANGELOG section against package.json
// (every push); a section for the next version, written before the version
// bump, is accepted there so work in progress can be pushed. With a tag it also requires the tag to match (tag push).
// `notes` prints only that version's section, without its header, plus an
// install footer and a compare link to the previous tag.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = 'leleasley/LeLibrary';
const IMAGE = 'ghcr.io/leleasley/lelibrary';

const INTRO = `Notes for the current version. Every earlier version is on [GitHub Releases](https://github.com/${REPO}/releases).`;

const HEADER = /^## \[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]/;

export function parseChangelog(text) {
  const sections = [];
  let current = null;
  for (const line of text.split('\n')) {
    const match = HEADER.exec(line);
    if (match) {
      current = { version: match[1], header: line, lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections.map((section) => ({ ...section, body: section.lines.join('\n').trim() }));
}

// The title, a pointer to GitHub Releases and the newest section only.
export function trimChangelog(text) {
  const [newest] = parseChangelog(text);
  if (!newest) return text;
  return `# Changelog\n\n${INTRO}\n\n${newest.header}\n\n${newest.body}\n`;
}

// The house rules for user-facing notes (see AGENTS.md "Versioning & Releases").
export function lintSection(section) {
  const problems = [];
  if (!section.body) problems.push('section is empty');
  if (section.body && !/^### /m.test(section.body)) problems.push('no "### " group headings');
  section.body.split('\n').forEach((line, index) => {
    const where = `line ${index + 1} of [${section.version}]`;
    if (/[–—]/.test(line)) problems.push(`${where}: em/en dash, use a plain hyphen or rewrite`);
    else if (/[^\x00-\x7F]/.test(line)) problems.push(`${where}: non-ASCII character ${JSON.stringify(line.match(/[^\x00-\x7F]/)[0])}`);
  });
  return problems;
}

// True when a is a later X.Y.Z than b (pre-release suffixes ignored).
export function isNewer(a, b) {
  const parts = (v) => String(v || '').split('-')[0].split('.').map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

function readVersion(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).version : null;
}

export function preflight({ tag, root = ROOT } = {}) {
  const problems = [];
  const sections = parseChangelog(readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8'));
  const appVersion = readVersion(resolve(root, 'package.json'));
  const frontendVersion = readVersion(resolve(root, 'frontend/package.json'));
  const upcoming = !tag && sections.length && isNewer(sections[0].version, appVersion) ? sections[0].version : null;
  const wanted = tag ? tag.replace(/^v/, '') : upcoming || appVersion;

  if (tag && !/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) problems.push(`tag ${tag} is not vX.Y.Z`);
  if (!upcoming && appVersion !== wanted) problems.push(`package.json is ${appVersion}, expected ${wanted}`);
  if (!upcoming && frontendVersion && frontendVersion !== wanted) problems.push(`frontend/package.json is ${frontendVersion}, expected ${wanted}`);
  if (!sections.length) problems.push('CHANGELOG.md has no "## [X.Y.Z]" sections');
  else if (sections[0].version !== wanted) problems.push(`newest CHANGELOG section is [${sections[0].version}], expected [${wanted}]`);

  const section = sections.find((entry) => entry.version === wanted);
  if (!section) problems.push(`CHANGELOG.md has no "## [${wanted}]" section`);
  else problems.push(...lintSection(section));
  if (sections.filter((entry) => entry.version === wanted).length > 1) problems.push(`[${wanted}] appears more than once`);
  else if (sections.length > 1) problems.push(`CHANGELOG.md still has older sections (${sections.slice(1).map((entry) => entry.version).join(', ')}); run: node .github/release/notes.mjs trim`);
  return { problems, section, version: wanted };
}

function previousTag(tag) {
  try {
    const tags = execFileSync('git', ['tag', '--list', 'v*', '--sort=-v:refname'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').map((value) => value.trim()).filter(Boolean);
    const at = tags.indexOf(tag);
    const older = at >= 0 ? tags.slice(at + 1) : tags;
    // A stable release compares against the previous stable one, skipping RCs.
    return (tag.includes('-') ? older : older.filter((value) => !value.includes('-')))[0] || null;
  } catch {
    return null;
  }
}

export function renderNotes({ section, tag, digest, previous }) {
  const out = [section.body, '', '---', ''];
  out.push('**Install or update**', '', '```', `docker pull ${IMAGE}:${tag}`, '```', '');
  if (digest) out.push(`Image digest: \`${digest}\` (signed build provenance is attached to the image).`, '');
  out.push(`Self-hosting and setup guide: [SETUP.md](https://github.com/${REPO}/blob/${tag}/SETUP.md)`);
  if (previous) out.push('', `Full list of commits: [${previous}...${tag}](https://github.com/${REPO}/compare/${previous}...${tag})`);
  return `${out.join('\n')}\n`;
}

function main(argv) {
  const [command, tag, ...rest] = argv;
  if (command === 'trim') {
    const path = resolve(ROOT, 'CHANGELOG.md');
    const before = readFileSync(path, 'utf8');
    const after = trimChangelog(before);
    if (after !== before) writeFileSync(path, after);
    console.error(`CHANGELOG.md keeps [${parseChangelog(after)[0]?.version ?? 'nothing'}] only.`);
    return 0;
  }
  const digestAt = rest.indexOf('--digest');
  const digest = digestAt >= 0 ? rest[digestAt + 1] : '';
  if (command !== 'check' && command !== 'notes') {
    console.error('usage: notes.mjs check [vX.Y.Z] | notes vX.Y.Z [--digest sha256:...] | trim');
    return 2;
  }
  if (command === 'notes' && !tag) {
    console.error('notes needs a tag');
    return 2;
  }
  const { problems, section, version } = preflight({ tag });
  if (problems.length) {
    console.error(`Release check failed for ${version}:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  if (command === 'check') {
    console.error(`Release check passed for ${version}.`);
    return 0;
  }
  process.stdout.write(renderNotes({ section, tag, digest, previous: previousTag(tag) }));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
