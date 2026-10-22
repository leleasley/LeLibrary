import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CollectionStudio } from '@/features/setup/full/collections/CollectionStudio';

function renderStudio(overrides: Partial<Parameters<typeof CollectionStudio>[0]> = {}) {
  return renderToStaticMarkup(
    <CollectionStudio
      collections={[]}
      onChange={() => {}}
      providerPrefix={null}
      platform="nuvio"
      packs={[]}
      onPacks={() => {}}
      ownedOn={false}
      onToggleOwned={() => {}}
      {...overrides}
    />,
  );
}

describe('collections studio public browser entry', () => {
  it('offers the public directory on nuvio setups once connected', () => {
    const html = renderStudio({ nuvioToken: 'session-token' });
    expect(html).toContain('Browse public Nuvio collections');
    expect(html).toContain('Browse public →');
  });

  it('explains the Nuvio connection requirement before connect', () => {
    const html = renderStudio({ nuvioToken: null });
    expect(html).toContain('Browse public Nuvio collections');
    expect(html).toContain('Connect Nuvio in Step 1 to browse public collections.');
    expect(html).toContain('disabled');
  });

  it('stays out of stremio setups entirely', () => {
    const html = renderStudio({ platform: 'stremio', nuvioToken: 'session-token' });
    expect(html).not.toContain('Browse public Nuvio collections');
  });
});

describe('collections studio folder sources', () => {
  const legacyCollection = [{
    id: 'collection-test',
    title: 'Test',
    tileShape: 'LANDSCAPE' as const,
    pinToTop: false,
    focusGlowEnabled: true,
    showAllTab: true,
    viewMode: 'TABBED_GRID' as const,
    hideTitle: false,
    backdropUrl: '',
    folders: [{
      id: 'folder-test',
      title: 'Trending folder',
      tileShape: 'LANDSCAPE' as const,
      hideTitle: false,
      coverImageUrl: '',
      focusGifEnabled: false,
      focusGifUrl: '',
      heroBackdropUrl: '',
      catalogSources: [
        { addonId: '', addonUrl: '', catalogId: 'lelibrary-curated-movie,lib-trending_movies', type: 'movie' as const, genre: 'Trending Movies' },
        { addonId: '', addonUrl: '', catalogId: 'lelibrary-curated-movie', type: 'movie' as const, genre: 'lib-now_playing_movies' },
      ],
    }],
  }];

  it('never shows an internal routing id on a folder tile', () => {
    const html = renderStudio({ collections: legacyCollection, packs: [], providerPrefix: null, ownedOn: false });
    expect(html).not.toContain('lelibrary-curated-movie');
    expect(html).toContain('Trending Movies');
    expect(html).toContain('Now Playing Movies');
  });
});
