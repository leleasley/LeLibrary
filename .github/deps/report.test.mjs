import test from 'node:test';
import assert from 'node:assert/strict';
import { outdatedRows, auditRows, renderSection, splitHeld } from './report.mjs';

test('majors are flagged and listed first', () => {
  const rows = outdatedRows({ pg: { current: '8.23.0', wanted: '8.23.1', latest: '8.23.1' }, express: { current: '4.22.3', wanted: '4.22.3', latest: '5.3.0' } });
  assert.deepEqual(rows.map((r) => [r.name, r.isMajor]), [['express', true], ['pg', false]]);
});

test('audit rows carry severity, fix command and advisory links', () => {
  const rows = auditRows({ vulnerabilities: { 'follow-redirects': { severity: 'high', fixAvailable: true, via: [{ url: 'https://github.com/advisories/GHSA-x' }] } } });
  assert.deepEqual(rows[0], { name: 'follow-redirects', severity: 'high', fix: 'npm audit fix', advisories: ['https://github.com/advisories/GHSA-x'] });
});

test('the section gives safe and major update commands separately', () => {
  const md = renderSection('Backend', '.', { pg: { current: '8.23.0', wanted: '8.23.1', latest: '8.23.1' }, express: { current: '4.22.3', wanted: '4.22.3', latest: '5.3.0' } }, {});
  assert.match(md, /npm update pg/);
  assert.match(md, /npm install express@5\.3\.0/);
  assert.match(md, /No known vulnerabilities/);
});

test('held packages are listed with their reason, not as updates', () => {
  const held = { '@types/node': 'matches the runtime', 'typescript-5': 'checker only' };
  const out = { '@types/node': { current: '24.1.0', wanted: '24.1.0', latest: '26.0.0' }, 'typescript-5:typescript@^5.9.3': { current: '5.9.3', wanted: '5.9.3', latest: '7.0.2' }, vite: { current: '8.3.4', wanted: '8.3.5', latest: '8.3.5' } };
  const split = splitHeld(outdatedRows(out), held);
  assert.deepEqual(split.active.map((r) => r.name), ['vite']);
  const md = renderSection('Frontend', 'frontend', out, {}, held);
  assert.doesNotMatch(md, /npm install @types\/node/);
  assert.match(md, /Held on purpose:/);
  assert.match(md, /typescript-5 5\.9\.3 \(latest 7\.0\.2\): checker only/);
});
