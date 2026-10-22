import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TierPicker } from '@/features/setup/shared/TierPicker';
import { queryKeys } from '@/api/query-keys';

const UUID_A = '123e4567-e89b-12d3-a456-426614174000';

function client(overrides: { savedSetups?: boolean; setups?: unknown[] } = {}) {
  const cache = new QueryClient();
  cache.setQueryData(queryKeys.features, {
    releases: false,
    savedSetups: overrides.savedSetups ?? false,
  });
  if (overrides.setups) cache.setQueryData(queryKeys.savedSetups, overrides.setups);
  return cache;
}

function render(cache: QueryClient): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <QueryClientProvider client={cache}>
        <TierPicker />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const SERVER_SETUP = {
  uuid: UUID_A,
  name: 'Living room',
  tier: 'quick',
  hasPassword: true,
  createdAtMs: Date.parse('2026-10-01T10:00:00Z'),
  updatedAtMs: Date.parse('2026-10-02T10:00:00Z'),
  lastUsedAtMs: Date.parse('2026-10-03T10:00:00Z'),
};

describe('TierPicker self-host saved setups', () => {
  it('keeps the section hidden when the instance has no list', () => {
    const html = render(client({ savedSetups: false }));
    expect(html).not.toContain('Saved on this server');
  });

  it('lists setups saved on this server', () => {
    const html = render(client({ savedSetups: true, setups: [SERVER_SETUP] }));
    expect(html).toContain('Back to a previous setup');
    expect(html).toContain('Saved on this server');
    expect(html).toContain('Living room');
    // Each entry is a real button (keyboard + screen reader), named for the
    // setup, not a clickable span.
    expect(html).toContain('aria-label="Open Living room"');
    // Server entries show when they were last used and have no Forget control
    // (they are not browser-local state).
    expect(html).toContain('Updated');
    // The tier badge shows the user-facing name, not the stored id.
    expect(html).toContain('Quick Look');
    expect(html).not.toContain('>quick<');
    expect(html).not.toContain('aria-label="Forget Living room on this browser"');
  });

  it('shows an empty state instead of nothing when the server has no setups', () => {
    const html = render(client({ savedSetups: true, setups: [] }));
    expect(html).toContain('No saved setups yet.');
  });

  it('renders a hostile setup name as text', () => {
    const html = render(client({
      savedSetups: true,
      setups: [{ ...SERVER_SETUP, name: '<script>alert(1)</script>' }],
    }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
