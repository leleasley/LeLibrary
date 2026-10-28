// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const sharp = require('sharp');
const covers = require('../src/catalog/generated-covers.ts');
const { compileCollectionPlan } = require('../src/catalog/collection-plan.ts');
const { normaliseNuvioArtwork } = require('../src/catalog/collection-artwork.ts');

// Small synthetic images only: no network, no real artwork.
async function fixture(width, height, hue, format = 'jpeg') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="hsl(${hue},60%,45%)"/><circle cx="${width / 2}" cy="${height / 3}" r="${width / 4}" fill="hsl(${(hue + 180) % 360},60%,70%)"/></svg>`;
  const image = sharp(Buffer.from(svg));
  return format === 'png' ? image.png().toBuffer() : image.jpeg().toBuffer();
}
async function logoFixture() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><rect x="10" y="10" width="220" height="60" rx="8" fill="#111"/></svg>';
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test('TMDB path validation accepts plain TMDB file names only', () => {
  for (const ok of ['/abc.jpg', '/qJ2tW6WMUDux911r6m7haRef0WH.jpg', '/logo123.png', '/x9.svg']) {
    assert.equal(covers.validTmdbPath(ok), true, ok);
  }
  for (const bad of ['abc.jpg', '/a/b.jpg', '/../a.jpg', '//evil.com/a.jpg', '/a.jpg?x=1', '/a_b.jpg', '/a-b.jpg',
    '/a.gif', '/a.JPG', '/a.jpg/', 'https://image.tmdb.org/t/p/w342/a.jpg', '/a%2e.jpg', '', null, 5, `/${'a'.repeat(80)}.jpg`]) {
    assert.equal(covers.validTmdbPath(bad), false, String(bad));
  }
});

test('cover URLs are content-addressed and parse back to the same spec', () => {
  const spec = covers.buildSpec('poster', { posters: ['/a1.jpg', '/b2.jpg', '/c3.jpg', '/d4.jpg'], backdrop: '/bg.jpg', logo: '/l.png', title: 'Korean Cinema & More' });
  const url = covers.coverUrl(spec);
  assert.match(url, /^\/art\/generated\/poster\/[a-f0-9]{24}\.jpg\?/);
  const parsedUrl = new URL(url, 'http://x');
  const [, , , kind, file] = parsedUrl.pathname.split('/');
  const parsed = covers.parseCoverRequest(kind, file, Object.fromEntries(parsedUrl.searchParams));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.spec, spec);
  assert.equal(parsed.hash, covers.coverFingerprint(spec));
});

test('the fingerprint changes when the paths, title, kind or layout change', () => {
  const base = covers.buildSpec('poster', { posters: ['/a.jpg', '/b.jpg'], backdrop: '/c.jpg', title: 'X' });
  const fp = covers.coverFingerprint(base);
  assert.equal(covers.coverFingerprint(covers.buildSpec('poster', { posters: ['/a.jpg', '/b.jpg'], backdrop: '/c.jpg', title: 'X' })), fp, 'stable for the same input');
  assert.notEqual(covers.coverFingerprint({ ...base, posters: ['/a.jpg', '/z.jpg'] }), fp);
  assert.notEqual(covers.coverFingerprint({ ...base, posters: ['/b.jpg', '/a.jpg'] }), fp);
  assert.notEqual(covers.coverFingerprint({ ...base, backdrop: '/d.jpg' }), fp);
  assert.notEqual(covers.coverFingerprint({ ...base, logo: '/l.png' }), fp);
  assert.notEqual(covers.coverFingerprint({ ...base, title: 'Y' }), fp);
  assert.notEqual(covers.coverFingerprint({ ...base, kind: 'wide' }), fp);
  assert.notEqual(covers.coverFingerprint({ ...base, layout: 'fan' }), fp);
});

test('the route parser rejects anything outside the strict contract', () => {
  const spec = covers.buildSpec('wide', { posters: ['/a.jpg'], backdrop: '/b.jpg', title: 'Ok' });
  const hash = covers.coverFingerprint(spec);
  const good = { p: 'a.jpg', b: 'b.jpg', t: 'Ok', v: '1' };
  assert.equal(covers.parseCoverRequest('wide', `${hash}.jpg`, good).ok, true);
  const reject = (kind, file, query, why) => assert.equal(covers.parseCoverRequest(kind, file, query).ok, false, why);
  reject('square', `${hash}.jpg`, good, 'unknown kind');
  reject('wide', `${hash}.png`, good, 'non-jpg file');
  reject('wide', 'nothex.jpg', good, 'bad hash format');
  reject('wide', `${hash}.jpg`, { ...good, t: 'Tampered' }, 'hash mismatch');
  reject('wide', `${hash}.jpg`, { ...good, p: '../a.jpg' }, 'path traversal');
  reject('wide', `${hash}.jpg`, { ...good, p: 'a.jpg,https://evil.example/x.jpg' }, 'foreign host');
  reject('wide', `${hash}.jpg`, { ...good, b: 'evil.example/b.jpg' }, 'nested backdrop path');
  reject('wide', `${hash}.jpg`, { ...good, l: 'x.gif' }, 'bad logo extension');
  reject('wide', `${hash}.jpg`, { ...good, p: ['a.jpg', 'b.jpg'] }, 'repeated parameter');
  reject('wide', `${hash}.jpg`, { ...good, p: 'a.jpg,b.jpg,c.jpg,d.jpg,e.jpg,f.jpg,g.jpg' }, 'too many posters');
  reject('wide', `${hash}.jpg`, { ...good, v: '999' }, 'unknown version');
  reject('wide', `${hash}.jpg`, { ...good, y: 'spiral' }, 'unknown layout');
  reject('wide', `${hash}.jpg`, { ...good, t: 'x'.repeat(300) }, 'title too long');
  reject('wide', `${hash}.jpg`, { ...good, t: 'a\nb' }, 'control characters');
  reject('wide', `${hash}.jpg`, { v: '1' }, 'no images');
});

test('titles are cleaned and capped; specs drop invalid paths', () => {
  assert.equal(covers.cleanTitle('  Hello\u0000\n  World\u202e '), 'Hello World');
  assert.equal(Array.from(covers.cleanTitle('x'.repeat(200))).length, 60);
  const spec = covers.buildSpec('poster', { posters: ['/ok.jpg', 'https://evil/x.jpg', '/../x.jpg', '/ok.jpg'], backdrop: 'nope', title: 'T' });
  assert.deepEqual(spec.posters, ['/ok.jpg']);
  assert.equal(spec.backdrop, '');
  assert.equal(covers.buildSpec('poster', { posters: [], title: 'Only a title' }), null);
});

test('TMDB paths are read from catalogue artwork, never from other hosts', () => {
  assert.equal(covers.tmdbPathFromImageUrl('https://image.tmdb.org/t/p/w342/abc123.jpg'), '/abc123.jpg');
  assert.equal(covers.tmdbPathFromImageUrl('https://image.tmdb.org/t/p/w1280/bg9.jpg'), '/bg9.jpg');
  // Poster providers wrap the TMDB poster: the token in the proxy URL never survives.
  const pictorium = `https://lelibrary.uk/SECRET-TOKEN/pictorium/movie/550.jpg?fallback=${encodeURIComponent('https://image.tmdb.org/t/p/w342/fight.jpg')}`;
  assert.equal(covers.tmdbPathFromImageUrl(pictorium), '/fight.jpg');
  assert.equal(covers.tmdbPathFromImageUrl('http://image.tmdb.org/t/p/w342/a.jpg'), '', 'plain http');
  assert.equal(covers.tmdbPathFromImageUrl('https://image.tmdb.org.evil.example/t/p/w342/a.jpg'), '');
  assert.equal(covers.tmdbPathFromImageUrl('https://api.ratingposterdb.com/k/imdb/poster-default/tt1.jpg?fallback=true'), '');
  const nested = `https://a.example/x?fallback=${encodeURIComponent(`https://b.example/y?fallback=${encodeURIComponent('https://image.tmdb.org/t/p/w342/a.jpg')}`)}`;
  assert.equal(covers.tmdbPathFromImageUrl(nested), '', 'only one level of fallback');
  const art = covers.artFromRows([
    { poster: pictorium, background: 'https://image.tmdb.org/t/p/w1280/bg.jpg' },
    { poster: 'https://image.tmdb.org/t/p/w342/two.jpg' },
    { poster: 'https://image.tmdb.org/t/p/w342/two.jpg' },
    { poster: 'https://other.example/three.jpg' },
  ]);
  assert.deepEqual(art, { posters: ['/fight.jpg', '/two.jpg'], backdrop: '/bg.jpg' });
});

test('renders poster and wide JPEGs at the right sizes from fixture images', async () => {
  const posters = await Promise.all([10, 90, 200, 300].map((hue) => fixture(342, 513, hue)));
  const backdrop = await fixture(780, 439, 40);
  const logo = await logoFixture();
  const cases = [
    { spec: covers.buildSpec('poster', { posters: ['/a.jpg', '/b.jpg', '/c.jpg', '/d.jpg'], title: 'Grid' }), images: { posters, backdrop: null, logo: null }, size: covers.POSTER_SIZE },
    { spec: covers.buildSpec('poster', { posters: ['/a.jpg', '/b.jpg', '/c.jpg'], backdrop: '/e.jpg', title: 'Fan' }), images: { posters: posters.slice(0, 3), backdrop, logo: null }, size: covers.POSTER_SIZE },
    { spec: covers.buildSpec('poster', { posters: ['/a.jpg'], title: '' }), images: { posters: [posters[0]], backdrop: null, logo: null }, size: covers.POSTER_SIZE },
    { spec: covers.buildSpec('wide', { backdrop: '/e.jpg', logo: '/l.png', title: 'Logo wins' }), images: { posters: [], backdrop, logo }, size: covers.WIDE_SIZE },
    { spec: covers.buildSpec('wide', { posters: ['/a.jpg', '/b.jpg'], title: 'No backdrop at all here' }), images: { posters: posters.slice(0, 2), backdrop: null, logo: null }, size: covers.WIDE_SIZE },
  ];
  for (const { spec, images, size } of cases) {
    const buf = await covers.renderCover(spec, images);
    const meta = await sharp(buf).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.equal(meta.width, size.width);
    assert.equal(meta.height, size.height);
    assert.ok(buf.length < 150 * 1024, 'covers stay small');
  }
});

test('a broken image never breaks the render', async () => {
  const good = await fixture(342, 513, 120);
  const spec = covers.buildSpec('poster', { posters: ['/a.jpg', '/b.jpg', '/c.jpg', '/d.jpg'], title: 'Partial' });
  const buf = await covers.renderCover(spec, { posters: [good, Buffer.from('not an image'), null, good], backdrop: null, logo: Buffer.from('<svg') });
  assert.equal((await sharp(buf).metadata()).width, 342);
});

async function startRoute(t, files) {
  const calls = [];
  const imageHttpClient = {
    get: async (url, options) => {
      calls.push({ url, options });
      const name = url.split('/').pop();
      if (!files[name]) return { status: 404, data: Buffer.alloc(0), headers: {} };
      return { status: 200, data: files[name], headers: { 'content-type': 'image/jpeg' } };
    },
  };
  const values = new Map();
  const cache = { get: async (k) => values.get(k) ?? null, set: async (k, v) => { values.set(k, v); } };
  const app = express();
  app.set('query parser', 'extended');
  require('../src/routes/images.ts').mountCoreImageRoutes(app, { imageHttpClient, cache });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { base: `http://127.0.0.1:${server.address().port}`, calls, values };
}

test('the art route renders, caches and only ever fetches image.tmdb.org', async (t) => {
  const files = {
    'a.jpg': await fixture(342, 513, 10), 'b.jpg': await fixture(342, 513, 100),
    'c.jpg': await fixture(342, 513, 200), 'd.jpg': await fixture(342, 513, 300),
    'bg.jpg': await fixture(780, 439, 50),
  };
  const { base, calls, values } = await startRoute(t, files);
  const url = covers.coverUrl(covers.buildSpec('poster', { posters: ['/a.jpg', '/b.jpg', '/c.jpg', '/d.jpg'], backdrop: '/bg.jpg', title: 'Route test' }));
  const first = await fetch(base + url);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'image/jpeg');
  assert.match(first.headers.get('cache-control'), /immutable/);
  const meta = await sharp(Buffer.from(await first.arrayBuffer())).metadata();
  assert.equal(meta.width, 342);
  assert.equal(meta.height, 513);
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.match(call.url, /^https:\/\/image\.tmdb\.org\/t\/p\/w(342|780|300)\/[A-Za-z0-9]+\.(jpg|png|svg)$/);
    assert.equal(call.options.maxRedirects, 0, 'redirects can never leave TMDB');
  }
  assert.ok([...values.keys()].some((key) => key.startsWith('gencover:v1:')), 'stored in the durable image cache');
  const fetched = calls.length;
  const second = await fetch(base + url);
  assert.equal(second.status, 200);
  assert.equal(calls.length, fetched, 'served from cache');

  // Rejected requests never fetch anything.
  const bad = [
    url.replace('t=Route+test', 't=Other'),
    url.replace('p=a.jpg', 'p=..%2Fa.jpg'),
    url.replace('p=a.jpg', `p=${encodeURIComponent('https://evil.example/a.jpg')}`),
    '/art/generated/poster/0123456789abcdef01234567.jpg?b=bg.jpg&v=1',
    '/art/generated/other/0123456789abcdef01234567.jpg?b=bg.jpg&v=1',
  ];
  for (const path of bad) {
    const res = await fetch(base + path, { redirect: 'manual' });
    assert.equal(res.status, 400, path);
  }
  assert.equal(calls.length, fetched);
});

test('the art route falls back to the TMDB image when nothing can be fetched', async (t) => {
  const { base } = await startRoute(t, {});
  const url = covers.coverUrl(covers.buildSpec('wide', { backdrop: '/bg.jpg', title: 'Down' }));
  const res = await fetch(base + url, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://image.tmdb.org/t/p/w780/bg.jpg');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('the plan gives generated covers only to folders without hand-made art', () => {
  const collections = [{
    id: 'collection-lelibrary-pack', title: 'Pack',
    folders: [
      { id: 'folder-lelibrary-a', title: 'Needs Art', tileShape: 'LANDSCAPE', catalogSources: [{ catalogId: 'lib-trending_movies', type: 'movie' }] },
      { id: 'folder-lelibrary-b', title: 'Has Art', tileShape: 'LANDSCAPE', coverImageUrl: '/collection-assets/collections/covers/x.jpg', catalogSources: [{ catalogId: 'lib-trending_movies', type: 'movie' }] },
      { id: 'folder-lelibrary-c', title: 'Poster Tile', tileShape: 'POSTER', heroBackdropUrl: 'https://example.org/own.jpg', catalogSources: [{ catalogId: 'lib-trending_series', type: 'series' }] },
    ],
  }];
  const parts = { posters: ['/p1.jpg', '/p2.jpg', '/p3.jpg', '/p4.jpg'], backdrop: '/bg.jpg', logo: '', title: 'Needs Art' };
  const generatedArt = { 'folder-lelibrary-a': parts, 'folder-lelibrary-b': parts, 'folder-lelibrary-c': { ...parts, title: 'Poster Tile' } };
  const plan = compileCollectionPlan({ collections, integration: 'nuvio', manifestId: 'community.lelibrary.dev', generatedArt });
  const [a, b, c] = plan.collections[0].folders;
  assert.match(a.coverImageUrl, /^\/art\/generated\/wide\/[a-f0-9]{24}\.jpg\?/);
  assert.equal(a.heroBackdropUrl, 'https://image.tmdb.org/t/p/w1280/bg.jpg');
  assert.equal(b.coverImageUrl, '/collection-assets/collections/covers/x.jpg', 'hand-made art wins');
  assert.match(c.coverImageUrl, /^\/art\/generated\/poster\//);
  assert.equal(c.heroBackdropUrl, 'https://example.org/own.jpg', 'an existing backdrop is kept');
  const nuvio = normaliseNuvioArtwork(a, 'https://lelibrary.uk');
  assert.ok(nuvio.coverImageUrl.startsWith('https://lelibrary.uk/art/generated/wide/'));
  // Without generated parts the plan is unchanged.
  const plain = compileCollectionPlan({ collections, integration: 'nuvio', manifestId: 'community.lelibrary.dev' });
  assert.equal(plain.collections[0].folders[0].coverImageUrl, undefined);
});

test('collecting art reads own catalogue rows only and never leaks a token', async () => {
  const token = 'SECRET-INSTALL-TOKEN';
  const loaded = [];
  const rows = (prefix) => Array.from({ length: 6 }, (_, i) => ({
    poster: `https://lelibrary.uk/${token}/pictorium/movie/${i}.jpg?fallback=${encodeURIComponent(`https://image.tmdb.org/t/p/w342/${prefix}${i}.jpg`)}`,
    background: `https://image.tmdb.org/t/p/w1280/${prefix}bg.jpg`,
  }));
  const collections = [{
    id: 'c', folders: [
      { id: 'f-own', title: 'Own', catalogSources: [{ catalogId: 'lib-trending_movies', type: 'movie', addonId: 'community.lelibrary.dev' }] },
      { id: 'f-art', title: 'Art', coverImageUrl: '/collection-assets/x.png', catalogSources: [{ catalogId: 'lib-trending_movies', type: 'movie' }] },
      { id: 'f-ext', title: 'External', catalogSources: [{ catalogId: 'top', type: 'movie', addonId: 'org.other', addonUrl: 'https://other.example/manifest.json' }] },
      { id: 'folder-lelibrary-hub-movies', title: 'Hub', catalogSources: [{ catalogId: 'torbox-movies', type: 'movie' }] },
      { title: 'No id', catalogSources: [{ catalogId: 'lib-trending_series', type: 'series' }] },
    ],
  }];
  const art = await covers.collectGeneratedArt(collections, {
    manifestId: 'community.lelibrary.dev',
    loadRows: async (catalogId, type) => { loaded.push(`${type}:${catalogId}`); return rows(type === 'movie' ? 'm' : 's'); },
  });
  assert.deepEqual(Object.keys(art).sort(), ['f-own', 'folder-0-4']);
  assert.deepEqual(art['f-own'].posters, ['/m0.jpg', '/m1.jpg', '/m2.jpg', '/m3.jpg']);
  assert.equal(art['f-own'].backdrop, '/mbg.jpg');
  assert.deepEqual(loaded.sort(), ['movie:lib-trending_movies', 'series:lib-trending_series']);
  assert.equal(JSON.stringify(art).includes(token), false);
});

test('collecting art stops at its budget', async () => {
  const collections = [{ id: 'c', folders: [{ id: 'slow', title: 'Slow', catalogSources: [{ catalogId: 'lib-trending_movies', type: 'movie' }] }] }];
  const started = Date.now();
  const art = await covers.collectGeneratedArt(collections, { budgetMs: 50, loadRows: () => new Promise(() => {}) });
  assert.deepEqual(art, {});
  assert.ok(Date.now() - started < 1000);
});

test('logos are resolved with the server key only, and not at all without one', async () => {
  assert.equal(await covers.resolveSourceLogo('trending_movies', { apiKey: 'x' }), '', 'not a logo source');
  const { catalogs } = require('../src/catalog/catalogdefs.ts');
  const networkId = Object.keys(catalogs).find((id) => catalogs[id].handler === 'tmdb_network');
  assert.ok(networkId);
  let called = 0;
  assert.equal(await covers.resolveSourceLogo(networkId, { apiKey: '', http: { get: async () => { called++; return { status: 200, data: {} }; } } }), '');
  assert.equal(called, 0, 'no key, no TMDB call');
  const values = new Map();
  const urls = [];
  const http = { get: async (url) => { urls.push(url); return { status: 200, data: { logo_path: '/netlogo.png' } }; } };
  const cache = { get: async (k) => values.get(k), set: async (k, v) => { values.set(k, v); } };
  assert.equal(await covers.resolveSourceLogo(networkId, { apiKey: 'synthetic', http, cache }), '/netlogo.png');
  assert.equal(await covers.resolveSourceLogo(networkId, { apiKey: 'synthetic', http, cache }), '/netlogo.png');
  assert.equal(urls.length, 1, 'cached');
  assert.match(urls[0], /^https:\/\/api\.themoviedb\.org\/3\/network\/\d+$/);
  const badHttp = { get: async () => ({ status: 200, data: { logo_path: 'https://evil.example/x.png' } }) };
  const other = Object.keys(catalogs).find((id) => catalogs[id].handler === 'tmdb_company');
  assert.equal(await covers.resolveSourceLogo(other, { apiKey: 'synthetic', http: badHttp, cache: { get: async () => null, set: async () => {} } }), '');
});

test('a registered cover is served from its short URL; an unknown short URL is refused', async (t) => {
  const files = { 'a.jpg': await fixture(342, 513, 10), 'b.jpg': await fixture(342, 513, 100), 'bg.jpg': await fixture(780, 439, 50) };
  const { base } = await startRoute(t, files);
  const spec = covers.buildSpec('wide', { posters: ['/a.jpg', '/b.jpg'], backdrop: '/bg.jpg', title: 'Short URL test' });
  const short = covers.staticCoverUrl(spec);
  assert.match(short, /^\/art\/generated\/wide\/[a-f0-9]{24}\.jpg$/, 'no query string');
  const ok = await fetch(base + short);
  assert.equal(ok.status, 200);
  assert.equal((await fetch(`${base}/art/generated/wide/${'0'.repeat(24)}.jpg`)).status, 400);
});
