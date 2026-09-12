const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CustomStreamValidationError,
  normalizeCustomStreams,
  validateCustomStreams,
  customStreamsFingerprint,
  hasCustomStreams,
  hasMappedCustomStreams,
  customStreamCatalogEntries,
  requestIdentity,
  matchCustomStreams,
} = require('../src/custom-streams');
const browserContract = require('../website/public/custom-streams-editor');
const tokenMap = require('../website/public/token-map');

test('legacy global rows normalize without changing their meaning', () => {
  assert.deepEqual(validateCustomStreams([{ name: 'LAN', url: 'http://192.168.1.5/movie.mp4', type: '*' }]), [{
    name: 'LAN', url: 'http://192.168.1.5/movie.mp4', type: '*',
  }]);
});

test('validation accepts canonical title and episode IDs', () => {
  const rows = validateCustomStreams([{
    label: 'Bedroom server', url: 'https://media.example/show/s01e02.mkv', type: 'series',
    ids: ['TT1234567:1:2', 'tt1234567:1:2'], filename: 'Show.S01E02.mkv', bingeGroup: 'bedroom',
  }]);
  assert.deepEqual(rows[0].ids, ['tt1234567:1:2']);
  assert.equal(rows[0].name, 'Bedroom server');
});

test('episode IDs are canonicalized and title-level series mappings are rejected', () => {
  const [row] = validateCustomStreams([{
    name: 'Episode', url: 'https://media.example/episode.mkv', type: 'series', ids: ['tt123:01:002'],
  }]);
  assert.deepEqual(row.ids, ['tt123:1:2']);
  assert.throws(() => validateCustomStreams([{
    name: 'Whole show', url: 'https://media.example/show.mkv', type: 'series', ids: ['tt123'],
  }]), /exact season and episode/);
});

test('validation rejects unsafe URL shapes and invalid IDs', () => {
  for (const row of [
    { name: 'Bad', url: 'javascript:alert(1)', type: '*' },
    { name: 'Bad', url: 'https://user:pass@example.com/a.mp4', type: '*' },
    { name: 'Bad', url: 'https://example.com/a.mp4#secret', type: '*' },
    { name: 'Bad', url: 'https://example.com/a.mp4', type: 'movie', ids: ['tmdb:1'] },
    { name: 'Bad', url: 'https://example.com/a.mp4', type: 'movie', ids: ['tt123:1:2'] },
  ]) {
    assert.throws(() => validateCustomStreams([row]), CustomStreamValidationError);
  }
});

test('partial import keeps valid rows and reports rejected rows', () => {
  const result = normalizeCustomStreams([
    { name: 'Good', url: 'https://example.com/good.mp4', type: 'movie', id: 'tt123' },
    { name: 'Bad', url: 'file:///tmp/bad.mp4', type: 'movie', id: 'tt456' },
  ], { allowPartial: true });
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].ids, ['tt123']);
  assert.deepEqual(result.errors, [{ index: 1, message: 'URL must use http:// or https://' }]);
});

test('browser import validation mirrors the server contract', () => {
  const input = [{ name: 'Episode', url: 'https://example.com/e.mkv', type: 'series', ids: ['TT123:01:02'], tmdbId: 4656, expiresAt: Date.now() + 60_000 }];
  assert.deepEqual(browserContract.normalizeRows(input, false).rows, validateCustomStreams(input));
  assert.throws(() => browserContract.normalizeRows([{
    name: 'Unsafe', url: 'file:///tmp/a.mkv', type: 'movie', ids: ['tt123'],
  }], false), /http:\/\/ or https:\/\//);
});

test('providerless mapping documents round-trip through the compact token map', () => {
  const config = {
    provider: 'none',
    customStreams: [{ name: 'Only', url: 'https://example.com/only.mp4', type: 'movie', ids: ['tt123'], expiresAt: Date.now() + 60_000 }],
  };
  const token = tokenMap.encodeConfig(config);
  const decoded = JSON.parse(Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  assert.equal(decoded.cu[0].ids[0], 'tt123');
  assert.deepEqual(tokenMap.normalizeConfig(decoded), config);
});

test('both Configure surfaces expose the complete shared mapping editor contract', () => {
  for (const relative of ['website/configure.html', 'src/accounts/configure/account-configure.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
    for (const id of ['csTitleSearch', 'csSelected', 'csSeason', 'csEpisode', 'csEpisodeStatus', 'csUrl', 'csExpiry', 'csSaveButton']) {
      assert.match(html, new RegExp(`id=["']${id}["']`), `${relative} is missing ${id}`);
    }
    assert.match(html, /custom-streams-editor\.js/);
    assert.doesNotMatch(html, /id=["']csSeason["'][^>]*type=["']number["']/);
    assert.doesNotMatch(html, /id=["']csImdbId["']/);
    assert.doesNotMatch(html, />Availability</);
    assert.doesNotMatch(html, /Import JSON|Check URL|Search by title/);
    assert.match(html, /id=["']csTitleSearch["'][^>]*oninput=/);
  }
});

test('Collections Wizard uses the same compact mapping editor shell', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src/accounts/web/wizard.html'), 'utf8');
  for (const id of ['csTitleSearch', 'csSelected', 'csSeason', 'csEpisode', 'csEpisodeStatus', 'csUrl', 'csExpiry', 'csSaveButton']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `Collections Wizard is missing ${id}`);
  }
  assert.match(html, /custom-streams\.css\?v=6/);
  assert.match(html, /custom-streams-editor\.js\?v=6/);
  assert.doesNotMatch(html, /id=["']csEpisode["'][^>]*type=["']number["']/);
  assert.doesNotMatch(html, />Availability<|Import JSON|Check URL|Search by title/);
});

test('website routing passes token-based Custom Stream picker requests to the addon', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'website/web-routes.js'), 'utf8');
  assert.match(routes, /\(preview\|manifest\|catalog\|meta\|stream\|collections\|custom-streams\|pictorium\)/);
});

test('formatted mapped rows use the Custom Streams badge and preserve explicit descriptions', () => {
  const result = matchCustomStreams([{
    name: 'Living room', url: 'https://example.com/Movie.2026.1080p.mp4', type: 'movie', ids: ['tt123'], description: 'My private copy',
  }], { type: 'movie', id: 'tt123', config: { streamPreset: 'lelibrary' } });
  assert.match(result.streams[0].name, /\[CS\+\] Living room/);
  assert.equal(result.streams[0].description, 'My private copy');
});

test('movie lookup returns exact mappings before legacy global rows', () => {
  const result = matchCustomStreams([
    { name: 'All movies', url: 'https://example.com/global.mp4', type: 'movie' },
    { name: 'Exact', url: 'https://example.com/exact.mp4', type: 'movie', ids: ['tt123'] },
    { name: 'Wrong title', url: 'https://example.com/wrong.mp4', type: 'movie', ids: ['tt999'] },
  ], { type: 'movie', id: 'tt123' });
  assert.deepEqual(result.streams.map(stream => stream.name), ['Exact', 'All movies']);
  assert.equal(result.streams[0].behaviorHints.notWebReady, false);
  assert.equal(result.streams[0].behaviorHints.filename, 'exact.mp4');
  assert.equal(result.streams[1].behaviorHints.notWebReady, false);
});

test('multiple URLs remain separate stream choices while catalogues deduplicate titles', () => {
  const rows = [
    { name: 'First link', url: 'https://example.com/first.mp4', type: 'movie', ids: ['tt123'] },
    { name: 'Second link', url: 'https://example.com/second.mp4', type: 'movie', ids: ['tt123'] },
    { name: 'Another movie', url: 'https://example.com/other.mp4', type: 'movie', ids: ['tt456'] },
    { name: 'Episode one', url: 'https://example.com/e1.mp4', type: 'series', ids: ['tt999:1:1'], tmdbId: 4656 },
    { name: 'Episode two', url: 'https://example.com/e2.mp4', type: 'series', ids: ['tt999:1:2'] },
  ];
  assert.deepEqual(matchCustomStreams(rows, { type: 'movie', id: 'tt123' }).streams.map(stream => stream.url), [
    'https://example.com/first.mp4', 'https://example.com/second.mp4',
  ]);
  assert.deepEqual(customStreamCatalogEntries(rows, 'movie').map(entry => entry.id), ['tt123', 'tt456']);
  assert.deepEqual(customStreamCatalogEntries(rows, 'series').map(entry => entry.id), ['tt999']);
  assert.equal(customStreamCatalogEntries(rows, 'series')[0].tmdbId, 4656);
});

test('expired mappings are removed from availability, matching and cache identity', () => {
  const expired = { name: 'Expired', url: 'https://example.com/expired.mp4', type: 'movie', ids: ['tt123'], expiresAt: Date.now() - 1_000 };
  assert.equal(hasCustomStreams([expired]), false);
  assert.equal(hasMappedCustomStreams([expired]), false);
  assert.deepEqual(matchCustomStreams([expired], { type: 'movie', id: 'tt123' }).streams, []);
  assert.equal(customStreamsFingerprint([expired]), 'none');
  assert.equal(browserContract.isActive(expired), false);
});

test('automatic expiry accepts up to 24 hours and keeps older permanent mappings compatible', () => {
  const active = { name: 'Temporary', url: 'https://example.com/temporary.mp4', type: 'movie', ids: ['tt123'], expiresAt: Date.now() + 86_399_000 };
  assert.equal(validateCustomStreams([active])[0].expiresAt, active.expiresAt);
  assert.equal(matchCustomStreams([active], { type: 'movie', id: 'tt123' }).streams.length, 1);
  assert.equal(hasCustomStreams([{ name: 'Older', url: 'https://example.com/older.mp4', type: 'movie', ids: ['tt123'] }]), true);
  assert.throws(() => validateCustomStreams([{ ...active, expiresAt: Date.now() + 86_701_000 }]), /more than 24 hours/);
});

test('HTTP and non-MP4 links are marked native-client oriented', () => {
  const result = matchCustomStreams([
    { name: 'LAN HLS', url: 'http://192.168.1.2/live.m3u8', type: 'movie', ids: ['tt123'] },
  ], { type: 'movie', id: 'tt123' });
  assert.equal(result.streams[0].behaviorHints.notWebReady, true);
});

test('episodes require an exact episode mapping and never use a base-series literal URL', () => {
  const result = matchCustomStreams([
    { name: 'Series title URL', url: 'https://example.com/show.mkv', type: 'series', ids: ['tt123'] },
    { name: 'S1E2', url: 'https://example.com/s01e02.mkv', type: 'series', ids: ['tt123:1:2'] },
    { name: 'S1E3', url: 'https://example.com/s01e03.mkv', type: 'series', ids: ['tt123:1:3'] },
  ], { type: 'series', id: 'tt123:1:2' });
  assert.deepEqual(result.streams.map(stream => stream.name), ['S1E2']);
  assert.match(result.streams[0].behaviorHints.bingeGroup, /^custom:/);
});

test('request identity accepts a resolved IMDb id for torbox namespace requests', () => {
  assert.deepEqual(requestIdentity({ type: 'series', id: 'torbox:series:99:2:4', imdbId: 'tt7654321', season: 2, episode: 4 }), {
    type: 'series', ttId: 'tt7654321', season: '2', episode: '4', exactId: 'tt7654321:2:4', isEpisode: true,
  });
});

test('mapping fingerprints change when rows are edited', () => {
  const before = customStreamsFingerprint([{ name: 'One', url: 'https://example.com/one.mp4', type: 'movie', ids: ['tt1'] }]);
  const after = customStreamsFingerprint([{ name: 'One', url: 'https://example.com/two.mp4', type: 'movie', ids: ['tt1'] }]);
  assert.notEqual(before, after);
  assert.equal(customStreamsFingerprint([]), 'none');
});

test('mapping-only library requests return without provider or TMDB credentials', async () => {
  const { buildStreams, libraryStreamFmtFp } = require('../src/builder');
  const rows = [{ name: 'Personal movie', url: 'https://media.example/movie.mp4', type: 'movie', ids: ['tt123'] }];
  const streams = await buildStreams({}, '', 'movie', '99', undefined, undefined, 'en-US', rows, '', { imdbId: 'tt123' });
  assert.match(streams[0].name, /Personal movie/);
  assert.notEqual(libraryStreamFmtFp({ customStreams: rows }), libraryStreamFmtFp({ customStreams: [] }));
});

test('mapping-only public IMDb requests do not require an IMDb to TMDB lookup', async () => {
  const { buildDiscoveryStreams } = require('../src/discovery');
  const result = await buildDiscoveryStreams({
    config: {}, tmdbApiKey: '', type: 'series', id: 'tt123:1:2', lang: 'en-US',
    customStreams: [{ name: 'Personal episode', url: 'https://media.example/s01e02.mkv', type: 'series', ids: ['tt123:1:2'] }],
    userKey: '', externalAddons: [],
  });
  assert.match(result.streams[0].name, /Personal episode/);
  assert.equal(result.ownedCount, 0);
  assert.equal(result.customCount, 1);
});

test('mapping-only public requests stay empty for unknown IDs instead of adding notices', async () => {
  const { buildDiscoveryStreams } = require('../src/discovery');
  const result = await buildDiscoveryStreams({
    config: {}, tmdbApiKey: '', type: 'movie', id: 'tt999', lang: 'en-US',
    customStreams: [{ name: 'Other title', url: 'https://media.example/movie.mp4', type: 'movie', ids: ['tt123'] }],
    userKey: '', externalAddons: [],
  });
  assert.deepEqual(result.streams, []);
});
