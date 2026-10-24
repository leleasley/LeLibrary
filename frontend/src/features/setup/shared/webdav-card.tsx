import { useState } from 'react';
import { apiClient } from '@/api/client';
import { KeyInput } from '@/features/setup/shared/sections';
import { setupCopy } from '@/features/setup/shared/setup-copy';
import type { SetupKeysDraft } from '@/features/setup/shared/config-contract';

// Self-host only: the user's own WebDAV server (NAS, rclone, Nextcloud,
// Synology) as a library. Three sealed fields, never revealed: in edit mode a
// saved server shows "Saved" and a blank field keeps the stored value.

type WebdavFields = Pick<SetupKeysDraft, 'webdavUrl' | 'webdavUser' | 'webdavPassword'>;
type VerifyReply = { valid?: boolean; error?: string; folders?: number; videos?: number };
type Post = (path: string, body: unknown) => Promise<VerifyReply>;

const ERRORS: Record<string, string> = {
  'bad-url': 'Enter the full address, starting with http:// or https://.',
  'blocked-host': 'This server is on your local network. Set WEBDAV_ALLOW_PRIVATE=on for this LeLibrary install to use it.',
  unreachable: 'LeLibrary could not reach this server.',
  auth: 'The username or password was not accepted.',
  'not-webdav': 'This address did not answer as a WebDAV server.',
  timeout: 'The server took too long to answer.',
};

export function webdavErrorMessage(code: string | undefined): string {
  return ERRORS[code ?? ''] ?? ERRORS['unreachable'] as string;
}

export async function checkWebdav(values: WebdavFields, post: Post): Promise<{ ok: boolean; message: string }> {
  const url = (values.webdavUrl ?? '').trim();
  if (!url) return { ok: false, message: webdavErrorMessage('bad-url') };
  let reply: VerifyReply;
  try {
    reply = await post('/api/verify/webdav', { url, user: (values.webdavUser ?? '').trim(), password: values.webdavPassword ?? '' });
  } catch {
    return { ok: false, message: webdavErrorMessage('unreachable') };
  }
  if (!reply.valid) return { ok: false, message: webdavErrorMessage(reply.error) };
  const videos = Number(reply.videos) || 0;
  const folders = Number(reply.folders) || 0;
  return { ok: true, message: setupCopy('Connected: {{videos}} videos in {{folders}} folders.', `Connected: ${videos} videos in ${folders} folders.`, { videos, folders }) };
}

export function WebdavCard({ enabled, values, onChange, savedServices, savedScope }: {
  enabled: boolean;
  values: SetupKeysDraft;
  onChange: (next: SetupKeysDraft) => void;
  savedServices?: readonly string[] | undefined;
  savedScope?: 'setup' | 'import' | undefined;
}) {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  if (!enabled) return null;
  const saved = Boolean(savedServices?.includes('webdavUrl'));
  const set = (field: keyof WebdavFields, value: string) => {
    setResult(null);
    onChange({ ...values, [field]: value });
  };
  const check = async () => {
    setChecking(true);
    setResult(await checkWebdav(values, (path, body) => apiClient.post<VerifyReply>(path, body)));
    setChecking(false);
  };
  return (
    <div className={`provider-card webdav-card is-open${saved || values.webdavUrl ? ' filled' : ''}`} data-state={result?.ok ? 'verified' : 'idle'}>
      <div className="pc-head">
        <img src="/provider-logos/webdav.svg" alt="" />
        <div className="pc-title">
          <strong>Your own WebDAV server</strong>
          <small>Add a NAS, rclone, Nextcloud or Synology WebDAV share. Its videos are matched and shown like your debrid library. Playback streams through this LeLibrary server.</small>
        </div>
        {saved && savedScope !== 'import' && <span className="pc-pill is-verified" aria-label="Key saved on the server">Saved</span>}
      </div>
      <div className="pc-body">
        <label className="field">
          <span>Server address</span>
          <input
            type="url" inputMode="url" autoComplete="off" spellCheck={false}
            placeholder={saved ? 'Saved (hidden). Type a new address to change it.' : 'http://192.168.1.10:8080/'}
            value={values.webdavUrl ?? ''} onChange={(e) => set('webdavUrl', e.target.value)}
          />
        </label>
        <label className="field">
          <span>Username</span>
          <input
            type="text" autoComplete="off" spellCheck={false}
            placeholder={saved ? 'Saved (hidden)' : ''}
            value={values.webdavUser ?? ''} onChange={(e) => set('webdavUser', e.target.value)}
          />
        </label>
        <KeyInput
          label="Password" hint="" value={values.webdavPassword ?? ''}
          onChange={(value) => set('webdavPassword', value)}
          {...(saved ? { saved: true } : {})}
          {...(savedScope ? { savedScope } : {})}
        />
        <div className="webdav-check">
          <button type="button" className="setup-secondary" onClick={() => void check()} disabled={checking}>
            {checking ? 'Checking…' : 'Check connection'}
          </button>
          {saved && !values.webdavUrl && <small>Type the address and login again to check them.</small>}
          {result && <p className={result.ok ? 'setup-note is-ok' : 'setup-note is-error'} role="status">{result.message}</p>}
        </div>
        <p className="setup-note">Using TorBox, Premiumize, AllDebrid or Real-Debrid? Add that service above instead: it plays straight from the service and is faster.</p>
      </div>
    </div>
  );
}
