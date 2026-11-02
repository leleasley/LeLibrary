import { formatSize, type LibraryStats } from '@/features/setup/library/library-api';
import { setupCopy } from '@/features/setup/shared/setup-copy';

// "At a glance" strip under the Library page counts: how big the library is,
// how much of it is 4K or HDR, and what arrived this week. Loaded after the
// summary so the page never waits on it.
export function LibraryGlance({ stats, language }: { stats: LibraryStats | null; language: string }) {
  if (!stats) return <div className="lib-glance is-loading" aria-hidden="true"><div /><div /><div /><div /></div>;
  if (stats.titles === 0) return null;
  const number = new Intl.NumberFormat(language);
  const percent = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 });
  const share = (count: number) => percent.format(stats.titles ? count / stats.titles : 0);
  return (
    <section className="lib-glance-wrap" aria-label="Library at a glance">
      <div className="lib-glance">
        <div className="lib-glance-tile">
          <strong>{formatSize(stats.sizeBytes, language) ?? '0 B'}</strong>
          <span>In your cloud</span>
        </div>
        <div className="lib-glance-tile">
          <strong>{number.format(stats.uhd)} <small>{share(stats.uhd)}</small></strong>
          <span>Titles in 4K</span>
          <i className="lib-glance-bar" style={{ width: share(stats.uhd) }} aria-hidden="true" />
        </div>
        <div className="lib-glance-tile">
          <strong>{number.format(stats.hdr)} <small>{share(stats.hdr)}</small></strong>
          <span>HDR &amp; Dolby Vision</span>
          <i className="lib-glance-bar is-hdr" style={{ width: share(stats.hdr) }} aria-hidden="true" />
        </div>
        <div className="lib-glance-tile">
          <strong>{number.format(stats.addedWeek)}</strong>
          <span>Added this week</span>
        </div>
      </div>
      {stats.recent.length > 0 && (
        <div className="lib-recent">
          <span className="lib-recent-label">{setupCopy('New this week', 'New this week')}</span>
          <div className="lib-recent-row">
            {stats.recent.map((item, index) => (
              <figure className="lib-recent-item" key={`${item.type}-${item.title}-${index}`} title={[item.title, item.year].filter(Boolean).join(' · ')}>
                {item.poster ? <img src={item.poster} alt="" loading="lazy" /> : <span className="lib-recent-blank" aria-hidden="true">{item.type === 'movie' ? '🎬' : '📺'}</span>}
                <figcaption data-i18n-preserve>{item.title}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
