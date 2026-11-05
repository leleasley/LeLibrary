import { useId, useState, type ReactNode } from 'react';
import { samplePoster } from '@/features/setup/shared/tier/TierPickers';

// The small "i" next to a step title: the step's one-line explanation, on
// hover / keyboard focus, or a tap on phones.
export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className={`ts-tip${open ? ' is-open' : ''}`}>
      <button
        type="button" className="ts-tip-btn" aria-label="About this page" aria-expanded={open} aria-describedby={id}
        onClick={() => setOpen((value) => !value)} onBlur={() => setOpen(false)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
      </button>
      <span className="ts-tip-pop" role="tooltip" id={id}>{text}</span>
    </span>
  );
}

// One step of a tier flow: the page title (with its info tip), then the
// body. The id anchors the step tabs (section-{id}). `hidden` keeps stepped
// flows on one page at a time without unmounting, so each step keeps its
// local state.
export function TierStep({ id, title, lede, hidden, children }: {
  id: string;
  title: string;
  lede?: string;
  hidden?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="qs-step" id={`section-${id}`} aria-label={title} hidden={hidden}>
      <header className="qs-step-head">
        <h2>{title}</h2>
        {lede && <InfoTip text={lede} />}
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

// The big heading block of the tier picker and the site pages.
export function TierHero({ eyebrow, title, accent, lede, facts }: {
  eyebrow: string;
  title: string;
  accent: string;
  lede: string;
  facts: string[];
}) {
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
