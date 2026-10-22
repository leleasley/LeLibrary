import type { ReactNode } from 'react';
import { samplePoster } from '@/features/setup/shared/tier/TierPickers';

// One step of a tier flow: big outlined numeral, title, lede, then the body.
// Hairlines between steps instead of a card around each one. The id anchors
// the progress rail (section-{id}). `hidden` keeps stepped flows on one page
// at a time without unmounting, so each step keeps its local state.
export function TierStep({ id, index, title, lede, done, hidden, children }: {
  id: string;
  index: number;
  title: string;
  lede?: string;
  done?: boolean;
  hidden?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`qs-step${done ? ' is-done' : ''}`} id={`section-${id}`} aria-label={title} hidden={hidden}>
      <header className="qs-step-head">
        <span className="qs-num flow-num" aria-hidden="true">{String(index).padStart(2, '0')}</span>
        <div>
          <h2>{title}</h2>
          {lede && <p>{lede}</p>}
        </div>
      </header>
      <div className="qs-step-body">{children}</div>
    </section>
  );
}

// Decorative poster wall behind the heading: the same public sample art the
// preview uses, tilted and faded so it reads as texture, never as content.
export function PosterWall() {
  const tiles = Array.from({ length: 24 }, (_, index) => index);
  return (
    <div className="qs-wall" aria-hidden="true">
      <div className="qs-wall-track">
        {tiles.map((index) => <img key={index} src={samplePoster(index, 'w185')} alt="" loading="lazy" />)}
      </div>
    </div>
  );
}

// The full hero introduces the tier; on later wizard steps it shrinks to a
// slim title line so each step starts near the top of the screen.
export function TierHero({ eyebrow, title, accent, lede, facts, compact }: {
  eyebrow: string;
  title: string;
  accent: string;
  lede: string;
  facts: string[];
  compact?: boolean;
}) {
  if (compact) {
    return (
      <header className="qs-hero is-compact">
        <span className="setup-eyebrow">{eyebrow}</span>
        <h1>{title} <em>{accent}</em></h1>
      </header>
    );
  }
  return (
    <header className="qs-hero">
      <span className="setup-eyebrow">{eyebrow}</span>
      <h1>{title}<br /><em>{accent}</em></h1>
      <p>{lede}</p>
      <ul className="qs-hero-facts">
        {facts.map((fact) => <li key={fact}>{fact}</li>)}
      </ul>
    </header>
  );
}

// Back / Start over / Continue for the stepped tiers.
export function TierWizardNav({ step, total, onBack, onNext, onReset, nextLabel, resetLabel = 'Start over' }: {
  step: number;
  total: number;
  onBack: () => void;
  onNext: () => void;
  onReset: () => void;
  nextLabel?: string;
  // Editing a saved setup: "Clear my edits" restores what the server holds.
  resetLabel?: string;
}) {
  const last = step >= total - 1;
  return (
    <div className="qs-wizard-nav">
      {step > 0 ? (
        <button type="button" className="qs-nav-back" onClick={onBack}>← Back</button>
      ) : <span />}
      <span className="qs-nav-right">
        <button type="button" className="pw-reset-link" onClick={onReset}>{resetLabel}</button>
        {!last && (
          <button type="button" className="qs-nav-next" onClick={onNext}>
            <span>Continue →</span>
            {nextLabel && <small>{nextLabel}</small>}
          </button>
        )}
      </span>
    </div>
  );
}
