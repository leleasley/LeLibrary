import { useEffect, useState, type ReactNode } from 'react';
import { PosterPreview, type PostersDraft } from '@/features/setup/shared/PostersSection';
import { FormattingPreview, type FormattingDraft } from '@/features/setup/shared/FormattingSection';
import type { SetupKeysDraft } from '@/features/setup/shared/config-contract';
import { samplePoster } from '@/features/setup/shared/tier/TierPickers';

export interface PreviewRow {
  label: string;
  value: string;
  // Green when the row is a "good to go" state (a connected library).
  ok?: boolean;
}

// The payoff, kept in view: real poster art from the chosen provider and a
// real stream card from the formatter, inside a TV frame, with the tier's own
// summary underneath. Desktop shows it in the sticky sidebar; phones open the
// same panel from the bottom dock.
export function TierPreviewPanel({ keys, posters, formatting, badgePack, rows, cta, footer }: {
  keys: SetupKeysDraft;
  posters: PostersDraft;
  formatting: FormattingDraft;
  badgePack: { pack: string; url: string };
  rows: PreviewRow[];
  cta?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="qs-panel finish">
      <div className="qs-panel-head">
        <span className="finish-kicker">YOUR LIBRARY PREVIEW</span>
        <span className="qs-live">Live</span>
      </div>
      <div className="qs-tv">
        <PosterPreview provider={posters.provider} keys={keys} draft={posters} />
        <FormattingPreview draft={formatting} badgePack={badgePack.pack} badgeUrl={badgePack.url} />
      </div>
      <dl className="qs-summary">
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd className={row.ok ? 'is-set' : ''} title={row.value}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {cta}
      {footer}
    </div>
  );
}

// Phones: a floating dock with a tiny poster stack and the current choices;
// tapping Preview slides the full panel up as a sheet.
export function TierDock({ hasArt, label, next, children }: {
  hasArt: boolean;
  label: string;
  // Stepped tiers: Continue lives in the dock on phones so it is never hidden
  // behind it, and is always one thumb-tap away.
  next?: { onClick: () => void } | undefined;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [open]);

  return (
    <>
      <div className="qs-dock">
        <span className="qs-dock-stack" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <span key={index} className="qs-dock-poster">
              {hasArt && <img src={samplePoster(index, 'w154')} alt="" loading="lazy" />}
            </span>
          ))}
        </span>
        <span className="qs-dock-copy">
          <small>Live preview</small>
          <strong>{label}</strong>
        </span>
        <button type="button" className={`qs-dock-btn${next ? ' is-ghost' : ''}`} aria-expanded={open} onClick={() => setOpen(true)}>Preview</button>
        {next && <button type="button" className="qs-dock-btn" onClick={next.onClick}>Continue →</button>}
      </div>
      {open && (
        <>
          <button type="button" className="qs-scrim" aria-label="Close preview" onClick={() => setOpen(false)} />
          <div className="qs-sheet" role="dialog" aria-modal="true" aria-label="Your library preview">
            <button type="button" className="qs-sheet-grab" aria-label="Close preview" onClick={() => setOpen(false)} />
            {children}
          </div>
        </>
      )}
    </>
  );
}
