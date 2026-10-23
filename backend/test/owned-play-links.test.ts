'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { playRef, PLAY_PREFIX } = require('../src/catalog/builder.ts');
const { materializePlayUrls } = require('../src/routes/shared.ts');
const providers = require('../src/providers/index.ts');
const { mountStreamRoutes } = require('../src/routes/stream.ts');

const fakeReq = (token: string) => ({ params: { token }, protocol: 'https', get: () => 'lelibrary.example' });

test('owned streams carry a token-free placeholder until a response fills it in', () => {
  const ref = playRef('usenet', 12345, 7, 'Folder/Show.S01E02.1080p.mkv');
  assert.ok(ref.startsWith(PLAY_PREFIX));
  assert.equal(ref, 'lelibrary-play://usenet/12345/7/Show.S01E02.1080p.mkv');
  const cached = { streams: [{ url: ref, name: 'x' }, { url: 'https://other.example/a.mkv' }] };
  const out = materializePlayUrls(cached, fakeReq('uuid.secret'));
  assert.equal(out.streams[0].url, 'https://lelibrary.example/uuid.secret/play/usenet/12345/7/Show.S01E02.1080p.mkv');
  assert.equal(out.streams[1].url, 'https://other.example/a.mkv');
  assert.equal(cached.streams[0].url, ref, 'the cached list is never modified');
});

async function withPlayApp(fn: (base: string) => Promise<void>, config: any) {
  const app = express();
  mountStreamRoutes(app, { resolveConfig: async (token: string) => (token === 'good' ? config : null) });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

test('the play route redirects to the provider link and refuses anything unsafe', async () => {
  const real = providers.getStreamLink;
  let link = 'https://cdn.provider.example/file.mkv?token=abc';
  providers.getStreamLink = async () => link;
  try {
    await withPlayApp(async (base) => {
      const ok = await fetch(`${base}/good/play/usenet/12345/7/Show.mkv`, { redirect: 'manual' });
      assert.equal(ok.status, 302);
      assert.equal(ok.headers.get('location'), link);
      assert.match(String(ok.headers.get('cache-control')), /no-store/);
      assert.equal((await fetch(`${base}/bad/play/usenet/12345/7`, { redirect: 'manual' })).status, 404);
      assert.equal((await fetch(`${base}/good/play/evil/12345/7`, { redirect: 'manual' })).status, 404);
      assert.equal((await fetch(`${base}/good/play/realdebrid/ABC/1`, { redirect: 'manual' })).status, 404, 'provider not in this setup');
      assert.equal((await fetch(`${base}/good/play/usenet/a%2F..%2Fb/7`, { redirect: 'manual' })).status, 404);
      link = 'http://insecure.example/file.mkv';
      assert.equal((await fetch(`${base}/good/play/usenet/12345/7`, { redirect: 'manual' })).status, 503);
    }, { provider: 'torbox', torboxApiKey: 'synthetic-key' });
  } finally {
    providers.getStreamLink = real;
  }
});

export interface OwnedPlayLinksTestModule {};
