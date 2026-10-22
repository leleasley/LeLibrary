import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchDay, fetchWeek, type DayShow } from '@/api/releases';
import { queryKeys } from '@/api/query-keys';
import { EpisodeBadgeRow } from '@/features/releases/ReleaseBadge';
import { DayListSkeleton } from '@/features/releases/ReleaseListSkeleton';
import { weekStartIso } from '@/features/releases/release-groups';
import { buildWeekStrip, weekStripDates } from '@/features/releases/tv-week';
import { todayIso, addDaysIso, formatAirDate, clampIso } from '@/features/releases/release-format';
import { useReleasesWindow } from '@/features/releases/use-releases-window';
import type { RegionCode } from '@/features/releases/use-region';
import { useTranslation } from 'react-i18next';
import { episodeCode, episodeLines } from '@/features/releases/episode-runs';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const STORAGE_KEY = 'll_releases_tv_filters';
const WEEK_DAYS = 7;
type Sort = 'popularity' | 'name';

interface Filters {
  notable: boolean;
  types: string[];
  language: string | null;
  sort: Sort;
}

const DEFAULT_FILTERS: Filters = { notable: true, types: [], language: null, sort: 'popularity' };

function readStoredFilters(): Filters {
  if (typeof window === 'undefined') return DEFAULT_FILTERS;
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, unknown>;
    return {
      notable: typeof raw['notable'] === 'boolean' ? raw['notable'] : true,
      types: Array.isArray(raw['types']) ? raw['types'].filter((value): value is string => typeof value === 'string') : [],
      language: typeof raw['language'] === 'string' ? raw['language'] : null,
      sort: raw['sort'] === 'name' ? 'name' : 'popularity',
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

// A day view is a list of what is on, not a poster wall: the poster, the show,
// its network, and every episode with its own title and badges. Nothing is
// hidden behind a click, so the whole row is the link.
function DayShowCard({ show, date }: { show: DayShow; date: string }) {
  const { t } = useTranslation('site');
  const lines = episodeLines(show.episodes);
  const episodeText = lines.map(episodeCode).join(', ');
  return (
    <li className="rel-day-show">
      <Link
        to={`/releases/tv/${show.id}?tab=tv&date=${date}`}
        className="rel-day-link"
        aria-label={`${show.title}, ${episodeText}`}
      >
        <span className="rel-poster rel-poster-sm">
          {show.poster
            ? <img src={show.poster} alt="" loading="lazy" />
            : <span className="rel-poster-empty" aria-hidden="true" />}
        </span>
        <span className="rel-day-text">
          <span className="rel-day-title">{show.title}</span>
          {(show.network || show.showType) && (
            <span className="rel-day-sub">{[show.network, show.showType].filter(Boolean).join(' · ')}</span>
          )}
          <span className="rel-day-eps">
            {lines.map((line) => (line.kind === 'single' ? (
              <span className="rel-day-ep-row" key={`${line.episode.season}:${line.episode.episode}`}>
                <span className="rel-day-ep">{episodeCode(line)}</span>
                {line.episode.name && <span className="rel-day-epname">{line.episode.name}</span>}
                <EpisodeBadgeRow badges={line.episode.badges} />
              </span>
            ) : (
              <span className="rel-day-ep-row is-run" key={`${line.season}:${line.from}-${line.to}`}>
                <span className="rel-day-ep">{episodeCode(line)}</span>
                <span className="rel-day-epname">{t('releases.episodeRun', { count: line.count })}</span>
                <EpisodeBadgeRow badges={line.badges} />
              </span>
            )))}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function TvTab({ region }: { region: RegionCode }) {
  const { t } = useTranslation('site');
  const { loaded, minDate, maxDate } = useReleasesWindow();
  const [params, setParams] = useSearchParams();
  const today = todayIso();
  const stored = useMemo(readStoredFilters, []);
  const [filters, setFilters] = useState<Filters>(stored);

  const raw = params.get('date');
  const date = raw && ISO.test(raw) ? clampIso(raw, minDate, maxDate) : today;

  // URL wins over localStorage on first load (shareable links).
  useEffect(() => {
    const next: Filters = { ...filters };
    let changed = false;
    if (params.has('notable')) { next.notable = params.get('notable') !== 'false'; changed = true; }
    if (params.has('type')) { next.types = params.get('type')!.split(',').filter(Boolean); changed = true; }
    if (params.has('language')) { next.language = params.get('language'); changed = true; }
    if (params.has('sort')) { next.sort = params.get('sort') === 'name' ? 'name' : 'popularity'; changed = true; }
    if (changed) setFilters(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const writeState = (nextFilters: Filters, nextDate: string) => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextFilters)); } catch { /* storage disabled */ }
    const nextParams = new URLSearchParams(params);
    nextParams.set('tab', 'tv');
    nextParams.set('date', nextDate);
    nextParams.set('notable', nextFilters.notable ? 'true' : 'false');
    if (nextFilters.types.length) nextParams.set('type', nextFilters.types.join(','));
    else nextParams.delete('type');
    if (nextFilters.language) nextParams.set('language', nextFilters.language);
    else nextParams.delete('language');
    nextParams.set('sort', nextFilters.sort);
    setParams(nextParams, { replace: true });
  };

  const apply = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    writeState(next, date);
  };
  const setDate = (next: string) => {
    const clamped = clampIso(next, minDate, maxDate);
    writeState(filters, clamped);
  };

  // Arrow keys walk the calendar like every other date view. Typing in a field
  // keeps its normal cursor behaviour.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      event.preventDefault();
      setDate(addDaysIso(date, event.key === 'ArrowLeft' ? -1 : 1));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // setDate closes over the current filters and URL, so the listener follows them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, filters, params, minDate, maxDate]);

  const dayQuery = useQuery({
    queryKey: [...queryKeys.releasesDay(region, date), filters.notable, filters.types.join('|'), filters.language, filters.sort],
    queryFn: ({ signal }) => fetchDay({
      region, date,
      sort: filters.sort,
      language: filters.language,
      types: filters.types,
      notable: filters.notable,
      signal,
    }),
    staleTime: 5 * 60 * 1000,
  });

  // The strip covers the week being viewed, so stepping inside a week reuses one
  // request and the counts behave like the list beside them.
  const weekFrom = weekStartIso(date);
  const weekQuery = useQuery({
    queryKey: [...queryKeys.releasesWeek(region, weekFrom), filters.notable, filters.types.join('|'), filters.language],
    queryFn: ({ signal }) => fetchWeek({
      region,
      from: weekFrom,
      days: WEEK_DAYS,
      language: filters.language,
      types: filters.types,
      notable: filters.notable,
      signal,
    }),
    staleTime: 5 * 60 * 1000,
  });

  const stripCounts = useMemo(() => {
    const counts: Record<string, { total: number; premieres: number }> = {};
    for (const day of weekQuery.data?.days ?? []) counts[day.date] = { total: day.total, premieres: day.premieres };
    return counts;
  }, [weekQuery.data]);

  const strip = loaded
    ? buildWeekStrip(weekStripDates(date, minDate, maxDate), stripCounts, date, today)
    : [];

  const data = dayQuery.data;
  const typeFacets = data ? Object.entries(data.facets.types).sort((a, b) => b[1] - a[1]) : [];
  const languageFacets = data ? Object.entries(data.facets.languages).sort((a, b) => b[1] - a[1]) : [];
  const premieres = data ? data.shows.filter((show) => show.premiereDay) : [];
  const rest = data ? data.shows.filter((show) => !show.premiereDay) : [];
  const isFiltered = !filters.notable || filters.types.length > 0 || filters.language !== null;

  return (
    <div className="rel-panel">
      {strip.length > 0 && (
        <div className="rel-week" role="group" aria-label={t('releases.daysInWeek')}>
          {strip.map((cell, index) => {
            const showMonth = index === 0 || strip[index - 1]?.month !== cell.month;
            const label = `${cell.isToday ? `${t('releases.today')}, ` : ''}${cell.weekday} ${cell.day} ${cell.month}, ${t('releases.showCount', { count: cell.total })}`
              + (cell.premieres ? `, ${t('releases.premiereCount', { count: cell.premieres })}` : '');
            return (
              <button
                key={cell.date}
                type="button"
                className={`rel-week-day${cell.isSelected ? ' is-active' : ''}${cell.isToday ? ' is-today' : ''}${cell.total === 0 ? ' is-empty' : ''}`}
                aria-pressed={cell.isSelected}
                aria-label={label}
                title={label}
                onClick={() => setDate(cell.date)}
              >
                <span className="rel-week-weekday">{cell.weekday}</span>
                <span className="rel-week-num">
                  {cell.day}
                  {showMonth && <span className="rel-week-month"> {cell.month}</span>}
                </span>
                <span className="rel-week-count">
                  {cell.total}
                  {cell.premieres > 0 && <span className="rel-week-dot" aria-hidden="true" />}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="rel-controls">
        <button type="button" className="rel-day-btn" onClick={() => setDate(addDaysIso(date, -1))} disabled={date <= minDate} aria-label={t('releases.previousDay')}>‹</button>
        <label className="rel-field rel-field-inline">
          <span>{t('releases.day')}</span>
          <input type="date" value={date} min={minDate} max={maxDate} onChange={(event) => setDate(event.target.value)} />
        </label>
        <button type="button" className="rel-day-btn" onClick={() => setDate(addDaysIso(date, 1))} disabled={date >= maxDate} aria-label={t('releases.nextDay')}>›</button>
        {date !== today && <button type="button" className="rel-today-btn" onClick={() => setDate(today)}>{t('releases.today')}</button>}
        {data && (
          <span className="rel-window-hint">
            {formatAirDate(date)} · {t('releases.showingCount', { shown: data.total, total: data.totalAll })}
            {isFiltered && <> · <button type="button" className="rel-linkbtn" onClick={() => apply({ notable: false, types: [], language: null })}>{t('releases.showAll')}</button></>}
          </span>
        )}
      </div>

      <div className="rel-chips" role="group" aria-label={t('releases.filters')}>
        <button type="button" className={filters.notable ? 'rel-chip is-active' : 'rel-chip'} aria-pressed={filters.notable} onClick={() => apply({ notable: true })}>{t('releases.notable')}</button>
        <button type="button" className={!filters.notable ? 'rel-chip is-active' : 'rel-chip'} aria-pressed={!filters.notable} onClick={() => apply({ notable: false })}>{t('releases.all')}</button>
        <span className="rel-chip-sep" aria-hidden="true" />
        <button
          type="button"
          className={filters.sort === 'popularity' ? 'rel-chip is-active' : 'rel-chip'}
          aria-pressed={filters.sort === 'popularity'}
          onClick={() => apply({ sort: 'popularity' })}
        >
          {t('releases.popularity')}
        </button>
        <button
          type="button"
          className={filters.sort === 'name' ? 'rel-chip is-active' : 'rel-chip'}
          aria-pressed={filters.sort === 'name'}
          onClick={() => apply({ sort: 'name' })}
        >
          A-Z
        </button>
        {typeFacets.length > 0 && <span className="rel-chip-sep" aria-hidden="true" />}
        {typeFacets.map(([type, count]) => (
          <button
            key={type}
            type="button"
            className={filters.types.includes(type) ? 'rel-chip is-active' : 'rel-chip'}
            aria-pressed={filters.types.includes(type)}
            onClick={() => apply({ types: filters.types.includes(type) ? filters.types.filter((t) => t !== type) : [...filters.types, type] })}
          >
            {type} <span className="rel-chip-count">{count}</span>
          </button>
        ))}
        {languageFacets.length > 1 && <span className="rel-chip-sep" aria-hidden="true" />}
        {languageFacets.map(([language, count]) => (
          <button
            key={language}
            type="button"
            className={filters.language === language ? 'rel-chip is-active' : 'rel-chip'}
            aria-pressed={filters.language === language}
            onClick={() => apply({ language: filters.language === language ? null : language })}
          >
            {language === 'unknown' ? t('releases.other') : language.toUpperCase()} <span className="rel-chip-count">{count}</span>
          </button>
        ))}
      </div>

      {dayQuery.isLoading && <DayListSkeleton />}
      {dayQuery.isError && (
        <p className="rel-state rel-state-error">
          {t('releases.dayError')}{' '}
          <button type="button" className="rel-retry" onClick={() => void dayQuery.refetch()}>{t('releases.retry')}</button>
        </p>
      )}
      {data && data.shows.length === 0 && <p className="rel-state">{t('releases.nothingAiring')}</p>}

      {data && premieres.length > 0 && (
        <>
          <h3 className="rel-subheading">{t('releases.premieresFinales')}</h3>
          <ul className="rel-day-list">{premieres.map((show) => <DayShowCard key={show.id} show={show} date={date} />)}</ul>
        </>
      )}
      {data && rest.length > 0 && (
        <>
          {premieres.length > 0 && <h3 className="rel-subheading">{t('releases.alsoOn', { date: formatAirDate(date) })}</h3>}
          <ul className="rel-day-list">{rest.map((show) => <DayShowCard key={show.id} show={show} date={date} />)}</ul>
        </>
      )}
    </div>
  );
}
