const test = require('node:test');
const assert = require('node:assert/strict');

test('manifest declares at most the two compact imported catalogues', async (t) => {
  const app = require('../app');
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const refs = [
    { addonId: '__lelibrary__', catalogId: 'synthetic-movie', type: 'movie' },
    { addonId: '__lelibrary__', catalogId: 'synthetic-series', type: 'series' },
  ];
  const token = Buffer.from(JSON.stringify({
    tmdbApiKey: 'synthetic', provider: '',
    importedRows: [{ id: 'synthetic', collections: [{ folders: [{ catalogSources: refs }] }] }],
  })).toString('base64url');
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/${token}/manifest.json?integration=nuvio`);
  assert.equal(response.status, 200);
  const manifest = await response.json();
  const imported = manifest.catalogs.filter(catalog => catalog.id.startsWith('lelibrary-import-'));
  assert.deepEqual(imported.map(catalog => catalog.id).sort(), ['lelibrary-import-movie', 'lelibrary-import-series']);
});
