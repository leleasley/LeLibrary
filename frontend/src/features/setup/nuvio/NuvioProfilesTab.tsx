import { useCallback, useEffect, useState } from 'react';
import { ConfirmModal } from '@/features/setup/shared/Modal';
import { setupCopy } from '@/features/setup/shared/setup-copy';
import {
  copyNuvioProfile, createNuvioBackup, createNuvioProfile, deleteNuvioProfile, fetchNuvioBackups,
  restoreNuvioBackup, updateNuvioProfile,
  type NuvioBackup, type NuvioPart, type NuvioProfile,
} from '@/features/setup/nuvio/api';
import {
  ColourDot, ColourSwatches, LockIcon, PART_LABELS, PartChecks, Switch, language, problemFrom, profileName,
  type NuvioCtx,
} from '@/features/setup/nuvio/nuvio-ui';

// Profiles (create, rename, recolour, copy, delete) and per-profile backups.

/** The delete button only unlocks for the exact profile name. */
export function deleteNameMatches(profile: Pick<NuvioProfile, 'name'>, typed: string): boolean {
  return typed.length > 0 && typed === profile.name;
}

export function DeleteProfileModal({ profile, busy, onConfirm, onCancel, initialTyped = '' }: {
  profile: NuvioProfile;
  busy: boolean;
  onConfirm: (confirmName: string) => void;
  onCancel: () => void;
  initialTyped?: string;
}) {
  const [typed, setTyped] = useState(initialTyped);
  const ready = deleteNameMatches(profile, typed) && !profile.isPrimary;
  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape' && !busy) onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);
  return (
    <div className="app-modal" role="dialog" aria-modal="true" aria-labelledby="nv-delete-title">
      <form className="app-modal-box nv-modal" onSubmit={(event) => { event.preventDefault(); if (ready) onConfirm(typed); }}>
        <h3 id="nv-delete-title">Delete this Nuvio profile?</h3>
        <p className="nv-modal-name"><ColourDot colour={profile.color} /> <strong data-i18n-preserve>{profile.name}</strong></p>
        <p>This permanently deletes the profile's watch history, saved logins and settings on every device. It cannot be undone, and a LeLibrary backup cannot bring watch history back.</p>
        <label className="setup-field">
          <span>Type the profile name to confirm</span>
          <input
            type="text" value={typed} autoComplete="off" spellCheck={false} autoFocus
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        <div className="app-modal-actions">
          <button type="button" className="setup-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn-danger" disabled={!ready || busy}>{busy ? 'Deleting…' : 'Delete profile'}</button>
        </div>
      </form>
    </div>
  );
}

function ProfileCard({ ctx, profile, profiles, onDelete }: {
  ctx: NuvioCtx;
  profile: NuvioProfile;
  profiles: NuvioProfile[];
  onDelete: (profile: NuvioProfile) => void;
}) {
  const { uuid, editToken, run, busy } = ctx;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(profile.name);
  const [colours, setColours] = useState(false);
  const [ownConfirm, setOwnConfirm] = useState(false);
  const primaryName = profiles.find((p) => p.isPrimary)?.name ?? 'Main';

  async function rename() {
    const next = name.trim();
    if (!next || next === profile.name) { setRenaming(false); return; }
    const out = await run(() => updateNuvioProfile(uuid, editToken, profile.index, { name: next }), { reload: 'all', undo: null });
    if (out) setRenaming(false);
  }

  return (
    <article className="nv-profile-card">
      <div className="nv-profile-top">
        <ColourDot colour={profile.color} />
        {renaming ? (
          <form className="nv-rename" onSubmit={(event) => { event.preventDefault(); void rename(); }}>
            <input
              type="text" value={name} maxLength={40} autoFocus aria-label="Profile name"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(false); }}
            />
            <button type="submit" className="setup-primary" disabled={busy || !name.trim()}>Save</button>
            <button type="button" className="setup-secondary" onClick={() => setRenaming(false)}>Cancel</button>
          </form>
        ) : (
          <strong className="nv-profile-name" data-i18n-preserve>{profile.name}</strong>
        )}
        {profile.pinEnabled && <span className="nv-pin" title="This profile has a PIN on your devices"><LockIcon /></span>}
        {profile.isPrimary && <em className="nv-badge">Main</em>}
      </div>
      {!profile.isPrimary && (
        <Switch
          checked={profile.usesPrimaryAddons} disabled={busy}
          label={setupCopy('Uses Main\'s addons', 'Uses Main\'s addons')}
          hint={setupCopy('Addons come from {{name}}.', 'Addons come from {{name}}.', { name: primaryName })}
          onChange={(next) => {
            if (!next) setOwnConfirm(true);
            else void run(() => updateNuvioProfile(uuid, editToken, profile.index, { usesPrimaryAddons: true }), { reload: 'all', undo: null });
          }}
        />
      )}
      {colours && (
        <ColourSwatches
          value={profile.color} disabled={busy}
          onChange={(color) => void run(() => updateNuvioProfile(uuid, editToken, profile.index, { color }), { reload: 'all', undo: null })}
        />
      )}
      <div className="nv-profile-actions">
        {!renaming && <button type="button" className="nv-text-btn" disabled={busy} onClick={() => { setName(profile.name); setRenaming(true); }}>Rename</button>}
        <button type="button" className="nv-text-btn" disabled={busy} aria-expanded={colours} onClick={() => setColours((open) => !open)}>Colour</button>
        {!profile.isPrimary && (
          <button type="button" className="nv-text-btn is-danger" disabled={busy} onClick={() => onDelete(profile)}>Delete</button>
        )}
      </div>
      <ConfirmModal
        open={ownConfirm}
        title="Give this profile its own addons?"
        body={setupCopy(
          'This profile stops using the main profile\'s addons and starts with no addons except the ones you add here. The main profile keeps its own.',
          'This profile stops using the main profile\'s addons and starts with no addons except the ones you add here. The main profile keeps its own.',
        )}
        confirmLabel={setupCopy('Use its own addons', 'Use its own addons')}
        onCancel={() => setOwnConfirm(false)}
        onConfirm={() => {
          setOwnConfirm(false);
          void run(() => updateNuvioProfile(uuid, editToken, profile.index, { usesPrimaryAddons: false }), { reload: 'all', undo: null });
        }}
      />
    </article>
  );
}

export function ProfilesTab({ ctx, profiles, maxProfiles, onDeleted, initialDelete = null }: {
  ctx: NuvioCtx;
  profiles: NuvioProfile[];
  maxProfiles: number;
  onDeleted: (index: number) => void;
  initialDelete?: NuvioProfile | null;
}) {
  const { uuid, editToken, run, busy } = ctx;
  const limit = Math.min(maxProfiles || 6, 6);
  const shown = [...profiles].sort((a, b) => a.index - b.index).slice(0, limit);
  const full = shown.length >= limit;
  const [deleting, setDeleting] = useState<NuvioProfile | null>(initialDelete);

  const [newName, setNewName] = useState('');
  const [newColour, setNewColour] = useState<string>('#1E88E5');
  const [copyFrom, setCopyFrom] = useState<number | ''>('');
  const [newParts, setNewParts] = useState<NuvioPart[]>(['settings', 'addons', 'collections', 'home']);

  const [source, setSource] = useState<number>(shown[0]?.index ?? 1);
  const [target, setTarget] = useState<number | ''>('');
  const [copyParts, setCopyParts] = useState<NuvioPart[]>(['settings', 'addons', 'collections', 'home']);
  const [confirmCopy, setConfirmCopy] = useState(false);

  async function create() {
    const name = newName.trim();
    if (!name || full) return;
    const body = {
      name, color: newColour,
      ...(copyFrom !== '' && newParts.length ? { copyFrom: { index: copyFrom, parts: newParts } } : {}),
    };
    const out = await run(() => createNuvioProfile(uuid, editToken, body), {
      reload: 'all', undo: null,
      done: setupCopy('Profile created in Nuvio', 'Profile created in Nuvio'),
    });
    if (out) { setNewName(''); setCopyFrom(''); }
  }

  return (
    <div className="nv-tab">
      <section className="nv-section">
        <div className="nv-tab-head">
          <div>
            <h2>Profiles</h2>
            <p>Nuvio allows up to six profiles. The main profile can be renamed but never deleted.</p>
          </div>
          <span className="nv-count" data-i18n-preserve>{`${shown.length} / ${limit}`}</span>
        </div>
        <div className="nv-profile-grid">
          {shown.map((profile) => (
            <ProfileCard key={`${profile.index}-${profile.name}-${profile.color}`} ctx={ctx} profile={profile} profiles={shown} onDelete={setDeleting} />
          ))}
        </div>
      </section>

      <section className="nv-section nv-form-card">
        <h3>Create a profile</h3>
        {full ? (
          <p className="nv-empty">This account already has the most profiles Nuvio allows.</p>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
            <label className="setup-field">
              <span>Name</span>
              <input type="text" value={newName} maxLength={40} autoComplete="off" onChange={(event) => setNewName(event.target.value)} />
            </label>
            <div className="setup-field">
              <span>Colour</span>
              <ColourSwatches value={newColour} onChange={setNewColour} disabled={busy} />
            </div>
            <label className="setup-field">
              <span>Copy from (optional)</span>
              <select value={copyFrom} onChange={(event) => setCopyFrom(event.target.value === '' ? '' : Number(event.target.value))}>
                <option value="">{setupCopy('Start empty', 'Start empty')}</option>
                {shown.map((profile) => <option key={profile.index} value={profile.index} data-i18n-preserve>{profile.name}</option>)}
              </select>
            </label>
            {copyFrom !== '' && <PartChecks value={newParts} onChange={setNewParts} disabled={busy} />}
            <button type="submit" className="setup-primary" disabled={busy || !newName.trim()}>{busy ? 'Creating…' : 'Create profile'}</button>
          </form>
        )}
      </section>

      {shown.length > 1 && (
        <section className="nv-section nv-form-card">
          <h3>Copy one profile to another</h3>
          <p>The target profile is backed up first, so you can undo it.</p>
          <div className="nv-copy-row">
            <label className="setup-field">
              <span>From</span>
              <select value={source} onChange={(event) => { const next = Number(event.target.value); setSource(next); if (target === next) setTarget(''); }}>
                {shown.map((profile) => <option key={profile.index} value={profile.index} data-i18n-preserve>{profile.name}</option>)}
              </select>
            </label>
            <label className="setup-field">
              <span>To</span>
              <select value={target} onChange={(event) => setTarget(event.target.value === '' ? '' : Number(event.target.value))}>
                <option value="">{setupCopy('Choose a profile', 'Choose a profile')}</option>
                {shown.filter((profile) => profile.index !== source).map((profile) => (
                  <option key={profile.index} value={profile.index} data-i18n-preserve>{profile.name}</option>
                ))}
              </select>
            </label>
          </div>
          <PartChecks value={copyParts} onChange={setCopyParts} disabled={busy} />
          <button type="button" className="setup-primary" disabled={busy || target === '' || copyParts.length === 0} onClick={() => setConfirmCopy(true)}>Copy</button>
        </section>
      )}

      <ConfirmModal
        open={confirmCopy && target !== ''}
        title="Copy this profile?"
        body={setupCopy(
          'This replaces {{parts}} on {{target}} with the ones from {{source}}. {{target}} is backed up first.',
          'This replaces {{parts}} on {{target}} with the ones from {{source}}. {{target}} is backed up first.',
          {
            parts: copyParts.map((part) => setupCopy(PART_LABELS[part], PART_LABELS[part]).toLowerCase()).join(', '),
            target: target === '' ? '' : profileName(shown, target),
            source: profileName(shown, source),
          },
        )}
        confirmLabel={setupCopy('Copy', 'Copy')}
        onCancel={() => setConfirmCopy(false)}
        onConfirm={() => {
          setConfirmCopy(false);
          if (target === '') return;
          void run(() => copyNuvioProfile(uuid, editToken, source, { target, parts: copyParts }), {
            reload: 'all', undo: target,
            done: setupCopy('Copied in Nuvio', 'Copied in Nuvio'),
          });
        }}
      />

      {deleting && !deleting.isPrimary && (
        <DeleteProfileModal
          profile={deleting} busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={(confirmName) => {
            const index = deleting.index;
            void run(() => deleteNuvioProfile(uuid, editToken, index, confirmName), {
              reload: 'all', undo: null,
              done: setupCopy('Profile deleted from Nuvio', 'Profile deleted from Nuvio'),
            }).then((out) => {
              if (out) { setDeleting(null); onDeleted(index); }
            });
          }}
        />
      )}
    </div>
  );
}

const REASONS: Record<string, string> = {
  manual: 'Backed up by you',
  undo: 'Before an undo',
  restore: 'Before a restore',
  copy: 'Before a copy',
  'delete-profile': 'Before deleting a profile',
};

function backupTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat(language(), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function reasonLabel(reason: string): string {
  const known = REASONS[reason];
  if (known) return setupCopy(known, known);
  return setupCopy('Before a change', 'Before a change');
}

function RestoreModal({ backup, profiles, busy, onCancel, onConfirm }: {
  backup: NuvioBackup;
  profiles: NuvioProfile[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (target: number) => void;
}) {
  const [target, setTarget] = useState<number>(backup.profileIndex);
  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape' && !busy) onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);
  return (
    <div className="app-modal" role="dialog" aria-modal="true" aria-labelledby="nv-restore-title">
      <div className="app-modal-box nv-modal">
        <h3 id="nv-restore-title">Restore this backup?</h3>
        <p>{setupCopy('From {{when}}.', 'From {{when}}.', { when: backupTime(backup.createdAt) })}</p>
        <p>It replaces the addons, collections, Home and settings it holds on the profile you choose. That profile is backed up first. Watch history is never touched.</p>
        <label className="setup-field">
          <span>Restore into</span>
          <select value={target} onChange={(event) => setTarget(Number(event.target.value))}>
            {profiles.map((profile) => <option key={profile.index} value={profile.index} data-i18n-preserve>{profile.name}</option>)}
          </select>
        </label>
        <div className="app-modal-actions">
          <button type="button" className="setup-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className="setup-primary" disabled={busy} onClick={() => onConfirm(target)}>{busy ? 'Restoring…' : 'Restore'}</button>
        </div>
      </div>
    </div>
  );
}

export function BackupsTab({ ctx, profile, profiles, version, initialBackups = null }: {
  ctx: NuvioCtx;
  profile: NuvioProfile;
  profiles: NuvioProfile[];
  version: number;
  initialBackups?: NuvioBackup[] | null;
}) {
  const { uuid, editToken, run, busy } = ctx;
  const [backups, setBackups] = useState<NuvioBackup[] | null>(initialBackups);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<NuvioBackup | null>(null);

  const load = useCallback(async () => {
    try {
      const out = await fetchNuvioBackups(uuid, editToken, profile.index);
      setBackups(out.backups);
      setError(null);
    } catch (err) {
      setError(problemFrom(err, 'Backups could not be loaded.').message);
    }
  }, [uuid, editToken, profile.index]);

  useEffect(() => { void load(); }, [load, version]);

  return (
    <div className="nv-tab">
      <div className="nv-tab-head">
        <div>
          <h2>Backups</h2>
          <p>LeLibrary backs this profile up before every change and keeps the last ten. A backup holds addons, collections, Home and settings, never watch history.</p>
        </div>
        <button
          type="button" className="setup-primary" disabled={busy}
          onClick={() => void run(() => createNuvioBackup(uuid, editToken, profile.index), {
            reload: 'none', undo: null,
            done: setupCopy('Backup saved', 'Backup saved'),
          })}
        >
          Back up now
        </button>
      </div>
      {error && <p className="setup-error" role="alert">{error}</p>}
      {backups === null && !error && (
        <div className="nv-skeleton-list" aria-hidden="true">{[0, 1, 2].map((n) => <div key={n} className="nv-skeleton-row" />)}</div>
      )}
      {backups && backups.length === 0 && <p className="nv-empty">No backups yet for this profile.</p>}
      {backups && backups.length > 0 && (
        <ol className="nv-list is-readonly">
          {backups.map((backup) => (
            <li key={backup.id} className="nv-row">
              <div className="nv-row-main nv-backup">
                <div className="nv-addon-label">
                  <strong data-i18n-preserve>{backupTime(backup.createdAt)}</strong>
                  <span className="nv-addon-meta">
                    <small>{reasonLabel(backup.reason)}</small>
                    {backup.parts.map((part) => (
                      <em key={part} className="nv-badge is-muted">{PART_LABELS[part as NuvioPart] ?? part}</em>
                    ))}
                  </span>
                </div>
                <button type="button" className="setup-secondary" disabled={busy} onClick={() => setRestoring(backup)}>Restore</button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {restoring && (
        <RestoreModal
          backup={restoring} profiles={profiles} busy={busy}
          onCancel={() => setRestoring(null)}
          onConfirm={(targetIndex) => {
            const backup = restoring;
            void run(() => restoreNuvioBackup(uuid, editToken, backup.id, targetIndex), {
              reload: 'all', undo: targetIndex,
              done: setupCopy('Backup restored in Nuvio', 'Backup restored in Nuvio'),
            }).then((out) => { if (out) setRestoring(null); });
          }}
        />
      )}
    </div>
  );
}
