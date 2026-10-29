import { useState, type ReactNode } from 'react';

// Same scale as the shared PasswordFields, split into four segments so the
// meter fills in visible steps rather than one stretching bar.
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0;
  if (password.length < 8) return 1;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((rule) => rule.test(password)).length;
  if (password.length >= 14 || (password.length >= 10 && variety >= 3)) return 4;
  if (password.length >= 10 || variety >= 3) return 3;
  return 2;
}

const STRENGTH_LABEL = ['', 'Too short', 'Okay', 'Good', 'Strong'] as const;

// Step 4: lock the setup and create the install link. The password only ever
// guards editing; the player never asks for it.
// The setup password is not a site login: tell the common password managers
// not to pop their fill and generate menus over it (they also stole focus and
// Escape presses from the end screen).
const QUIET_FIELD = { 'data-1p-ignore': 'true', 'data-lpignore': 'true', 'data-bwignore': 'true', 'data-form-type': 'other' } as const;

export function TierInstall({ password, confirmation, busy, error, onPassword, onConfirmation, onSubmit, onReset, submitLabel = 'Create my manifest', children }: {
  password: string;
  confirmation: string;
  busy: boolean;
  error: string | null;
  onPassword: (value: string) => void;
  onConfirmation: (value: string) => void;
  onSubmit: () => void;
  onReset?: () => void;
  submitLabel?: string;
  children?: ReactNode;
}) {
  const [show, setShow] = useState(false);
  const strength = passwordStrength(password);
  const match = confirmation.length > 0 && password === confirmation;
  const mismatch = confirmation.length > 0 && password !== confirmation;
  const ready = password.length > 0 && match;
  const status = !password ? 'Choose a password to lock your setup'
    : mismatch ? 'Passwords do not match'
    : match ? 'Passwords match - ready to create'
    : 'Confirm your password';

  return (
    <form className="qs-install" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <div className="qs-pw-grid">
        <label className="qs-pw">
          <span className="qs-pw-label">Password</span>
          <span className={`qs-pw-box${mismatch ? ' is-error' : match ? ' is-ok' : ''}`}>
            <input
              type={show ? 'text' : 'password'} autoComplete="new-password" {...QUIET_FIELD}
              placeholder="At least 8 characters"
              value={password}
              onChange={(event) => onPassword(event.target.value)}
            />
            <button
              type="button" className="qs-pw-eye"
              aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
              onClick={() => setShow((value) => !value)}
            >
              {show ? 'Hide' : 'Show'}
            </button>
          </span>
          <span className="qs-meter" aria-hidden="true">
            {[1, 2, 3, 4].map((step) => <i key={step} className={strength >= step ? `is-on is-${strength}` : undefined} />)}
          </span>
          {strength > 0 && <span className={`qs-meter-label is-${strength}`}>{STRENGTH_LABEL[strength]}</span>}
        </label>

        <label className="qs-pw">
          <span className="qs-pw-label">Confirm password</span>
          <span className={`qs-pw-box${mismatch ? ' is-error' : match ? ' is-ok' : ''}`}>
            <input
              type={show ? 'text' : 'password'} autoComplete="new-password" {...QUIET_FIELD}
              placeholder="Type it again"
              value={confirmation}
              onChange={(event) => onConfirmation(event.target.value)}
            />
            {match && <span className="qs-pw-state is-ok" aria-label="Passwords match">✓</span>}
            {mismatch && <span className="qs-pw-state is-error" aria-label="Passwords do not match">✕</span>}
          </span>
        </label>
      </div>

      <p className={`qs-pw-status${match ? ' is-ok' : mismatch ? ' is-error' : ''}`} aria-live="polite">{status}</p>

      <div className="qs-facts">
        <span><b>No email, no recovery.</b> Save both your manifest link and this password.</span>
        <span><b>Watching never asks for it.</b> It only guards changing settings.</span>
      </div>

      {children}
      {error && <p className="setup-error" role="alert">{error}</p>}

      <button type="submit" className={`qs-cta${ready ? ' is-ready' : ''}`} disabled={busy || !ready}>
        <span className="qs-cta-text">{busy ? 'Creating…' : submitLabel}</span>
        <span className="qs-cta-apps" aria-hidden="true">
          <img src="/stremio.svg" alt="" />
          <img src="/nuvio.png" alt="" />
        </span>
      </button>
      {onReset && <button type="button" className="pw-reset-link" onClick={onReset}>Start over</button>}
    </form>
  );
}
