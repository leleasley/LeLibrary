// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const { maskSensitivePath } = require('../src/middleware/request-logger.ts');

test('v5.5 install tokens (uuid.secret) are never logged', () => {
  const path = '/cf0af601-cb0f-47b8-9c32-7d0cb2e960b8.Zx9_secret-Part1234/manifest.json';
  assert.equal(maskSensitivePath(path), '/[token]/manifest.json');
});

test('play links never log the file name or file id', () => {
  assert.equal(maskSensitivePath('/abc.def/play/webdav/w:ebe7e18d6cac2ff7656f5112/L01vdmllcy9IZWF0Lm1rdg/Heat.1995.1080p.mkv'),
    '/[token]/play/webdav/w:ebe7e18d6cac2ff7656f5112/[token]/[name]');
  assert.equal(maskSensitivePath('/uuid-only-token-aaaaaaaaaa/play/usenet/12345/7/Show.S01E02.1080p.mkv'),
    '/[token]/play/usenet/12345/7/[name]');
});

test('ordinary paths are left readable', () => {
  assert.equal(maskSensitivePath('/api/verify/webdav'), '/api/verify/webdav');
  assert.equal(maskSensitivePath('/configure/quick'), '/configure/quick');
  assert.equal(maskSensitivePath('/health'), '/health');
});
