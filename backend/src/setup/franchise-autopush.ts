'use strict';
// Keep the owned "LeLibrary Collections" collection on Nuvio up to date in the
// background. Its folders read their films live, so a new film in a franchise
// already there shows up on its own; a new franchise (a new folder) used to
// need a manual push. After a library sync changes the set of owned
// franchises, this queues one update per setup that has pushed to Nuvio and
// has the owned collection switched on.
//
// The update touches only that one collection: every other collection on the
// profile is written back exactly as Nuvio returned it, in the same order.
// Home rows, badges and settings are not touched. If Nuvio does not have the
// owned collection yet, a normal full push runs instead. At most once an hour
// per setup, a few minutes after the change, so a download spree becomes one
// update. A setup without a saved Nuvio session is left alone.

const crypto = require('node:crypto');
const { LIBRARY_COLLECTION_ID, folderIdForCollection } = require('../catalog/nuvio-library-collections.ts');

const JOB_KIND = 'nuvio-owned-collection';
const SETTLE_MS = 5 * 60 * 1000;
const MIN_GAP_MS = 60 * 60 * 1000;
const RECORD_TTL_SECONDS = 30 * 24 * 3600;

const recordKey = (uuid: string) => `nuviofr:${String(uuid).toLowerCase()}`;

// Which franchises a collection holds: from projection metas (collectionId) or
// from pushed folders (id). Order and duplicates do not matter.
function fingerprint(items: { collectionId?: unknown; id?: unknown }[]): string {
  const ids = new Set<string>();
  for (const item of items || []) {
    if (item && item.collectionId != null && Number.isFinite(Number(item.collectionId))) ids.add(String(folderIdForCollection(item.collectionId)));
    else if (item && typeof item.id === 'string' && item.id) ids.add(item.id);
  }
  return crypto.createHash('sha256').update([...ids].sort().join('|')).digest('hex').slice(0, 16);
}

type Store = { get: (key: string) => Promise<any>; set: (key: string, value: any, ttl?: number) => Promise<any> };

// Called after a manual push: remember what it sent and where from.
async function recordPushed(uuid: string, ownedCollection: any, origin: string, store: Store = require('../runtime/cache.ts'), now = Date.now()): Promise<void> {
  const folders = Array.isArray(ownedCollection && ownedCollection.folders) ? ownedCollection.folders : [];
  await store.set(recordKey(uuid), { fp: fingerprint(folders), at: now, origin }, RECORD_TTL_SECONDS);
}

// Called after the owned projection is rebuilt for a library.
async function noteProjection(uuids: Iterable<string>, metas: any[], { store = require('../runtime/cache.ts'), jobs = require('../runtime/jobs.ts'), now = Date.now }: { store?: Store; jobs?: any; now?: () => number } = {}): Promise<void> {
  const fp = fingerprint(metas || []);
  for (const uuid of uuids || []) {
    const last = await store.get(recordKey(uuid)).catch(() => null);
    if (last && last.fp === fp) continue;
    const earliest = last && Number.isFinite(last.at) ? last.at + MIN_GAP_MS : 0;
    const delayMs = Math.max(SETTLE_MS, earliest - now());
    await jobs.scheduleJob({ kind: JOB_KIND, id: String(uuid).toLowerCase(), payload: { uuid: String(uuid).toLowerCase() }, delayMs }).catch(() => {});
  }
}

// Replace only the owned collection, keeping its place. Null when Nuvio does
// not have it yet (a full push is needed to place it).
function replaceOwnedCollection(existing: any[], owned: any): any[] | null {
  const list = Array.isArray(existing) ? existing : [];
  const index = list.findIndex((c) => String(c && c.id) === LIBRARY_COLLECTION_ID);
  if (index < 0) return null;
  const folders = Array.isArray(owned && owned.folders) ? owned.folders : [];
  if (!folders.length) return list.filter((_c, i) => i !== index);
  return list.map((c, i) => (i === index ? { ...owned, pinToTop: false } : c));
}

function defaultDeps() {
  const runtime = require('./runtime.ts');
  const conns = require('./connections.ts');
  const push = require('./push.ts');
  const axios = require('axios');
  const store = require('../runtime/cache.ts');
  const port = parseInt(process.env.PORT || '', 10) || 7860;
  return {
    store,
    openSetup: async (uuid: string) => (await runtime.getSetupStore()).resolveByUuid(uuid),
    readNuvio: (opened: any) => conns.readPush(opened, 'nuvio'),
    ownedCollectionEnabled: (config: any) => {
      const { compileCollectionPlan } = require('../catalog/collection-plan.ts');
      const plan = compileCollectionPlan({
        collections: Array.isArray(config.collections) ? config.collections : [],
        homeRows: Array.isArray(config.collectionHomeRows) ? config.collectionHomeRows : [],
        sources: Array.isArray(config.collectionSources) ? config.collectionSources : [],
        externalSources: [], manifestId: 'x', integration: 'nuvio', hideAnime: config.hideAnime === true,
      });
      return plan.nativeFranchiseCollection && plan.nativeFranchiseCollection.enabled === true;
    },
    origin: (record: any) => String((record && record.origin) || process.env.BASE_URL || '').replace(/\/+$/, ''),
    fetchOwned: async (installToken: string) => {
      const res = await axios.get(`http://127.0.0.1:${port}/${encodeURIComponent(installToken)}/collections.json?owned_only=1`, { timeout: 60000 });
      return Array.isArray(res.data) ? res.data.find((c: any) => c && c.id === LIBRARY_COLLECTION_ID) || null : null;
    },
    nuvio: {
      refresh: (conn: any) => push.refreshNuvioToken(conn),
      profileIndex: async (token: string, selected: unknown) => {
        const resolved = push.resolveNuvioProfile(await push.pullNuvioProfiles(token), selected);
        if (!resolved.ok) throw new Error(resolved.error);
        return resolved.profile.profile_index;
      },
      pull: (token: string, profileIndex: number) => push.pullNuvioCollections(token, profileIndex),
      push: (token: string, profileIndex: number, collections: unknown[], uuid: string) => push.writeNuvioCollections(token, profileIndex, collections, uuid),
    },
    saveConnection: async (uuid: string, connection: any) => {
      const setups = await runtime.getSetupStore();
      const current = await setups.resolveByUuid(uuid);
      if (current) await setups.save(uuid, { keys: conns.mergePushKeys(current.keys || {}, 'nuvio', connection) });
    },
    fullPush: async ({ opened, connection, origin }: any) => {
      const config = opened.config || {};
      return push.installSetup({
        uuid: opened.uuid, installToken: `${opened.uuid}.${opened.secret}`, connection, platform: 'nuvio',
        profileId: connection.nuvioSelectedProfile ?? null, internal: true, origin, port,
        document: {
          collections: Array.isArray(config.collections) ? config.collections : [],
          homeRows: Array.isArray(config.collectionHomeRows) ? config.collectionHomeRows : [],
          sources: Array.isArray(config.collectionSources) ? config.collectionSources : [],
        },
        options: push.pushOptionsFromConfig(config),
      });
    },
  };
}

async function runUpdate(payload: { uuid?: string }, deps: any = defaultDeps()): Promise<'done' | 'retry'> {
  const uuid = String((payload && payload.uuid) || '').toLowerCase();
  if (!uuid) return 'done';
  const opened = await deps.openSetup(uuid);
  if (!opened || !opened.secret) return 'done';
  const saved = deps.readNuvio(opened);
  if (!saved) return 'done';
  if (!deps.ownedCollectionEnabled(opened.config || {})) return 'done';
  const record = await deps.store.get(recordKey(uuid)).catch(() => null);
  const origin = deps.origin(record);
  if (!origin) return 'done';

  const owned = await deps.fetchOwned(`${opened.uuid}.${opened.secret}`);
  if (!owned) return 'retry';

  const refreshed = await deps.nuvio.refresh(saved);
  const connection = refreshed.data;
  if (refreshed.refreshed) await deps.saveConnection(uuid, connection);
  const token = connection && connection.nuvioToken;
  if (!token) return 'done';
  const profileIndex = await deps.nuvio.profileIndex(token, connection.nuvioSelectedProfile);
  const existing = await deps.nuvio.pull(token, profileIndex);
  const next = replaceOwnedCollection(existing, owned);
  if (!next) {
    const result = await deps.fullPush({ opened, connection, origin });
    if (!result || !result.ok) return 'retry';
  } else {
    await deps.nuvio.push(token, profileIndex, next, uuid);
  }
  await deps.store.set(recordKey(uuid), { fp: fingerprint(owned.folders || []), at: Date.now(), origin }, RECORD_TTL_SECONDS);
  return 'done';
}

// Registered at require time so the runner has the handler before it starts.
require('../runtime/jobs.ts').registerJobHandler(JOB_KIND, (payload: any) => runUpdate(payload));

export interface FranchiseAutopushApi {
  JOB_KIND: string;
  fingerprint: typeof fingerprint;
  recordPushed: typeof recordPushed;
  noteProjection: typeof noteProjection;
  replaceOwnedCollection: typeof replaceOwnedCollection;
  runUpdate: typeof runUpdate;
}

module.exports = { JOB_KIND, fingerprint, recordPushed, noteProjection, replaceOwnedCollection, runUpdate } satisfies FranchiseAutopushApi;
