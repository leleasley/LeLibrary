import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuickSetupPage } from '@/features/setup/quick/QuickSetupPage';
import { PartialSetupPage } from '@/features/setup/partial/PartialSetupPage';
import { importableSetups } from '@/features/setup/full/ImportSection';

function render(page: 'quick' | 'partial') {
  const El = page === 'quick' ? QuickSetupPage : PartialSetupPage;
  return renderToStaticMarkup(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <El />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// Settle In and Move In can both bring an old setup across; Quick Look stays
// lean. Only collection setups are importable: a plain token has no collections
// context and would land as an empty, broken-looking setup.
describe('import entry points', () => {
  it('quick look has no import entry', () => {
    expect(render('quick')).not.toContain('Import an old setup');
  });

  it('settle in offers the import on its first step', () => {
    expect(render('partial')).toContain('Import old setup');
  });

  it('settle in lists the LeLibrary shelves with no keys filled', () => {
    const html = render('partial');
    expect(html).toContain('My Movies');
    expect(html).toContain('My Anime');
  });
});

describe('which old setups can be imported', () => {
  it('keeps collection setups and drops plain tokens', () => {
    const setups = [
      { idMasked: 'aaa', kind: 'collection' },
      { idMasked: 'bbb', kind: 'token' },
      { idMasked: 'ccc', kind: 'collection' },
    ];
    expect(importableSetups(setups).map((setup) => setup.idMasked)).toEqual(['aaa', 'ccc']);
  });

  it('imports nothing when the account only has plain tokens', () => {
    expect(importableSetups([{ idMasked: 'bbb', kind: 'token' }])).toEqual([]);
  });
});
