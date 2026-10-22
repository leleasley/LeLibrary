import { MemoryRouter } from 'react-router-dom';
import { AppProviders } from '@/app/providers';
import { AppRouter } from '@/app/router';
import { ErrorPage } from '@/features/site/ErrorPage';
import '@/app/app.css';
import '@/features/setup/setup.css';

// Server-rendered error pages serve the SPA shell with window.__ERROR_PAGE__
// injected; they bypass the router entirely (the failing URL is not an app
// route). The shared site banner uses router links, so the error page still
// needs a router context of its own.
const errorPageData = typeof window !== 'undefined' ? (window as any).__ERROR_PAGE__ ?? null : null;

export function App() {
  if (errorPageData) {
    const entry = typeof window !== 'undefined' ? window.location.pathname : '/';
    return (
      <MemoryRouter initialEntries={[entry]}>
        <ErrorPage />
      </MemoryRouter>
    );
  }
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
