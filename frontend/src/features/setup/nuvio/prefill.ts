import { useEffect, useRef } from 'react';
import { apiClient } from '@/api/client';
import { ensureFreshNuvio, type PlatformConnection } from '@/features/setup/full/platform-login';
import { EMPTY_NUVIO_PLAYBACK, type NuvioPlaybackDraft, type PlaybackMode } from '@/features/setup/shared/nuvio-playback';
import { DEFAULT_NUVIO_HIDE_UNRELEASED, type NuvioHideUnreleased } from '@/features/setup/shared/nuvio-library';
import { toast } from '@/features/setup/shared/Toast';
import { setupCopy } from '@/features/setup/shared/setup-copy';

// Prefill from the Nuvio profile the person signed in to, so settings they
// already have are not switched on again by hand. Only settings LeLibrary
// itself offers (playback, Hide unreleased) and only where the draft is still
// at its default: a choice made here always wins.

export type NuvioSettingValues = Partial<Record<string, unknown>>;

const MODES: PlaybackMode[] = ['MANUAL', 'FIRST_STREAM', 'REGEX_MATCH'];

// The playback block as Nuvio has it, or null when the profile has none of
// these settings (nothing to fill in).
export function playbackFromNuvio(values: NuvioSettingValues, enabled: boolean): NuvioPlaybackDraft | null {
  const mode = values['autoPlayMode'];
  const next = values['nextEpisode'];
  if (typeof mode !== 'string' && typeof next !== 'boolean') return null;
  const regex = typeof values['autoPlayRegex'] === 'string' ? String(values['autoPlayRegex']) : '';
  let resolved: PlaybackMode = MODES.includes(mode as PlaybackMode) ? mode as PlaybackMode : 'MANUAL';
  // A regex mode without a pattern cannot be saved; start from manual instead.
  if (resolved === 'REGEX_MATCH' && !regex.trim()) resolved = 'MANUAL';
  return { ...EMPTY_NUVIO_PLAYBACK, enabled, mode: resolved, regex, nextEpisode: next === true };
}

export function unreleasedFromNuvio(values: NuvioSettingValues): NuvioHideUnreleased | null {
  const flag = values['hideUnreleased'];
  return flag === true ? 'hide' : flag === false ? 'show' : null;
}

export async function previewNuvioSettings(token: string, profile: number): Promise<NuvioSettingValues> {
  const out = await apiClient.post<{ settings?: { values?: NuvioSettingValues } }>(
    '/api/setup/nuvio/preview-settings',
    { profile },
    { headers: { 'x-nuvio-access-token': token } },
  );
  return out?.settings?.values ?? {};
}

// Create flows: once the person has signed in and a profile is picked, fill in
// the playback block and Hide unreleased from that profile, once per pick.
export function useNuvioCreatePrefill(input: {
  enabled: boolean;
  platform: 'nuvio' | 'stremio';
  connection: PlatformConnection | null;
  onConnection: (next: PlatformConnection) => void;
  playback: NuvioPlaybackDraft;
  setPlayback: (next: NuvioPlaybackDraft) => void;
  unreleased: NuvioHideUnreleased;
  setUnreleased: (next: NuvioHideUnreleased) => void;
}): void {
  const done = useRef<string | null>(null);
  const latest = useRef(input);
  latest.current = input;
  const token = input.connection?.platform === 'nuvio' ? input.connection.nuvioToken ?? '' : '';
  const profile = input.connection?.nuvioSelectedProfile ?? null;
  const userRaw = input.connection?.nuvioUser;
  const user = typeof userRaw === 'string' ? userRaw : JSON.stringify(userRaw ?? '');

  useEffect(() => {
    if (!input.enabled || input.platform !== 'nuvio' || !token || profile == null) return;
    // Keyed by account and profile, not token: a refreshed session is the same pick.
    const key = `${user}|${profile}`;
    if (done.current === key) return;
    done.current = key;
    let cancelled = false;
    void (async () => {
      try {
        const conn = latest.current.connection;
        const fresh = conn ? await ensureFreshNuvio(conn) : null;
        if (fresh && fresh !== conn) latest.current.onConnection(fresh);
        const values = await previewNuvioSettings(fresh?.nuvioToken ?? token, profile);
        if (cancelled) return;
        const now = latest.current;
        const filled: string[] = [];
        const playback = playbackFromNuvio(values, true);
        if (playback && !now.playback.enabled) { now.setPlayback(playback); filled.push(setupCopy('Playback', 'Playback')); }
        const unreleased = unreleasedFromNuvio(values);
        if (unreleased && now.unreleased === DEFAULT_NUVIO_HIDE_UNRELEASED) { now.setUnreleased(unreleased); filled.push(setupCopy('Hide unreleased', 'Hide unreleased')); }
        if (filled.length) toast(setupCopy('Filled in from your Nuvio profile: {{list}}', `Filled in from your Nuvio profile: ${filled.join(', ')}`, { list: filled.join(', ') }));
      } catch {
        // A failed read just means nothing is prefilled; the steps still work.
      }
    })();
    return () => { cancelled = true; };
  }, [input.enabled, input.platform, token, profile, user]);
}
