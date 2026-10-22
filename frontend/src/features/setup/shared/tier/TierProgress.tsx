import { useEffect, useRef, useState, type CSSProperties } from 'react';

export interface ProgressStep {
  id: string;
  label: string;
  done?: boolean;
}

// Sticky progress rail under the site banner, shared by every tier.
// - scroll mode (Quick Look, one long page): the amber fill slides with the
//   scroll position; each section contributes its own 0..1 share, written to a
//   CSS variable from a rAF loop so scrolling never re-renders React.
// - wizard mode (Settle In, Move In, one step at a time): the fill glides to
//   the active step and every label jumps straight to its step.
export function TierProgress({ steps, unsaved, wizard }: {
  steps: ProgressStep[];
  unsaved: boolean;
  wizard?: { active: number; onStep: (index: number) => void };
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [scrollActive, setScrollActive] = useState(0);
  const active = wizard ? wizard.active : scrollActive;

  useEffect(() => {
    if (wizard || typeof window === 'undefined') return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const anchor = window.innerHeight * 0.38;
      let progress = 0;
      steps.forEach((step, index) => {
        const section = document.getElementById(`section-${step.id}`);
        if (!section) return;
        const box = section.getBoundingClientRect();
        if (box.top > anchor) return; // not reached yet
        const share = Math.min(1, Math.max(0, (anchor - box.top) / Math.max(1, box.height)));
        progress = Math.max(progress, index + share);
      });
      // The last section is often shorter than the viewport: reaching the
      // bottom of the page always means the rail is full.
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      const value = atEnd ? steps.length : progress;
      railRef.current?.style.setProperty('--qs-progress', String(value / steps.length));
      setScrollActive(Math.min(steps.length - 1, Math.floor(value)));
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [steps, wizard]);

  function jump(index: number, id: string) {
    if (wizard) { wizard.onStep(index); return; }
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const style = {
    '--qs-steps': steps.length,
    ...(wizard ? { '--qs-progress': (wizard.active + 1) / steps.length } : {}),
  } as CSSProperties;

  return (
    <nav className={`qs-progress${wizard ? ' is-wizard' : ''}`} aria-label="Setup progress">
      <div className="qs-progress-in">
        <div className="qs-rail" ref={railRef} style={style}>
          <span className="qs-rail-track" aria-hidden="true">
            <span className="qs-rail-fill" />
          </span>
          <ol className="qs-rail-steps">
            {steps.map((step, index) => {
              const done = step.done ?? (wizard ? index < active : false);
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    className={`qs-rail-step${index === active ? ' is-active' : ''}${index < active ? ' is-past' : ''}${done ? ' is-done' : ''}`}
                    aria-current={index === active ? 'step' : undefined}
                    aria-label={`Step ${index + 1}: ${step.label}`}
                    onClick={() => jump(index, step.id)}
                  >
                    <span className="qs-rail-dot" aria-hidden="true">{done ? '✓' : index + 1}</span>
                    <span className="qs-rail-label">{step.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        {/* The floating banner collided with the dock and the preview, so the
            same notice lives in the rail: always visible, never on top. */}
        {unsaved && <span className="qs-unsaved" role="status">Unsaved changes</span>}
      </div>
    </nav>
  );
}
