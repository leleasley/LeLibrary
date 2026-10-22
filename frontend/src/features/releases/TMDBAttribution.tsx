// TMDB attribution, required by the TMDB API terms. The official mark is used
// unmodified and kept smaller and visually quieter than LeLibrary's branding.
import { useTranslation } from 'react-i18next';

export function TMDBAttribution() {
  const { t } = useTranslation('site');
  return (
    <div className="rel-attribution">
      <img src="/logos/TMDB.svg" alt="TMDB" className="rel-tmdb-logo" width="90" height="20" />
      <p>{t('releases.tmdbAttribution')}</p>
    </div>
  );
}
