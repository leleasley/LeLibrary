// @ts-nocheck
// Finish a Nuvio push in the background.
//
// The owned library folders are the one part of a push that needs a built
// projection, and a big account takes minutes to build. A push that could not
// include them used to end with "push again in a minute" — asking the person to
// do the server's work. Instead the push records itself here and a background
// job waits for the projection, then replays the same install the person's push
// ran (same code path, same saved connection, same recorded origin), so the
// folders appear on their own.
//
// The job is idempotent by construction: installSetup upserts the addon row,
// merges collections, and re-syncs the Home order and badges.

const JOB_KIND = 'publish-collections';
// First look after the projection has had a moment to land; the runner backs
// off from there if the library is still building.
const FIRST_DELAY_MS = 20000;

function pendingPublishJobId(uuid) {
  return String(uuid || '').toLowerCase();
}

// Queue (or refresh) the follow-up publish for a setup whose push was partial.
async function schedulePendingPublish({ uuid, origin, profileId }) {
  const jobs = require('../runtime/jobs.ts');
  if (!uuid || !origin) return null;
  return jobs.scheduleJob({
    kind: JOB_KIND,
    id: pendingPublishJobId(uuid),
    // The uuid travels in the payload as well as the job id: the handler needs
    // it to load the setup, and a job id alone is not a data contract.
    payload: { uuid: pendingPublishJobId(uuid), origin, profileId: profileId ?? null },
    delayMs: FIRST_DELAY_MS,
  });
}

// A complete push (or a disconnected setup) makes the follow-up pointless.
async function cancelPendingPublish(uuid) {
  const jobs = require('../runtime/jobs.ts');
  await jobs.cancelJob(JOB_KIND, pendingPublishJobId(uuid));
}

async function finishPendingPush(payload = {}) {
  const { uuid } = payload;
  const origin = typeof payload.origin === 'string' ? payload.origin : '';
  if (!uuid || !origin) {
    // Without the setup and the exact origin the addon row would be installed
    // against a different URL, which is worse than leaving the folders for a
    // manual push. Retry rather than report success, so the work is never
    // silently dropped; it expires on its own if it can never be completed.
    console.warn('[Push] Pending publish arrived without a uuid or origin; will retry');
    return uuid ? 'retry' : 'done';
  }

  const { getSetupStore } = require('./runtime.ts');
  const store = await getSetupStore().catch(() => null);
  if (!store) return 'retry';
  const opened = await store.resolveByUuid(uuid);
  if (!opened) return 'done';
  if (!opened.secret) return 'done';

  const conns = require('./connections.ts');
  const connection = conns.readPush(opened, 'nuvio');
  if (!connection) return 'done';

  const config = require('./config-store.ts').toEngineConfig(opened);
  const installToken = `${opened.uuid}.${opened.secret}`;

  // Keep the engine building this scope, then check whether the projection the
  // folders are built from exists yet.
  try {
    require('../library/engine.ts').noteConfig(installToken, config);
  } catch { /* engine absent (no database): the legacy build below covers it */ }
  const providers = require('../providers/index.ts');
  const userKey = providers.getUserKey(config);
  const lang = config.lang || 'en-US';
  const franchise = require('../catalog/franchise-collections.ts');
  if (franchise.getCollections(userKey, lang).length === 0) {
    // Not indexed: nothing else is warm-keeping this scope, so ask the legacy
    // build for it and come back.
    if (!require('../library/engine.ts').isIndexed()) {
      require('../runtime/refresh.ts').buildAndCacheForConfig(installToken, config).catch(() => {});
    }
    return 'retry';
  }

  const push = require('./push.ts');
  const result = await push.installSetup({
    uuid,
    installToken,
    connection,
    platform: 'nuvio',
    profileId: payload.profileId ?? null,
    document: {
      collections: Array.isArray(config.collections) ? config.collections : [],
      homeRows: Array.isArray(config.collectionHomeRows) ? config.collectionHomeRows : [],
      sources: Array.isArray(config.collectionSources) ? config.collectionSources : [],
    },
    options: push.pushOptionsFromConfig(config),
    origin,
    port: parseInt(process.env.PORT || '', 10) || undefined,
    // Background replays are not user pushes: they must not consume the
    // per-setup push rate limit.
    internal: true,
  });

  if (!result.ok) {
    console.warn('[Push] Background publish did not finish:', result.reason || result.error || 'unknown');
    return 'retry';
  }
  // Folders still missing means the projection landed empty (an account with no
  // owned collections yet). One more pass picks them up once it fills.
  return result.libraryPending ? 'retry' : 'done';
}

// Registered at require time so the runner has the handler before it starts.
require('../runtime/jobs.ts').registerJobHandler(JOB_KIND, finishPendingPush);

export interface PendingPushApi {
  JOB_KIND: string;
  schedulePendingPublish: any;
  cancelPendingPublish: any;
  finishPendingPush: any;
}

module.exports = {
  JOB_KIND,
  schedulePendingPublish,
  cancelPendingPublish,
  finishPendingPush,
} satisfies PendingPushApi;
