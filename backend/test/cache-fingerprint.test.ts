// @ts-nocheck
// Audit B8: cache key fingerprints that separate users/settings must be
// collision-safe (SHA-256 slice), and every caller must share one helper.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fingerprint = require('../src/runtime/cache-fingerprint.ts');
const { FP_HEX_LENGTH, hashShort, posterFp } = fingerprint;

const HEX = new RegExp(`^[0-9a-f]{${FP_HEX_LENGTH}}$`);

test('hashShort is a 96-bit SHA-256 hex slice', () => {
  assert.ok(FP_HEX_LENGTH >= 24);
  const crypto = require('node:crypto');
  assert.equal(hashShort('abc'), crypto.createHash('sha256').update('abc').digest('hex').slice(0, FP_HEX_LENGTH));
  assert.match(hashShort(''), HEX);
  assert.match(hashShort(['a', 1, true]), HEX);
  assert.equal(hashShort(['a', 'b']), hashShort('a,b'), 'String() coercion is kept');
});

test('hashShort separates the classic 32-bit string-hash collisions', () => {
  // "Aa" and "BB" share the old (h << 5) - h hash; so do any strings built
  // from those blocks. The old helper merged these cache entries.
  const old = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  assert.equal(old('AaAa'), old('BBBB'));
  assert.notEqual(hashShort('AaAa'), hashShort('BBBB'));
  assert.notEqual(hashShort('AaBB'), hashShort('BBAa'));
});

test('hashShort has no collisions across many synthetic keys', () => {
  const seen = new Set();
  for (let i = 0; i < 50000; i++) seen.add(hashShort(`synthetic-mdblist-key-${i}`));
  assert.equal(seen.size, 50000);
});

test('posterFp uses the shared format and separates poster settings', () => {
  const a = posterFp({ posterProvider: 'rpdb', rpdbKey: 'synthetic-a' });
  const b = posterFp({ posterProvider: 'rpdb', rpdbKey: 'synthetic-b' });
  assert.match(a, HEX);
  assert.notEqual(a, b);
  assert.equal(posterFp({ posterProvider: 'rpdb', rpdbKey: 'synthetic-a' }), a, 'stable');
  assert.notEqual(
    posterFp({ posterProvider: 'pictorium', pictoriumUrl: 'https://p.example', pictoriumOptions: { badge: 1 } }),
    posterFp({ posterProvider: 'pictorium', pictoriumUrl: 'https://p.example', pictoriumOptions: { badge: 2 } }),
  );
});

test('library stream format fingerprint is the shared hash and separates settings', () => {
  const { libraryStreamFmtFp } = require('../src/catalog/builder.ts');
  const fp = libraryStreamFmtFp({ streamPreset: 'compact' });
  assert.match(fp.slice(1), HEX);
  assert.equal(fp[0], ':');
  assert.equal(fp, libraryStreamFmtFp({ streamPreset: 'compact' }), 'stable between calls');
  assert.notEqual(fp, libraryStreamFmtFp({ streamPreset: 'detailed' }));
  assert.notEqual(libraryStreamFmtFp({}), libraryStreamFmtFp({ streamNotices: 'off' }));
});

test('discovery stream fingerprint is the shared hash and separates filters', () => {
  const { discoveryStreamKeyParts } = require('../src/catalog/discovery.ts');
  const a = discoveryStreamKeyParts({ filterResolutions: ['2160p'] }).fmtFp;
  const b = discoveryStreamKeyParts({ filterResolutions: ['1080p'] }).fmtFp;
  assert.match(a.slice(1), HEX);
  assert.notEqual(a, b);
});

test('public stream cache key carries collision-safe addon and format fingerprints', () => {
  const { publicStreamCacheKey } = require('../src/routes/stream.ts');
  const { discoveryStreamKeyParts } = require('../src/catalog/discovery.ts');
  const config = { streamPreset: 'compact' };
  const base = { config, type: 'movie', id: 'tt0000001', userKey: 'u1', externalAddons: ['https://a.example/manifest.json'], customStreams: [], aioFp: '', token: '' };
  const key = publicStreamCacheKey(base);
  // userKey + ':' + addonFp + ':' + fmtFp, all inside one makeKey part.
  const m = key.match(/u1:([0-9a-f]+):([0-9a-f]+)/);
  assert.ok(m, `unexpected key shape: ${key}`);
  assert.match(m[1], HEX);
  assert.equal(':' + m[2], discoveryStreamKeyParts(config).fmtFp, 'same fmtFp as the discovery builder');
  assert.equal(publicStreamCacheKey(base), key, 'stable');
  assert.notEqual(publicStreamCacheKey({ ...base, externalAddons: ['https://b.example/manifest.json'] }), key);
  assert.notEqual(publicStreamCacheKey({ ...base, config: { ...config, customAddon1: 'https://own.example/manifest.json' } }), key);
});

test('no ad-hoc 32-bit string hash is left in cache-key code', () => {
  // Every server-side cache fingerprint goes through runtime/cache-fingerprint.ts.
  const files = [
    'src/catalog/builder.ts', 'src/catalog/discovery.ts', 'src/catalog/libcatalog.ts',
    'src/library/catalog.ts', 'src/providers/torbox.ts', 'src/routes/images.ts',
    'src/routes/stream.ts', 'src/routes/catalog.ts', 'src/runtime/refresh.ts',
    'src/runtime/cache-fingerprint.ts',
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.doesNotMatch(src, /\(h\s*<<\s*5\)\s*-\s*h/, `${rel} has a local 32-bit hash`);
  }
});

test('collection warming uses the route poster fingerprint, not the legacy browser one', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/catalog/collection-cache-warm.ts'), 'utf8');
  assert.doesNotMatch(src, /wizard-shared\.js'\)\.posterFp/);
});
