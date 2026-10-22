import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MoviesTab } from '@/features/releases/MoviesTab';
import { TvTab } from '@/features/releases/TvTab';
import { SearchTab } from '@/features/releases/SearchTab';
import { TMDBAttribution } from '@/features/releases/TMDBAttribution';
import { useRegion } from '@/features/releases/use-region';
import '@/features/releases/releases.css';
import { PosterWall } from '@/features/setup/shared/tier/TierChrome';
import '@/features/setup/shared/tier/tier.css';
import { useTranslation } from 'react-i18next';
import { LocalizedCopy } from '@/i18n/LocalizedCopy';

type TabId = 'movies' | 'tv' | 'search';

const TABS: TabId[] = ['movies', 'tv', 'search'];

function asTab(value: string | null): TabId {
  return value === 'tv' || value === 'search' ? value : 'movies';
}

export function ReleasesPage() {
  const { t } = useTranslation('site');
  useEffect(() => { document.title = t('releases.documentTitle'); }, [t]);
  const { region, setRegion, regions } = useRegion();
  const [params, setParams] = useSearchParams();
  // The selected tab lives in the URL so returning from a title reopens the
  // same tab (and the link is shareable).
  const tab = asTab(params.get('tab'));
  const setTab = (next: TabId) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set('tab', next);
    setParams(nextParams, { replace: true });
  };

  // "/" jumps to search, the same reflex every searchable page trains. Typing
  // in a field keeps its own slash.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      event.preventDefault();
      const nextParams = new URLSearchParams(params);
      nextParams.set('tab', 'search');
      setParams(nextParams, { replace: true });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [params, setParams]);

  return (
    <LocalizedCopy><section className="rel-page rel-v2">
      <div className="rel-wall" aria-hidden="true"><PosterWall /></div>
      <header className="rel-header">
        <div>
          <span className="rel-eyebrow">{t('releases.label')}</span>
          <h1>{t('releases.headline')}</h1>
          <p className="rel-lede">{t('releases.lede')}</p>
        </div>
        <div className="rel-region" role="group" aria-label={t('releases.region')}>
          <span>{t('releases.region')}</span>
          <div className="rel-region-switch">
            {regions.map((code) => (
              <button
                key={code} type="button" aria-pressed={region === code}
                className={region === code ? 'is-active' : ''}
                onClick={() => setRegion(code === 'US' ? 'US' : 'GB')}
                data-i18n-preserve
              >
                {code}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="rel-tabs" role="tablist" aria-label={t('releases.views')}>
        {TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={tab === entry}
            className={tab === entry ? 'rel-tab is-active' : 'rel-tab'}
            onClick={() => setTab(entry)}
          >
            {t(`releases.${entry}`)}
          </button>
        ))}
      </div>

      {tab === 'movies' && <MoviesTab region={region} />}
      {tab === 'tv' && <TvTab region={region} />}
      {tab === 'search' && <SearchTab region={region} />}

      <TMDBAttribution />
    </section></LocalizedCopy>
  );
}
