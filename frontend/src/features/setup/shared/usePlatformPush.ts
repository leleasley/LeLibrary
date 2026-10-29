import { useEffect, useRef, useState } from 'react';
import { pushSetup, sealPushConnection, unlockSetup } from '@/features/setup/resolver/api';
import type { PlatformConnection } from '@/features/setup/full/platform-login';

export interface PlatformPush {
  // Bearer token from an immediate unlock with the password just typed. Never
  // stored anywhere; it only lives as long as this page.
  editToken: string | null;
  unlockError: string | null;
  // Whether the setup holds a connection for this platform at all.
  connected: boolean;
  profiles: NonNullable<PlatformConnection['nuvioProfiles']>;
  profileId: number | null;
  setProfileId: (value: number | null) => void;
  // Progress label while pushing, null when idle.
  busy: string | null;
  pushed: boolean;
  // The push published everything except the owned library folders, because the
  // library was still building. Pushing again in a minute adds them.
  libraryPending: boolean;
  // Nuvio only, this push only: remove the profile's other collections.
  replaceOthers: boolean;
  setReplaceOthers: (value: boolean) => void;
  push: () => Promise<boolean>;
}

// One push implementation for every surface that offers it (the Review step and
// the post-creation modal), so the two can never drift: seal the connection the
// setup already holds, then ask the server to install.
export function usePlatformPush(input: {
  uuid: string | null;
  password: string;
  platform: 'nuvio' | 'stremio' | null;
  connection: PlatformConnection | null;
  // Push without a connection from the setup itself (used by the review page,
  // which re-seals the draft connection on every push).
  sealBeforePush?: boolean;
  onPushed?: () => void;
  onError?: (message: string) => void;
}): PlatformPush {
  const { uuid, password, platform, connection } = input;
  const [editToken, setEditToken] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pushed, setPushed] = useState(false);
  const [libraryPending, setLibraryPending] = useState(false);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [replaceOthers, setReplaceOthers] = useState(false);

  const passwordRef = useRef(password);
  passwordRef.current = password;
  // Callbacks are used inside async handlers only, so a ref keeps them stable
  // without re-triggering the unlock effect.
  const handlers = useRef(input);
  handlers.current = input;

  const active = connection && platform && connection.platform === platform ? connection : null;
  const platformName = platform === 'stremio' ? 'Stremio' : 'Nuvio';
  const profiles = active?.platform === 'nuvio' ? (active.nuvioProfiles ?? []) : [];

  // One password check, then a bearer token; the password is never stored.
  useEffect(() => {
    if (!uuid || editToken) return;
    let cancelled = false;
    unlockSetup(uuid, passwordRef.current)
      .then((result) => { if (!cancelled) setEditToken(result.editToken); })
      .catch(() => { if (!cancelled) setUnlockError('Could not unlock for push. Your setup is saved; open it to push.'); });
    return () => { cancelled = true; };
    // Unlock once per created setup by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);

  useEffect(() => {
    setProfileId(active?.platform === 'nuvio' ? (active.nuvioSelectedProfile ?? null) : null);
  }, [active]);

  async function push(): Promise<boolean> {
    if (busy || !active || !uuid || !platform) return false;
    setBusy('Saving setup…');
    try {
      if (handlers.current.sealBeforePush !== false) {
        await sealPushConnection(uuid, platform, { ...active } as unknown as Record<string, unknown>, editToken ?? '');
      }
      setBusy(`Preparing ${platformName}…`);
      const result = await pushSetup(
        uuid,
        {
          platform,
          ...(platform === 'nuvio' && profileId ? { profile_id: profileId } : {}),
          ...(platform === 'nuvio' && replaceOthers ? { replace_other_collections: true } : {}),
        },
        editToken ?? '',
      );
      if (!result.ok) throw new Error('Push failed');
      // A one-off choice: the next push keeps other collections again.
      setReplaceOthers(false);
      setPushed(true);
      setLibraryPending(result.libraryPending === true);
      handlers.current.onPushed?.();
      return true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Push failed';
      // A timeout is the one failure that may still be finishing on the server:
      // say so instead of implying nothing happened.
      handlers.current.onError?.(
        /timed out/i.test(message)
          ? 'The push is taking longer than expected. It may still finish - check Nuvio in a minute, then push again if your collections are missing.'
          : message,
      );
      return false;
    } finally {
      setBusy(null);
    }
  }

  return {
    editToken, unlockError, connected: active !== null, profiles,
    profileId, setProfileId, busy, pushed, libraryPending, replaceOthers, setReplaceOthers, push,
  };
}
