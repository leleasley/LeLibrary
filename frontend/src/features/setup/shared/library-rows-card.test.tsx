import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LibraryRowsCard } from '@/features/setup/shared/LibraryRowsSection';
import { EMPTY_LIBRARY_ROWS, libraryRowsFromConfig, libraryRowsToConfig } from '@/features/setup/shared/library-rows';

const noop = () => undefined;

describe('Quick Look row names card', () => {
  it('shows the default names when nothing is renamed', () => {
    const html = renderToStaticMarkup(<LibraryRowsCard value={EMPTY_LIBRARY_ROWS} onChange={noop} />);
    expect(html).toContain('My Movies');
    expect(html).toContain('My Series');
    expect(html).toContain('LeLibrary Anime');
    expect(html).not.toContain('is-renamed');
    expect(html).toContain('Rename');
  });

  it('shows custom names, marks them, and never translates them', () => {
    const rows = { ...EMPTY_LIBRARY_ROWS, movies: { name: 'Films', show: true }, anime: { name: '', show: false } };
    const html = renderToStaticMarkup(<LibraryRowsCard value={rows} onChange={noop} />);
    expect(html).toMatch(/lr-chip is-renamed[^>]*>.*Films/);
    expect(html).toContain('lr-chip is-hidden');
    expect(html).toMatch(/data-i18n-preserve="[^"]*">Films</);
  });

  it('a saved rename comes back exactly when the setup is reopened', () => {
    const rows = { ...EMPTY_LIBRARY_ROWS, series: { name: '  TV Shows  ', show: true } };
    expect(libraryRowsFromConfig(libraryRowsToConfig(rows)).series).toEqual({ name: 'TV Shows', show: true });
  });
});

describe('Hide anime and the rows card', () => {
  it('shows the Anime row as hidden while Hide anime is on, without touching its saved switch', () => {
    const html = renderToStaticMarkup(<LibraryRowsCard value={EMPTY_LIBRARY_ROWS} onChange={noop} hideAnime />);
    expect(html).toMatch(/lr-chip is-hidden[^>]*>.*LeLibrary Anime/);
    expect(html).not.toMatch(/lr-chip is-hidden[^>]*>.*My Movies/);
    expect(EMPTY_LIBRARY_ROWS.anime.show).toBe(true);
  });
});
