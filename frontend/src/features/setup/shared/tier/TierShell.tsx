import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { TierProgress, type ProgressStep } from '@/features/setup/shared/tier/TierProgress';
import type { ShellCheck, ShellFact } from '@/features/setup/shared/tier/shell-model';
import { setupCopy, setupCount } from '@/features/setup/shared/setup-copy';
import './shell.css';

// The setup app shell shared by every tier, create and edit: a slim top bar
// (back, setup name, "Step N of M"), the step tabs, the step in one centred
// column, a sticky sidebar (status, Preview, completion, checklists) and a
// fixed footer whose Continue / finish action is always in view. Phones get
// a compact top bar with Arrange home + Preview, a thin progress line, and
// the same footer; the sidebar is desktop only.

export type ShellStatus = 'draft' | 'saved' | 'unsaved';

export interface ShellFinish {
  label: string;
  busy?: boolean | undefined;
  disabled?: boolean | undefined;
  onClick?: (() => void) | undefined;
  // Submits this form (the password step), so Enter in a field works too.
  form?: string | undefined;
}

export interface ShellSave {
  onSave: () => void;
  onSaveAndPush: (() => void) | null;
  pushTarget: string;
  busy: boolean;
}

export interface ShellFooter {
  reset: { label: string; onClick: () => void; disabled?: boolean | undefined };
  // The last step's action (Create my setup / Save changes).
  finish: ShellFinish | null;
  // Why the finish cannot run yet (shown in the footer, finish disabled).
  blocked?: string | null | undefined;
  // Edit mode with unsaved changes: Save from any step.
  save?: ShellSave | null | undefined;
}

export function scrollToSection(id: string) {
  document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function Icon({ path }: { path: ReactNode }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24">{path}</svg>;
}
const ICON_BACK = <path d="M15 6l-6 6 6 6" />;
const ICON_ARRANGE = <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />;
const ICON_PLAY = <path d="M8 5.5v13l10.5-6.5z" />;
const ICON_NEXT = <path d="M9 6l6 6-6 6" />;

export function TierShell({ tierLabel, name, editing, steps, active, onStep, onPreview, arrange, sidebar, footer, done, children }: {
  tierLabel: string;
  name: string;
  editing: boolean;
  steps: ProgressStep[];
  // Wizard mode (Settle In, Move In): the open step and how to change it.
  // Without it the page is one long scroll (Quick Look).
  active?: number | undefined;
  onStep?: ((index: number) => void) | undefined;
  onPreview: () => void;
  // The Home layout sheet (tiers with Home rows).
  arrange?: { count: number; onOpen: () => void } | null | undefined;
  sidebar: ReactNode;
  footer: ShellFooter;
  // Move In's Ready page: the step stays, the chrome around it steps back.
  done?: boolean | undefined;
  children: ReactNode;
}) {
  const [scrollActive, setScrollActive] = useState(0);
  const wizard = onStep !== undefined && active !== undefined;
  const current = wizard ? active : scrollActive;
  const total = steps.length;
  const last = current >= total - 1;
  // Step names inside "Step N: name" lines are translated here: the page's
  // copy bridge only swaps the English frame around them.
  const stepLabel = setupCopy(steps[current]?.label ?? '', steps[current]?.label ?? '');
  const next = steps[current + 1];
  const nextLabel = next ? setupCopy(next.label, next.label) : '';
  const title = name.trim() || (editing ? 'Your setup' : 'New setup');

  function goNext() {
    if (!next) return;
    if (wizard) onStep(current + 1);
    else scrollToSection(next.id);
  }

  const back = wizard && current > 0 ? (
    <button type="button" className="ts-icon ts-back" aria-label="Previous step" onClick={() => onStep(current - 1)}><Icon path={ICON_BACK} /></button>
  ) : editing ? <span className="ts-back-gap" aria-hidden="true" /> : (
    <Link className="ts-icon ts-back" to="/configure" aria-label="All setup types"><Icon path={ICON_BACK} /></Link>
  );

  const { finish, blocked, save } = footer;
  const finishDisabled = Boolean(finish?.disabled || finish?.busy || blocked);

  return (
    <div className={`ts${sidebar && !done ? ' has-side' : ''}${done ? ' is-done' : ''}`}>
      <div className="ts-main">
        <header className="ts-top">
          <div className="ts-bar">
            {back}
            <div className="ts-title">
              <strong data-i18n-preserve={name.trim() ? true : undefined}>{title}</strong>
              <small><span>{tierLabel}</span>{` · Step ${current + 1} of ${total}`}</small>
            </div>
            <span className="ts-phone-actions">
              {arrange && !done && (
                <button type="button" className="ts-icon" aria-label="Arrange home" aria-haspopup="dialog" onClick={arrange.onOpen}><Icon path={ICON_ARRANGE} /></button>
              )}
              <button type="button" className="ts-icon" aria-label="Open preview" aria-haspopup="dialog" onClick={onPreview}><Icon path={ICON_PLAY} /></button>
            </span>
          </div>
          <div className="ts-phone-progress">
            <span className="ts-phone-steps">
              <span>{`Step ${current + 1} of ${total}: ${stepLabel}`}</span>
              {next && <span>{`Step ${current + 2}: ${nextLabel}`}</span>}
            </span>
            <span className="ts-phone-track" aria-hidden="true"><i style={{ width: `${((current + 1) / total) * 100}%` }} /></span>
          </div>
          <div className="ts-tabs">
            <TierProgress
              steps={steps}
              {...(wizard ? { wizard: { active: current, onStep } } : { onActive: setScrollActive })}
            />
          </div>
        </header>
        <div className="ts-col">{children}</div>
      </div>
      {!done && <aside className="ts-side" aria-label="Setup status">{sidebar}</aside>}
      {!done && (
        <footer className="ts-foot">
          <div className="ts-foot-in">
            <span className="ts-foot-left">
              {wizard && current > 0 && (
                <button type="button" className="ts-foot-back" onClick={() => onStep(current - 1)}>Back</button>
              )}
              <button type="button" className="pw-reset-link ts-foot-reset" disabled={footer.reset.disabled} onClick={footer.reset.onClick}>{footer.reset.label}</button>
            </span>
            <span className="ts-foot-right">
              {blocked && <span className="ts-foot-why" role="status">{blocked}</span>}
              {save && !last && (
                <>
                  {save.onSaveAndPush && (
                    <button type="button" className="ts-foot-ghost ts-save-push" disabled={save.busy} onClick={save.onSaveAndPush}>{`Save and push to ${save.pushTarget}`}</button>
                  )}
                  <button type="button" className="ts-foot-ghost ts-save" disabled={save.busy} onClick={save.onSave}>Save</button>
                </>
              )}
              {next && !last ? (
                <>
                  {!blocked && <span className="ts-foot-next-label">{`Step ${current + 2}: ${nextLabel}`}</span>}
                  <button type="button" className="ts-foot-next" onClick={goNext}>
                    <span>Continue</span>
                    <Icon path={ICON_NEXT} />
                  </button>
                </>
              ) : finish && (
                <button
                  type={finish.form ? 'submit' : 'button'} form={finish.form}
                  className={`ts-foot-next ts-finish${finishDisabled ? '' : ' is-ready'}`}
                  disabled={finishDisabled}
                  onClick={finish.form ? undefined : finish.onClick}
                >
                  <span>{finish.label}</span>
                </button>
              )}
            </span>
          </div>
        </footer>
      )}
    </div>
  );
}

// ── Sidebar ──

function Checklist({ title, items }: { title: string; items: ShellCheck[] }) {
  if (!items.length) return null;
  return (
    <section className="ts-side-group">
      <h4>{title}</h4>
      <ul className="ts-checks">
        {items.map((item) => (
          <li key={item.id} className={item.done ? 'is-done' : undefined}>
            <span className="ts-check" aria-hidden="true">{item.done ? '✓' : ''}</span>
            <span>{item.label}</span>
            <span className="ts-sr">{item.done ? 'Done' : 'Not set'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Facts({ title, facts, boxed }: { title: string; facts: ShellFact[]; boxed?: boolean }) {
  if (!facts.length) return null;
  return (
    <section className="ts-side-group">
      <h4>{title}</h4>
      <dl className={`ts-facts${boxed ? ' is-boxed' : ''}`}>
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd data-i18n-preserve={fact.verbatim || /^\d+$/.test(fact.value) ? true : undefined}>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ShellSidebar({ status, onPreview, completion, required, optional, arrange, catalog = [], posters = [], preferences = [] }: {
  status: ShellStatus;
  onPreview: () => void;
  completion: { percent: number; complete: boolean };
  required: ShellCheck[];
  optional: ShellCheck[];
  arrange?: { count: number; onOpen: () => void } | null | undefined;
  catalog?: ShellFact[] | undefined;
  posters?: ShellFact[] | undefined;
  preferences?: ShellFact[] | undefined;
}) {
  const pill = status === 'draft' ? 'Draft' : status === 'saved' ? 'Saved' : 'Unsaved changes';
  return (
    <div className="ts-side-in">
      <header className="ts-side-head">
        <strong>Setup</strong>
        <span className={`ts-pill is-${status}${status === 'unsaved' ? ' qs-unsaved' : ''}`} role="status">{pill}</span>
      </header>
      <section className="ts-live">
        <strong>Live preview</strong>
        <p>See how Nuvio or Stremio shows this setup right now.</p>
        <button type="button" className="ts-live-btn" aria-haspopup="dialog" onClick={onPreview}>
          <Icon path={ICON_PLAY} />
          <span>Open preview</span>
        </button>
      </section>
      <section className="ts-side-group ts-progress">
        <span className="ts-progress-head">
          <span>Setup completion</span>
          <b data-i18n-preserve>{`${completion.percent}%`}</b>
        </span>
        <span className="ts-progress-track" role="progressbar" aria-label="Setup completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion.percent}>
          <i className={completion.complete ? 'is-complete' : undefined} style={{ width: `${completion.percent}%` }} />
        </span>
        {!completion.complete && <small className="ts-progress-note">Add the required items below to create your setup.</small>}
      </section>
      {arrange && (
        <section className="ts-side-group">
          <h4>Home layout</h4>
          <button type="button" className="ts-arrange" aria-haspopup="dialog" onClick={arrange.onOpen}>
            <Icon path={ICON_ARRANGE} />
            <span>
              <strong>Arrange home</strong>
              <small>{setupCount(arrange.count, 'item', 'items')}</small>
            </span>
            <Icon path={ICON_NEXT} />
          </button>
        </section>
      )}
      <Checklist title="Required" items={required} />
      <Checklist title="Optional" items={optional} />
      <Facts title="Catalog" facts={catalog} boxed />
      <Facts title="Posters" facts={posters} />
      <Facts title="Preferences" facts={preferences} />
    </div>
  );
}
