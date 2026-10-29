import { useState, type CSSProperties, type SyntheticEvent } from 'react';
import { parseBackup, stageBackup } from '@/features/setup/shared/setup-backup';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchFeatures } from '@/api/features';
import { queryKeys } from '@/api/query-keys';
import { i18n } from '@/i18n';
import { listSetups } from '@/features/setup/resolver/api';
import { mergeSavedSetups, type SavedSetup } from '@/features/setup/shared/saved-setups';
import { setupCopy } from '@/features/setup/shared/setup-copy';
import { TIERS, tierById, type TierId } from '@/features/setup/shared/tiers';
import {
  forgetSetup,
  loadSetupHistory,
  uuidFromInput,
} from '@/features/setup/shared/setup-history';
import { PosterWall, TierHero } from '@/features/setup/shared/tier/TierChrome';
import { samplePoster } from '@/features/setup/shared/tier/TierPickers';
import '@/features/setup/shared/tier/tier.css';

function labelFor(entry: Pick<SavedSetup, 'uuid' | 'name'>): string {
  return entry.name || `Setup ${entry.uuid.slice(0, 8)}…`;
}

// Locale-aware "when" for a setup saved on another device. Intl handles the
// words; the surrounding "Updated {{date}}" phrase comes from the setup bundle.
function formatUpdated(ms: number): string {
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const relative = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  if (abs < 60_000) return relative.format(Math.round(diff / 1_000), 'second');
  if (abs < 3_600_000) return relative.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return relative.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 2_592_000_000) return relative.format(Math.round(diff / 86_400_000), 'day');
  return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(ms));
}

// LeLibrary's own folder covers for the Move In preview's tiles (hosted only:
// /collection-art/ is not in the public repo). A self-hosted build has no such
// file, so a tile falls back to the franchise's plain TMDB still.
const FOLDER_ART = [
  { src: '/collection-art/franchise-marvel-v2.jpg', fallback: 'https://image.tmdb.org/t/p/w780/mDfJG3LC3Dqb67AZ52x3Z0jU0uB.jpg', title: 'Marvel' },
  { src: '/collection-art/franchise-star-wars-v2.jpg', fallback: 'https://image.tmdb.org/t/p/w780/iY2ujEY2m68OTTlPFTiHub9joHS.jpg', title: 'Star Wars' },
  { src: '/collection-art/franchise-john-wick-v2.jpg', fallback: 'https://image.tmdb.org/t/p/w780/fSwYa5q2xRkBoOOjueLpkLf3N1m.jpg', title: 'John Wick' },
  { src: '/collection-art/franchise-dune-v2.jpg', fallback: 'https://image.tmdb.org/t/p/w780/fahk0Fu7VUUfK6IkTt1R3waOD9F.jpg', title: 'Dune' },
];

function showFallback(event: SyntheticEvent<HTMLImageElement>, fallback: string): void {
  const img = event.currentTarget;
  if (img.src !== fallback) img.src = fallback;
}

function Row({ label, count, offset }: { label: string; count: number; offset: number }) {
  return (
    <span className="pk-row">
      <span className="pk-row-label">{label}</span>
      <span className="pk-row-track">
        {Array.from({ length: count }, (_, index) => (
          <img key={index} src={samplePoster(index + offset, 'w154')} alt="" loading="lazy" />
        ))}
      </span>
    </span>
  );
}

// What each tier's result looks like on a TV, drawn small: a picture of the
// difference instead of three checklists that read the same.
function TierMini({ id }: { id: TierId }) {
  return (
    <span className={`pk-mini pk-mini-${id}`} aria-hidden="true">
      <span className="pk-mini-screen">
        {id === 'quick' && (
          <>
            <Row label="My Movies" count={5} offset={0} />
            <span className="pk-stream"><i data-i18n-preserve>4K</i><i data-i18n-preserve>REMUX</i><span>Your copy · ready to play</span></span>
          </>
        )}
        {id === 'partial' && (
          <>
            <Row label="Continue" count={5} offset={1} />
            <Row label="My Shows" count={5} offset={3} />
            <Row label="Trending" count={5} offset={2} />
            <span className="pk-chips" data-i18n-preserve><i>4K</i><i>HDR</i><i>Atmos</i><i>Cached</i></span>
          </>
        )}
        {id === 'full' && (
          <>
            <span className="pk-folders">
              {FOLDER_ART.map((folder) => (
                <span key={folder.title} className="pk-folder">
                  <img src={folder.src} alt="" loading="lazy" onError={(event) => showFallback(event, folder.fallback)} />
                  <b data-i18n-preserve>{folder.title}</b>
                </span>
              ))}
            </span>
            <Row label="My Movies" count={5} offset={4} />
          </>
        )}
      </span>
    </span>
  );
}

// Feature by feature, which tier page carries it. Every tier shares one UUID +
// password model and can switch tier later without losing anything.
const COMPARE: { label: string; tiers: TierId[] }[] = [
  { label: 'TorBox, Real-Debrid, AllDebrid and Premiumize', tiers: ['quick', 'partial', 'full'] },
  { label: 'TMDB matching, TVDB and OMDb', tiers: ['quick', 'partial', 'full'] },
  { label: 'Poster artwork with a live preview', tiers: ['quick', 'partial', 'full'] },
  { label: 'Stream style and Nuvio badge packs', tiers: ['quick', 'partial', 'full'] },
  { label: 'Language, sorting and main metadata', tiers: ['partial', 'full'] },
  { label: 'Home rows, ordered your way', tiers: ['partial', 'full'] },
  { label: 'Playback filters, stream add-ons and custom links', tiers: ['partial', 'full'] },
  { label: 'MDBList and watchlists', tiers: ['partial', 'full'] },
  { label: 'Nuvio auto-play and next episode', tiers: ['partial', 'full'] },
  { label: 'Push straight to Nuvio or Stremio', tiers: ['partial', 'full'] },
  { label: 'Collections, folders and folder artwork', tiers: ['full'] },
  { label: 'Quick Packs and public Nuvio collections', tiers: ['full'] },
];

// The /configure index: three tiers, each with a picture of its result, a
// comparison for the curious, and the way back to an existing setup.
export function TierPicker() {
  const navigate = useNavigate();
  const [history, setHistory] = useState(loadSetupHistory);
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  // Self-host instances can list their own setups (issue #4). The flag is only
  // true when the operator configured SELFHOST_CONFIGS_SECRET, so the hosted
  // deployment and the default self-host never trigger the request.
  const featuresQuery = useQuery({
    queryKey: queryKeys.features,
    queryFn: () => fetchFeatures(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const savedSetupsEnabled = featuresQuery.data?.savedSetups === true;
  const savedQuery = useQuery({
    queryKey: queryKeys.savedSetups,
    queryFn: () => listSetups(),
    enabled: savedSetupsEnabled,
    staleTime: 30_000,
    retry: false,
  });
  const entries = mergeSavedSetups(savedQuery.data ?? [], history);

  const [backupError, setBackupError] = useState<string | null>(null);

  // Start a new setup from a settings backup: fill its level, then open it.
  async function loadBackup(file: File | undefined) {
    setBackupError(null);
    if (!file) return;
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) { setBackupError(parsed.error); return; }
    navigate(stageBackup(parsed.backup));
  }

  function openManual(event: React.FormEvent) {
    event.preventDefault();
    const uuid = uuidFromInput(manual);
    if (!uuid) {
      setManualError('That does not look like a setup id or setup link.');
      return;
    }
    setManualError(null);
    navigate(`/${uuid}`);
  }

  return (
    <section className="setup setup-wide qs qs-picker">
      <PosterWall />
      <TierHero
        eyebrow="Setup" title="How much do you" accent="want to set up?"
        lede="Start with the debrid account that holds your library. No MDBList key or extra stream add-on is needed. Add Home rows or Nuvio collections only if you want them."
        facts={['No account needed', 'Keys sealed on the server', 'Switch tiers later without losing anything']}
      />

      <div className="pk-tiers">
        {TIERS.map((option, index) => (
          <button
            key={option.id}
            type="button"
            className={`pk-tier${option.recommended ? ' is-recommended' : ''}`}
            style={{ '--pk-i': index } as CSSProperties}
            onClick={() => navigate(`/configure/${option.id}`)}
          >
            {option.recommended && <span className="pk-badge">Recommended</span>}
            <TierMini id={option.id} />
            <span className="pk-tier-body">
              <span className="pk-tier-head">
                <strong>{option.name}</strong>
                <span className="pk-steps">{`${option.steps} steps`}</span>
              </span>
              <small>{option.tagline}</small>
              <ul>
                {option.covers.map((line) => <li key={line}>{line}</li>)}
              </ul>
              <span className="pk-go">
                <span>{`Start ${option.name}`}</span>
                <span aria-hidden="true">→</span>
              </span>
            </span>
          </button>
        ))}
      </div>

      <details className="pk-compare">
        <summary>
          <strong>Compare everything</strong>
          <span>What each setup can do, side by side</span>
        </summary>
        <div className="pk-compare-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col"><span className="pk-sr">Feature</span></th>
                {TIERS.map((tier) => <th scope="col" key={tier.id} className={tier.recommended ? 'is-recommended' : ''}>{tier.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {TIERS.map((tier) => (
                    <td key={tier.id} className={tier.recommended ? 'is-recommended' : ''}>
                      {row.tiers.includes(tier.id)
                        ? <span className="pk-yes" aria-label="Included">✓</span>
                        : <span className="pk-no" aria-label="Not included">–</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <section className="pk-return" aria-label="Already have a setup?">
        <div className="pk-return-copy">
          <span className="setup-eyebrow">Coming back</span>
          <h2>Already have a setup?</h2>
          <p>Paste your setup id, install link or edit link. You will open the same page you set it up on, with everything filled in.</p>
        </div>
        <div className="pk-return-actions">
          <form className="setup-history-entry pk-paste" onSubmit={openManual}>
            <input
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              placeholder="Paste a setup id, install link or edit link…"
              autoComplete="off" spellCheck={false}
              aria-label="Setup id, install link or edit link"
            />
            <button type="submit">Open</button>
          </form>
          {manualError && (
            <p className="setup-history-error" role="alert">{setupCopy(manualError, manualError)}</p>
          )}
          <div className="pk-backup">
            <label className="setup-secondary pk-backup-btn">
              <input
                type="file" accept=".json,application/json" hidden
                onChange={(event) => { void loadBackup(event.target.files?.[0]); event.target.value = ''; }}
              />
              Start from a settings backup
            </label>
            <small>Fills in a new setup from a backup file. You add your own keys and password.</small>
          </div>
          {backupError && (
            <p className="setup-history-error" role="alert">{setupCopy(backupError, backupError)}</p>
          )}
          {(entries.length > 0 || savedSetupsEnabled) && (
            <div className="pk-history">
              <h3>Back to a previous setup</h3>
              <p className="setup-lede">
                {savedSetupsEnabled
                  ? 'Saved on this server or in this browser. Your password still guards every change.'
                  : 'Made on this browser. Your password still guards every change.'}
              </p>
              {savedSetupsEnabled && savedQuery.isPending && (
                <p className="setup-history-status" role="status">Loading saved setups…</p>
              )}
              {savedSetupsEnabled && savedQuery.isError && (
                <p className="setup-history-error" role="alert">
                  {setupCopy('Could not load saved setups.', 'Could not load saved setups.')}
                </p>
              )}
              {savedSetupsEnabled && savedQuery.isSuccess && entries.length === 0 && (
                <p className="setup-history-status">No saved setups yet.</p>
              )}
              {entries.length > 0 && (
                <div className="setup-history">
                  {entries.map((entry) => (
                    <span key={entry.uuid} className="setup-history-pill-wrap">
                      <button
                        type="button"
                        className="setup-history-pill"
                        aria-label={`Open ${labelFor(entry)}`}
                        onClick={() => navigate(`/${entry.uuid}`)}
                      >
                        <span className="setup-history-pill-name" data-i18n-preserve>{labelFor(entry)}</span>
                        {entry.tier && (
                          <span className="setup-history-pill-tier">
                            {tierById(entry.tier)?.name ?? entry.tier}
                          </span>
                        )}
                        {entry.source === 'server' && entry.updatedAt !== null && (
                          <span className="setup-history-pill-date">Updated {formatUpdated(entry.updatedAt)}</span>
                        )}
                        <span aria-hidden="true">→</span>
                      </button>
                      {entry.source === 'browser' && (
                        <button
                          type="button" className="setup-history-pill-forget"
                          aria-label={`Forget ${labelFor(entry)} on this browser`}
                          onClick={() => setHistory(forgetSetup(entry.uuid))}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <p className="setup-note setup-note-pill">
        Watching never asks for the password. It only guards changing settings,
        and we cannot recover it for you.
      </p>
    </section>
  );
}
