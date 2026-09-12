const test = require('node:test');
const assert = require('node:assert/strict');

const options = require('../website/public/pictorium-options');
const pictorium = require('../src/pictorium');
const { enhanceMeta, buildPictoriumPosterUrl } = require('../src/builder');

test('pictorium options whitelist, clamp and drop unknown keys', () => {
  const cleaned = options.sanitize({
    bs: 'nonsense', rs: 'netflix', gradHeight: 999, blur: -4, be: '0',
    side: 'diagonal', ac: 'F59E0B', lang: 'EN', region: 'gb', rogue: 'x',
  });
  assert.equal(cleaned.bs, 'shadow');
  assert.equal(cleaned.rs, 'netflix');
  assert.equal(cleaned.gradHeight, 100);
  assert.equal(cleaned.blur, 0);
  assert.equal(cleaned.be, '0');
  assert.equal(cleaned.side, '');
  assert.equal(cleaned.ac, '#f59e0b');
  assert.equal(cleaned.lang, 'en');
  assert.equal(cleaned.region, 'GB');
  assert.equal(Object.prototype.hasOwnProperty.call(cleaned, 'rogue'), false);
});

test('pictorium rating sources are normalized to supported ids', () => {
  assert.equal(options.sanitize({ rsrc: 'tomatoes,imdb,bogus,imdb' }).rsrc, 'imdb,tomatoes');
  assert.equal(options.sanitize({ rsrc: ['trakt', 'tmdb'] }).rsrc, 'tmdb,trakt');
  assert.equal(options.sanitize({ rsrc: 'tomatoesaudience,myanimelist' }).rsrc, 'popcorntime,mal');
  assert.equal(options.sanitize({}).rsrc, '');
  assert.match(options.toQuery({ rsrc: 'letterboxd,metacritic' }), /rsrc=letterboxd%2Cmetacritic/);
  const all = options.sanitize({
    rsrc: 'imdb,tmdb,mdblist,tomatoes,popcorntime,letterboxd,metacritic,metacriticuser,trakt,simkl,filmweb,filmwebcritics,rogerebert,mal,anilist,kitsu',
  }).rsrc;
  assert.ok(all.length <= 200);
  assert.equal(all.split(',').length, 16);
});

test('pictorium options toQuery stays a small ordered whitelist', () => {
  const qs = options.toQuery({ badges: '0', pre: '1', side: 'left' });
  assert.match(qs, /badges=0/);
  assert.match(qs, /pre=1/);
  assert.match(qs, /side=left/);
  assert.doesNotMatch(qs, /rogue/);
});

test('pictorium region, language and coming-soon defaults', () => {
  assert.equal(options.sanitize({}).pre, '1');
  assert.equal(options.sanitize({ pre: '0' }).pre, '');
  assert.equal(options.sanitize({ region: 'gb' }).region, 'GB');
  assert.equal(options.sanitize({ lang: 'EN' }).lang, 'en');
  assert.equal(options.sanitize({ region: 'USA' }).region, '');
  assert.match(options.toQuery({ region: 'GB', lang: 'en' }), /region=GB/);
  assert.match(options.toQuery({ region: 'GB', lang: 'en' }), /lang=en/);
});

test('pictorium options fromQuery accepts an object or a query string', () => {
  const fromObject = options.fromQuery({ bs: 'vetro', gradHeight: '40', badges: '0' });
  assert.equal(fromObject.bs, 'vetro');
  assert.equal(fromObject.gradHeight, 40);
  assert.equal(fromObject.badges, '0');
  const fromString = options.fromQuery('bs=pill&badges=0');
  assert.equal(fromString.bs, 'pill');
  assert.equal(fromString.badges, '0');
  assert.equal(options.fromQuery({ bs: ['vetro'] }).bs, 'vetro');
});

test('user Pictorium URL must be public HTTPS; operator URL may be internal', () => {
  // User-supplied URL (strict): private/internal and plain HTTP are refused.
  assert.equal(pictorium.safeBase('http://pictorium:8080'), '');
  assert.equal(pictorium.safeBase('http://localhost:8080'), '');
  assert.equal(pictorium.safeBase('http://127.0.0.1:8080'), '');
  assert.equal(pictorium.safeBase('http://192.168.1.20:8080'), '');
  assert.equal(pictorium.safeBase('http://posters.example.com'), '');
  assert.equal(pictorium.safeBase('https://posters.example.com/'), 'https://posters.example.com');
  // Operator env (trusted): internal HTTP is allowed.
  assert.equal(pictorium.safeBase('http://pictorium:8080', { allowPrivate: true }), 'http://pictorium:8080');
  // Both always refuse metadata and credentials.
  for (const allow of [undefined, { allowPrivate: true }]) {
    assert.equal(pictorium.safeBase('http://169.254.169.254/latest/meta-data', allow), '');
    assert.equal(pictorium.safeBase('https://metadata.google.internal', allow), '');
    assert.equal(pictorium.safeBase('http://100.100.100.200/latest/meta-data', allow), '');
    assert.equal(pictorium.safeBase('https://user:pass@posters.example.com', allow), '');
    assert.equal(pictorium.safeBase('ftp://posters.example.com', allow), '');
  }
});

test('resolveBase prefers a public user instance, then the operator backend', () => {
  const prev = process.env.PICTORIUM_URL;
  process.env.PICTORIUM_URL = 'http://ours-internal:9999';
  try {
    assert.equal(pictorium.resolveBase({ pictoriumUrl: 'https://mine.example.com' }), 'https://mine.example.com');
    assert.equal(pictorium.resolveBase({ pictoriumUrl: 'http://pictorium:8080' }), 'http://ours-internal:9999');
    assert.equal(pictorium.resolveBase({ pictoriumUrl: 'http://169.254.169.254' }), 'http://ours-internal:9999');
    assert.equal(pictorium.resolveBase({}), 'http://ours-internal:9999');
  } finally {
    if (prev === undefined) delete process.env.PICTORIUM_URL; else process.env.PICTORIUM_URL = prev;
  }
});

test('pictorium fallback only allows our own TMDB artwork', () => {
  assert.equal(pictorium.safeFallback('https://image.tmdb.org/t/p/w500/a.jpg'), 'https://image.tmdb.org/t/p/w500/a.jpg');
  assert.equal(pictorium.safeFallback('https://evil.example/x.jpg'), '');
  assert.equal(pictorium.safeFallback('http://image.tmdb.org/t/p/w500/a.jpg'), '');
});

test('pictorium request url never contains the key (header only)', () => {
  const url = pictorium.requestUrl({
    base: 'https://posters.example.com', apiKey: 'synthetic-key', type: 'series', id: 'tt0096697',
    title: 'The Simpsons', lang: 'en', region: 'GB', options: { bs: 'pill' },
  });
  assert.match(url, /^https:\/\/posters\.example\.com\/api\/poster\/series\/tt0096697\?/);
  assert.doesNotMatch(url, /api_key/);
  assert.doesNotMatch(url, /synthetic-key/);
  assert.match(url, /bs=pill/);
  assert.match(url, /title=The\+Simpsons/);
});

test('hidden main badge is emitted as all genre-row components off', () => {
  const qs = options.toQuery({ badges: '0', bg: '1', by: '1', br: '1', bq: '1', netLogo: '1', ranking: '1' });
  assert.match(qs, /badges=0/);
  assert.match(qs, /bg=0/);
  assert.match(qs, /by=0/);
  assert.match(qs, /br=0/);
  assert.match(qs, /bq=1/);
  assert.match(qs, /ranking=1/);
  const shown = options.toQuery({ badges: '1', bg: '1', by: '1', br: '1' });
  assert.match(shown, /bg=1/);
  assert.match(shown, /by=1/);
  assert.match(shown, /br=1/);
});

test('pictorium proxy path never contains the key', () => {
  const path = pictorium.proxyPath({
    token: 'tok', type: 'movie', id: '550', title: 'Fight Club',
    options: { bs: 'vetro' }, fallback: 'https://image.tmdb.org/t/p/w500/a.jpg',
  });
  assert.match(path, /^\/tok\/pictorium\/movie\/550\.jpg\?/);
  assert.match(path, /bs=vetro/);
  assert.doesNotMatch(path, /api_key/);
});

test('pictorium poster url is only built when enabled and token scoped', () => {
  const enhance = { pictorium: { enabled: true, token: 'tok', origin: 'https://dev.example', options: { bs: 'pill' } } };
  const url = buildPictoriumPosterUrl(enhance, { type: 'movie', id: 550, title: 'Fight Club', fallback: 'https://image.tmdb.org/t/p/w500/a.jpg' });
  assert.match(url, /^https:\/\/dev\.example\/tok\/pictorium\/movie\/550\.jpg\?/);
  assert.doesNotMatch(url, /api_key/);
  assert.equal(buildPictoriumPosterUrl({ pictorium: { enabled: false, token: 'tok' } }, { type: 'movie', id: 550 }), null);
  assert.equal(buildPictoriumPosterUrl({ pictorium: { enabled: true, token: '' } }, { type: 'movie', id: 550 }), null);
});

test('enhanceMeta rewrites the poster and keeps the TMDB fallback', async () => {
  const enhance = { pictorium: { enabled: true, token: 'tok', origin: 'https://dev.example', options: { bs: 'vetro' } } };
  const meta = { id: 'tt0133093', type: 'movie', name: 'Fight Club', released: '1999-10-15', imdbId: 'tt0133093', tmdbId: 550, poster: 'https://image.tmdb.org/t/p/w500/a.jpg' };
  const out = await enhanceMeta({ ...meta }, enhance);
  assert.match(out.poster, /^https:\/\/dev\.example\/tok\/pictorium\/movie\/tt0133093\.jpg\?/);
  assert.match(decodeURIComponent(out.poster), /fallback=https:\/\/image\.tmdb\.org\/t\/p\/w500\/a\.jpg/);
  assert.equal(out.posterShape, 'poster');
});

test('enhanceMeta leaves the poster alone when Pictorium is off', async () => {
  const meta = { id: 'tt0133093', type: 'movie', name: 'Fight Club', imdbId: 'tt0133093', tmdbId: 550, poster: 'https://image.tmdb.org/t/p/w500/a.jpg' };
  const out = await enhanceMeta({ ...meta }, { pictorium: { enabled: false, token: 'tok', origin: 'https://dev.example' } });
  assert.equal(out.poster, meta.poster);
});
