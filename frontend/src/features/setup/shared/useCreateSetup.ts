import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createSetup } from '@/features/setup/resolver/api';
import { turnstileToken } from '@/features/setup/shared/turnstile';
import { checkPassword } from '@/features/setup/resolver/validation';
import { rememberSetup } from '@/features/setup/shared/setup-history';
import { setupCopy } from '@/features/setup/shared/setup-copy';
import type { PlatformConnection } from '@/features/setup/full/platform-login';

// The Destination step's login, sealed with the setup when it is created (not
// only on a push), so closing the end screen or refreshing never loses it.
export function withConnection(keys: Record<string, unknown>, connection: PlatformConnection | null | undefined): Record<string, unknown> {
  if (!connection) return keys;
  const ok = connection.platform === 'nuvio' ? !!connection.nuvioToken : !!connection.stremioAuth;
  return ok ? { ...keys, push: { [connection.platform]: connection } } : keys;
}

// Every tier shows TMDB as required and the server enforces it. Keep the
// client check in one pure place so the message and the rule cannot drift.
export function createKeyError(keys: Record<string, unknown>): 'provider' | 'tmdb' | null {
  if (Object.keys(keys).length === 0) return 'provider';
  if (!String(keys['tmdbApiKey'] ?? '').trim()) return 'tmdb';
  return null;
}

// Shared creation tail for every tier page: password state, validation, the
// POST, and the handoff to /{uuid} with the just-created install link.
// The "Creating your setup..." loader stays up at least this long, then fades
// (CREATING_FADE_MS) before the Ready page fades in: a fast server should not
// flash the loader for a frame.
export const CREATING_MIN_MS = 1100;
export const CREATING_FADE_MS = 280;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useCreateSetup(tier: string, options: { navigateToSetup?: boolean; loader?: boolean } = {}) {
  const navigateToSetup = options.navigateToSetup !== false;
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ uuid: string; installToken: string } | null>(null);
  // Loader phase while a setup is being created (only with `loader`).
  const [creating, setCreating] = useState<'creating' | 'leaving' | null>(null);

  async function create(
    input: { name?: string; config: Record<string, unknown>; keys: Record<string, unknown>; connection?: PlatformConnection | null },
  ) {
    const check = checkPassword(password, confirmation);
    if (!check.ok) { setError(check.error ?? 'Check your password'); return false; }
    const keyError = createKeyError(input.keys);
    if (keyError === 'provider') {
      setError('Add at least one provider key above');
      return false;
    }
    if (keyError === 'tmdb') {
      setError(setupCopy('Add your TMDB API key above', 'Add your TMDB API key above'));
      return false;
    }
    setBusy(true);
    setError(null);
    const startedAt = Date.now();
    if (options.loader) setCreating('creating');
    try {
      const trimmedName = input.name?.trim();
      const created = await createSetup({
        tier,
        ...(trimmedName ? { name: trimmedName } : {}),
        password,
        config: input.config,
        keys: withConnection(input.keys, input.connection),
        turnstile: await turnstileToken('create-setup'),
      });
      if (options.loader) {
        await wait(Math.max(0, CREATING_MIN_MS - (Date.now() - startedAt)));
        setCreating('leaving');
        await wait(CREATING_FADE_MS);
      }
      finish(created.uuid, created.installToken, trimmedName ?? null);
      setCreating(null);
      return true;
    } catch (caught) {
      setCreating(null);
      setError(caught instanceof Error ? caught.message : 'Could not create your setup');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function finish(uuid: string, installToken: string, name: string | null) {
    setResult({ uuid, installToken });
    // Remember this browser's setups so /configure can offer them back
    // (self-hosters have no account list to return to).
    rememberSetup({ uuid, name, tier });
    if (navigateToSetup) {
      navigate(`/${uuid}`, {
        replace: true,
        state: { justCreated: true, installToken, tier },
      });
    }
  }

  // Revoke and regenerate swaps the install link in place; the UUID stays.
  function replaceInstallToken(installToken: string) {
    setResult((current) => (current ? { ...current, installToken } : current));
  }

  return { password, confirmation, error, busy, result, creating, setPassword, setConfirmation, create, replaceInstallToken };
}
