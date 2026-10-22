// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const packageJson = require('../../package.json');
const packageLock = require('../../package-lock.json');
const frontendPackage = require('../../frontend/package.json');
const app = require('../app.ts');

test('release version stays aligned across backend, frontend and addon manifests', () => {
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);
  assert.equal(frontendPackage.version, packageJson.version);

  const manifest = app.getConfiguredManifest('https://example.invalid', { provider: 'none' });
  assert.equal(manifest.version, packageJson.version);
});

test('health endpoint reports the package release version', async () => {
  const layer = app._router.stack.find(entry => entry.route?.path === '/health');
  assert.ok(layer, 'health route is missing');

  const body = await new Promise((resolve, reject) => {
    const res = { json: resolve };
    Promise.resolve(layer.route.stack[0].handle({}, res, reject)).catch(reject);
  });
  assert.deepEqual(body, { status: 'ok', version: packageJson.version });
});

export interface VersionConsistencyTestTestModule {};
