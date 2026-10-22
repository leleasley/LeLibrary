import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ErrorPage } from '@/features/site/ErrorPage';
import { GuidePage } from '@/features/site/GuidePage';
import { SiteBanner } from '@/features/site/SiteBanner';
import { NotFoundPage } from '@/features/site/NotFoundPage';
import { queryKeys } from '@/api/query-keys';
import { i18n } from '@/i18n';

beforeAll(async () => { await i18n.loadNamespaces('site'); });

// The landing, privacy and status pages are hosted-only and gitignored, so a
// public checkout has no such files. The glob includes them only when present
// and the dependent tests skip rather than failing the suite.
const hostedPages = import.meta.glob<Record<string, React.ComponentType>>('./*Page.tsx', { eager: true });
const HomePage = hostedPages['./HomePage.tsx']?.HomePage;
const PrivacyPage = hostedPages['./PrivacyPage.tsx']?.PrivacyPage;
const StatusPage = hostedPages['./StatusPage.tsx']?.StatusPage;
const itHome = HomePage ? it : it.skip;
const itPrivacy = PrivacyPage ? it : it.skip;
const itStatus = StatusPage ? it : it.skip;

// Render smoke for the ported site pages: structural markers only, never page
// copy (landing/privacy/status content stays private). Effects do not run
// under renderToStaticMarkup, so status-dependent regions render their
// empty/loading states unless the query cache is prefilled.
function render(element: React.ReactElement, client?: QueryClient): string {
  const queryClient = client ?? new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  );
}

// The top banner lives in the route shell, not in the pages: pages render
// their content + footer, the banner test below covers the header.
describe('site pages', () => {
  it('renders the banner with brand, nav, status pill and GitHub', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <SiteBanner />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(html).toContain('<header');
    expect(html).toContain('LeLibrary');
    expect(html).toContain('href="/configure"');
    expect(html).toContain('href="/guide"');
    expect(html).toContain('href="/status"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('github.com/leleasley/LeLibrary');
    expect(html).toContain('banner-pill');
  });

  it('renders the error page with server-injected defaults and the shared banner', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <ErrorPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(html).toContain('error-code');
    expect(html).toContain('>500<');
    expect(html).toContain('banner');
    expect(html).toContain('href="/guide"');
  });

  itHome('renders the landing shell: hero library, showcase, levels, FAQ and footer', () => {
    if (!HomePage) return;
    const html = render(<HomePage />);
    expect(html).toContain('<footer');
    expect(html).toContain('hm-shelf-row');
    expect(html).toContain('hm-compare');
    expect(html).toContain('href="/configure/quick"');
    expect(html).toContain('application/ld+json');
    // Footer and help links still land on the page sections and the guide.
    for (const id of ['goal', 'features', 'streams', 'how', 'faq', 'help']) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('help-grid');
    expect(html).toContain('href="/guide"');
    // Reveal animations must not hide content in the prerendered HTML.
    expect(html).not.toContain('hm-js');
  });

  itHome('badges nothing on the goal grid as unfinished', () => {
    if (!HomePage) return;
    // Curated collections ship in the Collections Studio, so no card should
    // still be marked work in progress. Structural marker only: the page copy
    // itself stays private.
    const html = render(<HomePage />);
    expect(html).not.toContain('wip-pill');
  });

  itPrivacy('renders the privacy shell with footer status', () => {
    if (!PrivacyPage) return;
    const html = render(<PrivacyPage />);
    expect(html).toContain('<footer');
    expect(html).toContain('footer-status');
  });

  it('renders the shared 404 design for unknown routes', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <NotFoundPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(html).toContain('error-hero');
    expect(html).toContain('>404<');
    expect(html).toContain('error-actions');
  });

  it('renders the guide with its topics, search and FAQ', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <GuidePage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(html).toContain('gd-nav');
    expect(html).toContain('href="#start"');
    expect(html).toContain('gd-search');
    expect(html).toContain('gd-faq');
    expect(html).toContain('<footer');
  });

  itStatus('renders the status page loading state without data', () => {
    if (!StatusPage) return;
    const html = render(<StatusPage />);
    expect(html).toContain('<footer');
    expect(html).toContain('st-groups');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Checking provider status');
  });

  itStatus('renders maintenance distinctly from outages, with the service breakdown', () => {
    if (!StatusPage) return;
    const client = new QueryClient();
    client.setQueryData(queryKeys.status, {
      overall: 'maintenance',
      providers: [{
        id: 'torbox',
        name: 'TorBox',
        status: 'maintenance',
        latency: 689,
        detail: 'GPU transcoding maintenance',
        url: 'https://status.torbox.app',
        maintenance: true,
        note: 'GPU transcoding maintenance',
        services: [
          { section: 'Main Resources', name: 'API', status: 'operational', availability: 99.82 },
          { section: 'Main Resources', name: 'Transcoding', status: 'maintenance' },
        ],
      }],
    });
    const html = render(<StatusPage />, client);
    expect(html).toContain('st-card maintenance');
    expect(html).toContain('st-chip maintenance');
    expect(html).toContain('GPU transcoding maintenance');
    expect(html).toContain('Transcoding');
    expect(html).toContain('99.82%');
    expect(html).not.toContain('st-card down');
  });
});
