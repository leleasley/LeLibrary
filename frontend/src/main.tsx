import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { i18n, i18nReady } from '@/i18n';
import { preloadRoutes } from '@/app/router';
import { installSetupDomCopy } from '@/i18n/setup-dom-copy';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

installSetupDomCopy(container);

// A deploy renames every hashed file, so a tab opened before it can ask for a
// script or stylesheet that no longer exists. Vite reports that here before
// the router sees it: reload once for the new build (same 60s guard as the
// route error page, so a broken deploy cannot loop).
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem('ll-chunk-retry-at') || 0);
    if (Date.now() - last < 60000) return;
    sessionStorage.setItem('ll-chunk-retry-at', String(Date.now()));
    event.preventDefault();
    window.location.reload();
  } catch {
    // Storage unavailable: let the route error page offer a manual reload.
  }
});

const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

void i18nReady.then(async () => {
  // Load this URL's page before the first render (see preloadRoutes).
  await preloadRoutes(window.location.pathname).catch(() => undefined);
  // The prerendered home page is English. Hydrate it for English visitors;
  // any other language renders fresh over it instead of mismatching.
  const prerendered = container.hasChildNodes();
  const english = (i18n.resolvedLanguage ?? i18n.language ?? 'en').startsWith('en');
  if (prerendered && english) {
    hydrateRoot(container, app, {
      // A mismatch makes React silently redraw the page; say where, so it can
      // be fixed (the prerendered HTML should always match the first render).
      onRecoverableError(error, info) {
        console.error('[hydrate]', error instanceof Error ? error.message : error, info?.componentStack ?? '');
      },
    });
  }
  else createRoot(container).render(app);
});
