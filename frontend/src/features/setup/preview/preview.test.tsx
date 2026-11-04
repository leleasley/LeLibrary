import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ROW_LIMIT, catalogKey, catalogUrl, createCatalogLoader, metasFrom, previewPlace,
  type CatalogLoader, type CatalogRef, type PreviewPlace, type RowState, type SetupPreview,
} from '@/features/setup/preview/preview-model';

// No network in tests: the preview endpoint is a spy that never resolves.
vi.mock('@/api/client', () => ({ apiClient: { get: vi.fn(() => new Promise(() => {})) } }));

const { PreviewPanel } = await import('@/features/setup/preview/PreviewPanel');

const TOKEN = '11111111-2222-3333-4444-555555555555.synthetic-secret';

const NUVIO: SetupPreview = {
  platform: 'nuvio',
  hero: [{ key: 'a:movie:torbox-movies', type: 'movie', catalogId: 'torbox-movies', name: 'My Movies' }],
  collections: [{
    id: 'collection-lelibrary-hub', title: 'The Hub', backdrop: 'https://image.tmdb.org/t/p/original/hub.jpg',
    folders: [
      {
        id: 'folder-4k', title: 'In 4K', cover: 'https://lelibrary.test/art/folder/folder-4k.jpg', shape: 'POSTER', hideTitle: false,
        sources: [
          { catalogId: 'torbox-movies-4k', type: 'movie', genre: '', name: 'Movies in 4K' },
          { catalogId: 'lelibrary-curated-series', type: 'series', genre: 'Shows in 4K', name: 'Shows in 4K' },
        ],
      },
      { id: 'folder-wide', title: 'Wide Folder', cover: '', shape: 'LANDSCAPE', hideTitle: false, sources: [] },
    ],
  }],
  home: [
    { kind: 'collection', id: 'collection-lelibrary-hub' },
    { kind: 'row', key: 'a:series:torbox-series', type: 'series', catalogId: 'torbox-series', name: 'My Shows' },
    { kind: 'row', key: 'a:movie:torbox-movies', type: 'movie', catalogId: 'torbox-movies', name: 'My Movies' },
    { kind: 'row', key: 'b:movie:top', type: 'movie', catalogId: 'top', name: 'Popular Elsewhere', external: true },
  ],
  franchisePending: true,
};

const STREMIO: SetupPreview = {
  platform: 'stremio',
  hero: [],
  collections: [],
  home: [
    { kind: 'row', key: 'a:movie:torbox-movies', type: 'movie', catalogId: 'torbox-movies', name: 'My Movies' },
    { kind: 'row', key: 'a:series:torbox-series', type: 'series', catalogId: 'torbox-series', name: 'My Shows' },
  ],
  franchisePending: false,
};

function posters(prefix: string, count: number) {
  return Array.from({ length: count }, (_, n) => ({ id: `${prefix}-${n}`, name: `${prefix} title ${n}`, poster: `https://image.tmdb.org/t/p/w342/${prefix}-${n}.jpg`, background: '' }));
}

function fakeLoader(states: [CatalogRef, RowState][]): CatalogLoader {
  const map = new Map(states.map(([ref, state]) => [catalogKey(ref), state]));
  return { get: (ref) => map.get(catalogKey(ref)), load: () => {}, retry: () => {}, subscribe: () => () => {} };
}

function render(props: { platform?: 'nuvio' | 'stremio'; place?: PreviewPlace; loader?: CatalogLoader; failed?: boolean; installToken?: string | null; dirty?: boolean }) {
  return renderToStaticMarkup(
    <PreviewPanel
      uuid="11111111-2222-3333-4444-555555555555" editToken="edit-token"
      installToken={props.installToken === undefined ? TOKEN : props.installToken}
      defaultPlatform={props.platform ?? 'nuvio'} dirty={props.dirty}
      loader={props.loader ?? fakeLoader([])}
      initial={{ previews: props.failed ? undefined : { nuvio: NUVIO, stremio: STREMIO }, place: props.place, failed: props.failed }}
    />,
  );
}

describe('PreviewPanel', () => {
  it('renders Nuvio Home in order: hero, collections, then rows with posters', () => {
    const html = render({
      loader: fakeLoader([
        [{ type: 'movie', catalogId: 'torbox-movies' }, { status: 'ready', metas: posters('movie', 20) }],
        [{ type: 'series', catalogId: 'torbox-series' }, { status: 'ready', metas: posters('series', 3) }],
      ]),
    });
    expect(html).toContain('What your player will show');
    expect(html).toContain('pv-hero');
    const order = ['The Hub', 'My Shows', 'Popular Elsewhere'].map((name) => html.indexOf(`>${name}<`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Folder covers in the collection row; posters capped per row.
    expect(html).toContain('https://lelibrary.test/art/folder/folder-4k.jpg');
    expect(html).toContain('pv-tile is-landscape');
    expect(html).toContain('movie-0.jpg');
    expect(html).toContain(`movie-${ROW_LIMIT - 1}.jpg`);
    expect(html).not.toContain(`movie-${ROW_LIMIT}.jpg`);
    expect(html).toContain('series-2.jpg');
    expect(html).toContain('From another addon: your player loads it, the preview cannot.');
    expect(html).toContain('Movie Collections appears here once your library has finished building.');
    // Nuvio is the selected player.
    expect(html).toMatch(/aria-selected="true"[^>]*>Nuvio</);
    // The install token is used for requests only, never shown.
    expect(html).not.toContain('synthetic-secret');
  });

  it('defaults to the saved player and shows Stremio as board rows only', () => {
    const html = render({ platform: 'stremio' });
    expect(html).toMatch(/aria-selected="true"[^>]*>Stremio</);
    expect(html).toContain('pv-screen is-stremio');
    expect(html).not.toContain('The Hub');
    expect(html).not.toContain('pv-hero ');
    expect(html).toContain('>My Movies<');
    expect(html).toContain('>Movie<');
    expect(html).toContain('>Series<');
  });

  it('opens a collection to its folders and a folder to its source tabs', () => {
    const collection = render({ place: { at: 'collection', collectionId: 'collection-lelibrary-hub' } });
    expect(collection).toContain('pv-folders');
    expect(collection).toContain('>In 4K<');
    expect(collection).toContain('>Wide Folder<');
    expect(collection).toContain('hub.jpg');
    expect(collection).not.toContain('>My Shows<');

    const folder = render({
      place: { at: 'folder', collectionId: 'collection-lelibrary-hub', folderId: 'folder-4k', tab: 1 },
      loader: fakeLoader([[{ type: 'series', catalogId: 'lelibrary-curated-series', genre: 'Shows in 4K' }, { status: 'ready', metas: posters('uhd', 30) }]]),
    });
    expect(folder).toContain('role="tablist" aria-label="Folder sources"');
    expect(folder).toMatch(/aria-selected="true"[^>]*><span[^>]*>Shows in 4K</);
    expect(folder).toContain('pv-grid');
    expect(folder).toContain('uhd-23.jpg');
    expect(folder).not.toContain('uhd-24.jpg');
  });

  it('shows empty and error states per row, with a retry', () => {
    const html = render({
      loader: fakeLoader([
        [{ type: 'movie', catalogId: 'torbox-movies' }, { status: 'error' }],
        [{ type: 'series', catalogId: 'torbox-series' }, { status: 'ready', metas: [] }],
      ]),
    });
    expect(html).toContain('This row did not load.');
    expect(html).toContain('pv-retry');
    expect(html).toContain('This row is empty.');
  });

  it('never leaves a blank page when the preview itself fails', () => {
    const html = render({ failed: true });
    expect(html).toContain('The preview could not be loaded.');
    expect(html).toContain('Try again');
  });

  it('explains missing posters without the install link and unsaved edits', () => {
    const html = render({ installToken: null, dirty: true });
    expect(html).toContain('Posters need your install link.');
    expect(html).toContain('This shows your saved settings.');
  });
});

describe('preview navigation', () => {
  it('drills down and back, resetting the tab per folder', () => {
    let place: PreviewPlace = { at: 'home' };
    place = previewPlace(place, { type: 'folder', collectionId: 'c', folderId: 'f' });
    expect(place).toEqual({ at: 'folder', collectionId: 'c', folderId: 'f', tab: 0 });
    place = previewPlace(place, { type: 'tab', tab: 2 });
    expect(place).toEqual({ at: 'folder', collectionId: 'c', folderId: 'f', tab: 2 });
    place = previewPlace(place, { type: 'back' });
    expect(place).toEqual({ at: 'collection', collectionId: 'c' });
    place = previewPlace(place, { type: 'back' });
    expect(place).toEqual({ at: 'home' });
    expect(previewPlace({ at: 'home' }, { type: 'tab', tab: 1 })).toEqual({ at: 'home' });
    // Switching the player always returns Home.
    expect(previewPlace({ at: 'collection', collectionId: 'c' }, { type: 'home' })).toEqual({ at: 'home' });
  });
});

describe('catalogue loading', () => {
  it('builds the addon catalogue URL the players use, genre as an extra', () => {
    expect(catalogUrl(TOKEN, { type: 'movie', catalogId: 'torbox-movies' })).toBe(`/${TOKEN}/catalog/movie/torbox-movies.json`);
    expect(catalogUrl(TOKEN, { type: 'series', catalogId: 'lelibrary-curated-series', genre: 'Shows in 4K' }))
      .toBe(`/${TOKEN}/catalog/series/lelibrary-curated-series/genre=Shows%20in%204K.json`);
  });

  it('keeps display fields only and drops metas without a poster', () => {
    const out = metasFrom({ metas: [{ id: 'a', name: 'A', poster: 'p.jpg', links: ['x'] }, { id: 'b', name: 'B' }, { id: 'c', poster: 'c.jpg' }] }, 12);
    expect(out).toEqual([{ id: 'a', name: 'A', poster: 'p.jpg', background: '' }, { id: 'c', name: '', poster: 'c.jpg', background: '' }]);
    expect(metasFrom(null, 12)).toEqual([]);
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
