// @ts-nocheck
// Deep links must survive a hard page load. A shared title URL is only useful
// if opening it cold reaches the app instead of the 404 page.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { existsSync } = require('node:fs');
const path = require('node:path');
const createWebRoutes = require('../src/routes/website.ts');

// The styled error page lives in the built frontend shell. CI's backend job
// runs without a frontend build, so only the status is checked there.
const HAS_BUILT_SHELL = existsSync(path.join(__dirname, '../../frontend/dist/index.html'));

async function withServer(fn) {
  const app = express();
  app.use(createWebRoutes(async () => null));
  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function statusOf(url) {
  const res = await fetch(url, { redirect: 'manual' });
  await res.text();
  return res.status;
}

async function withReleasesKey(value, fn) {
  const previous = process.env.RELEASES_TMDB_API_KEY;
  if (value === undefined) delete process.env.RELEASES_TMDB_API_KEY;
  else process.env.RELEASES_TMDB_API_KEY = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.RELEASES_TMDB_API_KEY;
    else process.env.RELEASES_TMDB_API_KEY = previous;
  }
}

test('a releases title deep link reaches the app instead of the 404 page', async () => {
  await withReleasesKey('test-key', async () => {
    await withServer(async (base) => {
      assert.notStrictEqual(await statusOf(`${base}/releases/tv/1416`), 404);
    });
  });
});

test('a movie deep link with a tab and date survives a hard load', async () => {
  await withReleasesKey('test-key', async () => {
    await withServer(async (base) => {
      assert.notStrictEqual(await statusOf(`${base}/releases/movie/123?tab=movies`), 404);
      assert.notStrictEqual(await statusOf(`${base}/releases/tv/1416?tab=tv&date=2026-10-15`), 404);
    });
  });
});

test('the releases index still gates on the hosted key', async () => {
  await withReleasesKey('test-key', async () => {
    await withServer(async (base) => {
      assert.notStrictEqual(await statusOf(`${base}/releases`), 404);
    });
  });
});

test('a self-hosted install still gets a clean 404 for releases pages', async () => {
  await withReleasesKey(undefined, async () => {
    await withServer(async (base) => {
      assert.strictEqual(await statusOf(`${base}/releases`), 404);
      assert.strictEqual(await statusOf(`${base}/releases/tv/1416`), 404);
    });
  });
});

test('the home page is the prerendered page whenever the build produced one', async () => {
  const home = path.join(__dirname, '../../frontend/dist/home.html');
  await withServer(async (base) => {
    const res = await fetch(`${base}/`, { redirect: 'manual' });
    if (!existsSync(home)) {
      // Public/self-hosted build: no prerender, the shell (or a redirect) answers.
      assert.ok([200, 302].includes(res.status));
      return;
    }
    assert.strictEqual(res.status, 200);
    const body = await res.text();
    assert.match(body, /<div id="root"><[a-z]/, 'root must contain prerendered markup');
    assert.doesNotMatch(body, />\s*(home|navigation|footer)\.[A-Za-z]+/, 'no raw i18n keys');
  });
});

test('the built SPA shell is never served as a normal page', async () => {
  await withServer(async (base) => {
    // /index.html used to return the shell, which the client router then read
    // as a setup id and rendered "Setup not found".
    assert.strictEqual(await statusOf(`${base}/index.html`), 404);
    const res = await fetch(`${base}/foo.html`);
    const body = await res.text();
    assert.strictEqual(res.status, 404);
    if (HAS_BUILT_SHELL) assert.match(body, /window.__ERROR_PAGE__/);
  });
});

test('asset-like unknown URLs are a plain 404 page', async () => {
  await withServer(async (base) => {
    for (const path of ['/foo.mp4', '/foo.mkv', '/foo.html', '/index']) {
      assert.strictEqual(await statusOf(`${base}${path}`), 404, path);
    }
  });
});
