import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchTitle, fetchSeasonEpisodes, type ReleaseMediaType, type SeasonSummary } from '@/api/releases';
import { queryKeys } from '@/api/query-keys';
import { ReleaseStatusBadge, EpisodeBadgeRow } from '@/features/releases/ReleaseBadge';
import { formatDate, relativeDay } from '@/features/releases/release-format';
import type { RegionCode } from '@/features/releases/use-region';
import { useTranslation } from 'react-i18next';

function DateStat({ label, date }: { label: string; date: string | null }) {
  const relative = relativeDay(date);
  return (
    <div className="rel-stat">
      <span className="rel-stat-label">{label}</span>
      <span className="rel-stat-value">{formatDate(date)}</span>
      {relative && <span className="rel-stat-hint">{relative}</span>}
    </div>
  );
}

function SeasonThumb({ src, eager }: { src: string | null; eager: boolean }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <span className="rel-season-thumb">
      {src
        ? <img
            src={src}
            alt=""
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            onLoad={() => setLoaded(true)}
          />
        : <span className="rel-season-thumb-empty" aria-hidden="true" />}
      {src && !loaded && <span className="rel-season-thumb-skeleton" aria-hidden="true" />}
    </span>
  );
}

function SeasonSection({ showId, season, index }: { showId: number; season: SeasonSummary; index: number }) {
  const { t } = useTranslation('site');
  const [open, setOpen] = useState(false);
  const episodesQuery = useQuery({
    queryKey: queryKeys.releasesSeason(showId, season.season),
    queryFn: ({ signal }) => fetchSeasonEpisodes({ id: showId, season: season.season, signal }),
    enabled: open,
    staleTime: 60 * 60 * 1000,
  });
  const episodes = episodesQuery.data?.episodes ?? [];

  return (
    <details className="rel-season" open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary>
        <SeasonThumb src={season.poster} eager={index < 6} />
        <span className="rel-season-text">
          <span className="rel-season-name">{season.name || (season.isSpecials ? t('releases.detail.specials') : t('releases.detail.season', { season: season.season }))}</span>
          <span className="rel-season-meta">
            {season.episodeCount !== null ? `${t('releases.detail.episodeCount', { count: season.episodeCount })} · ` : ''}
            {season.airDate ? formatDate(season.airDate) : t('releases.detail.dateTba')}
          </span>
        </span>
      </summary>
      {open && (
        <div className="rel-season-body">
          {episodesQuery.isLoading && <p className="rel-state">{t('releases.detail.loadingEpisodes')}</p>}
          {episodesQuery.isError && (
            <p className="rel-state rel-state-error">
              {t('releases.detail.seasonError')}{' '}
              <button type="button" className="rel-retry" onClick={() => void episodesQuery.refetch()}>{t('releases.retry')}</button>
            </p>
          )}
          {!episodesQuery.isLoading && !episodesQuery.isError && episodes.length === 0 && (
            <p className="rel-muted">{t('releases.detail.noEpisodes')}</p>
          )}
          {episodes.length > 0 && (
            <ul className="rel-episode-list">
              {episodes.map((episode) => (
                <li key={episode.id} className="rel-episode">
                  <span className="rel-episode-num">E{episode.episode}</span>
                  <span className="rel-episode-title">{episode.name ?? 'Untitled'}</span>
                  <EpisodeBadgeRow badges={episode.badges} />
                  <span className="rel-episode-meta">
                    {episode.runtime ? `${episode.runtime}m · ` : ''}{formatDate(episode.airDate)}
                  </span>
                  <ReleaseStatusBadge status={episode.status} date={episode.airDate} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}

export function TitleDetailPanel({ region, type, id }: { region: RegionCode; type: ReleaseMediaType; id: number }) {
  const { t } = useTranslation('site');
  const detailQuery = useQuery({
    queryKey: queryKeys.releasesTitle(region, type, id),
    queryFn: ({ signal }) => fetchTitle({ region, type, id, signal }),
    staleTime: 60 * 60 * 1000,
  });

  if (detailQuery.isLoading) {
    return (
      <div className="rel-detail" aria-busy="true">
        <div className="rel-hero rel-skeleton-hero">
          <span className="rel-skeleton rel-skeleton-poster" />
          <div className="rel-skeleton-lines">
            <span className="rel-skeleton rel-skeleton-line" />
            <span className="rel-skeleton rel-skeleton-line short" />
            <span className="rel-skeleton rel-skeleton-line" />
          </div>
        </div>
      </div>
    );
  }
  if (detailQuery.isError) {
    return (
      <p className="rel-state rel-state-error">
        {t('releases.detail.titleError')}{' '}
        <button type="button" className="rel-retry" onClick={() => void detailQuery.refetch()}>{t('releases.retry')}</button>
      </p>
    );
  }
  const detail = detailQuery.data;
  if (!detail) return <p className="rel-state">{t('releases.detail.notCached')}</p>;

  const relevantDate = detail.date;
  const numberedSeasons = detail.type === 'tv' ? detail.seasons.filter((season) => !season.isSpecials) : [];
  const specials = detail.type === 'tv' ? detail.seasons.filter((season) => season.isSpecials) : [];

  return (
    <article className="rel-detail">
      <div className="rel-hero">
        {detail.backdrop && <img className="rel-hero-bg" src={detail.backdrop} alt="" />}
        <div className="rel-hero-veil" aria-hidden="true" />
        <div className="rel-hero-content">
          <span className="rel-poster rel-poster-lg">
            {detail.poster
              ? <img src={detail.poster} alt="" />
              : <span className="rel-poster-empty" aria-hidden="true" />}
          </span>
          <div className="rel-hero-body">
            <span className="rel-eyebrow">
              {detail.type === 'movie' ? t('releases.detail.film') : t('releases.detail.series')}
              {detail.year ? ` · ${detail.year}` : ''}
            </span>
            <h1>{detail.title}</h1>
            <div className="rel-hero-badges">
              <ReleaseStatusBadge status={detail.status} date={relevantDate} />
              {detail.type === 'tv' && detail.showStatus && <span className="rel-chip">{detail.showStatus}</span>}
              {detail.type === 'tv' && detail.numberOfSeasons !== null && (
                <span className="rel-chip">{t('releases.detail.seasonCount', { count: detail.numberOfSeasons })}</span>
              )}
              {detail.type === 'tv' && detail.episodeRunTime ? <span className="rel-chip">{t('releases.detail.episodeRuntime', { minutes: detail.episodeRunTime })}</span> : null}
              {detail.type === 'tv' && detail.networks.slice(0, 2).map((network) => <span key={network} className="rel-chip">{network}</span>)}
              {detail.genres.slice(0, 4).map((genre) => <span key={genre} className="rel-chip">{genre}</span>)}
            </div>
            {detail.overview && <p className="rel-overview">{detail.overview}</p>}
          </div>
        </div>
      </div>

      {detail.type === 'movie' && (
        <dl className="rel-dates">
          <DateStat label={t('releases.detail.digital')} date={detail.digitalDate} />
          <DateStat label={t('releases.detail.cinema')} date={detail.theatricalDate} />
          <DateStat label={t('releases.detail.physical')} date={detail.physicalDate} />
        </dl>
      )}

      {detail.type === 'tv' && (
        <>
          <section className="rel-section">
            <h2>{t('releases.detail.episodes')}</h2>
            {detail.nextEpisode && detail.nextEpisode.airDate ? (
              <div className="rel-next-card">
                <span className="rel-next-date">{formatDate(detail.nextEpisode.airDate)}</span>
                <span className="rel-next-when">{relativeDay(detail.nextEpisode.airDate)}</span>
                <span className="rel-next-name">
                  {detail.nextEpisode.season !== null && detail.nextEpisode.episode !== null
                    ? `S${detail.nextEpisode.season}E${detail.nextEpisode.episode}`
                    : ''}
                  {detail.nextEpisode.name ? ` · ${detail.nextEpisode.name}` : ''}
                </span>
              </div>
            ) : (
              <p className="rel-muted">
                {detail.lastEpisode && detail.lastEpisode.airDate
                  ? t('releases.detail.lastAired', { date: formatDate(detail.lastEpisode.airDate), episode: detail.lastEpisode.season !== null ? ` (S${detail.lastEpisode.season}E${detail.lastEpisode.episode})` : '' })
                  : t('releases.detail.noEpisodeDates')}
              </p>
            )}
          </section>

          <section className="rel-section">
            <h2>{t('releases.detail.seasons')}</h2>
            {numberedSeasons.length === 0 && specials.length === 0 && <p className="rel-muted">{t('releases.detail.noSeasons')}</p>}
            <div className="rel-seasons">
              {numberedSeasons.map((season, index) => <SeasonSection key={season.season} showId={detail.id} season={season} index={index} />)}
            </div>
            {specials.length > 0 && (
              <>
                <h3 className="rel-subheading">{t('releases.detail.specials')}</h3>
                <div className="rel-seasons">
                  {specials.map((season) => <SeasonSection key={season.season} showId={detail.id} season={season} index={0} />)}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </article>
  );
}
