import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/features/setup/shared/Toast';
import { setupCopy } from '@/features/setup/shared/setup-copy';
import {
  fetchNuvioOverview, fetchNuvioProfile, undoNuvioChange,
  type NuvioBackup, type NuvioOverview, type NuvioProfile, type NuvioProfileDetail,
} from '@/features/setup/nuvio/api';
import { ColourDot, LockIcon, problemFrom, type NuvioCtx, type Problem, type RunWrite } from '@/features/setup/nuvio/nuvio-ui';
import { AddonsTab, HomeTab } from '@/features/setup/nuvio/NuvioContentTabs';
import { SettingsTab } from '@/features/setup/nuvio/NuvioSettingsTab';
import { BackupsTab, ProfilesTab } from '@/features/setup/nuvio/NuvioProfilesTab';
import '@/features/setup/library/library.css';
import './nuvio.css';

// The Nuvio tab of the setup edit page: the signed-in Nuvio account's
// profiles, each profile's addons, Home, collections and playback settings,
// and LeLibrary's own per-profile backups. Every write goes through the
// server, which backs the profile up first; the browser never sees tokens,
// PIN hashes or other addons' links.

export type NuvioTab = 'addons' | 'home' | 'settings' | 'profiles' | 'backups';

const TABS: { id: NuvioTab; label: string }[] = [
  { id: 'addons', label: 'Addons' },
  { id: 'home', label: 'Home and collections' },
  { id: 'settings', label: 'Playback settings' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'backups', label: 'Backups' },
];

export const SAVED_NOTE = 'Saved to Nuvio. Restart Nuvio or switch profile on your devices to see it.';

export interface NuvioPanelInitial {
  overview: NuvioOverview;
  detail?: NuvioProfileDetail | null;
  tab?: NuvioTab;
  backups?: NuvioBackup[] | null;
  deleteProfile?: NuvioProfile | null;
}

function firstProfile(overview: NuvioOverview, keep: number | null): number | null {
  const profiles = overview.profiles;
  if (keep != null && profiles.some((profile) => profile.index === keep)) return keep;
  if (overview.selected != null && profiles.some((profile) => profile.index === overview.selected)) return overview.selected;
  return profiles.find((profile) => profile.isPrimary)?.index ?? profiles[0]?.index ?? null;
}

export function ProfileSwitcher({ profiles, value, onChange, disabled }: {
  profiles: NuvioProfile[];
  value: number | null;
  onChange: (index: number) => void;
  disabled?: boolean | undefined;
}) {
  return (
    <div className="nv-switcher" role="tablist" aria-label="Nuvio profile">
      {profiles.map((profile) => (
        <button
          key={profile.index} type="button" role="tab" disabled={disabled}
          aria-selected={value === profile.index}
          className={`nv-switch-card${value === profile.index ? ' is-active' : ''}`}
          onClick={() => onChange(profile.index)}
        >
          <span className="nv-switch-top">
            <ColourDot colour={profile.color} />
            <strong data-i18n-preserve>{profile.name}</strong>
            {profile.pinEnabled && <span className="nv-pin" title="This profile has a PIN on your devices"><LockIcon /></span>}
            {profile.isPrimary && <em className="nv-badge">Main</em>}
          </span>
          {!profile.isPrimary && profile.usesPrimaryAddons && <small>Uses Main's addons</small>}
        </button>
      ))}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="nv-skeleton" aria-hidden="true">
      <div className="nv-skeleton-switcher">{[0, 1, 2].map((n) => <div key={n} className="nv-skeleton-card" />)}</div>
      <div className="nv-skeleton-list">{[0, 1, 2, 3].map((n) => <div key={n} className="nv-skeleton-row" />)}</div>
    </div>
  );
}

export function NuvioPanel({ uuid, editToken, initial, onEditSetup }: {
  uuid: string;
  editToken: string | null;
  initial?: NuvioPanelInitial | undefined;
  /** Switches the edit page back to this setup's Edit view. */
  onEditSetup?: (() => void) | undefined;
}) {
  const [overview, setOverview] = useState<NuvioOverview | null>(initial?.overview ?? null);
  const [overviewProblem, setOverviewProblem] = useState<Problem | null>(null);
  const [profileIndex, setProfileIndex] = useState<number | null>(() => (
    initial?.detail?.profile.index ?? (initial?.overview ? firstProfile(initial.overview, null) : null)
  ));
  const [detail, setDetail] = useState<NuvioProfileDetail | null>(initial?.detail ?? null);
  const [detailProblem, setDetailProblem] = useState<Problem | null>(null);
  const [tab, setTab] = useState<NuvioTab>(initial?.tab ?? 'addons');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [undoTarget, setUndoTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [backupsVersion, setBackupsVersion] = useState(0);
  const busyRef = useRef(false);
  const detailTicket = useRef(0);
  const profileRef = useRef<number | null>(profileIndex);
  profileRef.current = profileIndex;

  const loadOverview = useCallback(async () => {
    if (!editToken) return null;
    try {
      const next = await fetchNuvioOverview(uuid, editToken);
      setOverview(next);
      setOverviewProblem(null);
      setProfileIndex((current) => firstProfile(next, current));
      return next;
    } catch (err) {
      setOverviewProblem(problemFrom(err, 'Your Nuvio account could not be loaded.'));
      return null;
    }
  }, [uuid, editToken]);

  const loadDetail = useCallback(async (index: number) => {
    if (!editToken) return;
    const ticket = ++detailTicket.current;
    try {
      const next = await fetchNuvioProfile(uuid, editToken, index);
      if (ticket !== detailTicket.current) return;
      setDetail(next);
      setDetailProblem(null);
    } catch (err) {
      if (ticket === detailTicket.current) setDetailProblem(problemFrom(err, 'This profile could not be loaded.'));
    }
  }, [uuid, editToken]);

  useEffect(() => {
    if (!initial) void loadOverview();
    // Once per open; reloads are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadOverview]);

  useEffect(() => {
    if (profileIndex == null) return;
    if (detail && detail.profile.index === profileIndex) return;
    setDetail(null);
    void loadDetail(profileIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileIndex, loadDetail]);

  async function reload(kind: 'detail' | 'all' | 'none') {
    if (kind === 'none') return;
    if (kind === 'all') {
      const next = await loadOverview();
      const index = next ? firstProfile(next, profileRef.current) : profileRef.current;
      if (index != null) await loadDetail(index);
      return;
    }
    if (profileRef.current != null) await loadDetail(profileRef.current);
  }

  const run: RunWrite = async (action, options = {}) => {
    if (busyRef.current || !editToken) return null;
    busyRef.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const out = await action();
      options.after?.(out);
      toast(options.done ?? setupCopy('Saved to Nuvio', 'Saved to Nuvio'));
      setSavedNote(true);
      if (options.undo !== undefined && options.undo !== null) setUndoTarget(options.undo);
      setBackupsVersion((n) => n + 1);
      await reload(options.reload ?? 'detail');
      return out;
    } catch (err) {
      const next = problemFrom(err);
      setProblem(next);
      toast(next.message, 'error');
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  async function undo() {
    const target = undoTarget;
    if (target == null || !editToken) return;
    const out = await run(() => undoNuvioChange(uuid, editToken, target), {
      reload: 'all', undo: null,
      done: setupCopy('Last change undone in Nuvio', 'Last change undone in Nuvio'),
    });
    if (out) setUndoTarget(null);
  }

  function switchProfile(index: number) {
    if (index === profileIndex) return;
    setProblem(null);
    setDetailProblem(null);
    setProfileIndex(index);
  }

  if (!editToken) return null;

  const hero = (
    <header className="lib-hero nv-hero">
      <span className="setup-eyebrow">YOUR NUVIO</span>
      <h1>Your Nuvio, managed from here</h1>
      <p className="setup-lede">Addons, Home, collections and playback settings for each profile on your Nuvio account. LeLibrary backs a profile up before every change.</p>
      {overview && (
        <p className="nv-user">
          <span>Signed in as</span> <strong data-i18n-preserve>{overview.user}</strong>
        </p>
      )}
    </header>
  );

  if (overviewProblem && !overview) {
    return (
      <section className="lib-page nv-page" aria-label="Your Nuvio">
        {hero}
        <p className="setup-error" role="alert">{overviewProblem.message}</p>
        <button type="button" className="setup-secondary" onClick={() => void loadOverview()}>Try again</button>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="lib-page nv-page" aria-label="Your Nuvio" aria-busy="true">
        {hero}
        <PanelSkeleton />
      </section>
    );
  }

  const profiles = [...overview.profiles].sort((a, b) => a.index - b.index).slice(0, Math.min(overview.maxProfiles || 6, 6));
  const primaryName = profiles.find((profile) => profile.isPrimary)?.name ?? 'Main';
  const ctx: NuvioCtx = { uuid, editToken, busy, run };
  const current = profiles.find((profile) => profile.index === profileIndex) ?? null;
  const needsDetail = tab !== 'profiles' && tab !== 'backups';
  // At a glance for the profile on show: each count opens its tab.
  const glance = detail && current && detail.profile.index === current.index ? (() => {
    const addonsOn = detail.addons.filter((addon) => addon.enabled).length;
    const rowsShown = detail.home.items.filter((item) => item.enabled).length;
    const collections = detail.collections.length;
    return [
      { count: addonsOn, label: addonsOn === 1 ? 'addon on' : 'addons on', tab: 'addons' as const },
      { count: rowsShown, label: rowsShown === 1 ? 'Home row shown' : 'Home rows shown', tab: 'home' as const },
      { count: collections, label: collections === 1 ? 'collection' : 'collections', tab: 'home' as const },
    ];
  })() : null;

  return (
    <section className="lib-page nv-page" aria-label="Your Nuvio">
      {hero}

      {profiles.length === 0 ? (
        <p className="nv-empty">This Nuvio account has no profiles yet. Open Nuvio on a device once to create the first one.</p>
      ) : (
        <ProfileSwitcher profiles={profiles} value={profileIndex} onChange={switchProfile} disabled={busy} />
      )}

      {current?.pinEnabled && (
        <p className="lib-note">This profile has a PIN on your devices. Changes made here still apply to it.</p>
      )}

      {(savedNote || undoTarget != null) && (
        <div className="nv-saved" role="status">
          {savedNote && <span>Saved to Nuvio. Restart Nuvio or switch profile on your devices to see it.</span>}
          <span className="nv-saved-actions">
            {undoTarget != null && (
              <button type="button" className="setup-secondary" disabled={busy} onClick={() => void undo()}>Undo last change</button>
            )}
            {savedNote && (
              <button type="button" className="nv-icon-btn" aria-label="Dismiss" onClick={() => setSavedNote(false)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            )}
          </span>
        </div>
      )}

      {problem && (
        <div className="nv-problem">
          <p className="setup-error" role="alert">{problem.message}</p>
          {problem.code === 'nuvio-conflict' && (
            <button
              type="button" className="setup-secondary"
              onClick={() => { setProblem(null); void reload('all'); }}
            >
              Reload
            </button>
          )}
        </div>
      )}

      {glance && (
        <ul className="nv-summary" aria-label="This profile at a glance">
          {glance.map((item) => (
            <li key={item.label}>
              <button type="button" onClick={() => setTab(item.tab)}>
                <strong>{item.count}</strong>
                <span>{setupCopy(item.label, item.label)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="lib-toolbar nv-toolbar">
        <div className="lib-tabs nv-tabs" role="tablist" aria-label="Nuvio sections">
          {TABS.map((item) => (
            <button
              key={item.id} type="button" role="tab" aria-selected={tab === item.id}
              className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'profiles' && (
        <ProfilesTab
          ctx={ctx} profiles={profiles} maxProfiles={overview.maxProfiles}
          initialDelete={initial?.deleteProfile ?? null}
          onDeleted={(index) => { if (index === profileIndex) setProfileIndex(firstProfile(overview, null)); }}
        />
      )}

      {tab === 'backups' && current && (
        <BackupsTab ctx={ctx} profile={current} profiles={profiles} version={backupsVersion} initialBackups={initial?.backups ?? null} />
      )}

      {needsDetail && detailProblem && !detail && (
        <div className="nv-problem">
          <p className="setup-error" role="alert">{detailProblem.message}</p>
          {profileIndex != null && <button type="button" className="setup-secondary" onClick={() => void loadDetail(profileIndex)}>Try again</button>}
        </div>
      )}
      {needsDetail && !detail && !detailProblem && profiles.length > 0 && (
        <div className="nv-skeleton-list" aria-hidden="true">{[0, 1, 2, 3].map((n) => <div key={n} className="nv-skeleton-row" />)}</div>
      )}
      {needsDetail && detail && (
        <>
          {tab === 'addons' && (
            <AddonsTab ctx={ctx} detail={detail} primaryName={primaryName} onEditSetup={onEditSetup} />
          )}
          {tab === 'home' && <HomeTab ctx={ctx} detail={detail} />}
          {tab === 'settings' && <SettingsTab ctx={ctx} detail={detail} />}
        </>
      )}
    </section>
  );
}
