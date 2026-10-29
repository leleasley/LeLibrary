import { apiErrorCopy } from '@/api/error-copy';
import { useEffect, useState } from 'react';
import { toast } from '@/features/setup/shared/Toast';
import { setupCopy } from '@/features/setup/shared/setup-copy';
import {
  SIGNUP_LINKS,
  SignupUnavailableError,
  loginNuvio,
  loginStremio,
  refreshNuvioConnection,
  registerStremio,
  signupNuvio,
  type NuvioProfileRef,
  type PlatformConnection,
} from '@/features/setup/full/platform-login';

function connectionUser(connection: PlatformConnection): string {
  const user = (connection.platform === 'nuvio' ? connection.nuvioUser : connection.stremioUser) as Record<string, unknown> | null;
  if (user && typeof user === 'object') {
    for (const key of ['email', 'username', 'name']) {
      if (typeof user[key] === 'string' && (user[key] as string).trim()) return (user[key] as string).trim();
    }
  }
  return connection.platform === 'nuvio' ? 'Your Nuvio account' : 'Your Stremio account';
}

// Step 1 destination: pick the player, optionally sign in so review can push
// straight after creation. Sign-in runs browser-to-platform; only the
// session is sealed on the server when the setup is saved. Switching player
// drops the other player's session, so a push never targets the wrong app.
export function DestinationStep({ platform, onPlatform, connection, onConnection, savedAccount, onSavedProfile, profileName = '' }: {
  platform: 'nuvio' | 'stremio';
  onPlatform: (next: 'nuvio' | 'stremio') => void;
  connection: PlatformConnection | null;
  onConnection: (next: PlatformConnection | null) => void;
  // A connection already stored for this setup. When one exists there is
  // nothing to sign in for, so say so instead of showing an empty login form.
  savedAccount?: { user: string | null; profiles: NuvioProfileRef[]; selected: number | null } | null;
  onSavedProfile?: (profileIndex: number) => void;
  // Name for the first Nuvio profile when a new account is created here.
  profileName?: string;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  // Sign in to an existing account, or create one (browser-to-platform).
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [agreed, setAgreed] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [profilesBusy, setProfilesBusy] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);

  const active = connection && connection.platform === platform ? connection : null;
  const profiles = active?.platform === 'nuvio' ? (active.nuvioProfiles ?? []) : [];
  const saved = savedAccount ?? null;
  const showSaved = Boolean(saved) && !active && !reconnecting;
  const nuvioToken = active?.platform === 'nuvio' ? active.nuvioToken ?? null : null;

  // The saved account is shown instead of a login form; connecting again is an
  // explicit choice, so drop back to the form only when asked.
  useEffect(() => { setReconnecting(false); }, [platform]);

  // Imported connections carry a profile snapshot: refresh it from Nuvio so a
  // profile created since the import is selectable. Keyed on the token, not the
  // connection, so the update this makes cannot loop.
  useEffect(() => {
    if (!active || active.platform !== 'nuvio' || !active.nuvioToken) return;
    let cancelled = false;
    setProfilesBusy(true);
    setProfilesError(null);
    refreshNuvioConnection(active)
      .then((next) => { if (!cancelled) onConnection(next); })
      .catch((error) => {
        if (!cancelled) setProfilesError(apiErrorCopy(error, 'Could not load your Nuvio profiles'));
      })
      .finally(() => { if (!cancelled) setProfilesBusy(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nuvioToken]);

  async function refreshProfiles() {
    if (!active || active.platform !== 'nuvio' || !active.nuvioToken || profilesBusy) return;
    setProfilesBusy(true);
    setProfilesError(null);
    try {
      onConnection(await refreshNuvioConnection(active));
      toast('Profile list refreshed');
    } catch (error) {
      setProfilesError(apiErrorCopy(error, 'Could not load your Nuvio profiles'));
    } finally {
      setProfilesBusy(false);
    }
  }

  function pick(next: 'nuvio' | 'stremio') {
    if (next === platform) return;
    onPlatform(next);
    onConnection(null);
    setEmail('');
    setPassword('');
    setAgreed(false);
    setUnavailable(null);
  }

  function switchMode(next: 'signin' | 'create') {
    setMode(next);
    setUnavailable(null);
    setPassword('');
  }

  async function connect() {
    if (busy) return;
    setBusy(true);
    setUnavailable(null);
    try {
      const creating = mode === 'create';
      const result = creating
        ? (platform === 'nuvio'
          ? await signupNuvio(email.trim(), password, { agreed, profileName })
          : await registerStremio(email.trim(), password, { agreed }))
        : (platform === 'nuvio'
          ? await loginNuvio(email.trim(), password)
          : await loginStremio(email.trim(), password));
      onConnection(result);
      setPassword('');
      toast(creating
        ? setupCopy('Account created and connected. Use this email and password in the app.', 'Account created and connected. Use this email and password in the app.')
        : 'Connected');
    } catch (error) {
      const message = apiErrorCopy(error, mode === 'create' ? 'Could not create the account' : 'Could not sign in');
      if (error instanceof SignupUnavailableError) setUnavailable(setupCopy(message, message));
      else toast(setupCopy(message, message), 'error');
    } finally {
      setBusy(false);
    }
  }

  function changeAccount() {
    onConnection(null);
    setEmail('');
    setPassword('');
  }

  return (
    <div className="destination-step">
      <div className="platform-grid" role="group" aria-label="Destination platform">
        <button
          type="button" className={`platform-card${platform === 'nuvio' ? ' active' : ''}`}
          aria-pressed={platform === 'nuvio'} onClick={() => pick('nuvio')}
        >
          <span className="platform-logo"><img src="/nuvio.png" alt="" /></span>
          <span><strong>Nuvio</strong><small>Profile collections, artwork and focus animation</small></span>
          <span className="selection-mark" aria-hidden="true" />
        </button>
        <button
          type="button" className={`platform-card${platform === 'stremio' ? ' active' : ''}`}
          aria-pressed={platform === 'stremio'} onClick={() => pick('stremio')}
        >
          <span className="platform-logo"><img src="/stremio.svg" alt="" /></span>
          <span><strong>Stremio</strong><small>Curated Home rows and catalogue discovery</small></span>
          <span className="selection-mark" aria-hidden="true" />
        </button>
      </div>
      <div className="connection-panel">
        {showSaved ? (
          <div className="destination-connection">
            <img src={platform === 'nuvio' ? '/nuvio.png' : '/stremio.svg'} alt="" />
            <div>
              <span className="verify-badge ok">Connected</span>
              <strong>{saved?.user || 'Your account'}</strong>
              <span className="setup-note">
                Already saved on this server: a push uses it, no login needed
                {platform === 'nuvio' && saved && saved.profiles.length > 0 ? ` — ${saved.profiles.find((p) => p.profile_index === saved.selected)?.name ?? 'first profile'} receives it.` : '.'}
              </span>
              {platform === 'nuvio' && saved && saved.profiles.length > 1 && (
                <label className="setup-field action-inline-field">
                  <span>Nuvio profile</span>
                  <select
                    value={saved.selected ?? ''}
                    aria-label="Nuvio profile"
                    onChange={(event) => onSavedProfile?.(Number(event.target.value))}
                  >
                    {saved.profiles.map((profile) => (
                      <option key={profile.profile_index} value={profile.profile_index} data-i18n-preserve>{profile.name}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <button type="button" className="setup-secondary" onClick={() => setReconnecting(true)}>
              Change account
            </button>
          </div>
        ) : !active ? (
          <div className="connection-form">
            <div className="connection-mode" role="group" aria-label={platform === 'nuvio' ? 'Nuvio account' : 'Stremio account'}>
              <span>{platform === 'nuvio' ? 'Have a Nuvio account?' : 'Have a Stremio account?'}</span>
              <button type="button" className={mode === 'signin' ? 'is-active' : ''} aria-pressed={mode === 'signin'} onClick={() => switchMode('signin')}>Sign in</button>
              <span aria-hidden="true">or</span>
              <button type="button" className={mode === 'create' ? 'is-active' : ''} aria-pressed={mode === 'create'} onClick={() => switchMode('create')}>Create one</button>
            </div>
            {saved && (
              <p className="setup-note">
                Connecting here replaces the session already saved for this setup.
              </p>
            )}
            <label className="setup-field">
              <span>{platform === 'nuvio' ? 'Nuvio email' : 'Stremio email'}</span>
              <input
                type="email" autoComplete="username" value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void connect(); } }}
              />
            </label>
            <label className="setup-field">
              <span>Password</span>
              <span className="setup-provider-row">
                <input
                  type={showPassword ? 'text' : 'password'} autoComplete={mode === 'create' ? 'new-password' : 'current-password'} value={password}
                  minLength={mode === 'create' ? 8 : undefined}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void connect(); } }}
                />
                <button
                  type="button" className="eye-btn" aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? '🙈' : '👁'}
                </button>
              </span>
            </label>
            {mode === 'create' && (
              <>
                <small className="setup-hint">At least 8 characters. You sign in to the app with this email and password.</small>
                <label className="connection-agree">
                  <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
                  <span>
                    {platform === 'nuvio' ? 'I agree to Nuvio\'s Terms and Privacy Policy.' : 'I agree to Stremio\'s Terms and Privacy Policy.'}
                    <span className="connection-links">
                      <a href={SIGNUP_LINKS[platform].terms} target="_blank" rel="noopener noreferrer">Terms</a>
                      <span aria-hidden="true"> · </span>
                      <a href={SIGNUP_LINKS[platform].privacy} target="_blank" rel="noopener noreferrer">Privacy Policy</a>
                    </span>
                  </span>
                </label>
              </>
            )}
            {unavailable && (
              <p className="setup-error" role="alert">
                {unavailable}{' '}
                <a href={SIGNUP_LINKS[platform].page} target="_blank" rel="noopener noreferrer">
                  {platform === 'nuvio' ? 'Open Nuvio' : 'Open Stremio'}
                </a>
              </p>
            )}
            <button type="button" className="setup-primary" disabled={busy || (mode === 'create' && !agreed)} onClick={() => void connect()}>
              {mode === 'create'
                ? (busy ? 'Creating account…' : 'Create account')
                : (busy ? 'Connecting…' : 'Connect')}
            </button>
            <p className="setup-note connection-note">
              {mode === 'create'
                ? `Optional. The account is created by ${platform === 'nuvio' ? 'Nuvio' : 'Stremio'} itself, straight from this page: LeLibrary never sees or stores your password, only the session when you save.`
                : `Optional. Sign-in goes straight to ${platform === 'nuvio' ? 'Nuvio' : 'Stremio'}: only the session is sealed on this server when you save, never in your install URL.`}
            </p>
          </div>
        ) : (
          <div className="destination-connection">
            <img src={platform === 'nuvio' ? '/nuvio.png' : '/stremio.svg'} alt="" />
            <div>
              <span className="verify-badge ok">Connected</span>
              <strong>{connectionUser(active)}</strong>
              <span className="setup-note">Ready to receive this setup</span>
            </div>
            <button type="button" className="setup-secondary" onClick={changeAccount}>Change account</button>
          </div>
        )}
      </div>
      {active?.platform === 'nuvio' && (
        <div className="destination-profile">
          <div>
            <strong>Nuvio profile</strong>
            <small>Only this profile receives the setup.</small>
          </div>
          <div className="destination-profile-picker">
            <label className="setup-field">
              <span className="setup-hint">Profile</span>
              <select
                value={active.nuvioSelectedProfile ?? ''}
                onChange={(event) => onConnection({ ...active, nuvioSelectedProfile: Number(event.target.value) || null })}
                aria-label="Nuvio profile"
                disabled={profilesBusy || profiles.length === 0}
              >
                {profiles.length === 0 && <option value="">{profilesBusy ? 'Loading profiles…' : 'No profiles found'}</option>}
                {profiles.map((profile) => (
                  <option key={profile.profile_index} value={profile.profile_index} data-i18n-preserve>{profile.name}</option>
                ))}
              </select>
            </label>
            <button
              type="button" className="setup-secondary"
              disabled={profilesBusy}
              onClick={() => void refreshProfiles()}
            >
              {profilesBusy ? 'Refreshing…' : 'Refresh profiles'}
            </button>
          </div>
          {profilesError && (
            <p className="setup-error">
              {profilesError} — the list below is the one saved with your import. Reconnect the account to load it fresh.
            </p>
          )}
          {!profilesError && profiles.length === 0 && !profilesBusy && (
            <p className="setup-note">Nuvio returned no profiles for this account. Reconnect it to try again.</p>
          )}
        </div>
      )}
    </div>
  );
}
