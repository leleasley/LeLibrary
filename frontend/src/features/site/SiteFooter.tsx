import { useFeatures, useProviderStatus } from '@/features/site/site-hooks';
import { FooterStatus } from '@/features/site/StatusPill';
import { useTranslation } from 'react-i18next';
import '@/features/site/site-footer.css';

// Shared site footer used by the plain surfaces that do not live under the
// route shell (server-rendered and route-level error pages). Matches the
// footer markup on the site pages so navigation is identical everywhere.
export function SiteFooter() {
  const { t } = useTranslation('common');
  const status = useProviderStatus(60000);
  const features = useFeatures();
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <a href="/" className="brand">
            <img src="/LeLibrary-128.png" alt="LeLibrary" />
            <span>LeLibrary</span>
          </a>
          <p>The Stremio &amp; Nuvio addon that organizes your TorBox, Real-Debrid, AllDebrid, and Premiumize libraries with rich TMDB metadata.</p>
          <div className="footer-social">
            <a href="https://github.com/leleasley/LeLibrary" target="_blank" rel="noopener">
              <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
              GitHub
            </a>
            <a href="https://discord.gg/E3XbsmuQ9E" target="_blank" rel="noopener">
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.41891.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.41891.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z" /></svg>
              Discord
            </a>
            <a href="https://www.reddit.com/r/LeLibrary/" target="_blank" rel="noopener">
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z" /></svg>
              Reddit
            </a>
          </div>
        </div>

        <div className="footer-col">
          <h2>{t('footer.product')}</h2>
          <ul>
            <li><a href="/">{t('footer.home')}</a></li>
            <li><a href="/configure">{t('footer.setups')}</a></li>
            <li><a href="/guide">{t('navigation.guide')}</a></li>
            {features?.releases === true && <li><a href="/releases">{t('navigation.releases')}</a></li>}
            <li><a href="/status">{t('navigation.status')}</a></li>
          </ul>
        </div>

        <div className="footer-col">
          <h2>{t('footer.legal')}</h2>
          <ul>
            <li><a href="/privacy">{t('footer.privacy')}</a></li>
            <li><a href="/supporters">{t('footer.supporters')}</a></li>
            <li><a href="https://github.com/leleasley/LeLibrary" target="_blank" rel="noopener">{t('footer.source')}</a></li>
            <li><a href="https://www.reddit.com/r/LeLibrary/" target="_blank" rel="noopener">{t('footer.community')}</a></li>
            <li><a href="https://discord.gg/E3XbsmuQ9E" target="_blank" rel="noopener">Discord</a></li>
          </ul>
          <FooterStatus status={status} />
        </div>
      </div>

      <div className="footer-bar">
        <span>&copy; 2026 LeLibrary. {t('footer.notAffiliated')}</span>
        <span>{t('footer.madeFor')} <a href="https://www.stremio.com" target="_blank" rel="noopener">Stremio</a> &amp; <a href="https://nuvio.tv" target="_blank" rel="noopener">Nuvio</a> {t('footer.communitySuffix')}</span>
      </div>
    </footer>
  );
}
