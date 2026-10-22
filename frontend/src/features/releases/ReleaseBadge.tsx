import type { EpisodeBadges, ReleaseStatus } from '@/api/releases';
import { isNearRelease, releaseLabel } from '@/features/releases/release-format';
import { useTranslation } from 'react-i18next';

export function ReleaseStatusBadge({ status, date }: { status: ReleaseStatus; date?: string | null }) {
  const label = releaseLabel(status, date ?? null);
  const near = isNearRelease(status, date ?? null);
  return <span className={`rel-badge rel-status-${status}${near ? ' is-near' : ''}`}>{label}</span>;
}

// Badges are optional decoration: when a title has none, render nothing at all
// rather than an empty row that still takes vertical space.
export function EpisodeBadgeRow({ badges }: { badges: EpisodeBadges }) {
  const { t } = useTranslation('site');
  if (!badges.seriesPremiere && !badges.seasonPremiere && !badges.finale) return null;
  return (
    <span className="rel-episode-badges">
      {badges.seriesPremiere && <span className="rel-badge rel-badge-premiere">{t('releases.seriesPremiere')}</span>}
      {badges.seasonPremiere && <span className="rel-badge rel-badge-premiere">{t('releases.seasonPremiere')}</span>}
      {badges.finale && <span className="rel-badge rel-badge-finale">{t('releases.finale')}</span>}
    </span>
  );
}
