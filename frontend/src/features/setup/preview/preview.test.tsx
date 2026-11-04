import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  GRID_LIMIT, HERO_INTERVAL_MS, ROW_LIMIT, catalogUrl, createCatalogLoader, createMetaLoader, defaultMode, fitScale,
  gridColumns, heroHeight, heroPicks, metaUrl, metasFrom, moveFocus, previewNav, shouldAutoAdvance, startAutoAdvance,
  tmdbSized, type CatalogLoader, type MetaLoader, type PreviewMeta, type PreviewMode, type PreviewScreen, type SetupPreview,
} from '@/features/setup/preview/preview-model';

// No network in tests: every API call is a spy. The preview endpoint never
// resolves; writes must never be called at all.
const api = vi.hoisted(() => ({
  get: vi.fn(() => new Promise(() => {})),
  post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
}));
vi.mock('@/api/client', () => ({ apiClient: api }));

const { PreviewModal, cancelToClose, openAsModal } = await import('@/features/setup/preview/PreviewModal');

const UUID = '11111111-2222-3333-4444-555555555555';
const TOKEN = `${UUID}.synthetic-secret`;

const NUVIO: SetupPreview = {
  platform: 'nuvio',
  addonName: 'LeLibrary',
  hero: [
    { key: 'a:series:torbox-series', type: 'series', catalogId: 'torbox-series', name: 'My Shows' },
    { key: 'a:movie:torbox-movies', type: 'movie', catalogId: 'torbox-movies', name: 'My Movies' },
  ],
  collections: [{
    id: 'collection-lelibrary-hub', title: 'The Hub', backdrop: 'https://image.tmdb.org/t/p/original/hub.jpg', pinToTop: false,
    folders: [
      {
        id: 'folder-4k', title: 'In 4K', cover: 'https://lelibrary.test/art/folder/folder-4k.jpg', focusGif: 'https://lelibrary.test/art/folder/folder-4k.gif',
        shape: 'POSTER', hideTitle: false,
        sources: [
          { catalogId: 'torbox-movies-4k', type: 'movie', genre: '', name: 'Movies in 4K', catalogName: 'Movies in 4K' },
          { catalogId: 'lelibrary-curated-series', type: 'series', genre: 'Shows in 4K', name: 'Shows in 4K', catalogName: 'Curated' },
        ],
      },
      { id: 'folder-wide', title: 'Wide Folder', cover: '', focusGif: '', shape: 'LANDSCAPE', hideTitle: false, sources: [{ catalogId: 'torbox-movies', type: 'movie', genre: '', name: 'My Movies', catalogName: 'My Movies' }] },
    ],
  }],
  home: [
    { kind: 'collection', id: 'collection-lelibrary-hub' },
    { kind: 'row', key: 'a:series:torbox-series', type: 'series', catalogId: 'torbox-series', name: 'My Shows' },
    { kind: 'row', key: 'a:movie:torbox-movies', type: 'movie', catalogId: 'torbox-movies', name: 'Film Night', custom: true },
    { kind: 'row', key: 'b:movie:top', type: 'movie', catalogId: 'top', name: 'Popular Elsewhere', external: true },
  ],
  franchisePending: true,
};

const STREMIO: SetupPreview = {
  platform: 'stremio', addonName: 'LeLibrary', hero: [], collections: [], franchisePending: false,
  home: [
    { kind: 'row', key: 'a:movie:torbox-movies', type: 'movie', catalogId: 'torbox-movies', name: 'My Movies' },
    { kind: 'row', key: 'a:series:torbox-series', type: 'series', catalogId: 'torbox-series', name: 'My Shows' },
  ],
};

function metas(prefix: string, count: number, type = 'movie') {
  return Array.from({ length: count }, (_, n) => ({
    id: `${prefix}-${n}`, type, name: `${prefix} title ${n}`, poster: `https://image.tmdb.org/t/p/w500/${prefix}-${n}.jpg`,
    releaseInfo: String(2000 + n), genres: ['Drama'], description: `About ${prefix} ${n}`,
  }));
}

// The addon's catalogue routes, mocked: every row the preview asks for.
const CATALOGUES: Record<string, unknown[]> = {
  [catalogUrl(TOKEN, { type: 'movie', catalogId: 'torbox-movies' })]: metas('movie', 30),
  [catalogUrl(TOKEN, { type: 'series', catalogId: 'torbox-series' })]: metas('series', 5, 'series'),
  [catalogUrl(TOKEN, { type: 'movie', catalogId: 'torbox-movies-4k' })]: metas('uhd', 4),
  [catalogUrl(TOKEN, { type: 'series', catalogId: 'lelibrary-curated-series', genre: 'Shows in 4K' })]: metas('curated', 3, 'series'),
};

async function loadedLoader(): Promise<CatalogLoader> {
  const fetchJson = vi.fn(async (url: string) => {
    if (!(url in CATALOGUES)) throw new Error(`unexpected ${url}`);
    return { metas: CATALOGUES[url] };
  });
  const loader = createCatalogLoader(TOKEN, { fetchJson });
  const refs = [
    { type: 'movie', catalogId: 'torbox-movies' }, { type: 'series', catalogId: 'torbox-series' },
    { type: 'movie', catalogId: 'torbox-movies-4k' }, { type: 'series', catalogId: 'lelibrary-curated-series', genre: 'Shows in 4K' },
  ];
  for (const ref of refs) loader.load(ref);
  await vi.waitFor(() => expect(refs.every((ref) => loader.get(ref)?.status === 'ready')).toBe(true));
  return loader;
}

const noMetas: MetaLoader = { get: () => undefined, load: () => {}, subscribe: () => () => {} };

function render(options: {
  mode?: PreviewMode; loader?: CatalogLoader; stack?: PreviewScreen[]; size?: { width: number; height: number };
  failed?: boolean; installToken?: string | null; dirty?: boolean; open?: boolean;
}) {
  return renderToStaticMarkup(
    <PreviewModal
      open={options.open ?? true} onClose={() => {}}
      saved={{ uuid: UUID, editToken: 'edit-token', installToken: options.installToken === undefined ? TOKEN : options.installToken }}
      savedPlatform="nuvio" dirty={options.dirty}
      loader={options.loader ?? { get: () => undefined, load: () => {}, retry: () => {}, subscribe: () => () => {} }}
      metaLoader={noMetas}
      initial={{
        mode: options.mode ?? 'mobile', stack: options.stack, failed: options.failed,
        previews: options.failed ? undefined : { nuvio: NUVIO, stremio: STREMIO },
        size: options.size ?? { width: 1280, height: 900 },
      }}
    />,
  );
}

afterEach(() => { vi.useRealTimers(); });

describe('Preview modal', () => {
  it('renders nothing closed, a full-screen dialog with the app chrome open', () => {
    expect(render({ open: false })).toBe('');
    const html = render({ mode: 'tv' });
    expect(html).toContain('<dialog');
    expect(html).toContain('class="npv-dialog is-tv"');
    expect(html).toContain('Preview of your saved setup');
    for (const label of ['TV', 'Mobile', 'Stremio']) expect(html).toContain(`<span>${label}</span>`);
    expect(html).toMatch(/aria-pressed="true" class="is-active"><svg[^]*?<span>TV<\/span>/);
    expect(html).toContain('aria-label="Close preview"');
    expect(html).not.toContain('synthetic-secret');
  });

  it('opens as a modal, locks the page and gives focus back on close', () => {
    const opener = { focus: vi.fn() };
    const classes = new Set<string>();
    const dialog = { open: false, showModal: vi.fn(function (this: { open: boolean }) { this.open = true; }), close: vi.fn(function (this: { open: boolean }) { this.open = false; }), setAttribute: vi.fn() };
    const doc = { activeElement: opener as unknown as Element, documentElement: { classList: { add: (c: string) => { classes.add(c); }, remove: (c: string) => { classes.delete(c); } } } };
    const close = openAsModal(dialog, doc);
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
    expect(classes.has('npv-locked')).toBe(true);
    close();
    expect(dialog.close).toHaveBeenCalledTimes(1);
    expect(classes.has('npv-locked')).toBe(false);
    expect(opener.focus).toHaveBeenCalledTimes(1);

    // Escape is the dialog's cancel: it closes through the parent.
    const onClose = vi.fn();
    const event = { preventDefault: vi.fn() };
    cancelToClose(onClose)(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switches between TV, Mobile (phone stage or full width) and Stremio', () => {
    const tv = render({ mode: 'tv' });
    expect(tv).toContain('npv-tv-frame');
    expect(tv).toContain('npv-tv-side');
    expect(tv).toContain(`width:${1280 * fitScale(1280, 900, 1280, 720)}px`);

    const phone = render({ mode: 'mobile', size: { width: 1280, height: 900 } });
    expect(phone).toContain('npv-phone-frame');
    expect(phone).toContain('npv-tabbar');
    const fill = render({ mode: 'mobile', size: { width: 390, height: 700 } });
    expect(fill).toContain('npv-phone is-fill');
    expect(fill).not.toContain('npv-phone-frame');

    const stremio = render({ mode: 'stremio' });
    expect(stremio).toContain('npv-stremio');
    expect(stremio).not.toContain('The Hub');
    expect(stremio).toContain('>My Movies - Movie<');

    expect(defaultMode('nuvio', 390)).toBe('mobile');
    expect(defaultMode('nuvio', 1440)).toBe('tv');
    expect(defaultMode('stremio', 390)).toBe('stremio');
    // A mode switch always returns Home.
    expect(previewNav([{ at: 'home' }, { at: 'catalog', row: STREMIO.home[0] as never }], { type: 'home' })).toEqual([{ at: 'home' }]);
  });

  it('renders Nuvio Mobile Home in the saved order with posters from the catalogue routes', async () => {
    const html = render({ mode: 'mobile', loader: await loadedLoader() });
    const order = ['>The Hub<', '>My Shows - Series<', '>Film Night<', '>Popular Elsewhere - Movie<'].map((name) => html.indexOf(name));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Posters at a row size, capped at 18 per row, with title and year.
    expect(html).toContain('https://image.tmdb.org/t/p/w342/movie-0.jpg');
    expect(html).toContain(`movie-${ROW_LIMIT - 1}.jpg`);
    expect(html).not.toContain(`/movie-${ROW_LIMIT}.jpg`);
    expect(html).toContain('>movie title 0<');
    expect(html).toContain('>2000<');
    // The see-all chevron shows for the 30-item row only.
    expect((html.match(/class="npv-more"/g) ?? []).length).toBe(1);
    // Folder tiles: animated cover on mobile, wide shape, two-letter fallback.
    expect(html).toContain('folder-4k.gif');
    expect(html).toContain('npv-tile is-landscape');
    expect(html).toContain('>WF<');
    expect(html).toContain('From another addon: your player loads it, the preview cannot.');
    expect(html).toContain('Movie Collections appears here once your library has finished building.');
  });

  it('opens a collection folder on the folder screen with its tabs', async () => {
    let stack: PreviewScreen[] = [{ at: 'home' }];
    stack = previewNav(stack, { type: 'folder', collectionId: 'collection-lelibrary-hub', folderId: 'folder-4k' });
    expect(stack[1]).toEqual({ at: 'folder', collectionId: 'collection-lelibrary-hub', folderId: 'folder-4k', tab: 0 });
    const loader = await loadedLoader();
    const all = render({ mode: 'mobile', loader, stack });
    expect(all).toContain('npv-folder-cover');
    expect(all).toContain('>In 4K</h2>');
    expect(all).toContain('aria-label="Folder sources"');
    expect(all).toMatch(/aria-selected="true" class="is-active">All</);
    expect(all).toContain('>Movies in 4K (Movie)<');
    expect(all).toContain('>Curated (Series) · Shows in 4K<');
    // "All" merges every source.
    expect(all).toContain('uhd-0.jpg');
    expect(all).toContain('curated-0.jpg');
    expect(all).toContain('--npv-cols:3');

    const second = previewNav(stack, { type: 'tab', tab: 2 });
    const tab = render({ mode: 'tv', loader, stack: second });
    expect(tab).toContain('curated-2.jpg');
    expect(tab).not.toContain('uhd-0.jpg');
    expect(tab).toContain('--npv-cols:6');
    expect(previewNav(second, { type: 'back' })).toEqual([{ at: 'home' }]);
  });

  it('opens a row on its See all screen', async () => {
    const row = NUVIO.home[2] as Extract<SetupPreview['home'][number], { kind: 'row' }>;
    const html = render({ mode: 'mobile', loader: await loadedLoader(), stack: previewNav([{ at: 'home' }], { type: 'catalog', row }) });
    expect(html).toContain('npv-catalog-head');
    expect(html).toContain('>Film Night</h2>');
    expect(html).toContain('Movie · LeLibrary');
    expect(html).toContain('movie-29.jpg');
    expect(GRID_LIMIT).toBeGreaterThanOrEqual(30);
  });

  it('shows up to 8 hero items and an animated pager', async () => {
    const html = render({ mode: 'mobile', loader: await loadedLoader() });
    expect(html).toContain('class="npv-hero"');
    expect((html.match(/<button type="button" role="tab" aria-selected/g) ?? []).length).toBe(8);
    expect(html).toContain('View Details');
    expect(html).toContain('>Series<');

    const picks = heroPicks([{ type: 'series', metas: metas('s', 5, 'series').map((m) => metasFrom({ metas: [m] }, 1).metas[0]!) }, { type: 'movie', metas: metasFrom({ metas: metas('m', 10) }, 20).metas }]);
    expect(picks).toHaveLength(8);
    expect(picks.slice(0, 4).map((m) => m.id)).toEqual(['s-0', 'm-0', 's-1', 'm-1']);
    expect(new Set(picks.map((m) => m.id)).size).toBe(8);
    expect(heroHeight(390, 844)).toBe(452);
    expect(heroHeight(360, 640)).toBe(418);
    expect(heroHeight(700, 900)).toBe(380);
  });

  it('advances the hero every 8 seconds, and never with reduced motion', () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    const stop = startAutoAdvance(() => shouldAutoAdvance({ count: 8, reducedMotion: false, hidden: false, hovered: false }), advance);
    vi.advanceTimersByTime(HERO_INTERVAL_MS - 1);
    expect(advance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(advance).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(HERO_INTERVAL_MS * 2);
    expect(advance).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(HERO_INTERVAL_MS * 3);
    expect(advance).toHaveBeenCalledTimes(3);

    const reduced = vi.fn();
    const stopReduced = startAutoAdvance(() => shouldAutoAdvance({ count: 8, reducedMotion: true, hidden: false, hovered: false }), reduced);
    vi.advanceTimersByTime(HERO_INTERVAL_MS * 4);
    expect(reduced).not.toHaveBeenCalled();
    stopReduced();
    expect(shouldAutoAdvance({ count: 8, reducedMotion: false, hidden: true, hovered: false })).toBe(false);
    expect(shouldAutoAdvance({ count: 8, reducedMotion: false, hidden: false, hovered: true })).toBe(false);
    expect(shouldAutoAdvance({ count: 1, reducedMotion: false, hidden: false, hovered: false })).toBe(false);
  });

  it('TV: one focusable card at a time, a focus ring, arrow keys move between rows', async () => {
    const html = render({ mode: 'tv', loader: await loadedLoader() });
    expect(html).toContain('npv-tv-rows');
    expect((html.match(/tabindex="0" data-pos=/g) ?? []).length).toBe(1);
    expect(html).toMatch(/npv-tile is-poster is-focused[^>]*tabindex="0" data-pos="0-0"/);
    expect(html).toContain('from LeLibrary');
    expect(html).toContain('View all');

    const lengths = [2, 5, 0, 18];
    expect(moveFocus(lengths, { row: 0, col: 1 }, 'ArrowRight')).toEqual({ row: 0, col: 1 });
    expect(moveFocus(lengths, { row: 0, col: 1 }, 'ArrowDown')).toEqual({ row: 1, col: 1 });
    expect(moveFocus(lengths, { row: 1, col: 4 }, 'ArrowDown')).toEqual({ row: 3, col: 4 });
    expect(moveFocus(lengths, { row: 3, col: 9 }, 'ArrowUp')).toEqual({ row: 1, col: 4 });
    expect(moveFocus(lengths, { row: 1, col: 0 }, 'ArrowLeft')).toEqual({ row: 1, col: 0 });
    expect(moveFocus(lengths, { row: 0, col: 0 }, 'ArrowUp')).toEqual({ row: 0, col: 0 });
  });

  it('details sheet: a switched-off Play and never a push or save', async () => {
    const meta = metasFrom({ metas: metas('movie', 1) }, 1).metas[0] as PreviewMeta;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'));
    try {
      for (const mode of ['tv', 'mobile', 'stremio'] as const) {
        const html = render({ mode, loader: await loadedLoader(), stack: previewNav([{ at: 'home' }], { type: 'details', meta }) });
        expect(html).toContain('npv-details');
        expect(html).toMatch(/class="npv-pill is-play" disabled=""/);
        expect(html).toContain('Playback is not available in the preview.');
        expect(html).toContain('About movie 0');
      }
      expect(api.post).not.toHaveBeenCalled();
      expect(api.put).not.toHaveBeenCalled();
      expect(api.patch).not.toHaveBeenCalled();
      expect(api.delete).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
    // No preview source can reach a write: only GETs (and the two read-only
    // draft POSTs, which carry a body), no push or save module.
    const dir = path.dirname(fileURLToPath(import.meta.url));
    for (const file of readdirSync(dir).filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'))) {
      const source = readFileSync(path.join(dir, file), 'utf8');
      expect(source, file).not.toMatch(/apiClient\.(post(?!<\w+>\('\/api\/setup\/preview-draft(\/catalog)?')|put|patch|delete)|method:\s*['"](POST|PUT|PATCH|DELETE)|pushSetup|pushTo\w*\(|saveSetup|saveConfig|\/api\/setup\/[^'"`]*\/(push|config|keys)/);
    }
  });

  it('meta requests use the addon meta route; loads once each', async () => {
    expect(metaUrl(TOKEN, 'movie', 'torbox:movie:12')).toBe(`/${TOKEN}/meta/movie/torbox%3Amovie%3A12.json`);
    const fetchJson = vi.fn(async () => ({ meta: { id: 'x', type: 'movie', name: 'X', logo: 'https://image.tmdb.org/t/p/original/logo.png', background: 'b.jpg', genres: ['Drama'], description: 'D' } }));
    const loader = createMetaLoader(TOKEN, { fetchJson });
    loader.load({ type: 'movie', id: 'x' });
    loader.load({ type: 'movie', id: 'x' });
    await vi.waitFor(() => expect(loader.get({ type: 'movie', id: 'x' })?.logo).toContain('logo.png'));
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(tmdbSized('https://image.tmdb.org/t/p/original/logo.png', 'w500')).toBe('https://image.tmdb.org/t/p/w500/logo.png');
    expect(tmdbSized('https://lelibrary.test/p/poster.jpg', 'w342')).toBe('https://lelibrary.test/p/poster.jpg');
  });

  it('error, empty and missing-link states look like the app', async () => {
    const failed = render({ failed: true });
    expect(failed).toContain('The preview could not be loaded.');
    expect(failed).toContain('Try again');
    const loader: CatalogLoader = {
      get: (ref) => (ref.catalogId === 'torbox-movies' ? { status: 'error' } : { status: 'ready', metas: [], total: 0 }),
      load: () => {}, retry: () => {}, subscribe: () => () => {},
    };
    const html = render({ mode: 'mobile', loader, installToken: null, dirty: true });
    expect(html).toContain('This row did not load.');
    expect(html).toContain('Nothing here yet');
    expect(html).toContain('Posters need your install link.');
    expect(html).toContain('Save to see your latest changes.');
    expect(gridColumns(390)).toBe(3);
    expect(gridColumns(1280)).toBe(6);
  });
});

describe('catalogue loading', () => {
  it('builds the addon catalogue URL the players use, genre as an extra', () => {
    expect(catalogUrl(TOKEN, { type: 'movie', catalogId: 'torbox-movies' })).toBe(`/${TOKEN}/catalog/movie/torbox-movies.json`);
    expect(catalogUrl(TOKEN, { type: 'series', catalogId: 'lelibrary-curated-series', genre: 'Shows in 4K' }))
      .toBe(`/${TOKEN}/catalog/series/lelibrary-curated-series/genre=Shows%20in%204K.json`);
  });

  it('keeps display fields only, drops metas without a poster and counts the page', () => {
    const out = metasFrom({ metas: [{ id: 'a', name: 'A', poster: 'p.jpg', links: ['x'], releaseInfo: '2024-', genres: ['Drama', 3] }, { id: 'b', name: 'B' }, { id: 'c', poster: 'c.jpg', released: '2019-05-01T00:00:00Z' }] }, 12);
    expect(out.total).toBe(3);
    expect(out.metas).toEqual([
      { id: 'a', type: '', name: 'A', poster: 'p.jpg', background: '', logo: '', year: '2024-', genres: ['Drama'], description: '' },
      { id: 'c', type: '', name: '', poster: 'c.jpg', background: '', logo: '', year: '2019', genres: [], description: '' },
    ]);
    expect(metasFrom(null, 12)).toEqual({ metas: [], total: 0 });
  });

  it('loads each catalogue once, limits concurrency and retries after an error', async () => {
    let inFlight = 0;
    let peak = 0;
    const calls: string[] = [];
    let failNext = true;
    const fetchJson = vi.fn(async (url: string) => {
      calls.push(url);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      if (url.includes('/broken') && failNext) { failNext = false; throw new Error('boom'); }
      return { metas: [{ id: url, name: 'x', poster: 'p.jpg' }] };
    });
    const loader = createCatalogLoader(TOKEN, { fetchJson, concurrency: 2 });
    const refs = ['a', 'b', 'c', 'd', 'broken'].map((id) => ({ type: 'movie', catalogId: id }));
    for (const ref of refs) loader.load(ref);
    loader.load(refs[0]!);
    expect(loader.get(refs[0]!)).toEqual({ status: 'loading' });
    await vi.waitFor(() => expect(refs.every((ref) => loader.get(ref)?.status !== 'loading')).toBe(true));
    expect(peak).toBe(2);
    expect(calls).toHaveLength(5);
    expect(loader.get(refs[4]!)).toEqual({ status: 'error' });
    loader.retry(refs[0]!);
    expect(calls).toHaveLength(5);
    loader.retry(refs[4]!);
    await vi.waitFor(() => expect(loader.get(refs[4]!)?.status).toBe('ready'));
    expect(calls).toHaveLength(6);
  });
});
