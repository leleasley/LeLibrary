import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { TitleDetailPanel } from '@/features/releases/TitleDetailPanel';
import { useTranslation } from 'react-i18next';
import { LocalizedCopy } from '@/i18n/LocalizedCopy';
import { TMDBAttribution } from '@/features/releases/TMDBAttribution';
import { useRegion } from '@/features/releases/use-region';
import '@/features/releases/releases.css';

// Copies this title's URL, so "when is this out" can be answered with a link.
function CopyLinkButton() {
  const { t } = useTranslation('site');
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2400);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <LocalizedCopy><button type="button" className="rel-copy" onClick={() => void copy()} aria-live="polite">
      {state === 'copied' ? t('releases.linkCopied') : state === 'failed' ? t('releases.copyFailed') : t('releases.copyLink')}
    </button></LocalizedCopy>
  );
}

export function ReleaseDetailPage() {
  const { t } = useTranslation('site');
  const { type, id } = useParams();
  const [params] = useSearchParams();
  const { region } = useRegion();
  const parsedId = Number(id);
  const validType = type === 'movie' || type === 'tv';
  const valid = validType && Number.isInteger(parsedId) && parsedId > 0;

  // Return to the originating tab (and TV date) so leaving a detail does not
  // dump the user back on the Movies tab.
  const backParams = new URLSearchParams();
  const tab = params.get('tab');
  if (tab === 'movies' || tab === 'tv' || tab === 'search') backParams.set('tab', tab);
  const date = params.get('date');
  if (date) backParams.set('date', date);
  const backTo = `/releases${backParams.toString() ? `?${backParams.toString()}` : ''}`;

  return (
    <LocalizedCopy><section className="rel-page">
      <div className="rel-detail-bar">
        <p className="rel-back">
          <Link to={backTo}>&larr; {t('releases.back')}</Link>
        </p>
        {valid && <CopyLinkButton />}
      </div>
      {valid
        ? <TitleDetailPanel region={region} type={type === 'tv' ? 'tv' : 'movie'} id={parsedId} />
        : <p className="rel-state rel-state-error">{t('releases.invalidTitle')}</p>}
      <TMDBAttribution />
    </section></LocalizedCopy>
  );
}
