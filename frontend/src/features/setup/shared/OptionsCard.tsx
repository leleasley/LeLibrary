import { useState, type ReactNode } from 'react';

// A slim settings card: a label, the current choices as chips (so nothing is
// hidden behind a bare disclosure line), and a button that opens the fields
// inline. Same look as the Quick Look rows card (tier.css .lr-card).
export interface OptionChip {
  key: string;
  text: string;
  icon?: string;
  // Not the default: highlighted so changed settings stand out.
  changed?: boolean;
  // Something switched off or hidden: dimmed and struck through.
  off?: boolean;
  // User data or a language's own name: never run through the translator.
  verbatim?: boolean;
}

export function OptionsCard({ label, chips, openLabel = 'Change', children }: {
  label: string;
  chips: OptionChip[];
  openLabel?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`lr-card${open ? ' is-open' : ''}`}>
      <div className="lr-card-head">
        <div className="lr-card-copy">
          <strong>{label}</strong>
          <ul className="lr-chips">
            {chips.map((chip) => (
              <li key={chip.key} className={`lr-chip${chip.off ? ' is-hidden' : chip.changed ? ' is-renamed' : ''}`}>
                {chip.icon && <span aria-hidden="true">{chip.icon}</span>}
                {chip.verbatim ? <span data-i18n-preserve>{chip.text}</span> : <span>{chip.text}</span>}
              </li>
            ))}
          </ul>
        </div>
        <button type="button" className="lr-card-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Done' : openLabel}
        </button>
      </div>
      {open && <div className="lr-card-body">{children}</div>}
    </div>
  );
}
