import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReleaseListItem } from '@/api/releases';
import { MoviesTab } from '@/features/releases/MoviesTab';
import { ReleaseCard } from '@/features/releases/ReleaseCard';
import { SearchTab } from '@/features/releases/SearchTab';
import { TvTab } from '@/features/releases/TvTab';
import { addDaysIso, todayIso } from '@/features/releases/release-format';
import { i18n } from '@/i18n';

beforeAll(async () => { await i18n.loadNamespaces('site'); });

// Structural smoke tests for the releases surfaces. Effects do not run under
// renderToStaticMarkup, so these assert on what the first paint contains rather
// than on data-driven behaviour.
function render(element: React.ReactElement): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>{element}</QueryClientProvider>
    </MemoryRouter>,
  );
}

function movie(overrides: Partial<ReleaseListItem> = {}): ReleaseListItem {
  return {
    type: 'movie',
    id: 101,
    title: 'Wicked',
    poster: null,
    backdrop: null,
    genres: [],
    year: 2026,
    status: 'upcoming',
    date: null,
    releaseDate: null,
    digitalDate: null,
    theatricalDate: null,
    physicalDate: null,
    firstAirDate: null,
    nextEpisode: null,
    enriched: false,
    ...overrides,
  };
}

describe('MoviesTab', () => {
  it('offers the quick ranges and shows poster skeletons before the window loads', () => {
    const html = render(<MoviesTab region="GB" />);
    expect(html).toContain('Quick ranges');
    expect(html).toContain('This week');
    expect(html).toContain('Next 30 days');
    expect(html).toContain('Full window');
    expect(html).toContain('rel-item-skeleton');
    expect(html).toContain('aria-live="polite"');
  });
});

describe('SearchTab', () => {
  it('renders its search field and the minimum length hint', () => {
    const html = render(<SearchTab region="GB" />);
    expect(html).toContain('rel-search-field');
    expect(html).toContain('Type at least two characters to search.');
  });
});

describe('TvTab', () => {
  it('offers day navigation, a sort choice and the filters before the window loads', () => {
    const html = render(<TvTab region="GB" />);
    expect(html).toContain('Previous day');
    expect(html).toContain('Next day');
    expect(html).toContain('Notable');
    expect(html).toContain('Popularity');
    expect(html).toContain('A-Z');
    // The strip needs the cached window, so it is not offered before it loads.
    expect(html).not.toContain('Days in this week');
  });
});

describe('ReleaseCard', () => {
  it('marks a title that is out today', () => {
    const html = render(<ReleaseCard item={movie({ status: 'releasing_today', date: todayIso() })} />);
    expect(html).toContain('is-today');
    expect(html).toContain('Out today');
    expect(html).toContain('rel-item-when');
    expect(html).toContain('Today');
  });

  it('spells out a near date and stays quiet about a distant one', () => {
    expect(render(<ReleaseCard item={movie({ date: addDaysIso(todayIso(), 3) })} />)).toContain('In 3 days');
    expect(render(<ReleaseCard item={movie({ date: addDaysIso(todayIso(), 200) })} />)).not.toContain('rel-item-when');
  });
});
