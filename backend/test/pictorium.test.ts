// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');

const options = require('../src/runtime/pictorium-options.ts');
const pictorium = require('../src/runtime/pictorium.ts');
const { enhanceMeta, buildPictoriumPosterUrl } = require('../src/catalog/builder.ts');

test('pictorium options whitelist, clamp and drop unknown keys', () => {
  const cleaned = options.sanitize({
    bs: 'nonsense', rs: 'netflix', gradHeight: 999, blur: -4, be: '0',
    side: 'diagonal', ac: 'F59E0B', lang: 'EN', region: 'gb', rogue: 'x',
  });
  assert.equal(cleaned.bs, 'shadow');
  assert.equal(cleaned.rs, 'netflix');
  assert.equal(cleaned.gradHeight, 100);
  assert.equal(cleaned.blur, 1, 'Pictorium clamps blur to 1-100; be=0 turns it off');
  assert.equal(cleaned.be, '0');
  assert.equal(cleaned.side, '');
  assert.equal(cleaned.ac, '#f59e0b');
  assert.equal(cleaned.lang, 'en');
  assert.equal(cleaned.region, 'GB');
  assert.equal(Object.prototype.hasOwnProperty.call(cleaned, 'rogue'), false);
});

test('pictorium rating sources are normalized to supported ids', () => {
  // Order is kept: it picks which five separate ratings show, and in what order.
  assert.equal(options.sanitize({ rsrc: 'tomatoes,imdb,bogus,imdb' }).rsrc, 'tomatoes,imdb');
  assert.equal(options.sanitize({ rsrc: ['trakt', 'tmdb'] }).rsrc, 'trakt,tmdb');
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
  // Never send an empty language: Pictorium would fall back to Italian labels.
  assert.equal(options.sanitize({}).lang, 'en');
  assert.equal(options.sanitize({ lang: '' }).lang, 'en');
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

test('pictorium 1.24-1.25 keys default to Pictorium behaviour (zero URL churn)', () => {
  const cleaned = options.sanitize({});
  assert.equal(cleaned.ribbon, '1');
  assert.equal(cleaned.xbs, '');
  assert.equal(cleaned.bfont, 'inter');
  assert.equal(cleaned.qbs, 'standard');
  assert.equal(cleaned.cr, '1');
  assert.equal(cleaned.sep, '');
  assert.equal(cleaned.sepstyle, 'column');
  assert.equal(cleaned.sepscale, 130);
  assert.equal(cleaned.exscale, '');
  assert.equal(cleaned.gscale, 100);
  assert.equal(cleaned.netscale, 100);
  assert.equal(cleaned.netPos, '');
  assert.equal(cleaned.tscale, 100);
  assert.equal(cleaned.ts, 50);
  assert.equal(cleaned.tint, 20);
  assert.equal(cleaned.bf, 50);
  assert.equal(cleaned.bd, 30);
  assert.equal(cleaned.qmin, 'SD');
  assert.equal(cleaned.sash, '');
  // Byte-identical to the pre-1.24 contract: existing configs render
  // exactly the same posters through the same cache keys.
  assert.equal(
    options.toQuery({}),
    'badges=1&ranking=1&bg=1&by=1&br=1&bq=1&bs=shadow&rs=default' +
    '&gradHeight=30&be=1&blur=5&netLogo=1&pre=1&lang=en',
  );
});

test('pictorium new style keys sanitize and emit', () => {
  const cleaned = options.sanitize({
    ribbon: '0', xbs: 'corner', bfont: 'oswald', qbs: 'knockout', cr: 0,
    sep: true, sepstyle: 'BOTTOM-PILLS', netPos: 'TOP', qmin: '4k',
  });
  assert.equal(cleaned.ribbon, '0');
  assert.equal(cleaned.xbs, 'corner');
  assert.equal(cleaned.bfont, 'oswald');
  assert.equal(cleaned.qbs, 'knockout');
  assert.equal(cleaned.cr, '0');
  assert.equal(cleaned.sep, '1');
  assert.equal(cleaned.sepstyle, 'bottom-pills');
  assert.equal(cleaned.netPos, 'top');
  assert.equal(cleaned.qmin, '4K');
  assert.equal(options.sanitize({ xbs: 'nonsense', bfont: '', qbs: 'x', sepstyle: 'x', netPos: 'left', qmin: '8K' }).xbs, '');
  assert.equal(options.sanitize({ bfont: '' }).bfont, 'inter');
  const qs = options.toQuery(cleaned);
  for (const part of ['ribbon=0', 'xbs=corner', 'bfont=oswald', 'qbs=knockout', 'cr=0', 'sep=1', 'sepstyle=bottom-pills', 'netPos=top', 'qmin=4K']) {
    assert.match(qs, new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('pictorium scales clamp and offsets stay bounded', () => {
  const cleaned = options.sanitize({
    tscale: 999, gscale: 0, qscale: 'big', netscale: 50, sepscale: 7, exscale: 'xx',
    tox: 99999, goy: -99999, nox: 'left', sepox: 12,
  });
  assert.equal(cleaned.tscale, 200);
  assert.equal(cleaned.gscale, 100);
  assert.equal(cleaned.qscale, 100);
  assert.equal(cleaned.netscale, 50);
  assert.equal(cleaned.sepscale, 10);
  assert.equal(cleaned.exscale, '');
  assert.equal(cleaned.tox, 2000);
  assert.equal(cleaned.goy, -2000);
  assert.equal(cleaned.nox, 0);
  assert.equal(cleaned.sepox, 12);
  const qs = options.toQuery(cleaned);
  assert.match(qs, /tscale=200/);
  assert.match(qs, /netscale=50/);
  assert.match(qs, /tox=2000/);
  assert.match(qs, /goy=-2000/);
  assert.match(qs, /sepox=12/);
  assert.doesNotMatch(qs, /gscale=/);
  assert.doesNotMatch(qs, /qscale=/);
  assert.doesNotMatch(qs, /exscale=/);
  assert.doesNotMatch(qs, /nox=/);
  assert.equal(options.sanitize({ exscale: 150 }).exscale, 150);
  assert.match(options.toQuery({ exscale: 150 }), /exscale=150/);
});

test('pictorium sash keeps valid buckets in the user priority order', () => {
  assert.equal(options.sanitize({ sash: 'rank,upcoming,bogus,rank' }).sash, 'rank,upcoming');
  assert.equal(options.sanitize({ sash: ['new', 'award'] }).sash, 'new,award');
  assert.equal(options.sanitize({ sash: 'upcoming,rank,new,award,extra' }).sash, '', 'the default order is the default');
  // Full default order (or garbage) collapses to automatic.
  assert.equal(options.sanitize({ sash: 'upcoming,rank,new,award,extra' }).sash, '');
  assert.equal(options.sanitize({ sash: 'bogus' }).sash, '');
  assert.equal(options.sanitize({}).sash, '');
  assert.match(options.toQuery({ sash: 'rank,new' }), /sash=rank%2Cnew/);
  assert.doesNotMatch(options.toQuery({}), /sash=/);
});

test('pictorium new keys round-trip through fromQuery', () => {
  const out = options.fromQuery('ribbon=0&bfont=oswald&tscale=150&tox=-30&qmin=FHD&sash=award%2Cnew&netPos=top&bf=70');
  assert.equal(out.ribbon, '0');
  assert.equal(out.bfont, 'oswald');
  assert.equal(out.tscale, 150);
  assert.equal(out.tox, -30);
  assert.equal(out.qmin, 'FHD');
  assert.equal(out.sash, 'award,new');
  assert.equal(out.netPos, 'top');
  assert.equal(out.bf, 70);
});

test('pictorium editor lists cover the upstream enums', () => {
  assert.deepEqual(options.EXTRA_BADGE_STYLES, ['default', 'pill', 'colored', 'bordo', 'vetro', 'corner', 'follow-rank']);
  assert.deepEqual(options.BADGE_FONTS, ['inter', 'barlow-condensed', 'oswald']);
  assert.deepEqual(options.QUALITY_BADGE_STYLES, ['standard', 'mono', 'color', 'knockout']);
  assert.deepEqual(options.SEPARATE_RATINGS_STYLES, ['column', 'bottom-bar', 'bottom-pills', 'bottom-mono', 'bottom-color']);
  assert.deepEqual(options.QMIN_TIERS, ['SD', 'HD', 'FHD', '4K']);
  assert.deepEqual(options.SASH_BUCKETS, ['upcoming', 'rank', 'new', 'award', 'extra']);
  assert.deepEqual(options.NET_POSITIONS, ['top']);
});

export interface PictoriumTestTestModule {};

test('Pictorium 1.25.9: removed and new styles, languages and regions', () => {
  assert.equal(options.sanitize({ rs: 'bar' }).rs, 'default', 'removed upstream, renders as automatic');
  for (const rs of ['bordo', 'vetro', 'netflix-color', 'corner', 'number']) assert.equal(options.sanitize({ rs }).rs, rs);
  assert.equal(options.sanitize({ bs: 'minimal' }).bs, 'minimal');
  assert.equal(options.sanitize({ blur: 80 }).blur, 80);
  assert.equal(options.sanitize({ lang: 'es-419' }).lang, 'es-419');
  assert.equal(options.sanitize({ lang: 'pt-BR' }).lang, 'pt-br');
  assert.equal(options.sanitize({ lang: 'hi' }).lang, 'en', 'not a Pictorium language');
  assert.equal(options.sanitize({ region: 'global' }).region, 'GLOBAL');
  assert.equal(options.sanitize({ region: 'IE' }).region, '', 'ignored upstream');
  assert.equal(options.sanitize({ ac: '#F90' }).ac, '#ff9900');
});

test('Pictorium 1.25.9: new options emit only when changed', () => {
  assert.equal(options.toQuery({}), options.toQuery(options.DEFAULTS), 'defaults add nothing');
  const q = options.toQuery({
    tsh: 40, age: '1', agecountry: 'gb', agebs: 'knockout', theme: 'halloween', netFollow: '0', nox: 20, noy: 30,
    scale: 120, ox: -10, hideLogo: '1', logoFit: '1', layout: 'fresh', freshScope: 'all', tl: '0', bl: '1',
    formats: 'dv,atmos', df: 'iso',
  });
  for (const part of ['tsh=40', 'age=1', 'agecountry=GB', 'agebs=knockout', 'theme=halloween', 'netFollow=0',
    'nox=20', 'noy=30', 'scale=120', 'ox=-10', 'hideLogo=1', 'logoFit=1', 'layout=fresh', 'freshScope=all',
    'tl=0', 'bl=1', 'formats=dv%2Catmos', 'df=iso']) assert.ok(q.split('&').includes(part), part);
  assert.ok(!options.toQuery({ age: '' , agecountry: 'GB' }).includes('agecountry'), 'country only with the age badge');
  assert.ok(!options.toQuery({ layout: 'standard', freshScope: 'all' }).includes('freshScope'), 'scope only with Fresh');
  assert.equal(options.sanitize({ formats: 'dv,hdr,hdr10plus,atmos,imax' }).formats, '', 'all formats is the default');
  assert.equal(options.sanitize({ formats: 'NONE' }).formats, 'none');
});

test('All top badges off survives our proxy round trip and goes out as an empty sash', () => {
  const ours = options.toQuery({ sash: 'none' });
  assert.ok(ours.includes('sash=none'));
  assert.equal(options.fromQuery(ours).sash, 'none');
  assert.ok(options.toQuery({ sash: 'none' }, { upstream: true }).split('&').includes('sash='));
});

test('the age badge follows the region instead of Pictorium\'s Italian default', () => {
  assert.ok(options.toQuery({ age: '1', region: 'US' }).split('&').includes('agecountry=US'));
  assert.ok(options.toQuery({ age: '1', region: 'US', agecountry: 'DE' }).split('&').includes('agecountry=DE'));
  assert.ok(!options.toQuery({ age: '1', region: 'GLOBAL' }).includes('agecountry'));
});
