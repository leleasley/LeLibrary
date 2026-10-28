import { useEffect, useState, type ReactNode } from 'react';
import { ReplaceCollectionsToggle } from '@/features/setup/shared/ReplaceCollectionsToggle';
import { toast } from '@/features/setup/shared/Toast';
import { clearSetupCache } from '@/features/setup/resolver/api';
import { installUrl } from '@/features/setup/resolver/validation';

// The end of a setup. Move In, Settle In and the edit flow all land on one
// surface: a ready header, the publish desk,
// both install files, the player links, sharing, the other client integrations
// and manual controls. One component means the four ends cannot drift.

export interface PublishCounts {
  // Only the parts a tier actually has are shown: Settle In has no collections
  // studio, so it reports rows and language only.
  homeRows?: number;
  collections?: number;
  folders?: number;
  lang?: string;
}

export interface PublishProfilePicker {
  profiles: { profile_index: number; name: string }[];
  value: number | null;
  onChange: (value: number) => void;
}

export interface PublishAction {
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  hint?: string;
}

export interface PublishSecondaryAction {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

// Client integrations the addon exposes a compatible manifest for. Copy is
// deliberately terse: it names the app and what the button does.
export const CLIENT_COPY: Record<string, [string, string]> = {
  strmr: ['STRMR', 'Copy a compatible manifest for STRMR.'],
  fusion: ['Fusion', 'Copy a compatible manifest for Fusion.'],
  vidi: ['Vidi', 'Copy a compatible manifest for Vidi.'],
  wuplay: ['WuPlay', 'Copy a compatible manifest for WuPlay.'],
};

export const CLIENT_LOGOS: Record<string, string> = {
  strmr: '/client-logos/strmr.png?v=2',
  fusion: '/client-logos/fusion.jpg?v=2',
  vidi: '/client-logos/vidi.png?v=2',
  wuplay: '/client-logos/wuplay.png?v=2',
};

function clientCopy(id: string): [string, string] {
  return CLIENT_COPY[id] ?? [id, `Copy a compatible manifest for ${id}.`];
}

export function useClientIntegrations(installToken: string): { id: string; label: string; manifest: string }[] {
  const [clients, setClients] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/client-integrations', { cache: 'force-cache' })
      .then((response) => (response.ok ? response.json() : { clients: [] }))
      .then((payload: { clients?: { id?: string; label?: string }[] }) => {
        if (cancelled) return;
        const list = Array.isArray(payload?.clients) ? payload.clients : [];
        setClients(list
          .filter((client) => !!client?.id && !!CLIENT_COPY[String(client.id)])
          .map((client) => ({ id: String(client.id), label: clientCopy(String(client.id))[0] })));
      })
      .catch(() => {
        if (cancelled) return;
        setClients(Object.keys(CLIENT_COPY).map((id) => ({ id, label: clientCopy(id)[0] })));
      });
    return () => { cancelled = true; };
  }, []);
  return clients.map((client) => ({
    ...client,
    manifest: `${origin()}/${encodeURIComponent(installToken)}/i/${encodeURIComponent(client.id)}/manifest.json`,
  }));
}

function origin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

// The one action the end of a setup offers. It says what it will do: save then
// push while there are unsaved edits, push alone when everything is saved, and
// a plain save when there is no player login to push to yet. This is what
// removed the duplicate "Save changes" buttons: one action, labelled honestly.
export function publishActionFor(input: {
  dirty: boolean;
  pushing: string | null;
  saving: boolean;
  pushAvailable: boolean;
  platformName: string;
  onSaveAndPush: () => void;
  onSave: () => void;
  // Where the login lives for this tier: Move In has a Destination step, Settle
  // In collects it right in the publish desk.
  connectHint?: string;
}): PublishAction {
  const { dirty, pushing, saving, pushAvailable, platformName } = input;
  if (!pushAvailable) {
    return {
      label: saving ? 'Saving…' : 'Save changes',
      busy: saving,
      disabled: !dirty,
      onClick: input.onSave,
      hint: input.connectHint ?? `Connect ${platformName} on the Destination step to push from here.`,
    };
  }
  return {
    label: pushing ?? (dirty ? `Save and push to ${platformName}` : `Push to ${platformName}`),
    busy: pushing !== null,
    disabled: saving,
    onClick: input.onSaveAndPush,
    hint: dirty
      ? 'Your edits save first, then the whole setup is pushed.'
      : `Everything is saved. This pushes your saved setup to ${platformName}.`,
  };
}

export function PublishPanel({
  installToken,
  uuid,
  tierLabel,
  name,
  platform,
  counts,
  deskTitle,
  deskLede,
  deskBody,
  hasCollections = false,
  action,
  connected = false,
  profilePicker,
  replaceOthers,
  secondaryAction,
  actionsExtra,
  children,
}: {
  installToken: string;
  uuid: string;
  tierLabel: string;
  name?: string | null;
  platform: 'nuvio' | 'stremio';
  counts?: PublishCounts | undefined;
  deskTitle?: string;
  deskLede?: string;
  // Tier-specific content inside the publish desk: Settle In puts its player
  // login here, because that tier has no Destination step.
  deskBody?: ReactNode;
  // Only Move In builds collections, so only Move In gets collections.json,
  // the share block and the collections row in manual setup.
  hasCollections?: boolean;
  action?: PublishAction | null;
  connected?: boolean;
  profilePicker?: PublishProfilePicker | null;
  // Nuvio push only: the one-off "remove all other collections" tick box.
  replaceOthers?: { value: boolean; onChange: (next: boolean) => void } | null;
  secondaryAction?: PublishSecondaryAction | null;
  actionsExtra?: ReactNode;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [cacheMsg, setCacheMsg] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const platformName = platform === 'nuvio' ? 'Nuvio' : 'Stremio';
  const manifest = installUrl(origin(), installToken);
  const collections = `${origin()}/${installToken}/collections.json`;
  const stremioLink = manifest.replace(/^https?:\/\//, 'stremio://');
  const clients = useClientIntegrations(installToken);

  async function copy(value: string, key: string, message = 'Copied') {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1800);
      toast(message);
    } catch {
      toast('Could not copy', 'error');
    }
  }

  async function downloadProfile() {
    setShareMsg(null);
    try {
      const response = await fetch(collections);
      if (!response.ok) throw new Error('download failed');
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${(name || 'lelibrary').replace(/[^a-z0-9._-]+/gi, '-').toLowerCase()}-profile.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      setShareMsg('Profile downloaded');
    } catch {
      setShareMsg('Could not download the profile');
    }
  }

  async function clearCache() {
    setCacheMsg(null);
    try {
      const result = await clearSetupCache(installToken);
      setCacheMsg(result.success ? 'Cached data cleared' : result.error || 'Could not clear cache');
    } catch {
      setCacheMsg('Could not clear cache');
    }
  }

  const countsLine = (() => {
    if (!counts) return '';
    const parts: string[] = [];
    if (typeof counts.homeRows === 'number') parts.push(`${counts.homeRows} home row${counts.homeRows === 1 ? '' : 's'}`);
    if (typeof counts.collections === 'number') parts.push(`${counts.collections} collection${counts.collections === 1 ? '' : 's'}`);
    if (typeof counts.folders === 'number') parts.push(`${counts.folders} folder${counts.folders === 1 ? '' : 's'}`);
    if (counts.lang) parts.push(counts.lang);
    return parts.join(' · ');
  })();

  return (
    <div className="publish-panel">
      <header className="publish-ready">
        <span className="publish-ready-mark" aria-hidden="true">✓</span>
        <div>
          <span className="setup-kicker">{tierLabel} · READY</span>
          <h2>{name?.trim() ? `${name.trim()} is ready` : 'Your setup is ready'}</h2>
          {countsLine && <p>{countsLine}</p>}
        </div>
      </header>

      <section className="publish-desk">
        <div className="publish-desk-head">
          <span className="publish-desk-icon"><img src={platform === 'nuvio' ? '/nuvio.png' : '/stremio.svg'} alt="" /></span>
          <div>
            <h3>{deskTitle ?? (action ? `Publish to ${platformName}` : `Add this setup to ${platformName}`)}</h3>
            <p>
              {deskLede ?? (action
                ? `One click saves this setup and pushes your Home rows${hasCollections ? ' and collections' : ''}${platform === 'nuvio' && profilePicker ? ' to the selected profile' : ''}.`
                : 'Paste the install link into Stremio or Nuvio as an addon. Pushing Home rows straight into a player account needs a login, which you can add right here.')}
            </p>
          </div>
          <span className="publish-desk-badges">
            <span className="verify-badge ok">{platformName}</span>
            {counts?.lang && <span className="verify-badge ok">{counts.lang}</span>}
            {connected && <span className="verify-badge ok">Connected</span>}
          </span>
        </div>
        {profilePicker && profilePicker.profiles.length > 0 && (
          <label className="setup-field action-inline-field">
            <span>Profile</span>
            <select
              value={profilePicker.value ?? ''}
              onChange={(event) => profilePicker.onChange(Number(event.target.value))}
              aria-label={`${platformName} profile`}
            >
              {profilePicker.profiles.map((profile) => (
                <option key={profile.profile_index} value={profile.profile_index} data-i18n-preserve>{profile.name}</option>
              ))}
            </select>
          </label>
        )}
        {platform === 'nuvio' && action && replaceOthers && (
          <ReplaceCollectionsToggle value={replaceOthers.value} onChange={replaceOthers.onChange} />
        )}
        {deskBody}
        {action ? (
          <div className="publish-actions">
            <button
              type="button" className="setup-primary publish-primary"
              disabled={action.disabled || action.busy} onClick={action.onClick}
            >
              {action.label}
            </button>
            {secondaryAction && (
              <button type="button" className="btn-danger" disabled={secondaryAction.disabled} onClick={secondaryAction.onClick}>
                {secondaryAction.label}
              </button>
            )}
            {actionsExtra}
          </div>
        ) : (
          <div className="publish-actions">
            <a className="setup-primary" href={stremioLink} target="_blank" rel="noopener">Open in Stremio</a>
            <button type="button" className="setup-secondary" onClick={() => void copy(manifest, 'install', 'Install link copied')}>
              {copied === 'install' ? 'Copied ✓' : 'Copy install link'}
            </button>
            {actionsExtra}
          </div>
        )}
        {action?.hint && <p className="publish-hint">{action.hint}</p>}
      </section>

      <details className="install-option" open>
        <summary>
          <span className="install-option-icon"><img src="/stremio.svg" alt="" /></span>
          <span><strong>Add to Stremio</strong><small>Open the install link or copy it for later.</small></span>
          <span className="install-option-arrow" aria-hidden="true">›</span>
        </summary>
        <div className="install-option-body">
          <div className="button-row">
            <a className="setup-primary" href={stremioLink} target="_blank" rel="noopener">Open in Stremio</a>
            <button type="button" className="setup-secondary" onClick={() => void copy(manifest, 'stremio', 'Install link copied')}>
              {copied === 'stremio' ? 'Copied ✓' : 'Copy install link'}
            </button>
          </div>
        </div>
      </details>

      {hasCollections && (
        <details className="install-option">
          <summary>
            <span className="install-option-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="6" cy="12" r="2.4" /><circle cx="17" cy="6" r="2.4" /><circle cx="17" cy="18" r="2.4" /><path d="M8.2 10.9 14.9 7.2M8.2 13.1l6.7 3.7" /></svg></span>
            <span><strong>Share this setup</strong><small>Hand this profile to another account.</small></span>
            <span className="install-option-arrow" aria-hidden="true">›</span>
          </summary>
          <div className="install-option-body">
            <p className="setup-hint">
              Anyone with the link or file can import your collections and Home rows using their own keys.
              Companion addons only restore on your own account.
            </p>
            <div className="button-row">
              <button type="button" className="setup-secondary" onClick={() => void copy(collections, 'share', 'Share link copied')}>
                {copied === 'share' ? 'Copied ✓' : 'Copy share link'}
              </button>
              <button type="button" className="setup-secondary" onClick={() => void downloadProfile()}>Download profile JSON</button>
            </div>
            {shareMsg && <p className="setup-hint" role="status">{shareMsg}</p>}
          </div>
        </details>
      )}

      <section className="client-integrations" aria-label="More client integrations">
        <div className="client-integration-heading">
          <div><strong>More client integrations</strong><small>Choose an app to copy its compatible manifest.</small></div>
        </div>
        <div className="client-integration-list">
          {clients.map((client) => (
            <button
              key={client.id} type="button" className="client-integration-row"
              aria-label={`Copy ${client.label} manifest`} onClick={() => void copy(client.manifest, `client-${client.id}`, `${client.label} manifest copied`)}
            >
              <span className="client-integration-icon" aria-hidden="true"><img src={CLIENT_LOGOS[client.id]} alt="" /></span>
              <span className="client-integration-copy">
                <span className="client-integration-title">
                  <strong data-i18n-preserve>{client.label}</strong>
                  <span className="client-status testing">Testing</span>
                </span>
                <small>{clientCopy(client.id)[1]}</small>
              </span>
              <b aria-hidden="true">{copied === `client-${client.id}` ? '✓' : '›'}</b>
            </button>
          ))}
        </div>
      </section>

      <details className="install-option">
        <summary>
          <span className="install-option-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h3M11 17h9" /><circle cx="16" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg></span>
          <span><strong>Manual setup</strong><small>Manifest URL, collections file, and cache controls.</small></span>
          <span className="install-option-arrow" aria-hidden="true">›</span>
        </summary>
        <div className="install-option-body install-manual">
          <p className="setup-hint">
            Setup id {uuid.slice(0, 8)}… — keep these private: anyone with the link can watch. Changing settings needs your password.
          </p>
          <div className="copy-row">
            <input readOnly value={manifest} aria-label="Manifest URL" onFocus={(event) => event.target.select()} />
            <button type="button" className="created-copy-btn" onClick={() => void copy(manifest, 'manual-manifest')}>
              {copied === 'manual-manifest' ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          {hasCollections && (
            <div className="copy-row">
              <input readOnly value={collections} aria-label="Collections JSON URL" onFocus={(event) => event.target.select()} />
              <button type="button" className="created-copy-btn" onClick={() => void copy(collections, 'manual-collections')}>
                {copied === 'manual-collections' ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
          )}
          <div className="cache-row">
            <button type="button" className="btn-danger" onClick={() => void clearCache()}>Clear cached data</button>
            {cacheMsg && <span className="setup-note">{cacheMsg}</span>}
          </div>
        </div>
      </details>

      {children}
    </div>
  );
}
