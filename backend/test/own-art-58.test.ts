// @ts-nocheck
// 5.8: LeLibrary's own folder art. Fixture art directories and synthetic
// images only: no network, no real artwork, no keys.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..', '..');
const own = require('../src/catalog/own-art.ts');
const art = require('../src/catalog/live-art.ts');
const curated = require('../src/catalog/curated-collections.ts');
const { absoluteLocalArtwork } = require('../src/catalog/collection-artwork.ts');

const HUB = /^\/collection-assets\/collections\/(covers|gifs)\/lelibrary-hub-(movies|shows)(-focus)?-v3\.(jpg|gif)(\?v=\d+)?$/;

async function solid(width, height, hue, format = 'jpeg') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="hsl(${hue},60%,45%)"/><circle cx="${width / 2}" cy="${height / 3}" r="${width / 4}" fill="hsl(${(hue + 180) % 360},60%,70%)"/></svg>`;
  const img = sharp(Buffer.from(svg));
  return format === 'png' ? img.png().toBuffer() : img.jpeg().toBuffer();
}
async function layerPng() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect x="64" y="560" width="600" height="90" fill="#f7f4ee" fill-opacity="0.9"/></svg>';
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// A fixture art folder: one subject, one live folder (Top 3), one evergreen.
async function fixtureDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'll-art-'));
  const jpg = await solid(64, 36, 20);
  fs.writeFileSync(path.join(dir, 'hv-halloween-v2.jpg'), jpg);
  fs.writeFileSync(path.join(dir, 'hv-halloween-focus-v2.gif'), Buffer.from('GIF89a'));
  fs.writeFileSync(path.join(dir, 'ch-imdb-top-shows-v2.jpg'), jpg);
  fs.writeFileSync(path.join(dir, 'genre-horror-v3.jpg'), jpg);
  fs.writeFileSync(path.join(dir, 'preset-directors-ridley_scott-v2.jpg'), jpg);
  fs.mkdirSync(path.join(dir, 'live', 'ch-imdb-top-shows'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'live', 'ch-imdb-top-shows', 'over.png'), await layerPng());
  fs.writeFileSync(path.join(dir, 'live', 'ch-imdb-top-shows', 'under.png'), await layerPng());
  const index = {
    version: 2,
    folders: {
      'folder-lelibrary-hv-halloween': { kind: 'subject', version: 2, cover: 'hv-halloween-v2.jpg', gif: 'hv-halloween-focus-v2.gif', backdrop: '/abc.jpg', basis: { collections: [91361], parts: [1, 2] } },
      'folder-lelibrary-ch-imdb-top-shows': { kind: 'live', version: 2, cover: 'ch-imdb-top-shows-v2.jpg', live: { layout: 'top3', version: 1, under: true, slots: [[600, 58, 188, 282]] } },
      'folder-lelibrary-genre-horror': { kind: 'evergreen', version: 3, cover: 'genre-horror-v3.jpg' },
      'folder-lelibrary-preset-directors-ridley_scott': { kind: 'subject', version: 2, cover: 'preset-directors-ridley_scott-v2.jpg' },
      // Rejected: a file name that could leave the folder, a missing file.
      'folder-lelibrary-evil': { kind: 'subject', version: 1, cover: '../../etc/passwd' },
      'folder-lelibrary-missing': { kind: 'subject', version: 1, cover: 'missing-v1.jpg' },
    },
  };
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));
  return dir;
}

function withArt(dir, env = {}) {
  const saved = { COLLECTION_ART_DIR: process.env.COLLECTION_ART_DIR, ART_TMDB_API_KEY: process.env.ART_TMDB_API_KEY, RELEASES_TMDB_API_KEY: process.env.RELEASES_TMDB_API_KEY };
  process.env.COLLECTION_ART_DIR = dir;
  delete process.env.ART_TMDB_API_KEY;
  delete process.env.RELEASES_TMDB_API_KEY;
  Object.assign(process.env, env);
  own.resetOwnArtCache();
  return () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    own.resetOwnArtCache();
  };
}

test('no community artwork is left on disk or in any curated folder', () => {
  const left = [];
  const walk = (dir) => { for (const name of fs.readdirSync(dir)) { const p = path.join(dir, name); if (fs.statSync(p).isDirectory()) walk(p); else left.push(p.slice(path.join(ROOT, 'frontend', 'public').length)); } };
  walk(path.join(ROOT, 'frontend', 'public', 'collection-assets'));
  for (const file of left) assert.ok(file.endsWith('ASSET_SOURCES.md') || HUB.test(file), `community file still shipped: ${file}`);
  const urls = [];
  for (const pack of curated.listCuratedCollections()) {
    urls.push(pack.coverImageUrl, pack.backdropUrl);
    for (const folder of pack.folders) urls.push(folder.coverImageUrl, folder.focusGifUrl, folder.heroBackdropUrl, folder.titleLogoUrl);
  }
  const ids = curated.listCuratedCollections().map((pack) => pack.id);
  for (const collection of curated.buildCuratedCollections(ids)) {
    urls.push(collection.backdropUrl);
    for (const folder of collection.folders) urls.push(folder.coverImageUrl, folder.focusGifUrl, folder.heroBackdropUrl);
  }
  for (const url of urls.filter(Boolean)) {
    if (String(url).startsWith('/collection-assets/')) assert.match(url, HUB, url);
  }
  // Every folder still has a cover (generated here: tests never read the private art).
  const index = curated.curatedCollectionsPayload({ compact: true }).folderIndex;
  const withoutCover = Object.values(index).filter((f) => !f.coverImageUrl).map((f) => f.id);
  assert.ok(withoutCover.length <= 30, `folders without any cover: ${withoutCover.length}`);
});

test('retired community links go to the art that replaced them', () => {
  const marvel = curated.curatedFolderById('folder-lelibrary-franchise-marvel');
  assert.ok(marvel && marvel.coverImageUrl);
  assert.equal(curated.retiredArtworkTarget('/collection-assets/collections/covers/franchise-marvel.jpg?v=3'), marvel.coverImageUrl);
  const actor = curated.curatedFolderById('folder-lelibrary-actor-keanu-reeves');
  assert.equal(curated.retiredArtworkTarget('/collection-assets/people/covers/actor-keanu-reeves.png'), actor.coverImageUrl);
  // A file of a folder that no longer exists on its own: the merged folder.
  assert.ok(curated.retiredArtworkTarget('/collection-assets/collections/covers/discover-trending-series.jpg'));
  assert.equal(curated.retiredArtworkTarget('/collection-assets/collections/covers/no-such-thing.png'), '/collection-assets/collections/covers/lelibrary-hub-movies-v3.jpg');
  // Our own Hub art is not retired.
  assert.equal(curated.retiredArtworkTarget('/collection-assets/collections/covers/lelibrary-hub-movies-v3.jpg'), '');
  assert.equal(curated.retiredArtworkTarget('/art/generated/wide/abc.jpg'), '');
});

test('pushed and saved links to retired files are rewritten, own art gets the host', () => {
  const origin = 'https://lelibrary.uk';
  const marvel = curated.curatedFolderById('folder-lelibrary-franchise-marvel').coverImageUrl;
  assert.equal(absoluteLocalArtwork('/collection-assets/collections/covers/franchise-marvel.jpg?v=2', origin), origin + marvel);
  assert.equal(absoluteLocalArtwork(`${origin}/collection-assets/collections/covers/franchise-marvel.jpg?v=3`, origin), origin + marvel);
  assert.equal(absoluteLocalArtwork('/collection-art/hv-halloween-v2.jpg', origin), `${origin}/collection-art/hv-halloween-v2.jpg`);
  assert.equal(absoluteLocalArtwork('/art/folder/folder-lelibrary-ch-imdb-top-shows.jpg', origin), `${origin}/art/folder/folder-lelibrary-ch-imdb-top-shows.jpg`);
  // Another host's link is never rewritten to ours.
  assert.ok(absoluteLocalArtwork('https://example.com/collection-assets/x.png', origin).startsWith('https://example.com/collection-assets/x.png'));
  assert.match(absoluteLocalArtwork('/collection-assets/collections/covers/lelibrary-hub-shows-v3.jpg', origin), /^https:\/\/lelibrary\.uk\/collection-assets\/collections\/covers\/lelibrary-hub-shows-v3\.jpg\?v=\d$/);
});

test('own art index: covers, GIFs, live links only with a key, unsafe entries skipped', async () => {
  const dir = await fixtureDir();
  let restore = withArt(dir);
  try {
    assert.deepEqual(own.ownArtFor({ id: 'folder-lelibrary-hv-halloween' }), {
      coverImageUrl: '/collection-art/hv-halloween-v2.jpg', focusGifUrl: '/collection-art/hv-halloween-focus-v2.gif', focusGifEnabled: true,
      heroBackdropUrl: 'https://image.tmdb.org/t/p/w1280/abc.jpg',
    });
    // Live without the server's own TMDB key: the fixed snapshot.
    assert.equal(own.ownArtFor({ id: 'folder-lelibrary-ch-imdb-top-shows' }).coverImageUrl, '/collection-art/ch-imdb-top-shows-v2.jpg');
    assert.equal(own.ownArtFor({ id: 'folder-lelibrary-preset-directors-ridley_scott' }).coverImageUrl, '/collection-art/preset-directors-ridley_scott-v2.jpg');
    assert.equal(own.redirectFor('preset-directors-ridley_scott-v1.jpg'), '/collection-art/preset-directors-ridley_scott-v2.jpg');
    assert.equal(own.ownArtFor({ id: 'folder-lelibrary-evil' }), null);
    assert.equal(own.ownArtFor({ id: 'folder-lelibrary-missing' }), null);
    assert.equal(own.ownArtFor({ id: 'folder-lelibrary-not-listed' }), null);
    // Older versions go to the current file; unknown names do not redirect.
    assert.equal(own.redirectFor('genre-horror-v2.jpg'), '/collection-art/genre-horror-v3.jpg');
    assert.equal(own.redirectFor('hv-halloween-focus-v1.gif'), '/collection-art/hv-halloween-focus-v2.gif');
    assert.equal(own.redirectFor('genre-horror-v3.jpg'), '');
    assert.equal(own.redirectFor('../index.json'), '');
    restore();
    restore = withArt(dir, { ART_TMDB_API_KEY: 'synthetic-test-key' });
    assert.equal(own.ownArtFor({ id: 'folder-lelibrary-ch-imdb-top-shows' }).coverImageUrl, '/art/folder/folder-lelibrary-ch-imdb-top-shows.jpg');
    assert.deepEqual(own.liveFolderIds(), ['folder-lelibrary-ch-imdb-top-shows']);
    // The key never reaches a URL.
    assert.ok(!JSON.stringify(own.ownArtFor({ id: 'folder-lelibrary-ch-imdb-top-shows' })).includes('synthetic-test-key'));
  } finally {
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('live covers draw every layout at 1280x720, deterministically', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'll-live-'));
  const over = path.join(dir, 'over.png');
  fs.writeFileSync(over, await layerPng());
  const posters = await Promise.all([10, 60, 120, 200, 280].map((h) => solid(342, 513, h)));
  const backdrop = await solid(1280, 720, 300);
  const stops = [[0, [0, 0, 0]], [0.5, [0.2, 0.1, 0.1]], [1, [1, 0.9, 0.8]]];
  const specs = [
    { layout: 'brand', version: 1, field: [0.2, 0.01, 0.02], edge: [0.03, 0, 0], hi: [0.6, 0.05, 0.08], brandLift: [0.3, 0.02, 0.03], cols: 8, gap: 8 },
    { layout: 'wall', version: 1, cols: 7, gap: 10, stops, amount: 0.42, contrast: 1.04, saturate: 0.85, empty: [0.1, 0.1, 0.1] },
    { layout: 'top3', version: 1, stops, amount: 0.85, slots: [[400, 58, 188, 282], [718, 58, 188, 282], [1028, 58, 188, 282]], under: true },
    { layout: 'still', version: 1, stops, amount: 0.82, gamma: 0.95, leak: [1, 0.5, 0.2, 1, 0, 0.14] },
  ];
  try {
    for (const spec of specs) {
      const layers = { over, ...(spec.under ? { under: over } : {}) };
      const a = await art.drawLive(spec, { posters, backdrop }, layers, 42);
      const b = await art.drawLive(spec, { posters, backdrop }, layers, 42);
      assert.ok(a && a.length > 1000, spec.layout);
      const meta = await sharp(a).metadata();
      assert.equal(meta.width, 1280); assert.equal(meta.height, 720); assert.equal(meta.format, 'jpeg');
      assert.ok(a.equals(b), `${spec.layout} is deterministic`);
      // Nothing to draw from: still a cover (the layout's empty field).
      assert.ok(await art.drawLive(spec, { posters: [], backdrop: null }, layers, 42), `${spec.layout} without inputs`);
    }
    assert.equal(await art.drawLive({ layout: 'nope' }, { posters, backdrop }, { over }, 1), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('live fingerprint follows exactly what is drawn; paths only from image.tmdb.org', () => {
  const spec = { layout: 'top3', version: 1, posters: 3 };
  const rows = [
    { poster: 'https://image.tmdb.org/t/p/w342/a1.jpg', background: 'https://image.tmdb.org/t/p/w1280/b1.jpg' },
    { poster: 'https://pictorium.example/poster?token=SECRET&fallback=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw342%2Fa2.jpg' },
    { poster: 'https://evil.example/a3.jpg?key=SECRET' },
    { poster: 'https://image.tmdb.org/t/p/w342/a1.jpg' },
    { poster: 'https://image.tmdb.org/t/p/w342/a4.jpg' },
  ];
  const paths = art.pickPaths(rows, spec);
  assert.deepEqual(paths, { posters: ['/a1.jpg', '/a2.jpg', '/a4.jpg'], backdrop: '/b1.jpg' });
  assert.ok(!JSON.stringify(paths).includes('SECRET'));
  const fp = art.fingerprint('folder-lelibrary-x', spec, paths, 'stamp');
  assert.equal(fp, art.fingerprint('folder-lelibrary-x', spec, { ...paths }, 'stamp'));
  assert.notEqual(fp, art.fingerprint('folder-lelibrary-x', spec, { ...paths, posters: ['/a1.jpg', '/a4.jpg', '/a2.jpg'] }, 'stamp'));
  assert.notEqual(fp, art.fingerprint('folder-lelibrary-x', spec, paths, 'new-layer'));
  assert.deepEqual(art.pickPaths(rows, { layout: 'wall', posters: 2 }), { posters: ['/a1.jpg', '/a2.jpg'], backdrop: '' });
});

test('live route: ETag + 304 on a drawn cover, snapshot without one, 404 otherwise', async () => {
  const dir = await fixtureDir();
  const restore = withArt(dir);
  const service = require('../src/catalog/live-art-service.ts');
  const original = service.getLiveCover;
  const app = express();
  require('../src/routes/images.ts').mountCoreImageRoutes(app, {});
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = `${base}/art/folder/folder-lelibrary-ch-imdb-top-shows.jpg`;
  try {
    let res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=1800');
    const jpg = Buffer.from(await res.arrayBuffer());
    service.getLiveCover = async () => ({ buf: jpg, etag: '"live-abc"', fingerprint: 'abc', checkedAt: Date.now() });
    res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('etag'), '"live-abc"');
    assert.match(res.headers.get('cache-control'), /max-age=21600/);
    res = await fetch(url, { headers: { 'If-None-Match': '"live-abc"' } });
    assert.equal(res.status, 304);
    // Drawn with a missing image: short cache only.
    service.getLiveCover = async () => ({ buf: jpg, etag: '"live-abc-p"', fingerprint: 'abc-partial', checkedAt: Date.now() });
    res = await fetch(url);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
    for (const bad of ['folder-lelibrary-hv-halloween.jpg', 'folder-lelibrary-nope.jpg', '..%2Findex.json', 'x.png']) {
      assert.equal((await fetch(`${base}/art/folder/${bad}`)).status, 404, bad);
    }
  } finally {
    service.getLiveCover = original;
    server.close();
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('daily art check flags a franchise with a new film once, and never sends a key', async () => {
  const watch = require('../src/catalog/art-watch.ts');
  const dir = await fixtureDir();
  const restore = withArt(dir);
  const saved = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  const posts = [];
  const urls = [];
  let parts = [{ id: 1, release_date: '1978-10-25' }, { id: 2, release_date: '1981-10-30' }];
  const http = {
    get: async (url) => { urls.push(url); return url.includes('/collection/91361') ? { status: 200, data: { parts } } : { status: 404, data: null }; },
    post: async (url, body) => { posts.push({ url, body }); },
  };
  const mem = new Map();
  const store = { get: async (k) => mem.get(k) ?? null, set: async (k, v) => { mem.set(k, v); } };
  try {
    let out = await watch.checkSubjects({ http, store, key: 'synthetic-test-key', webhook: 'https://discord.example/hook' });
    assert.equal(out.checked, 1);
    assert.deepEqual(out.added, []);
    assert.equal(posts.length, 0);
    parts = [...parts, { id: 3, release_date: '2027-10-15' }, { id: 4, release_date: '' }];
    out = await watch.checkSubjects({ http, store, key: 'synthetic-test-key', webhook: 'https://discord.example/hook' });
    assert.deepEqual(out.added, ['folder-lelibrary-hv-halloween']);
    assert.match(out.stale['folder-lelibrary-hv-halloween'].reason, /1 new film/);
    assert.equal(posts.length, 1);
    assert.match(posts[0].body.content, /hv-halloween: 1 new film/);
    assert.ok(!JSON.stringify(posts).includes('synthetic-test-key'));
    assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'art-stale.json'), 'utf8'))['folder-lelibrary-hv-halloween']);
    // Already flagged: no second message.
    await watch.checkSubjects({ http, store, key: 'synthetic-test-key', webhook: 'https://discord.example/hook' });
    assert.equal(posts.length, 1);
    // TMDB failing never marks anything stale.
    assert.equal(await watch.changeFor({ basis: { collections: [5], parts: [1] } }, { http: { get: async () => ({ status: 500 }) }, key: 'k' }), '');
  } finally {
    if (saved === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = saved;
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
