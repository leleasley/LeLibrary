import type { ReactNode } from 'react';

// Step sub-section dropdown (cg-accordion): bordered card, icon + title + description in the head, an
// optional amber count pill, and a ▸ arrow that rotates open. Native
// <details> keeps it keyboard- and screen-reader-friendly for free.
export function Accordion({ title, desc, summary, icon, count, defaultOpen, children }: {
  title: string;
  desc?: string;
  // The Setup page's one-line state ("TorBox · TMDB key added"): each part is
  // its own text node so the setup copy map can translate it.
  summary?: string[];
  icon?: string;
  count?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="cg-accordion" open={defaultOpen ? true : undefined}>
      <summary className="cg-accordion-head">
        {icon && <span className="cg-section-icon" aria-hidden="true">{icon}</span>}
        <div>
          <strong>{title}</strong>
          {summary && summary.length > 0
            ? <small className="cg-accordion-summary">{summary.map((part, index) => <span key={index}>{part}</span>)}</small>
            : desc && <small>{desc}</small>}
        </div>
        {count && <span className="cg-accordion-count">{count}</span>}
      </summary>
      <div className="cg-accordion-body">{children}</div>
    </details>
  );
}
