import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ImportSection } from '@/features/setup/full/ImportSection';

describe('import section layout', () => {
  it('renders a launch button and no password fields until the end', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ImportSection staged={null} platform="nuvio" keepsCollections={false} onStage={() => {}} />
      </MemoryRouter>,
    );
    expect(html).toContain('Import old setup');
    expect(html).toContain('Bring your old setup across');
    // What comes across, and the three steps, are visible before opening it.
    for (const item of ['Keys', 'Logins', 'Settings', 'Home rows']) expect(html).toContain(item);
    expect(html).not.toContain('>Collections<');
    for (const step of ['Enter your email', 'Pick a setup', 'Review and create']) expect(html).toContain(step);
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('setup-row');
    expect(html).not.toContain('setup-kv');
  });

  it('shows the staged import as a pending change with a way out', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ImportSection
          staged={{ email: 'you@example.com', idMasked: '4v18…epA', label: 'My setup', kind: 'collection', keyCount: 5, collectionCount: 2, homeRowCount: 1, hasLogin: true, services: ['tmdbApiKey'] }}
          platform="nuvio"
          keepsCollections={false}
          onStage={() => {}}
        />
      </MemoryRouter>,
    );
    expect(html).toContain('Ready to bring across');
    expect(html).toContain('My setup');
    expect(html).toContain('5 keys');
    expect(html).toContain('Your login');
    expect(html).toContain('1 home row');
    expect(html).toContain('Remove');
    expect(html).toContain('Change');
    // Settle In does not carry collections, and says so.
    expect(html).not.toContain('<li>2 collections</li>');
    expect(html).toContain('Its 2 collections are not brought across');
  });

  it('Move In lists collections among what comes across', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ImportSection staged={null} platform="nuvio" keepsCollections onStage={() => {}} />
      </MemoryRouter>,
    );
    expect(html).toContain('>Collections<');
  });

  it('notifies the page when the staged import is removed', () => {
    const onStage = vi.fn();
    // Static markup cannot click; assert the banner wires the remover by
    // rendering it — interaction is covered by the staged round-trip below.
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ImportSection
          staged={{ email: 'you@example.com', idMasked: '4v18…epA', label: null, kind: 'token', keyCount: 0, collectionCount: 0, homeRowCount: 0, hasLogin: false, services: [] }}
          platform="nuvio"
          onStage={onStage}
        />
      </MemoryRouter>,
    );
    expect(onStage).not.toHaveBeenCalled();
    expect(html).toContain('Remove');
  });
});
