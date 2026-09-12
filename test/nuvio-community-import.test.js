const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeNuvioCommunityCollections } = require('../src/accounts/source-import');
const { MAX_UPSTREAM_BYTES, listParams, failurePayload, compactListPayload } = require('../src/nuvio-community');

test('Nuvio community list omits the all-type filter expected by the current API', () => {
  assert.deepEqual(listParams({ sort: 'popular', type: 'all', page: '1', limit: '24' }), {
    sort: 'popular', page: 1, limit: 24,
  });
  assert.deepEqual(listParams({ sort: 'recent', type: 'pack', search: '  films  ' }), {
    sort: 'recent', page: 1, limit: 24, type: 'pack', search: 'films',
  });
});

test('all Nuvio clients use the current public API key', () => {
  const files = [
    'src/accounts/index.js',
    'src/accounts/push.js',
    'src/accounts/web/account.js',
    'src/accounts/configure/account-configure.js',
    'website/public/configure.js',
  ];
  const values = files.map(file => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const match = source.match(/NUVIO_PUBLISHABLE_KEY\s*=\s*'([^']+)'/);
    assert.ok(match, `${file} must declare the Nuvio public key`);
    return match[1];
  });
  assert.equal(new Set(values).size, 1, 'Nuvio public keys must not drift between pages');
  assert.match(values[0], /^eyJ/);
});

test('all Nuvio profile writers use the current five-profile RPC contract', () => {
  const files = [
    'src/accounts/push.js',
    'src/accounts/configure/account-configure.js',
    'website/public/configure.js',
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(source, /sync_push_profiles[\s\S]{0,300}p_client_max_profiles:\s*5/, `${file} must send Nuvio's profile limit`);
  }
});

test('Nuvio proxy failures expose only privacy-safe diagnostics', () => {
  assert.deepEqual(failurePayload({ status: 500 }), {
    status: 502, code: 'nuvio_http_500', error: 'Nuvio rejected the public-collection request (HTTP 500).',
  });
  assert.deepEqual(failurePayload({ code: 'ETIMEDOUT' }), {
    status: 502, code: 'nuvio_transport_etimedout', error: 'LeLibrary could not reach Nuvio (ETIMEDOUT).',
  });
  assert.equal(failurePayload({ code: 'a-secret-or-unknown-message' }).code, 'nuvio_transport_network');
  assert.equal(failurePayload({ code: 'ERR_BAD_RESPONSE' }).code, 'nuvio_transport_err_bad_response');
});

test('large Nuvio list envelopes are accepted upstream but compacted before reaching the browser', () => {
  assert.equal(MAX_UPSTREAM_BYTES, 24 * 1024 * 1024);
  const payload = { items: [{
    public_id: 'large-pack',
    title: 'Large pack',
    envelope: {
      requirements: { addons: [{ addonId: 'community.catalogues' }] },
      resources: [{ json: { large: 'x'.repeat(1000) } }],
      collections: [{ coverImageUrl: 'https://example.invalid/cover.jpg', folders: [
        { catalogSources: [{ addonId: 'community.catalogues', catalogId: 'one', type: 'movie' }] },
        { catalogSources: [{ addonId: 'community.catalogues', catalogId: 'two', type: 'series' }] },
      ] }],
    },
  }], page: 1, hasNextPage: true };
  const compact = compactListPayload(payload);
  assert.equal(compact.items[0].envelope.resources, undefined);
  assert.equal(compact.items[0].envelope.collections, undefined);
  assert.equal(compact.items[0].envelope.requirements.addons[0].addonId, 'community.catalogues');
  assert.equal(compact.items[0].envelope.coverImageUrl, 'https://example.invalid/cover.jpg');
  assert.deepEqual(compact.items[0].stats, { collectionCount: 1, folderCount: 2, sourceCount: 2 });
  assert.equal(compact.hasNextPage, true);
});

test('Nuvio community built-in sources become live account-scoped definitions', () => {
  const result = normalizeNuvioCommunityCollections({ collections: [{
    id: 'kaptain', title: "Kaptain's Mega Collection", folders: [
      { id: 'popular-movies', title: 'Popular Movies', sources: [{ provider: 'tmdb', tmdbSourceType: 'DISCOVER', mediaType: 'MOVIE', sortBy: 'popularity.desc', filters: { with_genres: '28' } }] },
      { id: 'tv-list', title: 'TV List', sources: [{ provider: 'trakt', traktListId: 42, mediaType: 'TV' }] },
    ],
  }] });
  assert.equal(result.collections.length, 1);
  assert.equal(result.sources.length, 2);
  assert.equal(result.collections[0].folders[0].catalogSources[0].catalogId, result.sources[0].id);
  assert.equal(result.collections[0].folders[0].catalogSources[0].title, 'Popular Movies');
  assert.deepEqual(result.sources.map(source => source.label), ['Popular Movies', 'TV List']);
  assert.deepEqual(result.sources.map(source => source.mediaType), ['movie', 'series']);
});
