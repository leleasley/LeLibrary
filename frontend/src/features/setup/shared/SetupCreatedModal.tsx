import { useEffect, useState } from 'react';
import { toast } from '@/features/setup/shared/Toast';
import { installUrl } from '@/features/setup/resolver/validation';
import { usePlatformPush } from '@/features/setup/shared/usePlatformPush';
import type { PlatformConnection } from '@/features/setup/full/platform-login';

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="created-copy">
      <div className="created-copy-head">
        <span>{label}</span>
        <button
          type="button"
          className="created-copy-btn"
          onClick={() => {
            void navigator.clipboard.writeText(value)
              .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
              .catch(() => toast('Could not copy', 'error'));
          }}
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <input readOnly value={value} onFocus={(event) => event.target.select()} />
    </div>
  );
}

// Shown once the setup exists. The row is already saved at this point, so
// pushing is explicitly optional: the modal is about getting the links and
// wiring the player up now rather than later. Works with or without a connected
// platform; a caller can also route users to an in-page login panel when this
// flow collects its destination after creation.
export function SetupCreatedModal({ open, uuid, installToken, name, password, platform, pushConn, onConnectPrompt, onClose }: {
  open: boolean;
  uuid: string;
  installToken: string;
  name: string | null;
  password: string;
  platform: 'nuvio' | 'stremio' | null;
  pushConn: PlatformConnection | null;
  onConnectPrompt?: (() => void) | undefined;
  onClose: () => void;
}) {
  const push = usePlatformPush({
    uuid: open ? uuid : null,
    password,
    platform,
    connection: pushConn,
    onPushed: () => toast(`Pushed to ${platform === 'stremio' ? 'Stremio' : 'Nuvio'}`),
    onError: (message) => toast(message, 'error'),
  });

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const platformName = platform === 'stremio' ? 'Stremio' : 'Nuvio';
  const origin = window.location.origin;
  const manifest = installUrl(origin, installToken);
  const collections = `${origin}/${installToken}/collections.json`;

  return (
    <div
      className="app-modal" role="dialog" aria-modal="true" aria-label="Your setup is live"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="app-modal-box setup-created-dialog">
        <div className="app-modal-head">
          <div>
            <span className="setup-kicker">Saved and ready</span>
            <h3>Your setup is live</h3>
            <p>{name ? <><strong>{name}</strong> is on the server.</> : 'It is on the server.'} Copy the links, or push straight into your player.</p>
          </div>
          <button type="button" className="eye-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        <div className="setup-created-body">
          <CopyRow label="manifest.json" value={manifest} />
          <CopyRow label="collections.json" value={collections} />

          {push.connected ? (
            <div className="created-push">
              <div className="created-push-head">
                <img src={platform === 'nuvio' ? '/nuvio.png' : '/stremio.svg'} alt="" />
                <div>
                  <strong>Push to {platformName}</strong>
                  <small>
                    {platform === 'nuvio'
                      ? 'Adds your Home rows and collections to the selected profile.'
                      : 'Adds LeLibrary to your Stremio addons.'}
                  </small>
                </div>
              </div>
              {platform === 'nuvio' && push.profiles.length > 0 && (
                <label className="setup-field">
                  <span>Profile</span>
                  <select
                    value={push.profileId ?? ''}
                    onChange={(event) => push.setProfileId(Number(event.target.value) || null)}
                    aria-label="Nuvio profile"
                  >
                    {push.profiles.map((profile) => (
                      <option key={profile.profile_index} value={profile.profile_index}>{profile.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                className="setup-primary"
                disabled={push.busy !== null || !push.editToken}
                onClick={() => void push.push()}
              >
                {push.busy ?? (push.pushed ? `Pushed to ${platformName} ✓` : `Push to ${platformName}`)}
              </button>
              {push.unlockError && <p className="setup-error">{push.unlockError}</p>}
            </div>
          ) : (
            <>
              <p className="created-note">
                Saved on the server, so nothing is lost if you stop here. {onConnectPrompt
                  ? 'Choose Stremio or Nuvio and sign in below to push your Home rows, or install with the manifest link.'
                  : platform
                    ? `Sign in to ${platformName} in this setup to push your Home rows, or install with the manifest link.`
                    : 'Paste the manifest link into Stremio or Nuvio whenever you are ready.'}
              </p>
              {onConnectPrompt && (
                <button type="button" className="setup-secondary" onClick={onConnectPrompt}>
                  Choose a player and sign in
                </button>
              )}
            </>
          )}
        </div>

        <div className="app-modal-actions">
          <button type="button" className="setup-secondary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
