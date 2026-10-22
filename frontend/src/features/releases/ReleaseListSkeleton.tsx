// Placeholder rows for the poster grid and the TV day list, so a slow load
// keeps the page's shape instead of collapsing to a line of text. The blocks
// are aria-hidden; the live region carries the announcement for screen readers.
import { useTranslation } from 'react-i18next';
import { LocalizedCopy } from '@/i18n/LocalizedCopy';

function SkeletonLines() {
  return (
    <span className="rel-skeleton-lines">
      <span className="rel-skeleton rel-skeleton-line" />
      <span className="rel-skeleton rel-skeleton-line short" />
    </span>
  );
}

export function ReleaseListSkeleton({ count = 6, label = 'Loading releases' }: { count?: number; label?: string }) {
  const { t } = useTranslation('site');
  return (
    <LocalizedCopy><>
      <ul className="rel-list" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <li className="rel-item rel-item-skeleton" key={index}>
            <span className="rel-poster rel-skeleton" />
            <SkeletonLines />
          </li>
        ))}
      </ul>
      <span className="rel-visually-hidden" role="status" aria-live="polite">{label === 'Loading releases' ? t('releases.loadingReleases') : label}</span>
    </></LocalizedCopy>
  );
}

export function DayListSkeleton({ count = 4, label = 'Loading episodes' }: { count?: number; label?: string }) {
  const { t } = useTranslation('site');
  return (
    <LocalizedCopy><>
      <ul className="rel-day-list" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <li className="rel-day-show rel-day-skeleton" key={index}>
            <span className="rel-day-skeleton-head">
              <span className="rel-poster rel-poster-sm rel-skeleton" />
              <SkeletonLines />
              <span className="rel-skeleton rel-skeleton-line short" />
            </span>
          </li>
        ))}
      </ul>
      <span className="rel-visually-hidden" role="status" aria-live="polite">{label === 'Loading episodes' ? t('releases.loadingEpisodes') : label}</span>
    </></LocalizedCopy>
  );
}
