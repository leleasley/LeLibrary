import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PackLibraryModal } from '@/features/setup/full/collections/PackLibraryModal';
import type { CuratedPack } from '@/features/setup/full/collections/curated-packs';

function pack(overrides: Partial<CuratedPack> = {}): CuratedPack {
  return {
    id: 'discover',
    title: 'Discover',
    description: 'The essential rows.',
    category: 'Discover',
    icon: '✨',
    refresh: 'daily',
    coverImageUrl: '',
    backdropUrl: '',
    folderCount: 6,
    folders: [
      { id: 'f1', title: 'Trending', tileShape: 'poster', hideTitle: false, coverImageUrl: '/covers/trending.png', focusGifEnabled: false, focusGifUrl: '', heroBackdropUrl: '/backdrops/trending.jpg', catalogSources: [] },
      { id: 'f2', title: 'Popular', tileShape: 'poster', hideTitle: false, coverImageUrl: '/covers/popular.png', focusGifEnabled: false, focusGifUrl: '', heroBackdropUrl: '/backdrops/popular.jpg', catalogSources: [] },
      { id: 'f3', title: 'Classics', tileShape: 'poster', hideTitle: false, coverImageUrl: '/covers/classics.png', focusGifEnabled: false, focusGifUrl: '', heroBackdropUrl: '', catalogSources: [] },
    ] as CuratedPack['folders'],
    sections: [],
    ...overrides,
  } as CuratedPack;
}

const baseProps = {
  open: true,
  onClose: () => {},
  failed: false,
  selectedIds: [] as string[],
  ownedOn: false,
  hubOn: false,
  platform: 'nuvio' as const,
  onTogglePack: () => {},
  onToggleOwned: () => {},
  onToggleHub: () => {},
};

describe('pack library modal', () => {
  it('renders one hero image per card with a folder chip, never a sliced collage', () => {
    const html = renderToStaticMarkup(<PackLibraryModal {...baseProps} curated={[pack()]} />);
    // Single hero: the first landscape backdrop wins over portrait covers.
    expect(html).toContain('/backdrops/trending.jpg');
    expect(html).not.toContain('/covers/trending.png');
    expect(html).not.toContain('pack-art-2');
    expect(html).not.toContain('pack-art-3');
    expect(html).toContain('6 folders');
    expect(html).toContain('Add pack');
  });

  it('prefers the pack cover when one exists', () => {
    const html = renderToStaticMarkup(
      <PackLibraryModal {...baseProps} curated={[pack({ coverImageUrl: '/covers/pack.png' })]} />,
    );
    expect(html).toContain('/covers/pack.png');
    expect(html).not.toContain('/backdrops/trending.jpg');
  });

  it('marks selected packs and counts the footer selection', () => {
    const html = renderToStaticMarkup(
      <PackLibraryModal {...baseProps} curated={[pack()]} selectedIds={['discover']} />,
    );
    expect(html).toContain('Added');
    expect(html).toContain('pack-card selected');
    expect(html).toContain('<b>1</b> pack selected');
  });

  it('shows a fallback icon when a pack has no art at all', () => {
    const artless = pack({ coverImageUrl: '', folders: [{ id: 'f9', title: 'Empty', tileShape: 'poster', hideTitle: false, coverImageUrl: '', focusGifEnabled: false, focusGifUrl: '', heroBackdropUrl: '', catalogSources: [] }] as CuratedPack['folders'] });
    const html = renderToStaticMarkup(<PackLibraryModal {...baseProps} curated={[artless]} />);
    expect(html).toContain('pack-card-fallback');
  });

  it('tells the user the franchise collection also adds a Home row', () => {
    const html = renderToStaticMarkup(<PackLibraryModal {...baseProps} curated={[]} />);
    expect(html).toContain('LeLibrary Movie Collections');
    expect(html).toContain('Also adds a Home row');
  });
});
