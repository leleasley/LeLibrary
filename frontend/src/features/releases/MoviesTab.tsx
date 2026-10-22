import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchMovies } from '@/api/releases';
import { queryKeys } from '@/api/query-keys';
import { ReleaseCard } from '@/features/releases/ReleaseCard';
import { ReleaseListSkeleton } from '@/features/releases/ReleaseListSkeleton';
import { groupByWeek } from '@/features/releases/release-groups';
import {
  RANGE_PRESETS,
  activePreset,
  clampRange,
  initialRange,
  normalizeRange,
  presetRange,
  writeStoredRange,
  type MovieRange,
  type RangeBounds,
} from '@/features/releases/movie-range';
import { formatDate, todayIso } from '@/features/releases/release-format';
import { useReleasesWindow } from '@/features/releases/use-releases-window';
import type { RegionCode } from '@/features/releases/use-region';
import { useTranslation } from 'react-i18next';
import { LocalizedCopy } from '@/i18n/LocalizedCopy';

export function MoviesTab({ region }: { region: RegionCode }) {
  const { t } = useTranslation('site');
  const { loaded, minDate, maxDate } = useReleasesWindow();
  const [params, setParams] = useSearchParams();
  const bounds = (): RangeBounds => ({ today: todayIso(), minDate, maxDate });

  // The range comes from the URL first, then the last saved choice, then the
  // default preset. Nothing is requested before the cached window is known, so
  // the first call can never ask for a range the server has not synced.
  const urlRange = useMemo(
    () => normalizeRange(params.get('from'), params.get('to'), { today: todayIso(), minDate, maxDate }),
    [params, minDate, maxDate],
  );
  const savedRange = useMemo(
    () => (loaded ? initialRange({ today: todayIso(), minDate, maxDate }) : null),
    [loaded, minDate, maxDate],
  );
  const range = urlRange ?? savedRange;

  // A resolved range goes into the URL so the view is shareable and a reload
  // opens the same dates.
  useEffect(() => {
    if (!loaded || urlRange || !savedRange) return;
    const next = new URLSearchParams(params);
    next.set('tab', 'movies');
    next.set('from', savedRange.from);
    next.set('to', savedRange.to);
    setParams(next, { replace: true });
  }, [loaded, urlRange, savedRange, params, setParams]);

  const setRange = (next: MovieRange) => {
    const clamped = clampRange(next, { minDate, maxDate });
    writeStoredRange(clamped);
    const nextParams = new URLSearchParams(params);
    nextParams.set('tab', 'movies');
    nextParams.set('from', clamped.from);
    nextParams.set('to', clamped.to);
    setParams(nextParams, { replace: true });
  };

  const movieQuery = useInfiniteQuery({
    queryKey: queryKeys.releasesMovies(region, range?.from ?? '', range?.to ?? ''),
    queryFn: ({ pageParam, signal }) => {
      if (!range) return Promise.reject(new Error('The releases window is not ready yet'));
      return fetchMovies({ region, from: range.from, to: range.to, page: pageParam, signal });
    },
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled: loaded && range !== null,
    staleTime: 5 * 60 * 1000,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage, refetch, isError, isLoading } = movieQuery;
  const items = useMemo(() => movieQuery.data?.pages.flatMap((page) => page.results) ?? [], [movieQuery.data]);
  const groups = useMemo(() => groupByWeek(items, todayIso()), [items]);
  const total = movieQuery.data?.pages[0]?.total ?? 0;
  const preset = range ? activePreset(range, bounds()) : null;

  // Infinite scroll: the sentinel loads the next page as it approaches the
  // viewport, and the button below it stays as the keyboard and no-JS path.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = isFetchingNextPage; }, [isFetchingNextPage]);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !busyRef.current) void fetchNextPage();
    }, { rootMargin: '600px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, fetchNextPage, items.length]);

  return (
    <LocalizedCopy><div className="rel-panel">
      <div className="rel-chips" role="group" aria-label={t('releases.quickRanges')}>
        {RANGE_PRESETS.map((option) => {
          const isActive = preset === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={isActive ? 'rel-chip is-active' : 'rel-chip'}
              aria-pressed={isActive}
              onClick={() => setRange(presetRange(option.id, bounds()))}
            >
              {t(`releases.range.${option.id}`, { defaultValue: option.label })}
            </button>
          );
        })}
      </div>

      <div className="rel-controls">
        <label className="rel-field">
          <span>{t('releases.from')}</span>
          <input
            type="date"
            value={range?.from ?? ''}
            min={minDate}
            max={range?.to ?? maxDate}
            onChange={(event) => { if (range) setRange({ from: event.target.value, to: range.to }); }}
          />
        </label>
        <label className="rel-field">
          <span>{t('releases.to')}</span>
          <input
            type="date"
            value={range?.to ?? ''}
            min={range?.from ?? minDate}
            max={maxDate}
            onChange={(event) => { if (range) setRange({ from: range.from, to: event.target.value }); }}
          />
        </label>
        <span className="rel-window-hint">{t('releases.trackedUntil', { date: formatDate(maxDate) })}</span>
      </div>

      {(!loaded || isLoading) && <ReleaseListSkeleton />}

      {loaded && isError && (
        <p className="rel-state rel-state-error">
          {t('releases.loadError')}{' '}
          <button type="button" className="rel-retry" onClick={() => void refetch()}>{t('releases.retry')}</button>
        </p>
      )}

      {loaded && !isLoading && !isError && total === 0 && (
        <p className="rel-state">{t('releases.emptyMovies')}</p>
      )}

      {loaded && groups.map((group) => (
        <section className="rel-group" key={group.key}>
          <h3 className="rel-group-head">{group.label}</h3>
          <ul className="rel-list">
            {group.items.map((item) => (
              <ReleaseCard key={`${item.type}:${item.id}`} item={item} from="movies" />
            ))}
          </ul>
        </section>
      ))}

      {loaded && groups.length > 0 && (
        <div className="rel-more">
          {hasNextPage ? (
            <button
              type="button"
              className="rel-more-btn"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? t('releases.loadingMore') : t('releases.loadMore', { shown: items.length, total })}
            </button>
          ) : (
            <span className="rel-more-done">{t('releases.count', { count: total })}</span>
          )}
          <div ref={sentinelRef} className="rel-sentinel" aria-hidden="true" />
        </div>
      )}
    </div></LocalizedCopy>
  );
}
