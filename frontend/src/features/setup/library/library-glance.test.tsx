import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LibraryGlance } from '@/features/setup/library/LibraryGlance';

const STATS = {
  titles: 200, films: 150, shows: 50, sizeBytes: 5 * 1024 ** 4, uhd: 50, hdr: 20, addedWeek: 3,
  recent: [{ type: 'movie' as const, title: 'Sample Film', year: '2024', poster: 'https://image.tmdb.org/t/p/w342/x.jpg' }],
};

describe('library at a glance', () => {
  it('shows size, 4K and HDR shares and what is new', () => {
    const html = renderToStaticMarkup(<LibraryGlance stats={STATS} language="en-GB" />);
    expect(html).toContain('5 TB');
    expect(html).toContain('25%');
    expect(html).toContain('10%');
    expect(html).toContain('Added this week');
    expect(html).toContain('Sample Film');
    expect(html).toContain('title="Sample Film · 2024"');
  });

  it('waits quietly while loading and hides for an empty library', () => {
    expect(renderToStaticMarkup(<LibraryGlance stats={null} language="en-GB" />)).toContain('is-loading');
    expect(renderToStaticMarkup(<LibraryGlance stats={{ ...STATS, titles: 0, recent: [] }} language="en-GB" />)).toBe('');
  });

  it('leaves out the poster strip when nothing arrived this week', () => {
    expect(renderToStaticMarkup(<LibraryGlance stats={{ ...STATS, addedWeek: 0, recent: [] }} language="en-GB" />)).not.toContain('New this week');
  });
});
