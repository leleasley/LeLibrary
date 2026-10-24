import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { apiClient } from '@/api/client';
import { ConfirmModal } from '@/features/setup/shared/Modal';
import { toast } from '@/features/setup/shared/Toast';
import { WebdavCard } from '@/features/setup/shared/webdav-card';
import { useFeatures } from '@/features/site/site-hooks';
import {
  ARTWORK_KEY_FIELDS,
  HOME_ROW_PACKS,
  METADATA_KEY_FIELDS,
  POSTER_PROVIDERS,
  PROVIDER_KEY_FIELDS,
  STREAM_PRESETS,
  VERIFY_ENDPOINTS,
  type SetupKeysDraft,
  type StreamFilterDraft,
  type StreamPresetId,
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
  onResult?: (ok: boolean) => void;
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
        onResult?.(true);
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
export function KeyInput({ label, hint, value, onChange, verifyEndpoint, placeholder, logo, hideLabel, required, docsUrl, onVerifyResult, saved, savedScope, onReveal }: {
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
  onVerifyResult?: (ok: boolean) => void;
  // Editor affordance: the server holds a value for this field (it arrives
  // masked straight into the input on unlock). The tag proves it at a glance.
  saved?: boolean;
  // Which setup "saved" refers to. On an edit page it is this setup, and a blank
  // field keeps the stored secret. On a create page with a staged import it is
  // the OLD setup: nothing is stored for the new one yet, a blank field is not
  // carried over, and creating the setup removes the old one.
  savedScope?: 'setup' | 'import';
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
  const fromImport = savedScope === 'import';
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

  const eyeTitle = revealing ? (fromImport ? 'Fetching it from your imported setup…' : 'Fetching the saved key…')
    : canReveal ? (fromImport ? 'Fetch it from your imported setup' : 'Show saved key')
    : show ? 'Hide key' : 'Show key';

  return (
    <label className={`setup-field setup-provider${value.trim() ? ' is-filled' : ''}`}>
      {!hideLabel && (
        <span className="setup-field-label">
          <span>{label}{required && <span className="req"> *</span>}</span>
          <span className="setup-field-flags">
            {saved && (
              <span className="saved-tag" title={fromImport ? 'Held by the setup you imported' : 'Stored on this server'}>
                {fromImport ? 'From import' : 'Saved ✓'}
              </span>
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
            onResult={(ok) => { setFailed(!ok); setPassed(ok); onVerifyResult?.(ok); }}
            triggerRef={verifyTrigger}
          />
        )}
      </span>
      <small className="setup-hint">{hint}</small>
      {saved && empty && (
        fromImport ? (
          <small className="setup-hint is-warn">
            Empty, so it will not be carried over — and creating this setup removes the old one.
            {onReveal ? ' Press the eye to fetch it, or paste it again.' : ' Paste it again to keep it.'}
          </small>
        ) : (
          <small className="setup-hint">
            {onReveal
              ? 'Saved on the server. Leave blank to keep it, or press the eye to show it.'
              : 'Saved on the server — leave blank to keep it.'}
          </small>
        )
      )}
    </label>
  );
}

// Provider logos live in frontend/public; the keys themselves are sealed
// server-side and never readable again.
const PROVIDER_LOGOS: Partial<Record<keyof SetupKeysDraft, string>> = {
  torboxApiKey: '/provider-logos/torbox.png',
  rdApiKey: '/provider-logos/realdebrid.svg',
  adApiKey: '/provider-logos/alldebrid.png',
  pmApiKey: '/provider-logos/premiumize.svg',
};

export interface RevealProps {
  // Services with a saved server-side value (from the setup summary). Unlocks
  // the per-field Saved indicator; absent on create pages.
  savedServices?: string[] | undefined;
  // Which setup those services belong to (see KeyInput).
  savedScope?: 'setup' | 'import' | undefined;
  // Fetch one saved value on demand (the eye on an empty Saved field). Pages
  // wire this to whichever server path holds the value.
  revealSaved?: ((field: keyof SetupKeysDraft) => Promise<string | null>) | undefined;
}

function keyFields(
  fields: typeof PROVIDER_KEY_FIELDS,
  values: SetupKeysDraft,
  onChange: (next: SetupKeysDraft) => void,
  reveal?: Pick<RevealProps, 'savedServices' | 'savedScope' | 'revealSaved'>,
) {
  const [verified, setVerified] = useState<Record<string, boolean>>({});

  function mark(field: string, ok: boolean) {
    setVerified((prev) => ({ ...prev, [field]: ok }));
  }

  return (
    <>
      {fields.map(({ field, label, hint, logo, required, docsUrl, placeholder }) => (
        <div
          key={field}
          className={`meta-key${verified[field] ? ' is-verified' : ''}${(values[field] ?? '').trim() ? ' is-filled' : ''}${required ? ' is-required' : ''}`}
        >
          <span className={`meta-key-tag${required ? ' is-required' : ''}`}>
            {required ? 'Required' : 'Optional'}
          </span>
          <KeyInput
            label={label}
            hint={hint}
            {...(required ? { required: true } : {})}
            {...(placeholder ? { placeholder } : {})}
            {...(docsUrl ? { docsUrl } : {})}
            value={values[field] ?? ''}
            {...(PROVIDER_LOGOS[field] || logo ? { logo: (PROVIDER_LOGOS[field] || logo) as string } : {})}
            {...(VERIFY_ENDPOINTS[field] ? { verifyEndpoint: VERIFY_ENDPOINTS[field] as string } : {})}
            onVerifyResult={(ok) => mark(field, ok)}
            onChange={(value) => onChange({ ...values, [field]: value })}
            {...(reveal?.savedServices?.includes(field) ? { saved: true } : {})}
            {...(reveal?.savedScope ? { savedScope: reveal.savedScope } : {})}
            {...(reveal?.savedServices?.includes(field) && reveal.revealSaved ? { onReveal: () => reveal.revealSaved!(field) } : {})}
          />
        </div>
      ))}
    </>
  );
}

const PROVIDER_SHORT: Partial<Record<keyof SetupKeysDraft, string>> = {
  torboxApiKey: 'TorBox',
  rdApiKey: 'Real-Debrid',
  adApiKey: 'AllDebrid',
  pmApiKey: 'Premiumize',
};

// Capability line under each provider name.
const PROVIDER_BLURB: Partial<Record<keyof SetupKeysDraft, string>> = {
  torboxApiKey: 'Torrents and Usenet',
  rdApiKey: 'Torrents',
  adApiKey: 'Torrents',
  pmApiKey: 'Torrents and Usenet',
};

// Brand tints sampled from the shipped logo assets (as CSS rgb triplets), so
// each tile glows in its own colour instead of generic grey. Exposed as
// --pc-brand-rgb for rgba(...) usage in setup.css.
const PROVIDER_BRAND: Partial<Record<keyof SetupKeysDraft, string>> = {
  torboxApiKey: '48, 164, 144',
  rdApiKey: '159, 211, 238',
  adApiKey: '224, 86, 138',
  pmApiKey: '238, 90, 61',
};

export function ProviderKeys({ values, onChange, onRemove, savedServices, savedScope, revealSaved }: {
  values: SetupKeysDraft;
  onChange: (next: SetupKeysDraft) => void;
  onRemove?: (field: keyof SetupKeysDraft) => void;
} & RevealProps) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PROVIDER_KEY_FIELDS.map(({ field }) => [field, false])),
  );
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  // Turning a card off clears its key. When the server holds that key, ask
  // first: the switch used to delete a saved or imported key silently.
  const [pendingClear, setPendingClear] = useState<keyof SetupKeysDraft | null>(null);
  // A provider switched on before a key exists: the thumb slides immediately
  // and the card opens for the key. Closing the card without one clears it, so
  // the switch never claims a provider is ready when it has no key.
  const [armed, setArmed] = useState<Record<string, boolean>>({});
  const webdavSource = useFeatures()?.webdavSource === true;

  function toggle(field: keyof SetupKeysDraft) {
    const opening = open[field] === false;
    setOpen((prev) => ({ ...prev, [field]: opening }));
    if (!opening) setArmed((prev) => ({ ...prev, [field]: false }));
  }

  function markVerified(field: keyof SetupKeysDraft, ok: boolean) {
    setVerified((prev) => ({ ...prev, [field]: ok }));
  }

  function enable(field: keyof SetupKeysDraft, enabled: boolean) {
    setOpen((prev) => ({ ...prev, [field]: enabled }));
    if (!enabled) {
      setArmed((prev) => ({ ...prev, [field]: false }));
      markVerified(field, false);
      const next = { ...values };
      delete next[field];
      onChange(next);
    }
  }

  function requestToggle(field: keyof SetupKeysDraft, enabled: boolean) {
    if (!enabled) {
      const holdsKey = Boolean((values[field] ?? '').trim());
      if (holdsKey && savedServices?.includes(field)) {
        setPendingClear(field);
        return;
      }
    }
    enable(field, enabled);
  }

  const clearLabel = pendingClear
    ? (PROVIDER_SHORT[pendingClear] ?? String(pendingClear))
    : '';

  return (
    <>
      <div className="provider-grid">
        {PROVIDER_KEY_FIELDS.map(({ field, label, required, docsUrl, placeholder }) => {
          const filled = Boolean((values[field] ?? '').trim());
          // On means the card holds a key, or the user just switched it on and
          // is entering one. Opening the card by its header does not imply
          // activation; clicking the switch does, and the thumb slides with it.
          const switchOn = filled || armed[field] === true;
          const state = verified[field] ? 'verified' : filled ? 'added' : 'idle';
          return (
            <div
              className={`provider-card${open[field] ? ' is-open' : ''}${verified[field] ? ' is-verified' : ''}${filled ? ' filled' : ''}`}
              key={field}
              style={{ '--pc-brand-rgb': PROVIDER_BRAND[field] } as CSSProperties}
              data-state={state}
            >
              <div
                className="pc-head"
                role="button"
                tabIndex={0}
                aria-expanded={open[field] !== false}
                onClick={() => toggle(field)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(field); } }}
              >
                {PROVIDER_LOGOS[field] && <img src={PROVIDER_LOGOS[field]} alt="" />}
                <div className="pc-title">
                  <strong>{PROVIDER_SHORT[field] ?? label}</strong>
                  {PROVIDER_BLURB[field] && <small>{PROVIDER_BLURB[field]}</small>}
                </div>
                {verified[field] && (
                  <span className="pc-pill is-verified" aria-label="Key verified">
                    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
                      <path d="M2 6.2 4.6 8.8 10 3.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Verified
                  </span>
                )}
                {!verified[field] && filled && <span className="pc-pill is-added">Key added</span>}
                {!verified[field] && !filled && savedServices?.includes(field) && (
                  savedScope === 'import' ? (
                    <span className="pc-pill is-warn" aria-label="In your imported setup, not filled in here">
                      From import
                    </span>
                  ) : (
                    <span className="pc-pill is-verified" aria-label="Key saved on the server">
                      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
                        <path d="M2 6.2 4.6 8.8 10 3.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Saved
                    </span>
                  )
                )}
                <span className="pc-switch">
                  <input
                    type="checkbox"
                    className="pc-toggle"
                    checked={switchOn}
                    aria-label={`Use ${PROVIDER_SHORT[field] ?? label}`}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(event) => {
                      // No key yet: switch on, slide the thumb across and open
                      // the card for the key. Switching it off again closes it.
                      if (!filled) {
                        const next = event.target.checked;
                        setArmed((prev) => ({ ...prev, [field]: next }));
                        setOpen((prev) => ({ ...prev, [field]: next }));
                        return;
                      }
                      requestToggle(field, event.target.checked);
                    }}
                  />
                  <span className="pc-switch-track" aria-hidden="true"><span className="pc-switch-thumb" /></span>
                </span>
              </div>
              {open[field] !== false && (
                <div className="pc-body">
                  <KeyInput
                    label={label}
                    hint=""
                    {...(required ? { required: true } : {})}
                    {...(placeholder ? { placeholder } : {})}
                    {...(docsUrl ? { docsUrl } : {})}
                    value={values[field] ?? ''}
                    {...(VERIFY_ENDPOINTS[field] ? { verifyEndpoint: VERIFY_ENDPOINTS[field] as string } : {})}
                    onVerifyResult={(ok) => markVerified(field, ok)}
                    onChange={(value) => {
                      onChange({ ...values, [field]: value });
                      // Removing the last character returns the switch to off.
                      if (!value.trim()) setArmed((prev) => ({ ...prev, [field]: false }));
                    }}
                    {...(savedServices?.includes(field) ? { saved: true } : {})}
                    {...(savedScope ? { savedScope } : {})}
                    {...(savedServices?.includes(field) && revealSaved ? { onReveal: () => revealSaved(field) } : {})}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <WebdavCard enabled={webdavSource} values={values} onChange={onChange} onRemove={onRemove} savedServices={savedServices} savedScope={savedScope} />
      <p className="setup-note">
        Add at least one. Keys are sealed on the server.
      </p>

      <ConfirmModal
        open={pendingClear !== null}
        title={`Remove the ${clearLabel} key?`}
        body={`${clearLabel} is stored on this server. Turning it off here removes it when you save, and this setup stops reading your ${clearLabel} library until a key is added again.`}
        confirmLabel="Remove key"
        cancelLabel="Keep it"
        danger
        onConfirm={() => {
          if (pendingClear) {
            if (savedServices?.includes(pendingClear)) onRemove?.(pendingClear);
            enable(pendingClear, false);
          }
          setPendingClear(null);
        }}
        onCancel={() => setPendingClear(null)}
      />
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

export function MetadataKeys({ values, onChange, savedServices, savedScope, revealSaved }: {
  values: SetupKeysDraft;
  onChange: (next: SetupKeysDraft) => void;
} & RevealProps) {
  return <div className="key-card-list">{keyFields(METADATA_KEY_FIELDS, values, onChange, { savedServices, savedScope, revealSaved })}</div>;
}

export function ListKey({ value, onChange, savedServices, savedScope, revealSaved }: {
  value: string;
  onChange: (value: string) => void;
} & RevealProps) {
  return (
    <div className="key-card-list">
      <KeyInput
        label="MDBList API key"
        hint="Unlocks MDBList list rows and collection sources."
        logo="/logos/mdblist.svg"
        value={value}
        verifyEndpoint="/api/verify/mdblist"
        onChange={onChange}
        {...(savedServices?.includes('mdblistKey') ? { saved: true } : {})}
        {...(savedScope ? { savedScope } : {})}
        {...(savedServices?.includes('mdblistKey') && revealSaved ? { onReveal: () => revealSaved('mdblistKey') } : {})}
      />
    </div>
  );
}

// One-click home-row packs. Ids are validated server-side; unknown ids are refused.
export function HomeRows({ values, onChange }: {
  values: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(values.includes(id) ? values.filter((kept) => kept !== id) : [...values, id]);
  }
  return (
    <div className="setup-checks">
      {HOME_ROW_PACKS.map((pack) => (
        <label className="setup-check" key={pack.id}>
          <input type="checkbox" checked={values.includes(pack.id)} onChange={() => toggle(pack.id)} />
          <span>{pack.name}</span>
        </label>
      ))}
      <p className="setup-note">Pick the rows you actually watch. You can change these later.</p>
    </div>
  );
}

export function StreamFilters({ values, onChange }: {
  values: StreamFilterDraft;
  onChange: (next: StreamFilterDraft) => void;
}) {
  return (
    <>
      <label className="setup-check">
        <input
          type="checkbox" checked={values.hideUncached}
          onChange={(event) => onChange({ ...values, hideUncached: event.target.checked })}
        />
        <span>Hide uncached sources</span>
      </label>
      <div className="setup-row">
        <label className="setup-field">
          <span>Minimum resolution</span>
          <select
            value={values.minResolution}
            onChange={(event) => onChange({ ...values, minResolution: event.target.value as StreamFilterDraft['minResolution'] })}
          >
            <option value="">Any</option>
            <option value="480p">480p</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="2160p">2160p</option>
          </select>
        </label>
        <label className="setup-field">
          <span>Maximum file size (GB)</span>
          <input
            inputMode="decimal" placeholder="No limit"
            value={values.maxSizeGb} onChange={(event) => onChange({ ...values, maxSizeGb: event.target.value })}
          />
        </label>
      </div>
    </>
  );
}
