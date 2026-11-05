import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { apiClient } from '@/api/client';
import { ConfirmModal } from '@/features/setup/shared/Modal';
import { toast } from '@/features/setup/shared/Toast';
import { WebdavCard } from '@/features/setup/shared/webdav-card';
import { useFeatures } from '@/features/site/site-hooks';
import {
  PROVIDER_KEY_FIELDS,
  VERIFY_ENDPOINTS,
  type SetupKeysDraft,
} from '@/features/setup/shared/config-contract';

interface VerifyResult {
  valid?: boolean;
  username?: string | null;
  error?: string;
}

// Live key check against POST /api/verify/*. Green with the account name when
// the provider returns one, red with the server's message otherwise.
export function VerifyButton({ endpoint, value, label, onResult, triggerRef }: {
  endpoint: string;
  value: string;
  label?: string;
  // The account name the provider returned, when it returns one (MDBList).
  onResult?: (ok: boolean, username?: string | null) => void;
  // Lets the input ask for a check on blur, so a pasted key is verified without
  // hunting for the tick button.
  triggerRef?: { current: (() => void) | null };
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'bad'>('idle');
  // The value last checked, so an unchanged key is never re-checked.
  const checkedRef = useRef('');

  useEffect(() => { setState('idle'); checkedRef.current = ''; }, [value]);

  async function verify() {
    const key = value.trim();
    if (!key || state === 'busy') return;
    if (checkedRef.current === key && state === 'ok') return;
    setState('busy');
    try {
      const data = await apiClient.post<VerifyResult>(endpoint, { key });
      const who = label ? `${label}: ` : '';
      if (data?.valid) {
        checkedRef.current = key;
        setState('ok');
        toast(`${who}${data.username ? `connected as ${data.username}` : 'key verified'}`);
        onResult?.(true, typeof data.username === 'string' && data.username.trim() ? data.username.trim() : null);
      } else {
        checkedRef.current = '';
        setState('bad');
        toast(`${who}${data?.error || 'invalid key'}`, 'error');
        onResult?.(false);
      }
    } catch {
      checkedRef.current = '';
      setState('bad');
      toast(`${label ? `${label}: ` : ''}could not reach the verifier`, 'error');
      onResult?.(false);
    }
  }

  if (triggerRef) triggerRef.current = () => { void verify(); };

  const glyph = state === 'busy' ? '…' : state === 'ok' ? '✓' : state === 'bad' ? '✕' : '✓';
  return (
    <span className="setup-verify">
      <button
        type="button"
        className={`setup-verify-btn is-${state}`}
        disabled={!value.trim() || state === 'busy'}
        title={state === 'ok' ? 'Key verified' : state === 'bad' ? 'Key rejected' : 'Verify key'}
        aria-label={state === 'ok' ? 'Key verified' : 'Verify key'}
        onClick={() => void verify()}
      >
        {glyph}
      </button>
    </span>
  );
}

// One secret input with an optional live verify and eye toggle. The label row
// carries the required marker and the provider's "Get key" link, matching the
// reference; the input, eye and verify always sit on one line.
export function KeyInput({ label, hint, value, onChange, verifyEndpoint, placeholder, logo, hideLabel, required, docsUrl, onVerifyResult, saved, onReveal }: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  verifyEndpoint?: string;
  placeholder?: string;
  logo?: string;
  hideLabel?: boolean;
  required?: boolean;
  docsUrl?: string;
  onVerifyResult?: (ok: boolean, username?: string | null) => void;
  // Editor affordance: the server holds a value for this field (it arrives
  // masked straight into the input on unlock). The tag proves it at a glance.
  saved?: boolean;
  // Fetch the server-held value for this field on demand. Without it the eye is
  // a plain visibility toggle; with it, an empty "saved" field fetches the real
  // value first, so asking to see a saved key actually shows it.
  onReveal?: () => Promise<string | null>;
}) {
  const [show, setShow] = useState(false);
  const [failed, setFailed] = useState(false);
  const [passed, setPassed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const empty = value.trim().length === 0;
  const canReveal = Boolean(onReveal) && saved === true && empty;
  // Checks on the input's blur, and straight after a reveal fills the field, so
  // a key is verified without the user having to find the tick.
  const verifyTrigger = useRef<(() => void) | null>(null);

  async function toggleVisibility() {
    if (canReveal && !show && !revealing) {
      setRevealing(true);
      try {
        const fetched = await onReveal!();
        if (fetched && fetched.trim()) {
          setShow(true);
          // Revealed values are checked straight away: the point of showing a
          // saved key is knowing it still works.
          window.setTimeout(() => verifyTrigger.current?.(), 0);
        } else {
          toast(`${label}: no saved value to show`, 'error');
        }
      } catch (caught) {
        toast(`${label}: ${caught instanceof Error ? caught.message : 'could not show the saved key'}`, 'error');
      } finally {
        setRevealing(false);
      }
      return;
    }
    setShow((visible) => !visible);
  }

  const eyeTitle = revealing ? 'Fetching the saved key…'
    : canReveal ? 'Show saved key'
    : show ? 'Hide key' : 'Show key';

  return (
    <label className={`setup-field setup-provider${value.trim() ? ' is-filled' : ''}`}>
      {!hideLabel && (
        <span className="setup-field-label">
          <span>{label}{required && <span className="req"> *</span>}</span>
          <span className="setup-field-flags">
            {saved && (
              <span className="saved-tag" title="Stored on this server">Saved ✓</span>
            )}
            {docsUrl && <a href={docsUrl} target="_blank" rel="noopener">Get key →</a>}
          </span>
        </span>
      )}
      <span className="setup-provider-row">
        {logo && <img src={logo} alt="" className="setup-provider-logo" />}
        <input
          type={show ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder ?? (required ? 'Required' : 'Optional')}
          value={value}
          onChange={(event) => { setFailed(false); setPassed(false); onVerifyResult?.(false); onChange(event.target.value); }}
          onBlur={() => verifyTrigger.current?.()}
          className={failed ? 'invalid' : passed ? 'valid' : undefined}
          aria-invalid={failed}
        />
        <button
          type="button"
          className={`eye-btn${revealing ? ' is-busy' : ''}`}
          title={eyeTitle}
          aria-label={eyeTitle}
          aria-pressed={show}
          disabled={revealing}
          onClick={() => void toggleVisibility()}
        >
          {revealing ? '…' : show ? '🙈' : '👁'}
        </button>
        {verifyEndpoint && (
          <VerifyButton
            endpoint={verifyEndpoint} value={value}
            label={label.replace(/ (API )?key$| key$/i, '')}
            onResult={(ok, username) => { setFailed(!ok); setPassed(ok); onVerifyResult?.(ok, username); }}
            triggerRef={verifyTrigger}
          />
        )}
      </span>
      <small className="setup-hint">{hint}</small>
      {saved && empty && (
        <small className="setup-hint">
          {onReveal
            ? 'Saved on the server. Leave blank to keep it, or press the eye to show it.'
            : 'Saved on the server - leave blank to keep it.'}
        </small>
      )}
    </label>
  );
}

export interface RevealProps {
  // Services with a saved server-side value (from the setup summary). Unlocks
  // the per-field Saved indicator; absent on create pages.
  savedServices?: string[] | undefined;
  // Fetch one saved value on demand (the eye on an empty Saved field). Pages
  // wire this to whichever server path holds the value.
  revealSaved?: ((field: keyof SetupKeysDraft) => Promise<string | null>) | undefined;
}

// One service on a key card: what the head shows and what the key input needs.
export interface KeyCardSpec {
  field: keyof SetupKeysDraft;
  // Short name in the card head ("TorBox", "TMDB").
  name: string;
  // The key input's own label ("TorBox API key").
  label: string;
  blurb?: string;
  // A logo in the head tile; services without one get `monogram` instead.
  logo?: string;
  monogram?: string;
  // Brand tint as a CSS rgb triplet (--pc-brand-rgb).
  brand?: string;
  placeholder?: string;
  docsUrl?: string;
  // Help line under the key input (empty by default: the blurb says it).
  hint?: string;
  // Required cards stay open and carry no switch: the setup cannot do without them.
  required?: boolean;
  // Spans the whole grid row (a card with a longer body).
  wide?: boolean;
}

const CHECK_ICON = (
  <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
    <path d="M2 6.2 4.6 8.8 10 3.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// The head tile: the service's logo, or a monogram in the same slot.
export function KeyCardTile({ logo, monogram, invert }: { logo?: string | undefined; monogram?: string | undefined; invert?: boolean | undefined }) {
  if (logo) return <img src={logo} alt="" className={invert ? 'pc-logo-invert' : undefined} />;
  if (monogram) return <span className="pc-mono" aria-hidden="true" data-i18n-preserve>{monogram}</span>;
  return null;
}

// The one key card: the library providers, the metadata keys and MDBList all
// use it. Logo, name, blurb and a status pill in the head; the switch turns a
// service on (opening the card for its key) or off (dropping the key, after a
// confirm when the server holds it); the body is the key input with its Get
// key link, verify on blur and saved/reveal handling. `identity` is the
// account name to show ("Connected as ..."); `onIdentity` hears the name a
// verify returned (null when the key changed or failed).
export function KeyCard({ spec, value, onChange, onClear, saved, onReveal, identity, onIdentity, defaultOpen, children }: {
  spec: KeyCardSpec;
  value: string;
  onChange: (value: string) => void;
  // Drop the key. `fromServer` is true when the server held it, so the page
  // also clears it on save.
  onClear: (fromServer: boolean) => void;
  saved?: boolean | undefined;
  onReveal?: (() => Promise<string | null>) | undefined;
  identity?: string | null | undefined;
  onIdentity?: ((name: string | null) => void) | undefined;
  // Tests only: every card starts closed for people.
  defaultOpen?: boolean | undefined;
  children?: ReactNode;
}) {
  const required = spec.required === true;
  const [open, setOpen] = useState(defaultOpen === true);
  const [verified, setVerified] = useState(false);
  // Switched on before a key exists: the thumb slides immediately and the
  // card opens for the key. Closing the card without one switches it back
  // off, so the switch never claims a service is ready when it has no key.
  const [armed, setArmed] = useState(false);
  // Turning a card off clears its key. When the server holds that key, ask
  // first: the switch used to delete a saved key silently.
  const [confirmClear, setConfirmClear] = useState(false);
  const filled = Boolean(value.trim());
  const isOpen = open;
  const switchOn = filled || armed;
  const state = verified ? 'verified' : filled ? 'added' : 'idle';

  function toggle() {
    const opening = !open;
    setOpen(opening);
    if (!opening) setArmed(false);
  }

  function clear(fromServer: boolean) {
    setOpen(false);
    setArmed(false);
    setVerified(false);
    onIdentity?.(null);
    onClear(fromServer);
  }

  function onSwitch(checked: boolean) {
    // No key yet: switch on, slide the thumb across and open the card for
    // the key. Switching it off again closes it.
    if (!filled) {
      setArmed(checked);
      setOpen(checked);
      return;
    }
    if (checked) { setOpen(true); return; }
    if (saved) { setConfirmClear(true); return; }
    clear(false);
  }

  const headProps = {
    role: 'button',
    tabIndex: 0,
    'aria-expanded': isOpen,
    onClick: toggle,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
    },
  };

  return (
    <div
      className={`provider-card${isOpen ? ' is-open' : ''}${verified ? ' is-verified' : ''}${filled ? ' filled' : ''}${required ? ' is-required' : ''}${spec.wide ? ' is-wide' : ''}`}
      style={spec.brand ? { '--pc-brand-rgb': spec.brand } as CSSProperties : undefined}
      data-state={state}
      data-field={spec.field}
    >
      <div className="pc-head" {...headProps}>
        <KeyCardTile logo={spec.logo} monogram={spec.monogram} />
        <div className="pc-title">
          <strong data-i18n-preserve>{spec.name}</strong>
          {spec.blurb && <small>{spec.blurb}</small>}
          {identity && <small className="pc-identity">{`Connected as ${identity}`}</small>}
        </div>
        {verified && (
          <span className="pc-pill is-verified" aria-label="Key verified">{CHECK_ICON}Verified</span>
        )}
        {!verified && filled && <span className="pc-pill is-added">Key added</span>}
        {!verified && !filled && saved && (
          <span className="pc-pill is-verified" aria-label="Key saved on the server">{CHECK_ICON}Saved</span>
        )}
        {!filled && !saved && required && <span className="pc-pill is-warn">Required</span>}
        <span className="pc-switch">
          <input
            type="checkbox"
            className="pc-toggle"
            checked={switchOn}
            aria-label={`Use ${spec.name}`}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onSwitch(event.target.checked)}
          />
          <span className="pc-switch-track" aria-hidden="true"><span className="pc-switch-thumb" /></span>
        </span>
      </div>
      {isOpen && (
        <div className="pc-body">
          <KeyInput
            label={spec.label}
            hint={spec.hint ?? ''}
            {...(required ? { required: true } : {})}
            {...(spec.placeholder ? { placeholder: spec.placeholder } : {})}
            {...(spec.docsUrl ? { docsUrl: spec.docsUrl } : {})}
            value={value}
            {...(VERIFY_ENDPOINTS[spec.field] ? { verifyEndpoint: VERIFY_ENDPOINTS[spec.field] as string } : {})}
            onVerifyResult={(ok, username) => {
              setVerified(ok);
              // A changed or rejected key forgets the name; a pass reports it.
              if (!ok) onIdentity?.(null);
              else if (username) onIdentity?.(username);
            }}
            onChange={(next) => {
              onChange(next);
              // Removing the last character returns the switch to off.
              if (!next.trim()) setArmed(false);
            }}
            {...(saved ? { saved: true } : {})}
            {...(saved && onReveal ? { onReveal } : {})}
          />
          {children}
        </div>
      )}
      <ConfirmModal
        open={confirmClear}
        title={`Remove the ${spec.name} key?`}
        body={`${spec.name} is stored on this server. Turning it off here removes it when you save, and this setup stops using ${spec.name} until a key is added again.`}
        confirmLabel="Remove key"
        cancelLabel="Keep it"
        danger
        onConfirm={() => { setConfirmClear(false); clear(true); }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}

export type KeyCardExtras = Partial<Record<keyof SetupKeysDraft, {
  identity?: string | null | undefined;
  onIdentity?: ((name: string | null) => void) | undefined;
  children?: ReactNode;
}>>;

// Cards for a list of key fields, sharing the page's keys object. The library
// providers and the metadata keys both render through it.
export function KeyCardGrid({ specs, values, onChange, onRemove, savedServices, revealSaved, extras }: {
  specs: KeyCardSpec[];
  values: SetupKeysDraft;
  onChange: (next: SetupKeysDraft) => void;
  onRemove?: ((field: keyof SetupKeysDraft) => void) | undefined;
  // Per-field extras: the account name and body notes (MDBList).
  extras?: KeyCardExtras | undefined;
} & RevealProps) {
  return (
    <div className="provider-grid">
      {specs.map((spec) => {
        const saved = savedServices?.includes(spec.field) === true;
        const extra = extras?.[spec.field];
        return (
          <KeyCard
            key={spec.field}
            spec={spec}
            value={values[spec.field] ?? ''}
            onChange={(value) => onChange({ ...values, [spec.field]: value })}
            onClear={(fromServer) => {
              if (fromServer) onRemove?.(spec.field);
              const next = { ...values };
              delete next[spec.field];
              onChange(next);
            }}
            saved={saved}
            onReveal={saved && revealSaved ? () => revealSaved(spec.field) : undefined}
            identity={extra?.identity}
            onIdentity={extra?.onIdentity}
          >
            {extra?.children}
          </KeyCard>
        );
      })}
    </div>
  );
}

// Provider logos live in frontend/public; the keys themselves are sealed
// server-side and never readable again. The capability line under each name,
// and brand tints sampled from the shipped logo assets (CSS rgb triplets), so
// each tile glows in its own colour instead of generic grey.
const PROVIDER_CARDS: Partial<Record<keyof SetupKeysDraft, { name: string; blurb: string; logo: string; brand: string }>> = {
  torboxApiKey: { name: 'TorBox', blurb: 'Torrents and Usenet', logo: '/provider-logos/torbox.png', brand: '48, 164, 144' },
  rdApiKey: { name: 'Real-Debrid', blurb: 'Torrents', logo: '/provider-logos/realdebrid.svg', brand: '159, 211, 238' },
  adApiKey: { name: 'AllDebrid', blurb: 'Torrents', logo: '/provider-logos/alldebrid.png', brand: '224, 86, 138' },
  pmApiKey: { name: 'Premiumize', blurb: 'Torrents and Usenet', logo: '/provider-logos/premiumize.svg', brand: '238, 90, 61' },
};

export const PROVIDER_CARD_SPECS: KeyCardSpec[] = PROVIDER_KEY_FIELDS.map(({ field, label, docsUrl, placeholder }) => ({
  field,
  label,
  ...(PROVIDER_CARDS[field] ?? { name: label }),
  ...(docsUrl ? { docsUrl } : {}),
  ...(placeholder ? { placeholder } : {}),
}));

export function ProviderKeys({ values, onChange, onRemove, savedServices, revealSaved }: {
  values: SetupKeysDraft;
  onChange: (next: SetupKeysDraft) => void;
  onRemove?: ((field: keyof SetupKeysDraft) => void) | undefined;
} & RevealProps) {
  const webdavSource = useFeatures()?.webdavSource === true;
  return (
    <>
      <KeyCardGrid
        specs={PROVIDER_CARD_SPECS} values={values} onChange={onChange} onRemove={onRemove}
        savedServices={savedServices} revealSaved={revealSaved}
      />
      <WebdavCard enabled={webdavSource} values={values} onChange={onChange} onRemove={onRemove} savedServices={savedServices} />
      <p className="setup-note">
        Add at least one. Keys are sealed on the server.
      </p>
    </>
  );
}

// Catalogue organization: one combined library or a separate row per
// provider. The backend honours `rdCatalog` on the config.
export function RdCatalogSelect({ value, onChange }: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="setup-field">
      <span>Catalogue organization</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label="Catalogue organization">
        <option value="merge">Combined library</option>
        <option value="separate">Separate provider rows</option>
      </select>
      <small className="setup-hint">Combine providers into one library or keep a separate row for each.</small>
    </label>
  );
}
