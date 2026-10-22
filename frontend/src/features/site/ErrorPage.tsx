import { useEffect } from 'react';
import { useRouteError } from 'react-router-dom';
import { SiteBanner } from '@/features/site/SiteBanner';
import { SiteFooter } from '@/features/site/SiteFooter';
import '@/features/site/error.css';
import { useTranslation } from 'react-i18next';

export interface ErrorPageData {
  code: number;
  title: string;
  desc: string;
}

// Server-rendered errors (rate limits, bad tokens, unknown routes) serve the
// SPA shell with window.__ERROR_PAGE__ injected; this page renders it without
// needing the router. Defaults mirror the legacy error.html fallbacks.
export function readErrorPageData(): ErrorPageData {
  const injected = (typeof window !== 'undefined' ? (window as any).__ERROR_PAGE__ : null) ?? {};
  return {
    code: typeof injected.code === 'number' ? injected.code : 500,
    title: typeof injected.title === 'string' ? injected.title : 'Something went wrong',
    desc: typeof injected.desc === 'string' ? injected.desc : 'An unexpected error occurred. Please try again.',
  };
}

function isChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /importing a module script|failed to fetch dynamically|loading chunk|chunkloaderror|dynamically imported module|unable to preload css/i.test(message);
}

// Client-side route errors (render crashes, failed lazy chunk loads after a
// deploy). Chunk failures auto-reload once — a fresh deploy ships new hashed
// assets, so the first load after release can reference stale chunks. The
// 60s guard stops any reload loop if the reload itself fails.
export function RouteErrorPage() {
  const { t } = useTranslation('common');
  const error = useRouteError();
  const chunk = isChunkError(error);

  useEffect(() => {
    document.title = `${t('errors.wentWrong')} | LeLibrary`;
    try {
      if (chunk) {
        const last = Number(sessionStorage.getItem('ll-chunk-retry-at') || 0);
        if (Date.now() - last > 60000) {
          sessionStorage.setItem('ll-chunk-retry-at', String(Date.now()));
          window.location.reload();
        }
      }
    } catch {
      // Storage unavailable (private mode): fall through to the manual UI.
    }
  }, [chunk, error, t]);

  function reload() {
    window.location.reload();
  }

  return (
    <>
      <SiteBanner />
      <section className="error-hero">
        <div className="grid-bg"></div>
        <div className="error-content">
          <div className="error-code">{chunk ? t('errors.updated') : <>{t('errors.codeLabel')} <b>500</b></>}</div>
          <h1 className="error-title">
            {chunk ? t('errors.newVersion') : t('errors.wentWrong')}
          </h1>
          <p className="error-desc">
            {chunk
              ? t('errors.staleFiles')
              : t('errors.savedSafe')}
          </p>
          <div className="error-actions">
          <button type="button" className="btn btn-amber" onClick={reload}>{t('errors.reload')}</button>
          <a className="btn btn-outline" href="/">{t('errors.goHomeTitle')}</a>
          </div>
        </div>
      </section>
      <SiteFooter />
    </>
  );
}

// The visual 404/error block on its own, for pages already inside the route
// shell (setup pages) or the client not-found route. A 404 shows the address
// that was tried; server errors point at the status page.
export function ErrorState({ code, title, desc }: ErrorPageData) {
  const { t } = useTranslation('common');
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  return (
    <section className="error-hero">
      <div className="grid-bg"></div>
      <div className="error-content">
        <div className="error-code">{t('errors.codeLabel')} <b>{code}</b></div>
        <h1 className="error-title">{title}</h1>
        <p className="error-desc">{desc}</p>
        {code === 404 && path && path !== '/' && <code className="error-path">{path}</code>}
        <div className="error-actions">
          <a className="btn btn-amber" href="/">{t('errors.goHomeTitle')}</a>
          <a className="btn btn-outline" href="/configure">{t('errors.configureAddon')}</a>
        </div>
        <nav className="error-links" aria-label={t('errors.helpfulLinks')}>
          <a href="/guide">{t('navigation.guide')}</a>
          {code >= 500 && <a href="/status">{t('errors.checkStatus')}</a>}
          <a href="https://discord.gg/E3XbsmuQ9E" target="_blank" rel="noopener">{t('errors.askDiscord')}</a>
        </nav>
      </div>
    </section>
  );
}

export function ErrorPage({ data }: { data?: ErrorPageData } = {}) {
  const { code, title, desc } = data ?? readErrorPageData();
  useEffect(() => {
    document.title = `${code} ${title} | LeLibrary`;
  }, [code, title]);
  return (
    <>
      <SiteBanner />
      <ErrorState code={code} title={title} desc={desc} />
      <SiteFooter />
    </>
  );
}
