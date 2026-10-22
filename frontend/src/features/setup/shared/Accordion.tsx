import type { ReactNode } from 'react';

// Step sub-section dropdown (cg-accordion): bordered card, icon + title + description in the head, an
// optional amber count pill, and a ▸ arrow that rotates open. Native
// <details> keeps it keyboard- and screen-reader-friendly for free.
export function Accordion({ title, desc, icon, count, defaultOpen, children }: {
  title: string;
  desc?: string;
  icon?: string;
  count?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="cg-accordion" open={defaultOpen ? true : undefined}>
      <summary className="cg-accordion-head">
        {icon && <span className="cg-section-icon" aria-hidden="true">{icon}</span>}
        <div><strong>{title}</strong>{desc && <small>{desc}</small>}</div>
        {count && <span className="cg-accordion-count">{count}</span>}
      </summary>
      <div className="cg-accordion-body">{children}</div>
    </details>
  );
}
