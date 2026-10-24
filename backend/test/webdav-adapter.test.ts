// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeWebdav } = require('./helpers/fake-webdav.ts');

process.env.WEBDAV_SOURCE = 'on';
process.env.WEBDAV_ALLOW_PRIVATE = 'on';
const webdav = require('../src/providers/webdav.ts');

const GB = 1500;
const TREE = {
  '/Movies/Heat (1995)/Heat.1995.1080p.mkv': GB,
  '/Movies/Heat (1995)/Heat.1995.nfo': 20,
  '/Shows/Breaking Bad/Season 1/Breaking.Bad.S01E01.mkv': GB,
  '/Shows/Breaking Bad/Season 1/Breaking.Bad.S01E02.mkv': GB,
  '/loose.mp4': GB,
  '/Movies/notes.txt': 5,
};

function memoryCache() {
  const m = new Map();
  return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); } };
}
const config = (dav, over = {}) => ({ webdavUrl: dav.url, webdavUser: 'u', webdavPassword: 'p', ...over });

test('a WebDAV tree becomes one item per folder of videos', async () => {
  const dav = await createFakeWebdav({ files: TREE });
  try {
    const items = await webdav.listWebdavLibrary(config(dav), { deps: { cache: memoryCache() } });
    assert.deepEqual(items.map((i) => i.name).sort(), ['Breaking Bad Season 1', 'Heat (1995)', 'loose.mp4']);
    const heat = items.find((i) => i.name === 'Heat (1995)');
    assert.equal(heat.source, 'webdav');
    assert.match(heat.id, /^w:[0-9a-f]{24}$/);
    assert.equal(heat.download_finished, true);
    assert.deepEqual(heat.files.map((f) => f.name).sort(), ['Heat (1995)/Heat.1995.1080p.mkv', 'Heat (1995)/Heat.1995.nfo']);
    const file = heat.files.find((f) => f.name.endsWith('.mkv'));
    assert.equal(webdav.fileRefToPath(file.id), '/Movies/Heat (1995)/Heat.1995.1080p.mkv');
    assert.equal(heat.size, GB);
    const show = items.find((i) => i.name === 'Breaking Bad Season 1');
    assert.equal(show.files.length, 2);
    // Every request is a Depth: 1 listing.
    assert.ok(dav.log.length > 0);
    assert.ok(dav.log.every((r) => r.method === 'PROPFIND' && r.depth === '1'), JSON.stringify(dav.log));
  } finally { await dav.close(); }
});

test('the same ids come back on every scan', async () => {
  const dav = await createFakeWebdav({ files: TREE });
  try {
    const a = await webdav.listWebdavLibrary(config(dav), { deps: { cache: memoryCache() } });
    const b = await webdav.listWebdavLibrary(config(dav), { deps: { cache: memoryCache() } });
    assert.deepEqual(a.map((i) => i.id).sort(), b.map((i) => i.id).sort());
  } finally { await dav.close(); }
});

test('a server under a path prefix (Nextcloud) is crawled from that path', async () => {
  const dav = await createFakeWebdav({ files: TREE, prefix: '/remote.php/dav/files/u' });
  try {
    const items = await webdav.listWebdavLibrary(config(dav), { deps: { cache: memoryCache() } });
    assert.equal(items.length, 3);
    const heat = items.find((i) => i.name === 'Heat (1995)');
    assert.equal(webdav.fileRefToPath(heat.files[0].id).startsWith('/Movies/'), true);
  } finally { await dav.close(); }
});

test('a wrong password fails the scan instead of returning an empty library', async () => {
  const dav = await createFakeWebdav({ files: TREE });
  try {
    await assert.rejects(webdav.listWebdavLibrary(config(dav, { webdavPassword: 'nope' }), { deps: { cache: memoryCache() } }), { code: 'auth' });
  } finally { await dav.close(); }
});

test('too many entries fails the scan, also when the server ignores Depth', async () => {
  const many = {};
  for (let i = 0; i < 60; i++) many[`/Big/F${i}/file${i}.mkv`] = GB;
  for (const ignoreDepth of [false, true]) {
    const dav = await createFakeWebdav({ files: many, ignoreDepth });
    try {
      await assert.rejects(
        webdav.listWebdavLibrary(config(dav), { deps: { cache: memoryCache(), maxEntries: 50 } }),
        { code: 'too-large' },
      );
    } finally { await dav.close(); }
  }
});

test('a server that ignores Depth still gives each item once', async () => {
  const dav = await createFakeWebdav({ files: TREE, ignoreDepth: true });
  try {
    const items = await webdav.listWebdavLibrary(config(dav), { deps: { cache: memoryCache() } });
    assert.deepEqual(items.map((i) => i.name).sort(), ['Breaking Bad Season 1', 'Heat (1995)', 'loose.mp4']);
    assert.equal(items.find((i) => i.name === 'Breaking Bad Season 1').files.length, 2);
  } finally { await dav.close(); }
});

test('a scan is reused within the scan interval, then repeated', async () => {
  const dav = await createFakeWebdav({ files: TREE });
  try {
    let now = 1_000_000;
    const deps = { cache: memoryCache(), now: () => now };
    await webdav.listWebdavLibrary(config(dav), { fresh: true, deps });
    const after = dav.log.length;
    await webdav.listWebdavLibrary(config(dav), { fresh: true, deps });
    assert.equal(dav.log.length, after, 'second scan inside the interval made requests');
    now += webdav.scanTtlMs() + 1;
    await webdav.listWebdavLibrary(config(dav), { fresh: true, deps });
    assert.ok(dav.log.length > after);
  } finally { await dav.close(); }
});

test('local and plain-HTTP servers are refused unless allowed', async () => {
  const dav = await createFakeWebdav({ files: TREE });
  try {
    process.env.WEBDAV_ALLOW_PRIVATE = '';
    await assert.rejects(webdav.listWebdavLibrary(config(dav), { deps: { cache: memoryCache() } }), { code: 'blocked-host' });
    const plain = await webdav.verifyWebdav({ url: 'http://93.184.215.14/dav/', user: 'u', password: 'p' });
    assert.equal(plain.error, 'blocked-host');
  } finally { process.env.WEBDAV_ALLOW_PRIVATE = 'on'; await dav.close(); }
});

test('connection details: bad URLs are rejected, the scope ignores the password', () => {
  assert.equal(webdav.davConnection({ webdavUrl: 'ftp://x/y', webdavUser: 'u', webdavPassword: 'p' }), null);
  assert.equal(webdav.davConnection({ webdavUrl: 'https://a:b@x/y', webdavUser: 'u', webdavPassword: 'p' }), null);
  assert.equal(webdav.davConnection({ webdavUrl: '', webdavUser: 'u' }), null);
  const one = webdav.davConnection({ webdavUrl: 'https://dav.example.test/x/', webdavUser: 'u', webdavPassword: 'p' });
  const two = webdav.davConnection({ webdavUrl: 'https://dav.example.test/x', webdavUser: 'u', webdavPassword: 'other' });
  assert.equal(one.scopeSeed, two.scopeSeed);
  assert.equal(one.auth, 'Basic ' + Buffer.from('u:p').toString('base64'));
});

test('file refs can never leave the WebDAV folder', () => {
  const ref = (p) => Buffer.from(p, 'utf8').toString('base64url');
  for (const bad of ['../etc/passwd', '/a/../../b', 'http://x/y', '\\a', '//host/x', '', '/a/./b/..']) {
    assert.equal(webdav.fileRefToPath(ref(bad)), null, bad);
  }
  assert.equal(webdav.fileRefToPath('not base64 !!'), null);
  assert.equal(webdav.fileRefToPath(ref('/Movies/A B #1 é.mkv')), '/Movies/A B #1 é.mkv');
});

test('verify: counts on success, clear codes on failure', async () => {
  const dav = await createFakeWebdav({ files: TREE });
  try {
    const ok = await webdav.verifyWebdav({ url: dav.url, user: 'u', password: 'p' });
    assert.deepEqual(ok, { valid: true, folders: 2, videos: 1 });
    assert.equal((await webdav.verifyWebdav({ url: dav.url, user: 'u', password: 'x' })).error, 'auth');
    assert.equal((await webdav.verifyWebdav({ url: 'nonsense', user: 'u', password: 'p' })).error, 'bad-url');
  } finally { await dav.close(); }
  const html = await new Promise((resolve) => {
    const s = require('node:http').createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<html>hi</html>'); });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const r = await webdav.verifyWebdav({ url: `http://127.0.0.1:${html.address().port}/`, user: 'u', password: 'p' });
    assert.equal(r.error, 'not-webdav');
  } finally { html.close(); }
  const off = await webdav.verifyWebdav({ url: 'http://127.0.0.1:1/', user: 'u', password: 'p' });
  assert.equal(off.error, 'unreachable');
});
