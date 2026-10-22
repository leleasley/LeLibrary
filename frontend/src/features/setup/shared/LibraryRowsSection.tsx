import { useState } from 'react';
import { EMPTY_LIBRARY_ROWS, LIBRARY_ROWS, LIBRARY_ROW_NAME_MAX, type LibraryRowsDraft } from '@/features/setup/shared/library-rows';

// Rename the library rows and, on Quick Look, hide the ones you do not want.
// Settle In and Move In decide visibility in their Home rows step, so they get
// the names only (a second switch there would contradict the Home picker).
export function LibraryRowsSection({ value, onChange, showVisibility = false, hideAnime = false }: {
  value: LibraryRowsDraft;
  onChange: (next: LibraryRowsDraft) => void;
  showVisibility?: boolean;
  // "Hide anime" (More library options) removes the Anime row server-side, so
  // the row shows as hidden and its switch is locked rather than disagreeing.
  hideAnime?: boolean;
}) {
  return (
    <div className="lr">
      <p className="setup-hint">
        Give your library rows your own names. Leave a name empty to keep the default.
      </p>
      {LIBRARY_ROWS.map((row) => {
        const draft = value[row.id];
        const forcedOff = hideAnime && row.id === 'anime';
        const shown = draft.show && !forcedOff;
        return (
          <div className={`lr-row${showVisibility && !shown ? ' is-off' : ''}`} key={row.id}>
            <span className="lr-icon" aria-hidden="true">{row.icon}</span>
            <label className="lr-name">
              <span>{row.label}</span>
              <input
                type="text" maxLength={LIBRARY_ROW_NAME_MAX} autoComplete="off"
                value={draft.name} placeholder={row.defaultName}
                disabled={showVisibility && !shown}
                onChange={(event) => onChange({ ...value, [row.id]: { ...draft, name: event.target.value } })}
              />
            </label>
            {showVisibility && (
              <label className="switch-row lr-show">
                <span><strong>Show</strong></span>
                <input
                  type="checkbox" checked={shown} disabled={forcedOff} aria-label={`Show the ${row.label} row`}
                  onChange={(event) => onChange({ ...value, [row.id]: { ...draft, show: event.target.checked } })}
                />
                <i aria-hidden="true" />
              </label>
            )}
            {showVisibility && forcedOff && (
              <small className="lr-note">Hidden by Hide anime in Library options</small>
            )}
          </div>
        );
      })}
      {showVisibility && (
        <small className="setup-hint">The Anime row also hides itself while your library has no anime.</small>
      )}
    </div>
  );
}

// Quick Look's compact entry point: the three row names as chips (so the
// feature is visible without opening anything), with Rename opening the
// editor above inline. Custom names are user data and never translated.
export function LibraryRowsCard({ value, onChange, hideAnime = false }: {
  value: LibraryRowsDraft;
  onChange: (next: LibraryRowsDraft) => void;
  hideAnime?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const customised = LIBRARY_ROWS.some((row) => value[row.id].name.trim() !== '' || !value[row.id].show);
  return (
    <div className={`lr-card${open ? ' is-open' : ''}`}>
      <div className="lr-card-head">
        <div className="lr-card-copy">
          <strong>Your rows</strong>
          <ul className="lr-chips" aria-label="Your library rows">
            {LIBRARY_ROWS.map((row) => {
              const draft = value[row.id];
              const name = draft.name.trim();
              const hidden = !draft.show || (hideAnime && row.id === 'anime');
              const state = hidden ? ' is-hidden' : name ? ' is-renamed' : '';
              return (
                <li key={row.id} className={`lr-chip${state}`}>
                  <span aria-hidden="true">{row.icon}</span>
                  <span data-i18n-preserve>{name || row.defaultName}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <button type="button" className="lr-card-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Done' : 'Rename'}
        </button>
      </div>
      {open && (
        <div className="lr-card-body">
          <LibraryRowsSection value={value} onChange={onChange} showVisibility hideAnime={hideAnime} />
          {customised && (
            <button type="button" className="lr-reset" onClick={() => onChange(EMPTY_LIBRARY_ROWS)}>Reset to defaults</button>
          )}
        </div>
      )}
    </div>
  );
}
