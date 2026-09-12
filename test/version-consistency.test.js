const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageJson = require('../package.json');
const packageLock = require('../package-lock.json');
const app = require('../app');

test('release version stays aligned across package metadata, browser UI and addon manifests', () => {
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);

  const configureSource = fs.readFileSync(path.join(__dirname, '..', 'website', 'public', 'configure.js'), 'utf8');
  const browserVersion = configureSource.match(/const APP_VERSION = '([^']+)'/);
  assert.ok(browserVersion, 'Configure APP_VERSION is missing');
  assert.equal(browserVersion[1], packageJson.version);

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
