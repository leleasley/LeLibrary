// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeWebdav } = require('./helpers/fake-webdav.ts');

process.env.WEBDAV_SOURCE = 'on';
process.env.WEBDAV_ALLOW_PRIVATE = 'on';
const providers = require('../src/providers/index.ts');
const alldebrid = require('../src/providers/alldebrid.ts');

test('a provider that fails this sync is reported, so its rows are kept', async () => {
  const dav = await createFakeWebdav({ files: { '/Movies/Heat (1995)/Heat.mkv': 10 } });
  const real = alldebrid.getAlldebridDownloads;
  alldebrid.getAlldebridDownloads = async () => [{ id: '1', name: 'A.2001.mkv', source: 'alldebrid' }];
  try {
    const config = { adApiKey: 'synthetic', webdavUrl: dav.url, webdavUser: 'u', webdavPassword: 'wrong' };
    const downloads = await providers.fetchDownloads(config, { useCache: false, requireFresh: true });
    assert.equal(downloads.length, 1);
    assert.deepEqual(downloads.failedProviders, ['webdav']);
    const ok = await providers.fetchDownloads({ ...config, webdavPassword: 'p' }, { useCache: false, requireFresh: true });
    assert.deepEqual(ok.failedProviders, []);
  } finally { alldebrid.getAlldebridDownloads = real; await dav.close(); }
});
