import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { checkedProviders, statusClass, statusLabel, useFeatures, useProviderStatus } from '@/features/site/site-hooks';
import { useTranslation } from 'react-i18next';

// The single top banner for the whole application: brand, section nav, a live
// provider status pill and the GitHub link. Rendered by the route shell, so
// every page shares it and the old per-page topbars are gone.
export function SiteBanner() {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const status = useProviderStatus(60000);
  const features = useFeatures();
  const releasesEnabled = features?.releases === true;
  const overall = status ? statusClass(status.overall) : 'unknown';
  const counted = status ? checkedProviders(status.providers) : [];
  const count = status ? `${counted.filter((p) => p.status === 'operational').length}/${counted.length}` : '–';
  // The per-service tooltip is added after the first render, so the server's
  // HTML (which only carries the count) and React's first render match.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const title = mounted && status
    ? status.providers.map((p) => `${p.name}: ${statusLabel(p.status)}`).join(' · ')
    : 'Provider status';

  return (
    <header className="banner">
      <Link to="/" className="banner-brand" onClick={() => setOpen(false)}>
        <img src="/LeLibrary-128.png" alt="LeLibrary" className="banner-logo" />
        <span>LeLibrary</span>
      </Link>
      <nav className="banner-links" aria-label={t('navigation.primary')}>
        <NavLink to="/configure">{t('navigation.configure')}</NavLink>
        <NavLink to="/guide">{t('navigation.guide')}</NavLink>
        {releasesEnabled && <NavLink to="/releases">{t('navigation.releases')}</NavLink>}
        <NavLink to="/status">{t('navigation.status')}</NavLink>
        <NavLink to="/supporters">{t('navigation.supporters')}</NavLink>
        <NavLink to="/privacy">{t('navigation.privacy')}</NavLink>
      </nav>
      <div className="banner-right">
        {/* data-boot markers: the server fills these in on the prerendered home
            page (platform/boot-html.ts), so keep their structure fixed. */}
        <Link to="/status" className={`banner-pill ${overall}`} title={title} data-boot="pill">
          <span className="banner-dot"></span>
          <span data-boot="pill-count">{count}</span>
        </Link>
        <a href="https://discord.gg/E3XbsmuQ9E" target="_blank" rel="noopener" className="banner-icon-btn" aria-label="Discord">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z" /></svg>
        </a>
        <a href="https://www.reddit.com/r/LeLibrary/" target="_blank" rel="noopener" className="banner-icon-btn" aria-label="Reddit">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z" /></svg>
        </a>
        <a href="https://github.com/leleasley/LeLibrary" target="_blank" rel="noopener" className="banner-icon-btn" aria-label="GitHub">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
        </a>
        <button
          className={open ? 'banner-burger open' : 'banner-burger'}
          onClick={() => setOpen((v) => !v)}
          aria-label={t('navigation.menu')}
          aria-expanded={open}
          aria-controls="banner-mobile-menu"
        >
          <span></span><span></span><span></span>
        </button>
      </div>
      {open && (
        <nav className="banner-menu" id="banner-mobile-menu" aria-label={t('navigation.mobile')}>
          <NavLink to="/configure" onClick={() => setOpen(false)}>{t('navigation.configure')}</NavLink>
          <NavLink to="/guide" onClick={() => setOpen(false)}>{t('navigation.guide')}</NavLink>
          {releasesEnabled && <NavLink to="/releases" onClick={() => setOpen(false)}>{t('navigation.releases')}</NavLink>}
          <NavLink to="/status" onClick={() => setOpen(false)}>{t('navigation.status')}</NavLink>
          <NavLink to="/supporters" onClick={() => setOpen(false)}>{t('navigation.supporters')}</NavLink>
          <NavLink to="/privacy" onClick={() => setOpen(false)}>{t('navigation.privacy')}</NavLink>
          {/* The header hides these icons on narrow phones; they live here instead. */}
          <div className="banner-menu-social">
            <a href="https://discord.gg/E3XbsmuQ9E" target="_blank" rel="noopener">Discord ↗</a>
            <a href="https://www.reddit.com/r/LeLibrary/" target="_blank" rel="noopener">Reddit ↗</a>
            <a href="https://github.com/leleasley/LeLibrary" target="_blank" rel="noopener">GitHub ↗</a>
          </div>
        </nav>
      )}
    </header>
  );
}
