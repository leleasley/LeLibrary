// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert');
const aio = require('../src/streams/aiostreams.ts');

test('isBlockedIp rejects private, loopback, link-local, CGNAT and reserved ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.5', '172.16.0.1', '172.31.255.9', '169.254.10.10', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fd00::1', 'fe80::1']) {
    assert.strictEqual(aio.isBlockedIp(ip), true, `${ip} should be blocked`);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '104.21.27.218', '2606:4700::1111']) {
    assert.strictEqual(aio.isBlockedIp(ip), false, `${ip} should be allowed`);
  }
});

test('normalizeConnectorUrl only accepts https manifest endpoints without credentials', () => {
  assert.ok(aio.normalizeConnectorUrl('https://aio.example.com/uuid/password/manifest.json'));
  assert.strictEqual(aio.normalizeConnectorUrl('http://aio.example.com/manifest.json'), null);
  assert.strictEqual(aio.normalizeConnectorUrl('https://user:pass@aio.example.com/manifest.json'), null);
  // A pasted base link or stremio:// install link is normalised to its manifest.
  assert.strictEqual(aio.normalizeConnectorUrl('https://aio.example.com/config').pathname, '/config/manifest.json');
  assert.strictEqual(aio.normalizeConnectorUrl('stremio://aio.example.com/x/manifest.json').protocol, 'https:');
  // Plain HTTP only when the operator allows private (self-hosted) addons.
  assert.ok(aio.normalizeConnectorUrl('http://192.168.1.5:7000/manifest.json', { allowHttp: true }));
  assert.strictEqual(aio.normalizeConnectorUrl('not a url'), null);
  assert.strictEqual(aio.normalizeConnectorUrl(''), null);
});

test('connectorFingerprint is stable, short and does not reveal the URL', () => {
  const url = 'https://aio.example.com/supersecret/manifest.json';
  const fp = aio.connectorFingerprint(url);
  assert.strictEqual(fp, aio.connectorFingerprint(url));
  assert.strictEqual(fp.length, 16);
  assert.ok(!fp.includes('secret'));
  assert.notStrictEqual(fp, aio.connectorFingerprint('https://aio.example.com/other/manifest.json'));
});

test('fetchAioStreams refuses an invalid connector without any network call', async () => {
  const r = await aio.fetchAioStreams({ url: 'http://x/manifest.json', type: 'movie', id: 'tt1' });
  assert.deepStrictEqual(r, { streams: [], skipped: 'invalid_url' });
});

test('a URL that resolves to a loopback host is refused (SSRF guard)', async () => {
  const r = await aio.fetchAioStreams({ url: 'https://localhost/manifest.json', type: 'movie', id: 'tt1', timeoutMs: 1000 });
  assert.strictEqual(r.streams.length, 0);
  assert.ok(['blocked_host', 'error', 'bad_response'].includes(r.skipped), `unexpected skip: ${r.skipped}`);
});

test('repeated failures open a cooldown and a success clears it', () => {
  aio._reset();
  const fp = aio.connectorFingerprint('https://aio.example.com/x/manifest.json');
  assert.strictEqual(aio.isCoolingDown(fp), false);
  aio.markFailure(fp);
  aio.markFailure(fp);
  aio.markFailure(fp);
  assert.strictEqual(aio.isCoolingDown(fp), true);
  aio.markSuccess(fp);
  assert.strictEqual(aio.isCoolingDown(fp), false);
});

test('loopActive is false for an idle connector and generic keys', () => {
  aio._reset();
  assert.strictEqual(aio.loopActive('user', 'fp', 'movie', 'tt1'), false);
  aio.loopActive('user', 'fp', 'movie', 'tt1'); // no state change
});

export interface AiostreamsTestTestModule {};

test('private and internal hosts are refused unless the operator opts in', async () => {
  assert.strictEqual(await aio.pinnedLookup('127.0.0.1'), null);
  assert.strictEqual(await aio.pinnedLookup('192.168.1.5'), null);
  assert.strictEqual(await aio.pinnedLookup('169.254.169.254'), null);
  assert.ok(await aio.pinnedLookup('192.168.1.5', { allowPrivate: true }));
  assert.strictEqual(aio.allowPrivateHosts({}), false);
  assert.strictEqual(aio.allowPrivateHosts({ CUSTOM_ADDONS_ALLOW_PRIVATE: 'on' }), true);
});

test('the pinned lookup always answers with the address that was checked', async () => {
  const lookup = await aio.pinnedLookup('203.0.113.7');
  await new Promise((resolve) => lookup('anything.example', {}, (err, address) => { assert.strictEqual(address, '203.0.113.7'); resolve(); }));
  await new Promise((resolve) => lookup('anything.example', { all: true }, (err, list) => { assert.strictEqual(list[0].address, '203.0.113.7'); resolve(); }));
});
