// Settings backup: a setup's settings as a file, to keep or to start a new
// setup from (for example for a family member). Never keys, the password or
// player logins: those are sealed separately on the server and are not part
// of the config. A defensive filter drops anything key-like anyway.
import { snapshotFromSaved, snapshotToFullDraft, snapshotToPartialDraft, type TierId } from '@/features/setup/shared/edit-mode';
import { saveQuickDraft } from '@/features/setup/quick/quick-draft';
import { savePartialDraft } from '@/features/setup/partial/partial-draft';
import { saveFullDraft } from '@/features/setup/full/full-draft';

export const BACKUP_FORMAT = 'lelibrary-setup-backup';
export const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 2 * 1024 * 1024;

export interface SetupBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  tier: TierId;
  name: string;
  exportedAt: string;
  config: Record<string, unknown>;
}

const SECRET_FIELD = /(?:api)?key$|token$|secret|password|session|credential/i;

function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [field, inner] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELD.test(field)) continue;
    out[field] = stripSecrets(inner);
  }
  return out;
}

function isTier(value: unknown): value is TierId {
  return value === 'quick' || value === 'partial' || value === 'full';
}

export function buildBackup(input: { tier: TierId; name: string | null; config: unknown }): SetupBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    tier: input.tier,
    name: (input.name ?? '').trim(),
    exportedAt: new Date().toISOString(),
    config: stripSecrets(input.config && typeof input.config === 'object' ? input.config : {}) as Record<string, unknown>,
  };
}

export function downloadBackup(backup: SetupBackup): void {
  const slug = (backup.name || 'lelibrary-setup').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'lelibrary-setup';
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${slug}.lelibrary.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

export type BackupParse = { ok: true; backup: SetupBackup } | { ok: false; error: string };

export function parseBackup(text: string): BackupParse {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: 'That file is too large to be a LeLibrary backup.' };
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'That file is not a LeLibrary backup.' }; }
  const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (record['format'] !== BACKUP_FORMAT || typeof record['version'] !== 'number') {
    return { ok: false, error: 'That file is not a LeLibrary backup.' };
  }
  if (record['version'] > BACKUP_VERSION) {
    return { ok: false, error: 'This backup was made by a newer version of LeLibrary.' };
  }
  const config = record['config'];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, error: 'That file is not a LeLibrary backup.' };
  }
  return {
    ok: true,
    backup: {
      format: BACKUP_FORMAT,
      version: record['version'],
      tier: isTier(record['tier']) ? record['tier'] : 'full',
      name: typeof record['name'] === 'string' ? record['name'].slice(0, 80) : '',
      exportedAt: typeof record['exportedAt'] === 'string' ? record['exportedAt'] : '',
      config: stripSecrets(config) as Record<string, unknown>,
    },
  };
}

// Fill the backup's level from it, through the same path edit mode uses, and
// return where to go. The page then restores it like any saved draft; keys
// and the password are entered fresh, and creating makes a brand-new setup.
export function stageBackup(backup: SetupBackup): string {
  const snapshot = snapshotFromSaved(backup.config, {}, backup.name || null);
  if (backup.tier === 'quick') {
    saveQuickDraft({
      name: snapshot.name,
      keys: {},
      formatting: snapshot.formatting,
      posters: snapshot.posters,
      badgePack: snapshot.badgePack,
      extras: {
        lang: snapshot.meta.lang,
        notices: snapshot.meta.notices,
        noticeTypes: [...snapshot.meta.noticeTypes],
        searchScope: snapshot.meta.searchScope,
        hideAnime: snapshot.meta.hideAnime,
        torboxSources: [...snapshot.meta.torboxSources],
      },
      libraryRows: snapshot.libraryRows,
    });
  } else if (backup.tier === 'partial') {
    savePartialDraft(snapshotToPartialDraft(snapshot));
  } else {
    saveFullDraft(snapshotToFullDraft(snapshot));
  }
  return `/configure/${backup.tier}`;
}
