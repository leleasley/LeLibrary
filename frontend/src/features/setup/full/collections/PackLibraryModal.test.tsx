import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PackLibraryModal } from '@/features/setup/full/collections/PackLibraryModal';
import type { CuratedFolder, CuratedPack } from '@/features/setup/full/collections/curated-packs';
import type { CollectionDoc } from '@/features/setup/shared/collection-doc';

function folder(id: string, title: string, sourceIds: string[], extra: Partial<CuratedFolder> = {}): CuratedFolder {
  return {
    id, title, tileShape: 'LANDSCAPE', hideTitle: false, coverImageUrl: '', focusGifEnabled: false,
    focusGifUrl: '', heroBackdropUrl: '',
    catalogSources: sourceIds.map((id) => ({ catalogId: `lib-${id}`, type: id.endsWith('_series') ? 'series' : 'movie' })),
    sourceIds,
    ...extra,
  };
}

function pack(overrides: Partial<CuratedPack> = {}): CuratedPack {
  return {
    id: 'discover', title: 'Discover', description: 'The essential rows.', category: 'Discover', icon: '✨',
    refresh: 'live', coverImageUrl: '', backdropUrl: '', folderCount: 2, sections: [], kind: 'pack', filters: ['charts'],
    generatedCoverUrl: '/art/generated/poster/abc.jpg?p=a.jpg&v=1',
    folders: [
      folder('folder-lelibrary-trending', 'Trending', ['trending_movies', 'trending_series']),
      folder('folder-lelibrary-popular', 'Popular', ['tmdb_popular_movies']),
    ],
    ...overrides,
  };
}

const SPECIAL = pack({
  id: 'lelibrary-special', title: 'LeLibrary Special', kind: 'bundle', filters: ['charts'],
  sections: [{ id: 'discover', title: 'Discover', folders: ['folder-lelibrary-trending', 'folder-lelibrary-popular'] }],
});
const STREAMING = pack({
  id: 'streaming-region', title: 'Streaming by Region', kind: 'pack', filters: ['streaming'],
  folders: [
    folder('folder-lelibrary-sr-netflix', 'Netflix', ['streaming_netflix_movies']),
    folder('folder-lelibrary-sr-bbc', 'BBC iPlayer', ['svc_bbc_iplayer_movies'], { regions: ['GB'] }),
    folder('folder-lelibrary-sr-joyn', 'Joyn', ['svc_joyn_movies'], { regions: ['DE'] }),
    folder('folder-lelibrary-sr-rtl', 'RTL+', ['svc_rtl_plus_movies'], { regions: ['DE'] }),
  ],
});
const CHARTS = pack({
  id: 'charts', title: "Charts & What's Hot", kind: 'pack', filters: ['charts'], requiresMdblistKey: true,
  folders: [folder('folder-lelibrary-ch-week', 'Most Watched This Week', ['chart_watched_week_movies'], { needsMdblistKey: true })],
});
const SINGLE = pack({
  id: 'preset-cinema-now', title: 'Cinema Now', kind: 'single', filters: ['charts'],
  folders: [folder('folder-lelibrary-cinema', 'In Theatres', ['now_playing_movies'])],
});
const SEASONAL = pack({
  id: 'seasonal', title: 'Seasonal & Holidays', kind: 'pack', filters: ['seasonal'],
  folders: [folder('folder-lelibrary-xmas', 'Christmas', ['themed_christmas_movies'], { season: { from: '11-15', to: '01-06' } })],
});

const base = {
  open: true, onClose: () => {}, failed: false, aliases: {}, collections: [] as CollectionDoc[],
  region: 'GB', hasMdblistKey: false, platform: 'nuvio' as const, ownedOn: false, hubOn: false,
  onAddPack: () => {}, onRemovePack: () => {}, onToggleOwned: () => {}, onToggleHub: () => {},
  today: new Date(2026, 9, 28),
};

function doc(id: string, sourceIds: string[]): CollectionDoc {
  return {
    id, title: id, tileShape: 'LANDSCAPE', pinToTop: false, focusGlowEnabled: true, showAllTab: true,
    viewMode: 'TABBED_GRID', backdropUrl: '', hideTitle: false,
    folders: [{
      id: `${id}-f`, title: 'f', tileShape: 'LANDSCAPE', hideTitle: false, coverImageUrl: '', focusGifEnabled: false,
      focusGifUrl: '', heroBackdropUrl: '',
      catalogSources: sourceIds.map((sid) => ({ addonId: '', addonUrl: '', catalogId: `lib-${sid}`, type: 'movie' as const, genre: '' })),
    }],
  };
}

describe('pack picker', () => {
  it('renders bundles first, then themed packs, then single collections', () => {
    const html = renderToStaticMarkup(<PackLibraryModal {...base} curated={[SINGLE, STREAMING, SPECIAL]} />);
    const bundles = html.indexOf('Bundled packs');
    const themed = html.indexOf('Themed packs');
    const singles = html.indexOf('Single collections');
    expect(bundles).toBeGreaterThan(-1);
    expect(themed).toBeGreaterThan(bundles);
    expect(singles).toBeGreaterThan(themed);
    expect(html.indexOf('data-pack="lelibrary-special"')).toBeLessThan(html.indexOf('data-pack="streaming-region"'));
  });

  it('shows the generated cover, counts and the fixed filters instead of free-text categories', () => {
    const html = renderToStaticMarkup(<PackLibraryModal {...base} curated={[pack()]} />);
    expect(html).toContain('/art/generated/poster/abc.jpg');
    expect(html).toContain('1 collection');
    expect(html).toContain('2 folders');
    for (const label of ['Streaming', 'Genres &amp; Moods', 'Franchises &amp; Universes', 'People', 'World &amp; Regional', 'Seasonal', 'Kids &amp; Family', 'Charts']) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(html).toContain('Peek inside');
    expect(html).toContain('Add 2 folders');
  });

  it('hides services outside the region and says how many', () => {
    const html = renderToStaticMarkup(<PackLibraryModal {...base} curated={[STREAMING]} region="GB" />);
    expect(html).toContain('Add 2 folders');
    expect(html).toContain('2 services aren&#x27;t available in United Kingdom and are hidden.');
    const german = renderToStaticMarkup(<PackLibraryModal {...base} curated={[STREAMING]} region="DE" />);
    expect(german).toContain('Add 3 folders');
    expect(german).not.toContain('BBC iPlayer');
    expect(german).toContain('1 service isn&#x27;t available in Germany and is hidden.');
  });

  it('locks MDBList packs until a key exists and points at Optional list sources', () => {
    const locked = renderToStaticMarkup(<PackLibraryModal {...base} curated={[CHARTS]} />);
    expect(locked).toContain('Add your MDBList key in Optional list sources to use this');
    expect(locked).toMatch(/<button[^>]*class="pp-add"[^>]*disabled=""[^>]*>Locked<\/button>/);
    const open = renderToStaticMarkup(<PackLibraryModal {...base} curated={[CHARTS]} hasMdblistKey />);
    expect(open).not.toContain('Optional list sources');
    expect(open).toContain('Add 1 folder');
  });

  it('marks packs whose folders are already present as added, never as new', () => {
    const html = renderToStaticMarkup(
      <PackLibraryModal {...base} curated={[pack(), SPECIAL]} collections={[doc('pack-discover', ['trending_movies', 'trending_series', 'tmdb_popular_movies'])]} />,
    );
    expect(html).not.toContain('Add 2 folders');
    expect((html.match(/✓ Added/g) ?? []).length).toBe(2);
    expect(html).toContain('Remove');
  });

  it('never shows a folder twice inside a card', () => {
    const html = renderToStaticMarkup(<PackLibraryModal {...base} curated={[SPECIAL]} />);
    expect(html.match(/data-pack="lelibrary-special"/g)?.length).toBe(1);
  });

  it('shows the Nuvio Home size meter and the Stremio catalogue note', () => {
    const many = Array.from({ length: 61 }, (_, index) => doc(`c${index}`, [`s_${index}`]));
    const crowded = renderToStaticMarkup(<PackLibraryModal {...base} curated={[]} collections={many} />);
    expect(crowded).toContain('Nuvio Home size');
    expect(crowded).toContain('61 folders');
    expect(crowded).toContain('Nuvio Home gets crowded above about 60 folders');
    const stremio = renderToStaticMarkup(<PackLibraryModal {...base} curated={[]} collections={many.slice(0, 3)} platform="stremio" />);
    expect(stremio).toContain('On Stremio each folder source becomes its own catalogue: 3 catalogues.');
    expect(stremio).not.toContain('LeLibrary Movie Collections');
  });

  it('keeps the LeLibrary essentials on Nuvio with a plain Home row note', () => {
    const html = renderToStaticMarkup(<PackLibraryModal {...base} curated={[]} />);
    expect(html).toContain('LeLibrary Movie Collections');
    expect(html).toContain('Also adds a Home row for your franchises.');
    expect(html).not.toContain('—');
  });

  it('flags seasonal packs', () => {
    const html = renderToStaticMarkup(<PackLibraryModal {...base} curated={[SEASONAL]} />);
    expect(html).toContain('Seasonal</span>');
  });
});
