import { Link } from 'react-router-dom';
import type { ReleaseListItem } from '@/api/releases';
import { ReleaseStatusBadge } from '@/features/releases/ReleaseBadge';
import { formatDate, isOutToday, relativeWhen } from '@/features/releases/release-format';
import { useTranslation } from 'react-i18next';

// One poster card used by Movies and Search so they stay consistent. Always
// shows a date (falling back to "Date unknown"), a relative hint when the date
// is close enough for one to be useful, and a status badge. `from` carries the
// originating tab so the detail page can return to it.
export function ReleaseCard({ item, from }: { item: ReleaseListItem; from?: string }) {
  const { t } = useTranslation('site');
  const params = new URLSearchParams();
  if (from) params.set('tab', from);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const when = relativeWhen(item.date);
  const outToday = isOutToday(item.status, item.date);
  return (
    <li className={outToday ? 'rel-item is-today' : 'rel-item'}>
      <Link to={`/releases/${item.type}/${item.id}${suffix}`} className="rel-item-link" aria-label={t('releases.titleDetails', { title: item.title })}>
        <span className="rel-poster">
          {item.poster
            ? <img src={item.poster} alt="" loading="lazy" />
            : <span className="rel-poster-empty" aria-hidden="true" />}
          <span className="rel-poster-badge"><ReleaseStatusBadge status={item.status} date={item.date} /></span>
          {when && <span className="rel-item-when">{when}</span>}
        </span>
        <span className="rel-item-body">
          <span className="rel-item-title">{item.title}</span>
          <span className="rel-item-meta">
            {item.year ? `${item.year} · ` : ''}{item.type === 'tv' ? t('releases.detail.series') : t('releases.detail.film')}
          </span>
          <span className="rel-item-meta rel-item-date">
            {t('releases.dateLabel')}: {formatDate(item.date)}
          </span>
        </span>
      </Link>
    </li>
  );
}
