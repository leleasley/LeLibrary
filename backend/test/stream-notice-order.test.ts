// @ts-nocheck
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
// A film with no digital release yet (synthetic, no network).
const tmdb = require('../src/media/tmdb.ts');
tmdb.getMovieReleaseInfo = async () => ({ digitalDate: '2099-01-01', releaseDate: '2026-10-01' });
const { applyStreamNotices } = require('../src/catalog/builder.ts');

const opts = { config: { streamNotices: 'on' }, tmdbApiKey: 'synthetic', tmdbId: 1, type: 'movie' };
const owned = (n) => ({ name: `Owned ${n}`, url: `lelibrary-play://torbox/1/${n}` });
const isNotice = (stream) => /Digital release not found/.test(stream.name || '');

test('an owned copy plays first: the notice sits under the owned files', async () => {
  const out = await applyStreamNotices([owned(1), owned(2), { name: 'Torrentio 1080p', url: 'https://x.example/a' }], opts);
  assert.deepEqual(out.map((s) => (isNotice(s) ? 'NOTICE' : s.name)), ['Owned 1', 'Owned 2', 'NOTICE', 'Torrentio 1080p']);
});

test('with no owned copy the notice still leads', async () => {
  const out = await applyStreamNotices([{ name: 'Comet 4K', url: 'https://x.example/b' }], opts);
  assert.equal(isNotice(out[0]), true);
});

test('a custom link is not an owned debrid file', async () => {
  const out = await applyStreamNotices([{ name: 'My custom link', url: 'https://cdn.example/film.mp4' }, owned(1)], opts);
  assert.equal(isNotice(out[0]), true, 'only leading LeLibrary debrid files go above the notice');
});
