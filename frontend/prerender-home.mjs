import { existsSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'production';

const frontendDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(frontendDir, 'dist');
const manifestPath = resolve(distDir, '.vite/manifest.json');
// Build metadata only: never ship it, whichever way this script exits.
process.on('exit', () => { try { rmSync(dirname(manifestPath), { recursive: true, force: true }); } catch { /* already gone */ } });

// The landing page is hosted-only and gitignored. A public checkout has no
// HomePage.tsx: skip the prerender there (the server serves the SPA shell, and
// "/" falls back to the setup picker) instead of failing the build.
if (!existsSync(resolve(frontendDir, 'src/features/site/HomePage.tsx'))) {
  console.log('prerender-home: HomePage.tsx absent (public build), skipping');
  process.exit(0);
}
const [{ createElement }, { renderToString }, { createStaticHandler, createStaticRouter, StaticRouterProvider }, { createServer }] = await Promise.all([
  import('react'),
  import('react-dom/server'),
  import('react-router-dom'),
  import('vite'),
]);

const vite = await createServer({
  configFile: resolve(frontendDir, 'vite.config.ts'),
  root: frontendDir,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
});

try {
  const [{ i18n, i18nReady }, { AppProviders }, { routes }] = await Promise.all([
    vite.ssrLoadModule('/src/i18n/index.ts'),
    vite.ssrLoadModule('/src/app/providers.tsx'),
    vite.ssrLoadModule('/src/app/router.tsx'),
  ]);

  // Real English copy, not keys: the locale bundles load lazily, so wait for
  // them before rendering (the browser does the same before hydrating).
  // The Guide/overview videos manifest is baked in so the first render already
  // knows about the overview (the hero button would otherwise flip from the
  // walkthrough fallback once the page fetches it). Optional: hosted only.
  const videosPath = resolve(distDir, 'guide/videos/videos.json');
  const videosData = existsSync(videosPath) ? JSON.parse(await readFile(videosPath, 'utf8')) : null;
  globalThis.__LL_VIDEOS__ = videosData;
  // The hosted site always has Releases, so the prerendered menu includes it
  // and matches the boot data the server ships. Status stays unknown here: the
  // server fills the data-boot markers in when it sends the page.
  globalThis.__LL_BOOT__ = { features: { releases: true, savedSetups: false, unavailableStreamAddons: [] } };

  await i18nReady;
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces(['common', 'site']);

  // The app's own route tree through the static router, so the HTML is
  // exactly what the browser's first render produces and hydration matches.
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request('https://lelibrary.uk/'));
  if (context instanceof Response) throw new Error(`prerender-home: "/" answered ${context.status}`);
  const router = createStaticRouter(handler.dataRoutes, context);
  const page = createElement(AppProviders, null,
    createElement(StaticRouterProvider, { router, context, hydrate: false }));

  const html = renderToString(page);
  const leaked = html.match(/>\s*(home|navigation|footer|common|staticText)\.[A-Za-z]+/);
  if (leaked) throw new Error(`prerender-home: untranslated key in output (${leaked[0].trim()})`);

  const shellPath = resolve(distDir, 'index.html');
  const shell = await readFile(shellPath, 'utf8');
  const root = '<div id="root"></div>';
  if (!shell.includes(root)) throw new Error('Could not find the React root in frontend/dist/index.html');
  // The home page's CSS sits in its lazily loaded chunk, so the prerendered
  // HTML would paint unstyled until the script fetched it. Link every CSS file
  // the chunk needs (and preload its script) so the first paint is complete.
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entry = manifest['src/features/site/HomePage.tsx'];
  if (!entry) throw new Error('prerender-home: HomePage chunk missing from the Vite manifest');
  const css = new Set();
  const seen = new Set();
  const walk = (key) => {
    const chunk = manifest[key];
    if (!chunk || seen.has(key)) return;
    seen.add(key);
    for (const file of chunk.css || []) css.add(file);
    for (const child of chunk.imports || []) walk(child);
  };
  walk('src/features/site/HomePage.tsx');
  const head = [...css].filter((file) => !shell.includes(`/${file}"`))
    .map((file) => `<link rel="stylesheet" crossorigin href="/${file}">`);
  head.push(`<link rel="modulepreload" crossorigin href="/${entry.file}">`);
  if (videosData) {
    // Inert JSON data block (not executable), read by the hero on hydration.
    head.push(`<script type="application/json" id="ll-videos">${JSON.stringify(videosData).replace(/</g, '\\u003c')}</script>`);
  }
  if (!shell.includes('</head>')) throw new Error('Could not find </head> in frontend/dist/index.html');
  const prerendered = shell
    .replace('</head>', () => head.join('\n') + '\n</head>')
    .replace(root, () => '<div id="root">' + html + '</div>');
  await mkdir(distDir, { recursive: true });
  await writeFile(resolve(distDir, 'home.html'), prerendered);
  console.log(`prerender-home: wrote dist/home.html (${Math.round(html.length / 1024)} KB of markup, ${css.size} home stylesheet(s)${videosData ? ', videos manifest' : ''})`);
} finally {
  await vite.close();
}
