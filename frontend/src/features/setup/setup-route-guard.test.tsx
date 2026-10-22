import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SetupEditPage } from '@/features/setup/SetupEditPage';

// Single-segment paths such as /index.html used to render SetupEditPage, which
// fetched a setup named "index.html" and showed "Setup not found". They are
// not setup ids and must render the shared 404 instead.
function renderAt(path: string): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path=":uuid" element={<SetupEditPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('setup route guard', () => {
  it('renders the 404 design for a non-UUID path', () => {
    const html = renderAt('/index.html');
    expect(html).toContain('error-hero');
    expect(html).toContain('>404<');
    expect(html).not.toContain('Setup not found');
  });

  it('does not treat an asset-like path as a setup id', () => {
    const html = renderAt('/movie.mp4');
    expect(html).toContain('error-hero');
  });
});
