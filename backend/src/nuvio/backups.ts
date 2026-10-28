// Per-profile Nuvio backups, kept by LeLibrary (never Nuvio's whole-account
// backup/restore, which replaces every profile of the account).
//
// A snapshot holds what the manager can change on one profile: the addon rows
// (with their links), the collections document, the Home settings and the TV
// and phone settings blobs. Addon links are secrets, so the snapshot is sealed
// with the setup store's server key; only the part names and timestamps are
// readable in the table. The newest 10 per (setup, profile) are kept.
import type { PoolLike } from '../setup/config-store.ts';
import type { SealApi } from '../setup/seal.ts';
import type { NuvioClient, Row } from './client.ts';
import type { OwnContext, ProjectionApi } from './projection.ts';

const crypto = require('node:crypto') as typeof import('node:crypto');
const { seal, unseal } = require('../setup/seal.ts') as SealApi;
const projection = require('./projection.ts') as ProjectionApi;

export type Part = 'settings' | 'addons' | 'collections' | 'home';

export interface AddonSnapshotRow { url: string; name: string | null; enabled: boolean; sort_order: number }

export interface Snapshot {
  v: 1;
  addons?: AddonSnapshotRow[];
  collections?: Row[];
  home?: Row | null;
  settings?: { tv: Row | null; mobile: Row | null };
}

// A capture also carries what the write that follows needs (row ids, the
// settings timestamps for the guarded push). Only `snapshot` is stored.
export interface Capture {
  snapshot: Snapshot;
  addonRows: Row[];
  collectionsUpdatedAt: string | null;
  homeUpdatedAt: string | null;
  settingsUpdatedAt: { tv: string | null; mobile: string | null };
}

export interface BackupSummary {
  id: string;
  profileIndex: number;
  createdAt: string;
  reason: string;
  parts: Part[];
}

export interface BackupStore {
  migrate(): Promise<void>;
  take(input: { setupUuid: string; profileIndex: number; reason: BackupReason; parts: Part[]; snapshot: Snapshot }): Promise<BackupSummary>;
  list(setupUuid: string, profileIndex?: number | null): Promise<BackupSummary[]>;
  get(setupUuid: string, id: string): Promise<{ summary: BackupSummary; snapshot: Snapshot } | null>;
  newestAutomatic(setupUuid: string, profileIndex: number): Promise<string | null>;
  remove(setupUuid: string, id: string): Promise<void>;
  removeAll(setupUuid: string): Promise<void>;
}

const PARTS: Part[] = ['settings', 'addons', 'collections', 'home'];
const KEEP_PER_PROFILE = 10;
// Reason codes (the UI labels these). Automatic pre-write backups are what
// "Undo" steps back through; undo/restore/manual backups never are.
const REASONS = ['manual', 'undo', 'restore', 'copy', 'delete-profile', 'auto'] as const;
export type BackupReason = (typeof REASONS)[number];
const UNDOABLE: BackupReason[] = ['auto', 'copy', 'delete-profile'];

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS nuvio_backups (
     id uuid PRIMARY KEY,
     setup_uuid text NOT NULL,
     profile_index int NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     reason text NOT NULL,
     parts jsonb NOT NULL,
     sealed jsonb NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS nuvio_backups_setup_idx ON nuvio_backups (setup_uuid, profile_index, created_at DESC)',
];

function isPart(value: unknown): value is Part {
  return typeof value === 'string' && (PARTS as string[]).includes(value);
}

function normaliseParts(value: unknown): Part[] | null {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isPart)) return null;
  return PARTS.filter((part) => (value as string[]).includes(part));
}

function summaryFromRow(row: Record<string, unknown>): BackupSummary {
  const created = row['created_at'];
  const parts = Array.isArray(row['parts']) ? row['parts'] : (() => {
    try { return JSON.parse(String(row['parts'] || '[]')) as unknown[]; } catch { return []; }
  })();
  return {
    id: String(row['id']),
    profileIndex: Number(row['profile_index']),
    createdAt: created instanceof Date ? created.toISOString() : new Date(String(created)).toISOString(),
    reason: String(row['reason'] || ''),
    parts: parts.filter(isPart),
  };
}

function createBackupStore(options: { pool: PoolLike; key: Buffer; now?: () => Date }): BackupStore {
  const { pool, key } = options;
  const clock = options.now || (() => new Date());
  // Strictly increasing, so "newest" is never a tie within one process.
  let last = 0;
  const now = (): Date => {
    const at = Math.max(clock().getTime(), last + 1);
    last = at;
    return new Date(at);
  };
  let migrated: Promise<void> | null = null;

  async function ready(): Promise<void> {
    if (!migrated) {
      migrated = (async () => { for (const statement of MIGRATIONS) await pool.query(statement); })()
        .catch((err: unknown) => { migrated = null; throw err; });
    }
    await migrated;
  }

  return {
    migrate: ready,

    async take({ setupUuid, profileIndex, reason, parts, snapshot }) {
      await ready();
      const id = crypto.randomUUID();
      const createdAt = now();
      await pool.query(
        'INSERT INTO nuvio_backups (id, setup_uuid, profile_index, created_at, reason, parts, sealed) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)',
        [id, setupUuid, profileIndex, createdAt, reason, JSON.stringify(parts), JSON.stringify(seal(key, snapshot))],
      );
      await pool.query(
        `DELETE FROM nuvio_backups WHERE setup_uuid = $1 AND profile_index = $2 AND id NOT IN (
           SELECT id FROM nuvio_backups WHERE setup_uuid = $1 AND profile_index = $2
           ORDER BY created_at DESC LIMIT ${KEEP_PER_PROFILE})`,
        [setupUuid, profileIndex],
      );
      return { id, profileIndex, createdAt: createdAt.toISOString(), reason, parts };
    },

    async list(setupUuid, profileIndex = null) {
      await ready();
      const filtered = Number.isInteger(profileIndex);
      const result = await pool.query(
        `SELECT id, profile_index, created_at, reason, parts FROM nuvio_backups WHERE setup_uuid = $1${filtered ? ' AND profile_index = $2' : ''} ORDER BY created_at DESC LIMIT 60`,
        filtered ? [setupUuid, profileIndex] : [setupUuid],
      );
      return result.rows.map(summaryFromRow);
    },

    async get(setupUuid, id) {
      await ready();
      const result = await pool.query(
        'SELECT id, profile_index, created_at, reason, parts, sealed FROM nuvio_backups WHERE setup_uuid = $1 AND id = $2',
        [setupUuid, id],
      );
      const row = result.rows[0];
      if (!row) return null;
      const sealed = typeof row['sealed'] === 'string' ? JSON.parse(row['sealed'] as string) : row['sealed'];
      const snapshot = unseal(key, sealed) as Snapshot | null;
      if (!snapshot || snapshot.v !== 1) return null;
      return { summary: summaryFromRow(row), snapshot };
    },

    async newestAutomatic(setupUuid, profileIndex) {
      await ready();
      const result = await pool.query(
        'SELECT id FROM nuvio_backups WHERE setup_uuid = $1 AND profile_index = $2 AND reason = ANY($3) ORDER BY created_at DESC LIMIT 1',
        [setupUuid, profileIndex, UNDOABLE],
      );
      return result.rows[0] ? String(result.rows[0]['id']) : null;
    },

    async remove(setupUuid, id) {
      await ready();
      await pool.query('DELETE FROM nuvio_backups WHERE setup_uuid = $1 AND id = $2', [setupUuid, id]);
    },

    async removeAll(setupUuid) {
      await ready();
      await pool.query('DELETE FROM nuvio_backups WHERE setup_uuid = $1', [setupUuid]);
    },
  };
}

// Read the given parts of one profile as Nuvio holds them now.
async function captureParts(client: NuvioClient, profileIndex: number, parts: Part[]): Promise<Capture> {
  const capture: Capture = {
    snapshot: { v: 1 },
    addonRows: [],
    collectionsUpdatedAt: null,
    homeUpdatedAt: null,
    settingsUpdatedAt: { tv: null, mobile: null },
  };
  const jobs: Promise<void>[] = [];
  if (parts.includes('addons')) {
    jobs.push(client.listAddons(profileIndex).then((rows) => {
      capture.addonRows = projection.sortedAddonRows(rows);
      capture.snapshot.addons = capture.addonRows.map((row, index) => ({
        url: String(row['url'] ?? ''),
        name: typeof row['name'] === 'string' ? row['name'] as string : null,
        enabled: row['enabled'] !== false,
        sort_order: Number.isFinite(Number(row['sort_order'])) ? Number(row['sort_order']) : index,
      }));
    }));
  }
  if (parts.includes('collections')) {
    jobs.push(client.pullCollections(profileIndex).then((pulled) => {
      capture.snapshot.collections = pulled.items;
      capture.collectionsUpdatedAt = pulled.updatedAt;
    }));
  }
  if (parts.includes('home')) {
    jobs.push(client.pullHome(profileIndex).then((pulled) => {
      capture.snapshot.home = pulled.doc;
      capture.homeUpdatedAt = pulled.updatedAt;
    }));
  }
  if (parts.includes('settings')) {
    jobs.push(Promise.all([client.pullSettings(profileIndex, 'tv'), client.pullSettings(profileIndex, 'mobile')]).then(([tv, mobile]) => {
      capture.snapshot.settings = { tv: tv.blob, mobile: mobile.blob };
      capture.settingsUpdatedAt = { tv: tv.updatedAt, mobile: mobile.updatedAt };
    }));
  }
  await Promise.all(jobs);
  return capture;
}

// Make one profile's addon rows match a list, one row at a time: rows found
// by link are updated, missing ones inserted, the rest deleted last so the
// list is never empty. This setup's own LeLibrary row is always kept (the
// push manages it). Never the full-list push, which deletes unsent rows.
async function applyAddonRows(client: NuvioClient, profileIndex: number, wanted: AddonSnapshotRow[], own: OwnContext): Promise<boolean> {
  const desired = wanted.filter((row) => row && typeof row.url === 'string' && row.url)
    .slice().sort((a, b) => a.sort_order - b.sort_order);
  if (!desired.length) return false;
  const current = projection.sortedAddonRows(await client.listAddons(profileIndex));
  const used = new Set<Row>();
  let order = 0;
  for (const row of desired) {
    const match = current.find((c) => !used.has(c) && String(c['url']) === row.url)
      || current.find((c) => !used.has(c) && projection.canonicalAddonUrl(c['url']) === projection.canonicalAddonUrl(row.url));
    if (match) {
      used.add(match);
      const patch: { name?: string | null; enabled?: boolean; sort_order?: number } = {};
      if ((match['name'] ?? null) !== row.name) patch.name = row.name;
      if ((match['enabled'] !== false) !== row.enabled) patch.enabled = row.enabled;
      if (Number(match['sort_order']) !== order) patch.sort_order = order;
      if (Object.keys(patch).length) await client.updateAddon(profileIndex, String(match['id']), patch);
    } else {
      await client.insertAddon(profileIndex, { url: row.url, name: row.name, enabled: row.enabled, sort_order: order });
    }
    order += 1;
  }
  for (const row of current) {
    if (used.has(row)) continue;
    if (projection.isOwnAddon(row, own)) {
      if (Number(row['sort_order']) !== order) await client.updateAddon(profileIndex, String(row['id']), { sort_order: order });
      order += 1;
      continue;
    }
    await client.deleteAddon(profileIndex, String(row['id']));
  }
  return true;
}

// Write a snapshot's parts back to a profile. Returns the parts written.
async function restoreSnapshot(
  client: NuvioClient,
  snapshot: Snapshot,
  target: number,
  parts: Part[],
  own: OwnContext,
): Promise<Part[]> {
  const restored: Part[] = [];
  if (parts.includes('settings') && snapshot.settings) {
    let wrote = false;
    for (const platform of ['tv', 'mobile'] as const) {
      const blob = snapshot.settings[platform];
      if (!blob) continue;
      const current = await client.pullSettings(target, platform);
      await client.pushSettings(target, platform, blob, current.updatedAt);
      wrote = true;
    }
    if (wrote) restored.push('settings');
  }
  if (parts.includes('addons') && Array.isArray(snapshot.addons)) {
    if (await applyAddonRows(client, target, snapshot.addons, own)) restored.push('addons');
  }
  if (parts.includes('collections') && Array.isArray(snapshot.collections)) {
    await client.pushCollections(target, snapshot.collections);
    restored.push('collections');
  }
  if (parts.includes('home') && snapshot.home) {
    await client.pushHome(target, snapshot.home);
    restored.push('home');
  }
  return restored;
}

// The shared store on the setup database, or null without one.
let shared: BackupStore | null = null;
function defaultBackupStore(): BackupStore | null {
  if (shared) return shared;
  const runtime = require('../setup/runtime.ts') as import('../setup/runtime.ts').RuntimeApi;
  const pool = runtime.getSetupPool();
  if (!pool) return null;
  const { loadServerKey } = require('../setup/keys.ts') as import('../setup/keys.ts').KeysApi;
  const key = loadServerKey();
  if (!key) return null;
  shared = createBackupStore({ pool, key });
  return shared;
}

export interface BackupsApi {
  PARTS: Part[];
  KEEP_PER_PROFILE: number;
  REASONS: readonly BackupReason[];
  UNDOABLE: BackupReason[];
  isPart: (value: unknown) => value is Part;
  normaliseParts: (value: unknown) => Part[] | null;
  createBackupStore: (options: { pool: PoolLike; key: Buffer; now?: () => Date }) => BackupStore;
  defaultBackupStore: () => BackupStore | null;
  captureParts: (client: NuvioClient, profileIndex: number, parts: Part[]) => Promise<Capture>;
  applyAddonRows: (client: NuvioClient, profileIndex: number, wanted: AddonSnapshotRow[], own: OwnContext) => Promise<boolean>;
  restoreSnapshot: (client: NuvioClient, snapshot: Snapshot, target: number, parts: Part[], own: OwnContext) => Promise<Part[]>;
}

module.exports = {
  PARTS,
  KEEP_PER_PROFILE,
  REASONS,
  UNDOABLE,
  isPart,
  normaliseParts,
  createBackupStore,
  defaultBackupStore,
  captureParts,
  applyAddonRows,
  restoreSnapshot,
} satisfies BackupsApi;
