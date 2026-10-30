import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { fetchNuvioProfile } from '@/features/setup/nuvio/api';
import { playbackFromNuvio, type NuvioSettingValues } from '@/features/setup/nuvio/prefill';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  deleteSetup, fetchSetup, fetchSetupConfig, pushProfiles, pushSetup, pushStatus, revealSetupKey,
  saveSetup, sealPushConnection, setNuvioProfile, unlockSetup, type SetupSummary,
} from '@/features/setup/resolver/api';
import { clearEditToken, getEditToken, setEditToken } from '@/features/setup/resolver/edit-session';
import { installUrl } from '@/features/setup/resolver/validation';
import { RouteSkeleton } from '@/app/RouteSkeleton';
import { ConfirmModal } from '@/features/setup/shared/Modal';
import { buildBackup, downloadBackup } from '@/features/setup/shared/setup-backup';
import { toast } from '@/features/setup/shared/Toast';
import { isSetupUuid, rememberSetup } from '@/features/setup/shared/setup-history';
import { setupCopy, setupCount } from '@/features/setup/shared/setup-copy';
import { LibraryPanel } from '@/features/setup/library/LibraryPanel';
import { NuvioPanel } from '@/features/setup/nuvio/NuvioPanel';
import { fetchLibrarySummary } from '@/features/setup/library/library-api';
import { forgetDeletedSetup } from '@/features/setup/shared/saved-setups';
import { ErrorState } from '@/features/site/ErrorPage';
import { PublishPanel, publishActionFor } from '@/features/setup/shared/PublishPanel';
import {
  editSaveBody, emptySnapshot, snapshotFromSaved,
  type EditMode, type TierId, type TierSnapshot,
} from '@/features/setup/shared/edit-mode';
import type { SetupKeysDraft } from '@/features/setup/shared/config-contract';
import type { NuvioProfileRef } from '@/features/setup/full/platform-login';
import { QuickSetupPage } from '@/features/setup/quick/QuickSetupPage';
import { PartialSetupPage } from '@/features/setup/partial/PartialSetupPage';
import { FullSetupPage } from '@/features/setup/full/FullSetupPage';
import '@/features/setup/shared/tier/tier.css';

// /{uuid}: one page per tier, used for both creating and editing. This route
// only decides which tier page to show, unlocks it, and owns everything that
// talks to the saved row (load, save, push, tier switch, delete). The fields
// themselves are the tier's own create page in edit mode, so editing a setup
// always looks and behaves exactly like the page that made it.

interface CreatedState {
  justCreated?: boolean;
  installToken?: string;
  tier?: string;
}

export const TIER_LABELS: Record<TierId, string> = { quick: 'Quick Look', partial: 'Settle In', full: 'Move In' };

const TIER_PAGES: Record<TierId, ComponentType<{ edit?: EditMode }>> = {
  quick: QuickSetupPage,
  partial: PartialSetupPage,
  full: FullSetupPage,
};

// Unknown or legacy tiers open in Move In, the page that can show every field,
// so a setup is never uneditable.
export function tierFor(tier: string | null | undefined): TierId {
  return tier === 'quick' || tier === 'partial' || tier === 'full' ? tier : 'full';
}

export function tierPageFor(tier: string | null | undefined): ComponentType<{ edit?: EditMode }> {
  return TIER_PAGES[tierFor(tier)];
}

type SavedAccount = { user: string | null; profiles: NuvioProfileRef[]; selected: number | null };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);


type EditView = 'edit' | 'library' | 'nuvio' | 'settings';
// Matches the .edit-stage fade in tier.css.
const VIEW_FADE_MS = 170;

function UnlockModal({ uuid, tier, busy, loading, error, leaving, password, onPassword, onSubmit }: {
  uuid: string;
  tier: TierId;
  busy: boolean;
  loading: boolean;
  error: string | null;
  leaving: boolean;
  password: string;
  onPassword: (value: string) => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  return (
    <div className={`edit-unlock${leaving ? ' is-leaving' : ''}`} role="dialog" aria-modal="true" aria-label="Unlock your setup">
      <form className="edit-unlock-card" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <img className="edit-unlock-logo" src="/LeLibrary-128.png" alt="" />
        <span className="setup-eyebrow">{TIER_LABELS[tier]}</span>
        <h1>Welcome back</h1>
        <p>Enter your password to change this setup. Watching never asks for it.</p>
        <label className="setup-field">
          <span>Setup id</span>
          <input className="edit-unlock-id" readOnly value={uuid} data-i18n-preserve onFocus={(event) => event.target.select()} />
        </label>
        <label className="setup-field">
          <span>Password</span>
          <input
            ref={inputRef}
            type="password" autoComplete="current-password"
            value={password} onChange={(event) => onPassword(event.target.value)}
            disabled={busy || loading}
          />
        </label>
        {error && <p className="setup-error" role="alert">{error}</p>}
        <button type="submit" className="qs-cta is-ready edit-unlock-btn" disabled={busy || loading || !password}>
          <span className="qs-cta-text">{loading ? 'Loading your settings…' : busy ? 'Checking…' : 'Unlock'}</span>
        </button>
        <small className="edit-unlock-note">No email, no recovery. Forgotten passwords cannot be reset.</small>
      </form>
    </div>
  );
}

export function SetupEditPage() {
  const { uuid = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation('common');
  const [created] = useState<CreatedState>(() => (location.state ?? {}) as CreatedState);
  const [summary, setSummary] = useState<SetupSummary | null>(null);
  const [missing, setMissing] = useState(false);
  const [password, setPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [installToken, setInstallToken] = useState<string | null>(created.installToken ?? null);
  const [copied, setCopied] = useState(false);

  // saved: what the server holds (the dirty baseline). seed: what the page
  // starts from (saved, or the carried-over values after a tier switch).
  const [saved, setSaved] = useState<TierSnapshot | null>(null);
  const [seed, setSeed] = useState<TierSnapshot | null>(null);
  const [current, setCurrent] = useState<TierSnapshot | null>(null);
  const [savedTier, setSavedTier] = useState<TierId>('quick');
  const [activeTier, setActiveTier] = useState<TierId>('quick');
  const [pageKey, setPageKey] = useState(0);
  const clearKeys = useRef(new Set<string>());
  const [clearCount, setClearCount] = useState(0);

  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAccount, setSavedAccount] = useState<SavedAccount | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // One push only: remove the Nuvio profile's other collections.
  const [replaceOthers, setReplaceOthers] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Which view the side rail shows: the tier page, the Library or the setup
  // settings. The tier page stays mounted while another view is open so
  // unsaved edits (and its scroll position) survive the switch.
  const [view, setView] = useState<EditView>('edit');
  const dirtyRef = useRef(false);
  // The fade runs on the element directly: a React render of the tier page
  // takes long enough to swallow the fade-out.
  const stageRef = useRef<HTMLDivElement>(null);
  const editScroll = useRef(0);
  const pendingScroll = useRef<number | null>(null);
  const fadeTimer = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingScroll.current === null) return;
    window.scrollTo({ top: pendingScroll.current });
    pendingScroll.current = null;
    const stage = stageRef.current;
    // Next frame, so the hidden-to-shown swap is painted before it fades in.
    if (stage) requestAnimationFrame(() => stage.classList.remove('is-fading'));
  }, [view]);
  useEffect(() => () => { if (fadeTimer.current) window.clearTimeout(fadeTimer.current); }, []);
  // How many files need attention, for the switch. Loaded once after unlock;
  // a setup without the library index or a debrid key simply shows no count.
  const [libraryAttention, setLibraryAttention] = useState<number | null>(null);

  // The "just created" view is consumed once and stripped from history: a
  // reload must ask for the password again rather than re-show the install link.
  useEffect(() => {
    if (location.state && (location.state as CreatedState).justCreated) {
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Saved settings and saved keys load together, so the page never renders
  // half-filled and then jumps.
  async function loadSettings(token: string, keyServices: string[], name: string | null) {
    setLoadingSettings(true);
    try {
      const [config, keys] = await Promise.all([
        fetchSetupConfig(uuid, token).then((data) => data.config).catch(() => ({})),
        revealKeys(token, keyServices),
      ]);
      const snapshot = snapshotFromSaved(config, keys, name);
      setSaved(snapshot);
      setSeed(snapshot);
      setCurrent(snapshot);
      setPageKey((key) => key + 1);
    } finally {
      setLoadingSettings(false);
    }
  }

  async function revealKeys(token: string, services: string[]): Promise<Record<string, string>> {
    const wanted = services.filter((service) => typeof service === 'string' && service);
    const settled = await Promise.allSettled(wanted.map(async (service) => {
      const out = await revealSetupKey(uuid, service, token);
      return { service, key: typeof out?.key === 'string' ? out.key : '' };
    }));
    const filled: Record<string, string> = {};
    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value.key.trim()) filled[result.value.service] = result.value.key;
    }
    return filled;
  }

  useEffect(() => {
    if (!isSetupUuid(uuid)) return;
    let cancelled = false;
    fetchSetup(uuid)
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
        const tier = tierFor(data.tier);
        setSavedTier(tier);
        setActiveTier(tier);
        // Same-tab return with a live edit token: already unlocked.
        const token = getEditToken();
        if (token && !created.justCreated) void loadSettings(token, data.keyServices ?? [], data.name ?? null);
      })
      .catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);

  async function unlock() {
    if (!password) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      const result = await unlockSetup(uuid, password);
      setEditToken(result.editToken, result.editTokenExpiresInMs);
      setInstallToken(result.installToken);
      setPassword('');
      rememberSetup({ uuid, name: result.name ?? null, tier: result.tier ?? null });
      await loadSettings(result.editToken, result.keyServices ?? [], result.name ?? null);
      // Fade the modal away over the now-filled page.
      setLeaving(true);
      window.setTimeout(() => setLeaving(false), 450);
    } catch (caught) {
      clearEditToken();
      const message = caught instanceof Error ? caught.message : 'Could not unlock this setup';
      setUnlockError(message);
    } finally {
      setUnlocking(false);
    }
  }

  // The saved player connection lives server-side; only its summary comes back.
  const platform = current?.platform ?? 'nuvio';
  useEffect(() => {
    const token = getEditToken();
    if (!saved || !token) return;
    let cancelled = false;
    pushStatus(uuid, platform, token)
      .then(async (status) => {
        if (!status.connected) { if (!cancelled) setSavedAccount(null); return; }
        let profiles: NuvioProfileRef[] = [];
        let selected: number | null = status.selectedProfile ?? null;
        if (platform === 'nuvio') {
          try {
            const fresh = await pushProfiles(uuid, token);
            profiles = fresh.profiles;
            selected = fresh.selected ?? selected;
          } catch { /* the picker just stays hidden */ }
        }
        if (!cancelled) setSavedAccount({ user: status.user ?? null, profiles, selected });
      })
      .catch(() => { if (!cancelled) setSavedAccount(null); });
    return () => { cancelled = true; };
  }, [uuid, platform, saved]);

  // What the selected Nuvio profile has now, shown under the setup's Nuvio
  // sections. Read after the profile list (one token refresh at a time). If
  // the setup leaves playback to Nuvio, its options start from Nuvio's values
  // (still off, so nothing becomes unsaved) and switching them on keeps them.
  const [nuvioCurrent, setNuvioCurrent] = useState<NuvioSettingValues | null>(null);
  const nuvioSeeded = useRef(false);
  const nuvioSelected = savedAccount?.selected ?? null;
  useEffect(() => {
    const token = getEditToken();
    if (platform !== 'nuvio' || nuvioSelected == null || !token) { setNuvioCurrent(null); return; }
    let cancelled = false;
    fetchNuvioProfile(uuid, token, nuvioSelected)
      .then((detail) => {
        if (cancelled) return;
        const values = (detail?.settings?.values ?? {}) as NuvioSettingValues;
        setNuvioCurrent(values);
        if (nuvioSeeded.current || dirtyRef.current) return;
        nuvioSeeded.current = true;
        const fromNuvio = playbackFromNuvio(values, false);
        if (!fromNuvio || saved?.nuvioPlayback.enabled) return;
        setSaved((prev) => (prev ? { ...prev, nuvioPlayback: fromNuvio } : prev));
        setSeed((prev) => (prev ? { ...prev, nuvioPlayback: fromNuvio } : prev));
        setPageKey((key) => key + 1);
      })
      .catch(() => { if (!cancelled) setNuvioCurrent(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid, platform, nuvioSelected]);

  // The Nuvio view works on the saved connection only, so a Nuvio setup
  // needs one stored on the server before the rail offers it. Losing it
  // (platform switched to Stremio) drops back to the edit view.
  const nuvioAvailable = platform === 'nuvio' && savedAccount !== null;
  useEffect(() => {
    if (view === 'nuvio' && !nuvioAvailable) setView('edit');
  }, [view, nuvioAvailable]);

  const body = useMemo(() => {
    if (!current || !saved || !summary) return null;
    return editSaveBody({
      current, saved,
      savedName: summary.name ?? null,
      savedTier, tier: activeTier,
      providerServices: summary.keyServices ?? [],
      clearKeys: [...clearKeys.current],
    });
    // clearCount tracks the ref's contents.
  }, [current, saved, summary, savedTier, activeTier, clearCount]);
  const newConnection = Boolean(current?.connection) && !same(current?.connection, saved?.connection);
  const dirty = body !== null || newConnection;
  dirtyRef.current = dirty;

  async function saveAll(): Promise<boolean> {
    const token = getEditToken();
    if (!token) { setSaveError('Session expired: unlock again'); return false; }
    if (!current || !summary) return false;
    setSaving(true);
    setSaveError(null);
    try {
      if (body) await saveSetup(uuid, body, token);
      if (current.connection && newConnection) {
        try {
          await sealPushConnection(uuid, current.connection.platform, { ...current.connection } as unknown as Record<string, unknown>, token);
          toast('Player connection saved');
        } catch {
          toast('Settings saved, but the player connection did not save', 'error');
        }
      }
      // Everything on screen is now what the server holds.
      const keys = Object.fromEntries(
        Object.entries(current.keys).filter(([, value]) => typeof value === 'string' && value.trim()),
      ) as SetupKeysDraft;
      setSaved({ ...current, keys });
      setSavedTier(activeTier);
      clearKeys.current.clear();
      setClearCount(0);
      if (activeTier !== savedTier) toast(`Now a ${TIER_LABELS[activeTier]} setup. Same link, same id.`);
      else toast('Saved ✓');
      fetchSetup(uuid).then(setSummary).catch(() => {});
      return true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not save';
      setSaveError(message);
      toast(message, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndPush() {
    const token = getEditToken();
    if (!token) { setSaveError('Session expired: unlock again'); return; }
    const name = platform === 'nuvio' ? 'Nuvio' : 'Stremio';
    setPushing('Saving…');
    try {
      if (dirty && !(await saveAll())) return;
      setPushing(`Pushing to ${name}…`);
      const pushed = await pushSetup(uuid, { platform, ...(platform === 'nuvio' && replaceOthers ? { replace_other_collections: true } : {}) }, token);
      setReplaceOthers(false);
      toast(dirty ? `Saved and pushed to ${name}` : `Pushed to ${name}`);
      if (pushed.libraryPending) toast('Your library folders are still being prepared and will appear on their own');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Push failed';
      setSaveError(message);
      toast(message, 'error');
    } finally {
      setPushing(null);
    }
  }

  function switchTier(next: TierId) {
    if (next === activeTier || !current) return;
    // Carry everything on screen into the other tier's page. Nothing is
    // written until Save; Save then moves the setup and keeps its id.
    setSeed(current);
    setActiveTier(next);
    setPageKey((key) => key + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function clearEdits() {
    if (!saved) return;
    setSeed(saved);
    setCurrent(saved);
    setActiveTier(savedTier);
    clearKeys.current.clear();
    setClearCount(0);
    setSaveError(null);
    setPageKey((key) => key + 1);
    toast('Edits cleared');
  }

  async function deleteAll() {
    const token = getEditToken();
    if (!token) { toast('Session expired: unlock again', 'error'); setConfirmDelete(false); return; }
    setDeleting(true);
    try {
      await deleteSetup(uuid, token);
      clearEditToken();
      forgetDeletedSetup(uuid, queryClient);
      toast('Setup deleted');
      navigate('/configure', { replace: true });
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Could not delete this setup', 'error');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  function copyLink(value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => setCopied(false));
  }

  // Attention count for the Library switch, once the setup is unlocked.
  const isUnlocked = saved !== null && seed !== null;
  useEffect(() => {
    if (!isUnlocked) return;
    const token = getEditToken();
    if (!token) return;
    let cancelled = false;
    fetchLibrarySummary(uuid, token)
      .then((summaryOut) => { if (!cancelled) setLibraryAttention(summaryOut.attention); })
      .catch(() => { /* no index or no debrid key: no count */ });
    return () => { cancelled = true; };
  }, [isUnlocked, uuid, view]);

  // Any single-segment path reaches this route (React Router has no shape
  // check), so /index.html or /foo.mp4 must be the shared 404.
  if (!isSetupUuid(uuid)) {
    return <ErrorState code={404} title={t('errors.notFound')} desc={t('errors.notFoundDesc')} />;
  }
  if (missing) {
    return (
      <ErrorState
        code={404}
        title={setupCopy('Setup not found', 'Setup not found')}
        desc={setupCopy('That setup id is not on this instance.', 'That setup id is not on this instance.')}
      />
    );
  }
  if (!summary) return <RouteSkeleton variant="setup" label="Loading your setup…" />;

  if (created.justCreated) {
    const manifest = installToken ? installUrl(window.location.origin, installToken) : '';
    return (
      <section className="setup">
        <div className="setup-panel">
          <span className="setup-eyebrow">YOU ARE READY</span>
          <h1>Your setup is live</h1>
          <p className="setup-lede">Paste this into Stremio or Nuvio as an addon.</p>
          <label className="setup-field">
            <span>Your manifest.json</span>
            <input readOnly value={manifest} />
          </label>
          <div className="setup-actions">
            <button type="button" className="setup-primary" onClick={() => copyLink(manifest)}>
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
          </div>
          <p className="setup-warning">
            Keep this link private: anyone who has it can watch. Changing settings needs your password.
          </p>
        </div>
      </section>
    );
  }

  const Page = TIER_PAGES[activeTier];
  const unlocked = saved !== null && seed !== null;
  const manifest = installToken ? installUrl(window.location.origin, installToken) : null;
  const platformName = platform === 'nuvio' ? 'Nuvio' : 'Stremio';
  const pushAvailable = Boolean(current?.connection) || Boolean(savedAccount);

  // Fetched at click time so a backup always matches what is saved now.
  async function downloadSettings() {
    const token = getEditToken();
    if (!token || !summary) return;
    try {
      const data = await fetchSetupConfig(uuid, token);
      downloadBackup(buildBackup({ tier: savedTier, name: summary.name ?? null, config: data.config }));
      toast('Settings backup downloaded');
    } catch {
      toast('Could not download the backup', 'error');
    }
  }

  // Fade the current view out, swap, fade the next one in. Returning to the
  // tier page puts it back where it was scrolled to.
  function go(next: EditView) {
    if (next === view) return;
    if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
    if (view === 'edit') editScroll.current = window.scrollY;
    const swap = () => {
      fadeTimer.current = null;
      pendingScroll.current = next === 'edit' ? editScroll.current : 0;
      setView(next);
    };
    const stage = stageRef.current;
    if (!stage || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { swap(); return; }
    stage.classList.add('is-fading');
    fadeTimer.current = window.setTimeout(swap, VIEW_FADE_MS);
  }

  const backToEditing = (
    <button type="button" className="edit-back" onClick={() => go('edit')}>
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg>
      <span>Back to editing</span>
    </button>
  );

  const settings = (
    <section className="edit-settings" aria-label="Setup settings">
      <div className="edit-settings-head">
        <span className="setup-eyebrow">Setup settings</span>
        <h2>This setup</h2>
        <p data-i18n-preserve className="edit-settings-id">{uuid}</p>
      </div>
      <div className="edit-settings-block">
        <h3>Setup type</h3>
        <p>Switch to a different setup type. Everything you have carries over; it only changes when you save, and the link and id stay the same.</p>
        <div className="edit-tiers" role="radiogroup" aria-label="Setup type">
          {(['quick', 'partial', 'full'] as const).map((tier) => (
            <button
              key={tier} type="button" role="radio" aria-checked={activeTier === tier}
              className={`edit-tier${activeTier === tier ? ' is-active' : ''}`}
              onClick={() => switchTier(tier)}
            >
              <strong>{TIER_LABELS[tier]}</strong>
              <small>{tier === savedTier ? 'Saved type' : activeTier === tier ? 'Applies when you save' : tier === 'quick' ? 'Library, posters, streams' : tier === 'partial' ? 'Adds Home rows and filters' : 'Adds collections and folders'}</small>
            </button>
          ))}
        </div>
      </div>
      {manifest && (
        <div className="edit-settings-block">
          <h3>Install link</h3>
          <p>Paste this into Stremio or Nuvio. Keep it private: anyone with it can watch.</p>
          <span className="edit-link">
            <input readOnly value={manifest} onFocus={(event) => event.target.select()} />
            <button type="button" className="setup-secondary" onClick={() => copyLink(manifest)}>{copied ? 'Copied ✓' : 'Copy'}</button>
          </span>
        </div>
      )}
      <div className="edit-settings-block">
        <h3>Settings backup</h3>
        <p>Download this setup's saved settings as a file. Keys, your password and player logins are never included. Start a new setup from it on the setup page, for example for someone else in your home.</p>
        <button type="button" className="setup-secondary" onClick={() => void downloadSettings()}>Download settings backup</button>
      </div>
      <div className="edit-settings-actions">
        <button type="button" className="setup-secondary" disabled={!dirty} onClick={clearEdits}>Clear my edits</button>
        <button type="button" className="btn-danger" onClick={() => setConfirmDelete(true)}>Delete all my data</button>
      </div>
    </section>
  );

  const editMode: EditMode = {
    uuid,
    tier: activeTier,
    editToken: getEditToken(),
    locked: !unlocked,
    nuvioCurrent,
    initial: seed ?? emptySnapshot(),
    dirty,
    savedServices: summary.keyServices ?? [],
    revealSaved: async (field) => {
      const token = getEditToken();
      if (!token) throw new Error('unlock the setup first');
      const out = await revealSetupKey(uuid, field, token);
      const value = typeof out?.key === 'string' ? out.key : '';
      if (!value.trim()) return null;
      setSaved((prev) => (prev ? { ...prev, keys: { ...prev.keys, [field]: value } } : prev));
      return value;
    },
    onRemoveKey: (field) => { clearKeys.current.add(field); setClearCount(clearKeys.current.size); },
    onSnapshot: (snapshot) => {
      // A key typed back in cancels its pending removal.
      for (const [field, value] of Object.entries(snapshot.keys)) {
        if (typeof value === 'string' && value.trim() && clearKeys.current.delete(field)) setClearCount(clearKeys.current.size);
      }
      setCurrent(snapshot);
    },
    onSave: () => void saveAll(),
    saving,
    onSaveAndPush: pushAvailable ? () => void saveAndPush() : null,
    pushTarget: platformName,
    pushing: pushing !== null,
    onClearEdits: clearEdits,
    savedAccount,
    onSavedProfile: (profileIndex) => {
      const token = getEditToken();
      if (!token) { toast('Session expired: unlock again', 'error'); return; }
      setNuvioProfile(uuid, profileIndex, token)
        .then(() => {
          setSavedAccount((prev) => (prev ? { ...prev, selected: profileIndex } : prev));
          toast('Profile updated');
        })
        .catch(() => toast('Could not change the profile', 'error'));
    },
    renderFinish: ({ deskBody, name }) => (
      <div className="edit-finish">
        {name && (
          <label className="setup-field qs-name">
            <span>Setup name</span>
            <input
              type="text" autoComplete="off" placeholder="e.g. Living room"
              value={name.value} onChange={(event) => name.onChange(event.target.value)}
            />
          </label>
        )}
        {activeTier !== savedTier && (
          <p className="edit-tier-note">{`Saving moves this setup to ${TIER_LABELS[activeTier]}. Same link, same id.`}</p>
        )}
        {activeTier === 'quick' || !manifest ? (
          <>
            <button type="button" className={`qs-cta${dirty ? ' is-ready' : ''}`} disabled={!dirty || saving} onClick={() => void saveAll()}>
              <span className="qs-cta-text">{saving ? 'Saving…' : dirty ? 'Save changes' : 'Everything is saved'}</span>
            </button>
            {saveError && <p className="setup-error" role="alert">{saveError}</p>}
          </>
        ) : (
          <>
            {saveError && <p className="setup-error" role="alert">{saveError}</p>}
            <PublishPanel
              installToken={installToken ?? ''}
              uuid={uuid}
              tierLabel={TIER_LABELS[activeTier]}
              name={(current?.name ?? '').trim() || summary.name}
              platform={platform}
              counts={{
                homeRows: (current?.homeRows ?? []).filter((row) => row.enabled !== false).length,
                collections: (current?.collections ?? []).length,
                folders: (current?.collections ?? []).reduce((total, collection) => total + (collection.folders || []).length, 0),
                lang: current?.meta.lang ?? 'en-US',
              }}
              deskTitle={`Publish to ${platformName}`}
              hasCollections={activeTier === 'full'}
              deskBody={deskBody}
              connected={pushAvailable}
              action={publishActionFor({
                dirty, pushing, saving, pushAvailable, platformName,
                onSaveAndPush: () => void saveAndPush(),
                onSave: () => void saveAll(),
                connectHint: activeTier === 'full'
                  ? `Connect ${platformName} on the Destination step to push from here.`
                  : `Sign in above (optional) and this pushes straight to ${platformName}.`,
              })}
              secondaryAction={{ label: 'Clear my edits', disabled: !dirty, onClick: clearEdits }}
              replaceOthers={pushAvailable ? { value: replaceOthers, onChange: setReplaceOthers } : null}
              profilePicker={platform === 'nuvio' && savedAccount?.profiles?.length ? {
                profiles: savedAccount.profiles,
                value: savedAccount.selected,
                onChange: (profileIndex) => editMode.onSavedProfile(profileIndex),
              } : null}
            />
          </>
        )}
      </div>
    ),
  };

  const railItems: { id: EditView; label: string; title: string; icon: ReactNode; badge?: number | null }[] = [
    { id: 'edit', label: 'Edit', title: 'Edit settings', icon: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6" /> },
    { id: 'library', label: 'Library', title: 'Your library', icon: <path d="M5 4v16M9 4v16M13 5l4 15M18 4.5l2 .5" />, badge: libraryAttention },
    ...(nuvioAvailable ? [{
      id: 'nuvio' as const, label: 'Nuvio', title: 'Your Nuvio',
      icon: <><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" /><path d="M10 8.6v6.8l5.4-3.4z" /></>,
    }] : []),
    {
      id: 'settings', label: 'Settings', title: 'Setup settings',
      icon: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></>,
    },
  ];

  return (
    <div className={`edit-root${unlocked ? ' has-rail' : ''}`}>
      {unlocked && (
        <nav className="edit-rail" aria-label="Setup sections">
          {railItems.map((item) => (
            <button
              key={item.id} type="button" title={item.title}
              aria-current={view === item.id ? 'page' : undefined}
              className={`edit-rail-item${view === item.id ? ' is-active' : ''}`}
              onClick={() => go(item.id)}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">{item.icon}</svg>
              <span className="edit-rail-label">{item.label}</span>
              {item.badge ? <em className="edit-rail-badge" aria-label={setupCount(item.badge, 'file needs attention', 'files need attention')}>{item.badge}</em> : null}
            </button>
          ))}
        </nav>
      )}
      <div className="edit-stage" ref={stageRef}>
        <div className={unlocked ? 'edit-page' : 'edit-page is-locked'} inert={!unlocked} aria-hidden={!unlocked} hidden={unlocked && view !== 'edit'}>
          <Page key={`${activeTier}-${pageKey}`} edit={editMode} />
        </div>
        {unlocked && view === 'library' && (
          <div className="edit-view edit-view-library">
            {backToEditing}
            <LibraryPanel uuid={uuid} editToken={getEditToken()} />
          </div>
        )}
        {unlocked && view === 'nuvio' && nuvioAvailable && (
          <div className="edit-view edit-view-library edit-view-nuvio">
            {backToEditing}
            <NuvioPanel uuid={uuid} editToken={getEditToken()} onEditSetup={() => go('edit')} />
          </div>
        )}
        {unlocked && view === 'settings' && (
          <div className="edit-view edit-view-settings">
            {backToEditing}
            {settings}
          </div>
        )}
      </div>
      {(!unlocked || leaving) && (
        <UnlockModal
          uuid={uuid} tier={savedTier}
          busy={unlocking} loading={loadingSettings} error={unlockError} leaving={leaving}
          password={password} onPassword={setPassword} onSubmit={() => void unlock()}
        />
      )}
      <ConfirmModal
        open={confirmDelete}
        title="Delete everything linked to this setup?"
        body="This permanently deletes the setup, its settings and its saved keys from this server. Installed addon links stop working immediately. This cannot be undone."
        confirmLabel={deleting ? 'Deleting…' : 'Delete everything'}
        danger
        onConfirm={() => void deleteAll()}
        onCancel={() => { if (!deleting) setConfirmDelete(false); }}
      />
    </div>
  );
}
