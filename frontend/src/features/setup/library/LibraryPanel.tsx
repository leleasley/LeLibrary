import { useCallback, useEffect, useRef, useState } from 'react';
import { i18n } from '@/i18n';
import { apiErrorCopy } from '@/api/error-copy';
import { toast } from '@/features/setup/shared/Toast';
import { setupCopy, setupCount } from '@/features/setup/shared/setup-copy';
import {
  episodeLabel, fetchLibraryItems, fetchLibrarySummary, fetchSeasonEpisodes, fetchShowSeasons, fixItem, formatSize,
  episodeOptionLabel, ignoreItem, parsedEpisode, retryMatching, searchSeed, searchTmdb, undoFix,
  type FixMediaType, type LibraryItem, type LibrarySummary, type LibraryView, type SeasonEpisode, type ShowSeason, type TmdbChoice,
} from '@/features/setup/library/library-api';
import './library.css';

// The Library tab of the setup edit page: what LeLibrary found in this
// setup's own debrid library, why anything is missing, and an owner fix for
// it. Reads only the server's index of the setup's own files.

const PROVIDER_NAMES: Record<string, string> = { torbox: 'TorBox', realdebrid: 'Real-Debrid', alldebrid: 'AllDebrid', premiumize: 'Premiumize' };
const KIND_LABELS: Record<string, string> = { torrent: 'Torrent', usenet: 'Usenet', webdl: 'Web download' };
const REASONS: Record<string, string> = {
  'no-candidate': 'TMDB has no title that matches this name.',
  'ambiguous-candidate': 'More than one title fits, so LeLibrary did not guess.',
  'season-missing': 'The show was found, but not this season.',
  unparseable: 'LeLibrary could not read a title from the file name.',
  'meta-build-failed': 'The title was found but its details could not be loaded.',
  'manual-fix-unavailable': 'Your fix could not be loaded from TMDB. Try fixing it again.',
  'search-unavailable': 'TMDB did not answer. LeLibrary will try again later.',
  'lookup-error': 'TMDB did not answer. LeLibrary will try again later.',
  other: 'It could not be matched safely.',
};

function language(): string {
  return i18n.resolvedLanguage ?? i18n.language ?? 'en';
}

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const minutes = Math.round((then - Date.now()) / 60000);
  const rtf = new Intl.RelativeTimeFormat(language(), { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: 'warn' | 'muted' | undefined }) {
  return (
    <div className={`lib-stat${tone ? ` is-${tone}` : ''}`}>
      <strong>{new Intl.NumberFormat(language()).format(value)}</strong>
      <span>{label}</span>
    </div>
  );
}

function FileMeta({ item }: { item: LibraryItem }) {
  const parts = [
    PROVIDER_NAMES[item.provider] ?? item.provider,
    item.kind ? KIND_LABELS[item.kind] ?? item.kind : null,
    formatSize(item.size, language()),
    episodeLabel(item),
  ].filter(Boolean) as string[];
  return (
    <div className="lib-meta">
      {parts.map((part) => <span key={part} data-i18n-preserve={/^S\d/.test(part) || /\d/.test(part) ? '' : undefined}>{part}</span>)}
    </div>
  );
}

// What a hash-named item or pack folder actually contains.
function Inside({ item }: { item: LibraryItem }) {
  if (!item.inner) return null;
  return (
    <p className="lib-inner">
      <span>Inside:</span> <code data-i18n-preserve>{item.inner}</code>
      {item.innerCount > 0 && <span className="lib-inner-more">+ {setupCount(item.innerCount, 'more file', 'more files')}</span>}
    </p>
  );
}

function FixDialog({ uuid, editToken, item, onClose, onFixed }: {
  uuid: string;
  editToken: string;
  item: LibraryItem;
  onClose: () => void;
  onFixed: () => void;
}) {
  const startsAsShow = item.mediaType === 'series' || item.mediaType === 'anime' || item.season != null;
  const [type, setType] = useState<'movie' | 'tv'>(startsAsShow ? 'tv' : 'movie');
  const [query, setQuery] = useState(() => searchSeed(item));
  const [results, setResults] = useState<TmdbChoice[] | null>(null);
  const [picked, setPicked] = useState<TmdbChoice | null>(null);
  // Season/episode the item's names imply, used to pre-select the pickers.
  const implied = parsedEpisode(item.season != null ? null : item.name, item.season != null ? null : item.inner);
  const impliedSeason = item.season ?? implied.season;
  const impliedEpisode = item.episode ?? (item.season != null ? null : implied.episode);
  const isRange = item.seasonStart != null && item.seasonEnd != null && item.seasonEnd > item.seasonStart;
  const isPack = item.innerCount > 0;
  const [seasons, setSeasons] = useState<ShowSeason[] | null>(null);
  const [episodes, setEpisodes] = useState<SeasonEpisode[] | null>(null);
  // 'keep' = the season range the file name already says (multi-season packs).
  const [season, setSeason] = useState<'keep' | number | null>(isRange ? 'keep' : impliedSeason);
  // 'whole' = a whole-season pack.
  const [episode, setEpisode] = useState<'whole' | number>(impliedEpisode ?? 'whole');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape' && !busy) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function search(event?: React.FormEvent) {
    event?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    setPicked(null);
    try {
      const out = await searchTmdb(uuid, editToken, { q, type });
      setResults(out.results);
      if (out.results.length === 1) setPicked(out.results[0] ?? null);
    } catch (err) {
      setError(apiErrorCopy(err, setupCopy('TMDB search failed. Try again.', 'TMDB search failed. Try again.')));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setSeasons(null);
    setEpisodes(null);
    if (!picked || picked.type !== 'tv') return;
    let cancelled = false;
    fetchShowSeasons(uuid, editToken, picked.tmdbId)
      .then((out) => {
        if (cancelled) return;
        setSeasons(out.seasons);
        // Keep the implied season if the show has it, else its first season.
        setSeason((current) => {
          if (current === 'keep') return current;
          if (current != null && out.seasons.some((s) => s.number === current)) return current;
          return out.seasons.find((s) => s.number > 0)?.number ?? out.seasons[0]?.number ?? null;
        });
      })
      .catch(() => { if (!cancelled) setSeasons([]); });
    return () => { cancelled = true; };
  }, [picked, uuid, editToken]);

  useEffect(() => {
    setEpisodes(null);
    if (!picked || picked.type !== 'tv' || typeof season !== 'number') return;
    let cancelled = false;
    fetchSeasonEpisodes(uuid, editToken, picked.tmdbId, season)
      .then((out) => {
        if (cancelled) return;
        setEpisodes(out.episodes);
        setEpisode((current) => (current === 'whole' || out.episodes.some((e) => e.number === current) ? current : 'whole'));
      })
      .catch(() => { if (!cancelled) setEpisodes([]); });
    return () => { cancelled = true; };
  }, [picked, season, uuid, editToken]);

  useEffect(() => {
    if (query.trim()) void search();
    // Only on open and when the type changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  async function save() {
    if (!picked) return;
    const isMovie = picked.type === 'movie';
    const seasonNumber = typeof season === 'number' ? season : null;
    const episodeNumber = seasonNumber !== null && typeof episode === 'number' ? episode : null;
    if (!isMovie && season !== 'keep' && seasonNumber === null) {
      setError(setupCopy('Choose a season.', 'Choose a season.'));
      return;
    }
    const mediaType: FixMediaType = isMovie ? 'movie' : picked.anime ? 'anime' : 'series';
    setBusy(true);
    setError(null);
    try {
      await fixItem(uuid, editToken, item.id, {
        tmdbId: picked.tmdbId, mediaType,
        season: isMovie ? null : seasonNumber,
        episode: isMovie ? null : episodeNumber,
      });
      toast(setupCopy('Fixed. It shows in Stremio and Nuvio after their next refresh.', 'Fixed. It shows in Stremio and Nuvio after their next refresh.'));
      onFixed();
    } catch (err) {
      setError(apiErrorCopy(err, setupCopy('Could not save the fix. Try again.', 'Could not save the fix. Try again.')));
      setBusy(false);
    }
  }

  return (
    <div className="app-modal lib-fix-modal" role="dialog" aria-modal="true" aria-labelledby="lib-fix-title" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="app-modal-box lib-fix-box">
        <div className="app-modal-head">
          <h3 id="lib-fix-title">{item.status === 'matched' ? 'Change this match' : 'Fix this match'}</h3>
          <button type="button" className="eye-btn" aria-label="Close" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <div className="lib-fix-file">
          <code className="lib-file" data-i18n-preserve>{item.name}</code>
          <Inside item={item} />
        </div>

        <div className="lib-type" role="radiogroup" aria-label="What is it?">
          <button type="button" role="radio" aria-checked={type === 'movie'} className={type === 'movie' ? 'is-active' : ''} onClick={() => setType('movie')}>Film</button>
          <button type="button" role="radio" aria-checked={type === 'tv'} className={type === 'tv' ? 'is-active' : ''} onClick={() => setType('tv')}>TV show</button>
        </div>

        <form className="lib-search" onSubmit={(event) => void search(event)}>
          <input
            type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Title, TMDB id or IMDb id (tt…)" aria-label="Search TMDB" autoFocus
          />
          <button type="submit" className="setup-secondary" disabled={busy || !query.trim()}>Search</button>
        </form>

        <div className="lib-results" aria-live="polite">
          {results && results.length === 0 && <p className="lib-empty">No titles found. Try another spelling, or paste the TMDB or IMDb id.</p>}
          {results?.map((choice) => (
            <button
              key={`${choice.type}-${choice.tmdbId}`} type="button"
              className={`lib-choice${picked?.tmdbId === choice.tmdbId && picked.type === choice.type ? ' is-picked' : ''}`}
              onClick={() => setPicked(choice)} aria-pressed={picked?.tmdbId === choice.tmdbId && picked.type === choice.type}
            >
              {choice.poster ? <img src={choice.poster} alt="" loading="lazy" /> : <span className="lib-poster-ph" aria-hidden="true" />}
              <span className="lib-choice-copy" data-i18n-preserve>
                <strong>{choice.title}{choice.year ? ` (${choice.year})` : ''}</strong>
                {choice.originalTitle && choice.originalTitle !== choice.title && <small>{choice.originalTitle}</small>}
                <small className="lib-overview">{choice.overview}</small>
              </span>
            </button>
          ))}
        </div>

        {picked && picked.type === 'tv' && (
          <div className="lib-episode">
            <label className="setup-field">
              <span>Season</span>
              <select
                value={season === 'keep' ? 'keep' : season ?? ''}
                disabled={!seasons}
                onChange={(event) => setSeason(event.target.value === 'keep' ? 'keep' : event.target.value === '' ? null : Number(event.target.value))}
              >
                {!seasons && <option value="">{setupCopy('Loading seasons…', 'Loading seasons…')}</option>}
                {isRange && <option value="keep">{setupCopy('Seasons {{from}} to {{to}} (keep the pack)', 'Seasons {{from}} to {{to}} (keep the pack)', { from: item.seasonStart, to: item.seasonEnd })}</option>}
                {seasons?.map((s) => (
                  <option key={s.number} value={s.number}>
                    {[
                      s.number === 0 ? setupCopy('Specials', 'Specials') : setupCopy('Season {{number}}', 'Season {{number}}', { number: s.number }),
                      s.year,
                      s.episodes != null ? setupCount(s.episodes, 'episode', 'episodes') : null,
                    ].filter(Boolean).join(' · ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="setup-field">
              <span>Episode</span>
              <select
                value={episode}
                disabled={season === 'keep' || typeof season !== 'number'}
                onChange={(event) => setEpisode(event.target.value === 'whole' ? 'whole' : Number(event.target.value))}
              >
                <option value="whole">{setupCopy('Whole season (pack)', 'Whole season (pack)')}</option>
                {episodes?.map((e) => (
                  <option key={e.number} value={e.number} data-i18n-preserve>{episodeOptionLabel(e)}</option>
                ))}
              </select>
            </label>
            <p className="lib-hint">
              {isPack
                ? setupCopy('This item holds several videos, so a whole season usually fits.', 'This item holds several videos, so a whole season usually fits.')
                : setupCopy('This item is a single video: pick its episode if you know it.', 'This item is a single video: pick its episode if you know it.')}
            </p>
          </div>
        )}

        {error && <p className="setup-error" role="alert">{error}</p>}
        <div className="app-modal-actions">
          <button type="button" className="setup-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="setup-primary" disabled={!picked || busy} onClick={() => void save()}>{busy && picked ? 'Saving…' : 'Use this title'}</button>
        </div>
      </div>
    </div>
  );
}

export function LibraryPanel({ uuid, editToken }: { uuid: string; editToken: string | null }) {
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [view, setView] = useState<LibraryView>('attention');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState<LibraryItem | null>(null);
  const [retrying, setRetrying] = useState(false);
  const request = useRef(0);

  const loadSummary = useCallback(async () => {
    if (!editToken) return;
    try {
      const next = await fetchLibrarySummary(uuid, editToken);
      setSummary(next);
      setSummaryError(null);
      return next;
    } catch (err) {
      setSummaryError(apiErrorCopy(err, setupCopy('Your library could not be loaded.', 'Your library could not be loaded.')));
      return null;
    }
  }, [uuid, editToken]);

  const loadItems = useCallback(async (append = false) => {
    if (!editToken) return;
    const ticket = ++request.current;
    setLoading(true);
    try {
      const out = await fetchLibraryItems(uuid, editToken, { view, q: query.trim(), offset: append ? items.length : 0 });
      if (ticket !== request.current) return;
      setTotal(out.total);
      setItems((prev) => (append ? [...prev, ...out.items] : out.items));
    } catch (err) {
      if (ticket === request.current) toast(apiErrorCopy(err, setupCopy('Your library could not be loaded.', 'Your library could not be loaded.')), 'error');
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, [uuid, editToken, view, query, items.length]);

  useEffect(() => {
    void loadSummary().then((next) => {
      // Nothing needs attention: open on the matched list instead.
      if (next && next.attention === 0) setView('matched');
    });
  }, [loadSummary]);

  useEffect(() => {
    const timer = setTimeout(() => void loadItems(false), query ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, query, editToken]);

  async function refreshAll() {
    await Promise.all([loadSummary(), loadItems(false)]);
  }

  async function act(fn: () => Promise<unknown>, done: string) {
    if (!editToken) return;
    try {
      await fn();
      toast(done);
      await refreshAll();
    } catch (err) {
      toast(apiErrorCopy(err, setupCopy('That did not work. Try again.', 'That did not work. Try again.')), 'error');
    }
  }

  async function retry() {
    if (!editToken || retrying) return;
    setRetrying(true);
    try {
      const out = await retryMatching(uuid, editToken);
      toast(out.requeued
        ? setupCopy('Trying {{count}} files again. Check back in a minute.', 'Trying {{count}} files again. Check back in a minute.', { count: out.requeued })
        : setupCopy('Nothing is waiting to be retried.', 'Nothing is waiting to be retried.'));
      setTimeout(() => void refreshAll(), 15000);
    } catch (err) {
      toast(apiErrorCopy(err, setupCopy('That did not work. Try again.', 'That did not work. Try again.')), 'error');
    } finally {
      setRetrying(false);
    }
  }

  if (!editToken) return null;
  if (summaryError && !summary) {
    return (
      <section className="lib-page">
        <div className="lib-hero"><span className="setup-eyebrow">YOUR LIBRARY</span><h1>Your library</h1></div>
        <p className="setup-error" role="alert">{summaryError}</p>
      </section>
    );
  }

  const synced = relativeTime(summary?.lastSyncAt ?? null);
  const tabs: { id: LibraryView; label: string; count: number | undefined }[] = [
    { id: 'attention', label: 'Needs attention', count: summary?.attention },
    { id: 'matched', label: 'Matched', count: summary?.matched },
    { id: 'ignored', label: 'Ignored', count: summary?.ignored },
  ];

  return (
    <section className="lib-page" aria-label="Your library">
      <header className="lib-hero">
        <span className="setup-eyebrow">YOUR LIBRARY</span>
        <h1>What LeLibrary found in your cloud</h1>
        <p className="setup-lede">Every file in your debrid account and what it became in Stremio and Nuvio. Fix anything that was missed or matched wrong; your fixes only affect your own library.</p>
      </header>

      {summary && !summary.hasPassword && (
        <p className="lib-note">Anyone with this setup's id can open this page. Set a password in the setup settings to keep your file names private.</p>
      )}

      {summary ? (
        <div className="lib-stats">
          <Stat value={summary.files} label="Files" />
          <Stat value={summary.films} label="Films" />
          <Stat value={summary.shows} label="Shows" />
          <Stat value={summary.attention} label="Need attention" tone={summary.attention ? 'warn' : undefined} />
          {summary.ignored > 0 && <Stat value={summary.ignored} label="Ignored" tone="muted" />}
        </div>
      ) : (
        <div className="lib-stats is-loading" aria-hidden="true">{[0, 1, 2, 3].map((n) => <div key={n} className="lib-stat" />)}</div>
      )}

      {summary && (
        <div className="lib-sync">
          <span>
            {summary.providers.map((p) => PROVIDER_NAMES[p.provider] ?? p.provider).join(' · ')}
            {synced ? <> · {setupCopy('Last checked {{when}}', 'Last checked {{when}}', { when: synced })}</> : null}
            {summary.pending > 0 ? <> · {setupCount(summary.pending, 'file still being matched', 'files still being matched')}</> : null}
          </span>
          {summary.attention > 0 && (
            <button type="button" className="setup-secondary" onClick={() => void retry()} disabled={retrying}>{retrying ? 'Starting…' : 'Try matching again'}</button>
          )}
        </div>
      )}

      {summary && !summary.canFix && (
        <p className="lib-note">Add a TMDB key to this setup to fix matches.</p>
      )}

      <div className="lib-toolbar">
        <div className="lib-tabs" role="tablist" aria-label="Library view">
          {tabs.map((tab) => (
            <button
              key={tab.id} type="button" role="tab" aria-selected={view === tab.id}
              className={view === tab.id ? 'is-active' : ''} onClick={() => setView(tab.id)}
            >
              {tab.label}{tab.count != null ? <span className="lib-count">{new Intl.NumberFormat(language()).format(tab.count)}</span> : null}
            </button>
          ))}
        </div>
        <input
          type="search" className="lib-filter" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by file or title" aria-label="Search by file or title"
        />
      </div>

      <div className="lib-list" aria-busy={loading}>
        {!loading && items.length === 0 && (
          <p className="lib-empty">
            {query ? 'Nothing matches that search.' : view === 'attention' ? 'Everything in your library is matched.' : view === 'ignored' ? 'You have not ignored any files.' : 'Nothing matched yet.'}
          </p>
        )}
        {items.map((item) => (
          <article key={item.id} className={`lib-row is-${item.status}`}>
            {item.status === 'matched' && (item.poster ? <img className="lib-thumb" src={item.poster.replace('/w500/', '/w154/')} alt="" loading="lazy" /> : <span className="lib-thumb lib-poster-ph" aria-hidden="true" />)}
            <div className="lib-row-main">
              {item.status === 'matched' && (
                <strong className="lib-title" data-i18n-preserve>{item.title}{item.year ? ` (${item.year})` : ''}</strong>
              )}
              <code className="lib-file" data-i18n-preserve>{item.name}</code>
              <Inside item={item} />
              <FileMeta item={item} />
              {item.reason && <p className="lib-reason">{REASONS[item.reason] ?? REASONS['other']}</p>}
              {item.fixed && item.status === 'matched' && <span className="lib-badge">Your fix</span>}
            </div>
            <div className="lib-actions">
              {item.status !== 'ignored' && summary?.canFix && (
                <button type="button" className={item.status === 'matched' ? 'setup-secondary' : 'setup-primary'} onClick={() => setFixing(item)}>
                  {item.status === 'matched' ? 'Change' : 'Fix match'}
                </button>
              )}
              {item.status !== 'ignored' && (
                <button type="button" className="setup-secondary" onClick={() => void act(() => ignoreItem(uuid, editToken, item.id), setupCopy('Ignored. It no longer shows anywhere.', 'Ignored. It no longer shows anywhere.'))}>Ignore</button>
              )}
              {(item.fixed || item.status === 'ignored') && (
                <button type="button" className="setup-secondary" onClick={() => void act(() => undoFix(uuid, editToken, item.id), setupCopy('Back to automatic matching.', 'Back to automatic matching.'))}>
                  {item.status === 'ignored' ? 'Stop ignoring' : 'Undo my fix'}
                </button>
              )}
            </div>
          </article>
        ))}
        {items.length < total && (
          <button type="button" className="setup-secondary lib-more" disabled={loading} onClick={() => void loadItems(true)}>
            {loading ? 'Loading…' : setupCopy('Show more ({{count}} left)', 'Show more ({{count}} left)', { count: total - items.length })}
          </button>
        )}
      </div>

      {fixing && (
        <FixDialog
          uuid={uuid} editToken={editToken} item={fixing}
          onClose={() => setFixing(null)}
          onFixed={() => { setFixing(null); void refreshAll(); }}
        />
      )}
    </section>
  );
}
