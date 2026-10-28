// UUID-keyed platform push.
//
// No accounts, no user tables: the platform connection comes from the config
// row's encrypted_keys, the collections document from encrypted_config, and
// the manifest is the setup's own install URL. Nuvio RPC details, merge
// rules, home-order sync and badge sync must stay byte-compatible with what
// Nuvio already holds for existing users.
const axios = require('axios');
const { compileCollectionPlan } = require('../catalog/collection-plan.ts') as {
  compileCollectionPlan: (input: Record<string, unknown>) => {
    collections: unknown[];
    homeRows: HomeRowDoc[];
    folderLibraryIds: unknown[];
    libraryIds: unknown[];
    nativeFranchiseCollection?: { enabled?: boolean };
    externalAddons: { addonId: string; addonUrl: string }[];
    externalBindings: { id: string; addonId: string; manifestUrl: string; mediaType: string; gatewayLabel: string; manifestFingerprint: string }[];
    importedTypes: unknown[];
  };
};
const artwork = require('../catalog/collection-artwork.ts') as {
  normaliseNuvioArtwork: (folder: unknown, origin: string) => Record<string, unknown>;
  absoluteLocalArtwork: (value: unknown, origin: string) => string;
  nuvioTileShape: (value: unknown) => 'POSTER' | 'LANDSCAPE' | 'SQUARE';
};
const libraryCollections = require('../catalog/nuvio-library-collections.ts') as {
  mergeCollectionsInPlace: (existing: unknown, generated: unknown, options?: { removeMissing?: (item: unknown) => boolean }) => unknown;
  LIBRARY_COLLECTION_ID: string;
};
import type { PlaybackSettings } from '../catalog/nuvio-playback-settings.ts';
const homeSettings = require('../catalog/nuvio-home-settings.ts') as {
  homeSettingsPayload: (settings: unknown, items: unknown[], hideUnreleased: boolean | null) => Record<string, unknown>;
  dropMalformedHomeItems: (items: unknown[]) => Record<string, unknown>[];
};
const playbackSettings = require('../catalog/nuvio-playback-settings.ts') as {
  normalisePlaybackSettings: (input: unknown) => PlaybackSettings | null;
  applyPlaybackSettingsToBlob: (blob: unknown, settings: PlaybackSettings | null) => Record<string, unknown> | null;
};
const badgePacks = require('../catalog/nuvio-badge-packs.ts') as {
  resolveBadgePackUrl: (pack: unknown, url: unknown, base: string) => string;
  buildBadgeImport: (manifest: unknown, sourceUrl: string) => unknown;
  applyBadgeImportToBlob: (blob: unknown, badgeImport: unknown) => unknown;
  enableTmdbEnrichmentInBlob: (blob: unknown) => unknown;
  fetchBadgeManifest: (sourceUrl: string) => Promise<unknown>;
  SETTINGS_PLATFORMS: string[];
};
const cacheWarm = require('../catalog/collection-cache-warm.ts') as {
  warmTokenLibraryCatalogs: (input: { origin: string; tokenId: string; libraryIds?: unknown[]; request?: (url: string) => Promise<unknown>; limit?: number }) => Promise<{ requested?: number; warmed?: number; timedOut?: boolean }>;
};

export interface PushConnection {
  stremioAuth?: string;
  stremioUser?: unknown;
  nuvioToken?: string;
  nuvioRefresh?: string | null;
  nuvioUser?: unknown;
  nuvioProfiles?: NuvioProfile[];
  nuvioSelectedProfile?: number | string | null;
  [key: string]: unknown;
}

export interface NuvioProfile {
  profile_index: number;
  name: string;
  uses_primary_addons: boolean;
}

export interface HomeRowDoc {
  enabled?: boolean;
  order?: number;
  customTitle?: boolean;
  title?: string;
  source?: { addonId?: string; catalogId?: string; id?: string; type?: string };
  _nativeFranchiseCollection?: boolean;
  [key: string]: unknown;
}

// One parser for the push-facing config fields so the interactive route and the
// background replay cannot drift. An absent or invalid playback choice means
// "leave Nuvio alone", never a default that overwrites the user's player.
function pushOptionsFromConfig(config: Record<string, unknown> | null | undefined): PushOptions {
  const source = config && typeof config === 'object' ? config : {};
  return {
    hideAnime: source['hideAnime'] === true,
    badgePack: typeof source['nuvioBadgePack'] === 'string' ? source['nuvioBadgePack'] : undefined,
    badgeUrl: typeof source['nuvioBadgeUrl'] === 'string' ? source['nuvioBadgeUrl'] : undefined,
    nuvioPlayback: playbackSettings.normalisePlaybackSettings(source['nuvioPlayback']),
    nuvioHideUnreleased: typeof source['nuvioHideUnreleased'] === 'boolean'
      ? source['nuvioHideUnreleased']
      : null,
  };
}

export interface PushDocument {
  collections?: unknown[];
  homeRows?: HomeRowDoc[];
  sources?: unknown[];
}

export interface PushOptions {
  hideAnime?: boolean;
  badgePack?: string;
  badgeUrl?: string;
  // Absent/null leaves the user's Nuvio playback settings untouched.
  nuvioPlayback?: PlaybackSettings | null;
  // Tri-state: null leaves the user's Home-catalog choice untouched.
  nuvioHideUnreleased?: boolean | null;
  // One push only, chosen with a tick box: drop every collection on the
  // profile that is not LeLibrary's. Never read from the saved config, so
  // background updates and replays always keep other collections.
  replaceOtherCollections?: boolean;
}

export interface InstallSetupInput {
  uuid: string;
  installToken: string;
  connection: PushConnection;
  platform: 'nuvio' | 'stremio';
  profileId?: string | number | null;
  document: PushDocument;
  options?: PushOptions;
  origin: string;
  port?: number;
  // Background replays (the job that finishes a partial push) are not user
  // pushes, so they skip the per-setup push rate limit.
  internal?: boolean;
}

export interface InstallSetupResult {
  ok: boolean;
  reason?: string;
  error?: string;
  platform?: string;
  profile_id?: string | null;
  connection?: PushConnection;
  // The push published everything except the owned franchise folders, because
  // the library was still building. A second push includes them.
  libraryPending?: boolean;
}

const NUVIO_API_BASE = 'https://api.nuvio.tv';
const NUVIO_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgxNTIxMzQ2LCJleHAiOjE5MzkyMDEzNDZ9.tmQaj682pwzehpqlgCDMnySOqiUvpgRbrE43T4VJpDI';
const STREMIO_API = 'https://api.strem.io/api';
const TIMEOUT = 20000;
const NUVIO_PUSH_WINDOW_MS = 60 * 1000;
const NUVIO_PUSH_MAX_PER_USER = 4;
const nuvioPushBuckets = new Map<string, { startedAt: number; count: number }>();

function allowPush(key: string): boolean {
  const now = Date.now();
  const id = String(key || 'unknown');
  let bucket = nuvioPushBuckets.get(id);
  if (!bucket || now - bucket.startedAt >= NUVIO_PUSH_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
    nuvioPushBuckets.set(id, bucket);
  }
  if (bucket.count >= NUVIO_PUSH_MAX_PER_USER) return false;
  bucket.count++;
  return true;
}

function savedNuvioAccessToken(data: PushConnection | null | undefined): string {
  const candidates = [
    data?.nuvioToken, (data as Record<string, unknown> | undefined)?.['access_token'], (data as Record<string, unknown> | undefined)?.['accessToken'], (data as Record<string, unknown> | undefined)?.['token'],
  ];
  return candidates.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function savedNuvioRefreshToken(data: PushConnection | null | undefined): string {
  const record = (data || {}) as Record<string, unknown>;
  const candidates = [
    data?.nuvioRefresh, record['refresh_token'], record['refreshToken'], record['refresh'],
  ];
  return candidates.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function log(...args: unknown[]): void {
  console.log('[Push]', ...args);
}

function internalOrigin(port?: number): string {
  const resolved = Number.isFinite(Number(port)) ? Number(port) : (parseInt(process.env['PORT'] || '', 10) || 7860);
  return `http://127.0.0.1:${resolved}`;
}

function originClientId(key: string): string {
  return `lelibrary-server-${key}`;
}

async function nuvioRpc(token: string, path: string, body: unknown): Promise<unknown> {
  const r = await axios.post(`${NUVIO_API_BASE}${path}`, body || {}, {
    headers: {
      'Content-Type': 'application/json',
      apikey: NUVIO_PUBLISHABLE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    timeout: TIMEOUT,
  });
  return r.data;
}

async function nuvioRest(token: string, path: string, options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<unknown> {
  const r = await axios({
    method: options.method || 'GET',
    url: `${NUVIO_API_BASE}${path}`,
    headers: {
      'Content-Type': 'application/json',
      apikey: NUVIO_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
    ...(options.body === undefined ? {} : { data: options.body }),
    timeout: TIMEOUT,
  });
  return r.data;
}

function parseNuvioJson(raw: unknown, fallback: unknown): unknown {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return fallback; }
  }
  return raw == null ? fallback : raw;
}

// Nuvio's sync schema uses underscore-delimited catalogue keys. Keeping this
// in one helper avoids creating a second row whenever an order is re-synced.
function nuvioHomeKey(addonId: unknown, type: unknown, catalogId: unknown): string {
  return `${addonId}_${type}_${catalogId}`;
}

// The `key` written into each Home item. Nuvio mobile matches Home items by
// key and its own keys are "manifestId:type:catalogId"; an underscore key never
// matched there and came back as a broken entry. The TV app ignores `key`.
function nuvioItemKey(addonId: unknown, type: unknown, catalogId: unknown): string {
  return `${addonId}:${type}:${catalogId}`;
}

// Pull the profiles, flip the target profile off "primary addons", push back.
// Only when the profile still uses the primary profile's addons: otherwise
// nothing is written. The push carries the whole freshly pulled list (an older
// server version deleted profiles missing from it), with every field passed
// through as Nuvio sent it: the old field subset dropped profile backgrounds
// and, by always sending avatar_url, cleared avatars picked from the catalog.
async function ensureOwnAddons(token: string, targetIndex: number): Promise<void> {
  try {
    const profData = await nuvioRpc(token, '/rest/v1/rpc/sync_pull_profiles', {}) as { profiles?: unknown[] } | unknown[];
    const rawProfiles = (Array.isArray(profData) ? profData : ((profData as { profiles?: unknown[] })?.profiles || [])) as Record<string, unknown>[];
    const indexOf = (p: Record<string, unknown>) => Math.trunc(Number(p['profile_index'] ?? p['id']));
    const target = rawProfiles.find((p) => indexOf(p) === targetIndex);
    const usesPrimary = (p: Record<string, unknown>) => Boolean(p['uses_primary_addons'] ?? p['usesPrimaryAddons']);
    if (!target || !usesPrimary(target)) return;
    const pushed = rawProfiles.map((p) => {
      const idx = indexOf(p);
      const avatarUrl = String(p['avatar_url'] || '').trim();
      const out: Record<string, unknown> = {
        profile_index: idx,
        name: String(p['name'] || '').trim() || `Profile ${idx}`,
        avatar_color_hex: String(p['avatar_color_hex'] || p['avatarColorHex'] || '').trim() || '#1E88E5',
        uses_primary_addons: idx === targetIndex ? false : usesPrimary(p),
        uses_primary_plugins: !!(p['uses_primary_plugins'] ?? p['usesPrimaryPlugins']),
      };
      // avatar_url, when present, replaces avatar_id on the server: send it only when set.
      if (avatarUrl) out['avatar_url'] = avatarUrl;
      else if (p['avatar_id']) out['avatar_id'] = p['avatar_id'];
      for (const field of ['profile_background_id', 'profile_background_url']) {
        if (p[field] !== undefined && p[field] !== null && p[field] !== '') out[field] = p[field];
      }
      return out;
    });
    await nuvioRpc(token, '/rest/v1/rpc/sync_push_profiles', {
      p_profiles: pushed,
      p_client_max_profiles: 6,
      p_origin_client_id: originClientId('setup'),
    });
    log('Profile', targetIndex, 'switched to own addons');
  } catch (err) {
    log('Profile switch failed (continuing):', (err as Error).message);
  }
}

async function nuvioOwnerId(token: string): Promise<string | null> {
  const ownerData = await nuvioRpc(token, '/rest/v1/rpc/get_sync_owner', {}) as unknown;
  if (Array.isArray(ownerData) && typeof ownerData[0] === 'string') return ownerData[0];
  if (typeof ownerData === 'string') return ownerData;
  const record = (ownerData || {}) as Record<string, unknown>;
  return (record['owner_id'] || record['id'] || null) as string | null;
}

// Upsert the LeLibrary addon row on a profile (keep other addons).
// CREATE FIRST, then clean up the old rows: the old delete-everything-then-
// insert order left the profile WITHOUT the addon whenever the POST failed
// (timeout / token expiry mid-push), with nothing to restore it. Here a POST
// failure leaves the previous install untouched.
async function installAddonOnNuvio(token: string, ownerId: string, profileIndex: number, manifestUrl: string, manifestId: string, origin: string): Promise<void> {
  const installingLeLibrary = String(manifestUrl).startsWith(origin);
  const existing = await nuvioRest(token,
    `/rest/v1/addons?select=*&user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileIndex}`) as Record<string, unknown>[];
  const list = Array.isArray(existing) ? existing : [];
  // Nuvio can reject an insert when the exact manifest URL is already present.
  // A harmless install marker makes this a real upsert while preserving the
  // old working addon until the new row has been accepted.
  const installUrl = new URL(manifestUrl);
  installUrl.searchParams.set('_install', Date.now().toString(36));
  const freshManifestUrl = installUrl.toString();
  const installName = installingLeLibrary ? 'LeLibrary' : String(manifestId || 'Required addon').slice(0, 160);
  log('Installing addon on Nuvio profile', profileIndex, installingLeLibrary ? 'LeLibrary' : String(manifestId || 'companion'));
  await nuvioRest(token, '/rest/v1/addons', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [{ user_id: ownerId, profile_id: profileIndex, url: freshManifestUrl, name: installName, enabled: true, sort_order: 0 }],
  });
  // New row is in: now drop stale duplicates (including any row this POST
  // just superseded). Only rows that are NOT the freshly created one.
  for (const a of list) {
    let sameConfiguredAddon = false;
    try {
      const previous = new URL(String(a['url'] || ''));
      const wanted = new URL(String(manifestUrl));
      previous.searchParams.delete('_install');
      wanted.searchParams.delete('_install');
      sameConfiguredAddon = previous.toString() === wanted.toString();
    } catch { /* unparseable stored URL: leave it alone */ }
    const isOurs = installingLeLibrary && (String(a['url'] || '').startsWith(origin) || String(a['name'] || '').toLowerCase() === 'lelibrary');
    if (!isOurs && !sameConfiguredAddon) continue;
    await nuvioRest(token,
      `/rest/v1/addons?id=eq.${encodeURIComponent(String(a['id']))}&profile_id=eq.${profileIndex}`,
      { method: 'DELETE' });
  }
  log('Addon installed on Nuvio profile', profileIndex);
}

// Older setups pushed ids like `lelibrary-special` or bare pack ids, so
// recognise those legacy ids as well when clearing a previous push.
function isLeLibraryCollection(collection: unknown): boolean {
  const record = (collection || {}) as Record<string, unknown>;
  const id = String(record['id'] || '');
  return id.startsWith('collection-lelibrary') ||
    id === 'lelibrary-special' ||
    id.startsWith('pack-lelibrary-special') ||
    String(record['title'] || '').trim().toLowerCase() === 'lelibrary special';
}

function mergeCollections(existing: unknown, ours: unknown, replaceOthers = false): unknown {
  return libraryCollections.mergeCollectionsInPlace(existing, ours, { removeMissing: replaceOthers ? () => true : isLeLibraryCollection });
}

async function pushNuvioCollections(token: string, profileIndex: number, collections: unknown, uuidKey: string, replaceOthers = false): Promise<void> {
  const pulled = await nuvioRpc(token, '/rest/v1/rpc/sync_pull_collections', { p_profile_id: profileIndex }) as { collections_json?: unknown } | unknown[];
  const row = (Array.isArray(pulled) ? pulled[0] : pulled) as { collections_json?: unknown };
  const existing = Array.isArray(row?.collections_json)
    ? row.collections_json
    : parseNuvioJson(row?.collections_json, []);
  const merged = mergeCollections(existing, collections, replaceOthers);
  await nuvioRpc(token, '/rest/v1/rpc/sync_push_collections', {
    p_profile_id: profileIndex,
    p_collections_json: merged,
    p_origin_client_id: originClientId(uuidKey),
  });
  log('Pushed', (merged as unknown[]).length, 'collection(s) to Nuvio profile', profileIndex);
}

// One profile's collections as Nuvio holds them, and a write of a full list.
// Used by the background owned-collection update (setup/franchise-autopush.ts),
// which replaces only its own collection and keeps every other entry as is.
async function pullNuvioCollections(token: string, profileIndex: number): Promise<Record<string, unknown>[]> {
  const pulled = await nuvioRpc(token, '/rest/v1/rpc/sync_pull_collections', { p_profile_id: profileIndex }) as { collections_json?: unknown } | unknown[];
  const row = (Array.isArray(pulled) ? pulled[0] : pulled) as { collections_json?: unknown };
  const list = Array.isArray(row?.collections_json) ? row.collections_json : parseNuvioJson(row?.collections_json, []);
  return Array.isArray(list) ? list as Record<string, unknown>[] : [];
}

async function writeNuvioCollections(token: string, profileIndex: number, collections: unknown[], uuidKey: string): Promise<void> {
  await nuvioRpc(token, '/rest/v1/rpc/sync_push_collections', {
    p_profile_id: profileIndex,
    p_collections_json: collections,
    p_origin_client_id: originClientId(uuidKey),
  });
  log('Updated the owned collection on Nuvio profile', profileIndex);
}

// Apply the setup's selected badge pack to the target Nuvio profile. Nuvio
// renders badges from the profile's own badge settings, so changing the
// picker in LeLibrary must also rewrite that setting — otherwise the profile
// keeps showing whichever pack was imported before. Only the badge rules
// value is replaced; every other profile setting passes through untouched.
// Best-effort: badge failures never fail the collection push.
async function syncNuvioBadgePack(token: string, profileIndex: number, badge: { pack?: string; url?: string }, uuidKey: string, origin: string): Promise<void> {
  try {
    const sourceUrl = badgePacks.resolveBadgePackUrl(badge.pack, badge.url, origin);
    if (!sourceUrl) return;
    const manifest = await badgePacks.fetchBadgeManifest(sourceUrl);
    const badgeImport = badgePacks.buildBadgeImport(manifest, sourceUrl);
    for (const platform of badgePacks.SETTINGS_PLATFORMS) {
      try {
        const pulled = await nuvioRpc(token, '/rest/v1/rpc/sync_pull_profile_settings_blob', {
          p_profile_id: profileIndex,
          p_platform: platform,
        }) as { settings_json?: unknown } | unknown[];
        const row = (Array.isArray(pulled) ? pulled[0] : pulled) as { settings_json?: unknown };
        const blob = row?.settings_json;
        if (!blob || typeof blob !== 'object') continue;
        await nuvioRpc(token, '/rest/v1/rpc/sync_push_profile_settings_blob', {
          p_profile_id: profileIndex,
          p_settings_json: badgePacks.applyBadgeImportToBlob(blob, badgeImport),
          p_platform: platform,
          p_origin_client_id: originClientId(uuidKey),
        });
        log(`Nuvio badge pack synced (${platform}):`, sourceUrl);
      } catch (err) {
        log(`Could not sync Nuvio badge pack (${platform}):`, (err as Error).message);
      }
    }
  } catch (err) {
    log('Could not sync Nuvio badge pack:', (err as Error).message);
  }
}

// Apply the setup's Nuvio playback choices (auto stream selection + auto-play
// next episode) to each platform's profile settings blob. The blob is pulled,
// one feature bucket is rewritten, and the whole thing is pushed back, exactly
// like the badge and TMDB syncs above. Platforms whose blob has no player
// settings are skipped: the Nuvio client clears that bucket before applying it,
// so inventing one would reset every other player preference.
// Best-effort: a settings failure never fails the addon push.
async function syncNuvioPlaybackSettings(
  token: string,
  profileIndex: number,
  settings: PlaybackSettings | null,
  uuidKey: string,
  deps: { rpc?: typeof nuvioRpc; platforms?: readonly string[] } = {},
): Promise<void> {
  if (!settings) return;
  const rpc = deps.rpc || nuvioRpc;
  const platforms = deps.platforms || badgePacks.SETTINGS_PLATFORMS;
  for (const platform of platforms) {
    try {
      const pulled = await rpc(token, '/rest/v1/rpc/sync_pull_profile_settings_blob', {
        p_profile_id: profileIndex,
        p_platform: platform,
      }) as { settings_json?: unknown } | unknown[];
      const row = (Array.isArray(pulled) ? pulled[0] : pulled) as { settings_json?: unknown };
      const next = playbackSettings.applyPlaybackSettingsToBlob(row?.settings_json, settings);
      if (!next) {
        log(`Nuvio playback settings skipped (${platform}): no player settings bucket`);
        continue;
      }
      await rpc(token, '/rest/v1/rpc/sync_push_profile_settings_blob', {
        p_profile_id: profileIndex,
        p_settings_json: next,
        p_platform: platform,
        p_origin_client_id: originClientId(uuidKey),
      });
      log(`Nuvio playback settings synced (${platform})`);
    } catch (err) {
      log(`Could not sync Nuvio playback settings (${platform}):`, (err as Error).message);
    }
  }
}

// Nuvio stores TMDB enrichment settings per profile and platform. Enable the
// feature on both clients whenever a user pushes, preserving their other
// choices. A settings RPC failure must not fail the addon push.
async function enableNuvioTmdbEnrichment(token: string, profileIndex: number, uuidKey: string): Promise<void> {
  for (const platform of badgePacks.SETTINGS_PLATFORMS) {
    try {
      const pulled = await nuvioRpc(token, '/rest/v1/rpc/sync_pull_profile_settings_blob', {
        p_profile_id: profileIndex,
        p_platform: platform,
      }) as { settings_json?: unknown } | unknown[];
      const row = (Array.isArray(pulled) ? pulled[0] : pulled) as { settings_json?: unknown };
      // Never create a settings blob: the mobile app resets every settings
      // group missing from a pulled blob, so an almost empty one wiped a
      // phone's settings. No blob yet means the app has not synced; leave it.
      if (!row?.settings_json || typeof row.settings_json !== 'object') {
        log(`Nuvio TMDB enrichment skipped (${platform}): no settings yet`);
        continue;
      }
      const blob = row.settings_json;
      await nuvioRpc(token, '/rest/v1/rpc/sync_push_profile_settings_blob', {
        p_profile_id: profileIndex,
        p_settings_json: badgePacks.enableTmdbEnrichmentInBlob(blob),
        p_platform: platform,
        p_origin_client_id: originClientId(uuidKey),
      });
      log(`Nuvio TMDB enrichment enabled (${platform})`);
    } catch (err) {
      log(`Could not enable Nuvio TMDB enrichment (${platform}):`, (err as Error).message);
    }
  }
}

// Order Nuvio's Home rows to match the manifest catalogue order.
async function syncNuvioHomeOrder(token: string, profileIndex: number, manifest: { id?: string; catalogs?: { type?: string; id?: string; showInHome?: boolean }[] }, homeRows: HomeRowDoc[] = [], collections: { id?: string }[] = [], uuidKey = 'setup', hideUnreleased: boolean | null = null): Promise<void> {
  try {
    if (!manifest || !Array.isArray(manifest.catalogs)) return;
    const platform = 'home_catalog_shared';
    const pulled = await nuvioRpc(token, '/rest/v1/rpc/sync_pull_home_catalog_settings', {
      p_profile_id: profileIndex,
      p_platform: platform,
    }) as { settings_json?: unknown } | unknown[];
    const row = (Array.isArray(pulled) ? pulled[0] : pulled) as { settings_json?: unknown };
    const settings = parseNuvioJson(row?.settings_json, {}) as { show_catalog_type?: boolean; hide_unreleased_content?: boolean; items?: Record<string, unknown>[] };
    const items = homeSettings.dropMalformedHomeItems(Array.isArray(settings.items) ? settings.items.slice() : []);
    // Nuvio collection Home entries do not have addon/type/catalog fields.
    // Canonicalise them separately so an older, pinned collection record can
    // be replaced instead of surviving under the empty-catalogue key.
    const homeKey = (item: Record<string, unknown> | undefined): string => {
      if (item?.['is_collection'] === true || item?.['isCollection'] === true || item?.['collection_id'] || item?.['collectionId']) {
        return `collection_${item['collection_id'] || item['collectionId']}`;
      }
      return nuvioHomeKey(item?.['addon_id'], item?.['type'], item?.['catalog_id']);
    };
    const byKey = new Map(items.map((item) => [homeKey(item), item]));

    const orderedHomeRows = (homeRows || [])
      .filter((r) => r?.enabled !== false && r?.source)
      .slice()
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    const selectedRowsByCatalog = new Map<string, HomeRowDoc>();
    const selectedOrderByKey = new Map<string, number>();
    orderedHomeRows.forEach((r, index) => {
      const source = r.source || {};
      const addonId = source.addonId || manifest.id;
      const catalogId = source.catalogId || source.id;
      if (!catalogId || !source.type) return;
      const key = nuvioHomeKey(addonId, source.type, catalogId);
      selectedOrderByKey.set(key, index);
      if (addonId === manifest.id && catalogId) selectedRowsByCatalog.set(catalogId, r);
    });

    const selectedRows = new Set(selectedRowsByCatalog.keys());
    const selectedCount = selectedOrderByKey.size;
    for (let manifestIndex = 0; manifestIndex < (manifest.catalogs || []).length; manifestIndex += 1) {
      const catalog = (manifest.catalogs || [])[manifestIndex] as { type?: string; id?: string; showInHome?: boolean };
      if (!catalog) continue;
      const key = nuvioHomeKey(manifest.id, catalog.type, catalog.id);
      const existing = byKey.get(key) || {};
      const isFranchise = String(catalog.id || '') === 'torbox-collections' ||
        String(catalog.id || '').startsWith('torbox-collection-');
      const hiddenFromHome = catalog.showInHome === false;
      if (hiddenFromHome || isFranchise) {
        byKey.delete(key);
        continue;
      }
      const selectedOrder = selectedOrderByKey.get(key);
      const currentOrder = selectedOrder == null ? selectedCount + manifestIndex : selectedOrder;
      byKey.set(key, {
        ...existing,
        addon_id: manifest.id,
        type: catalog.type,
        catalog_id: catalog.id,
        enabled: selectedRows.has(String(catalog.id)),
        order: currentOrder,
        custom_title: selectedRowsByCatalog.get(String(catalog.id))?.customTitle === true
          ? selectedRowsByCatalog.get(String(catalog.id))?.title
          : (existing['custom_title'] || ''),
        is_collection: false,
        collection_id: existing['collection_id'] || '',
        key: nuvioItemKey(manifest.id, catalog.type, catalog.id),
      });
    }

    for (const homeRow of orderedHomeRows) {
      const source = homeRow?.source;
      const catalogId = source?.catalogId || source?.id;
      if (!source?.addonId || source.addonId === manifest.id || !catalogId || !source.type) continue;
      const key = nuvioHomeKey(source.addonId, source.type, catalogId);
      const existing = byKey.get(key) || {};
      byKey.set(key, {
        ...existing,
        addon_id: source.addonId,
        type: source.type,
        catalog_id: catalogId,
        enabled: homeRow.enabled !== false,
        order: selectedOrderByKey.get(key) ?? selectedCount,
        custom_title: existing['custom_title'] || homeRow.title || '',
        is_collection: false,
        collection_id: existing['collection_id'] || '',
        key: nuvioItemKey(source.addonId, source.type, catalogId),
      });
    }

    const manifestCatalogKeys = new Set((manifest.catalogs || []).map((c) => nuvioHomeKey(manifest.id, c?.type, c?.id)));
    for (const [key, item] of byKey) {
      if (item && item['addon_id'] === manifest.id && !manifestCatalogKeys.has(key) && item['is_collection'] !== true) {
        byKey.delete(key);
      }
      // Drop any flat torbox-collections Home catalog row from any LeLibrary addon namespace
      if (item && (item['catalog_id'] === 'torbox-collections' || String(item['catalog_id'] || '').startsWith('torbox-collection-')) && item['is_collection'] !== true) {
        byKey.delete(key);
      }
    }

    // Explicitly place the franchise collection at the very bottom of Home
    // so Nuvio never treats it as an unranked collection and defaults it to the top.
    const franchiseKey = `collection_${libraryCollections.LIBRARY_COLLECTION_ID}`;
    const hasFranchise = (collections || []).some((c) => String(c?.id || '') === libraryCollections.LIBRARY_COLLECTION_ID);
    if (hasFranchise) {
      const existingFranchise = byKey.get(franchiseKey) || {};
      byKey.set(franchiseKey, {
        ...existingFranchise,
        is_collection: true,
        collection_id: libraryCollections.LIBRARY_COLLECTION_ID,
        enabled: true,
        custom_title: existingFranchise['custom_title'] || '',
        key: franchiseKey,
      });
    } else {
      byKey.delete(franchiseKey);
    }

    const finalItems = (() => {
      const existingKeys = items.map(homeKey)
        .filter((key, index, all) => key !== franchiseKey && byKey.has(key) && all.indexOf(key) === index);
      const addedKeys = Array.from(byKey.keys())
        .filter((key) => key !== franchiseKey && !existingKeys.includes(key));
      const allKeys = [...existingKeys, ...addedKeys];
      if (byKey.has(franchiseKey)) {
        allKeys.push(franchiseKey);
      }
      // Each item keeps the key set above (the mobile format for catalogues,
      // collection_<id> for collections); the map key is only for matching.
      return allKeys.map((key, order) => {
        const item = byKey.get(key) || {};
        const own = typeof item['key'] === 'string' && item['key'] ? item['key'] : null;
        const catalogKey = !item['is_collection'] && item['addon_id'] && item['type'] && item['catalog_id']
          ? nuvioItemKey(item['addon_id'], item['type'], item['catalog_id'])
          : null;
        return { ...item, key: catalogKey || own || key, order };
      });
    })();

    await nuvioRpc(token, '/rest/v1/rpc/sync_push_home_catalog_settings', {
      p_profile_id: profileIndex,
      p_platform: platform,
      p_settings_json: homeSettings.homeSettingsPayload(settings, finalItems, hideUnreleased),
      p_origin_client_id: originClientId(uuidKey),
    });
    log('Nuvio Home order synced');
  } catch (err) {
    log('Could not sync Nuvio Home order:', (err as Error).message);
  }
}

// Try refreshing an expired Nuvio token; returns the new (access, refresh).
async function refreshNuvioToken(data: PushConnection): Promise<{ data: PushConnection; refreshed: boolean }> {
  const refreshToken = savedNuvioRefreshToken(data);
  if (!refreshToken) return { data, refreshed: false };
  try {
    const r = await axios.post(`${NUVIO_API_BASE}/auth/v1/token?grant_type=refresh_token`,
      { refresh_token: refreshToken },
      { headers: { 'Content-Type': 'application/json', apikey: NUVIO_PUBLISHABLE_KEY }, timeout: TIMEOUT });
    const d = r.data as { access_token?: string; refresh_token?: string };
    if (r.status === 200 && d?.access_token) {
      return {
        data: {
          ...data,
          nuvioToken: d.access_token,
          nuvioRefresh: d.refresh_token || refreshToken,
        },
        refreshed: true,
      };
    }
  } catch { /* fall through */ }
  return { data, refreshed: false };
}

function normalizeProfiles(raw: unknown): NuvioProfile[] {
  const list = Array.isArray(raw) ? raw : ((raw as { profiles?: unknown })?.profiles || []);
  return ((Array.isArray(list) ? list : []) as Record<string, unknown>[])
    .map((pr) => {
      const idx = Math.trunc(Number(pr['profile_index'] ?? pr['id']));
      return {
        profile_index: idx,
        name: String(pr['name'] || '').trim() || `Profile ${idx}`,
        uses_primary_addons: !!((pr as Record<string, unknown>)['uses_primary_addons'] ?? (pr as Record<string, unknown>)['usesPrimaryAddons']),
      };
    })
    .filter((pr) => Number.isFinite(pr.profile_index) && pr.profile_index >= 1);
}

async function pullNuvioProfiles(token: string): Promise<NuvioProfile[]> {
  const profData = await nuvioRpc(token, '/rest/v1/rpc/sync_pull_profiles', {});
  return normalizeProfiles(profData);
}

// Which profile a push targets. Exported for tests, because the quiet version
// of this was the bug: `selected || profiles[0]` silently retargeted the push
// at the first profile whenever the chosen one had gone (renamed, deleted or
// renumbered since the setup was created), and still reported success.
function resolveNuvioProfile(profiles: NuvioProfile[], selected: unknown):
  { ok: true; profile: NuvioProfile } | { ok: false; error: string } {
  const wanted = selected == null || String(selected).trim() === '' ? NaN : Math.trunc(Number(selected));
  if (Number.isFinite(wanted)) {
    const found = profiles.find((profile) => profile.profile_index === wanted);
    if (found) return { ok: true, profile: found };
    return {
      ok: false,
      error: `The Nuvio profile this setup was pointed at (${wanted}) is no longer on the account. Pick a profile again, then push.`,
    };
  }
  // Nothing was chosen: the first profile is what the picker showed.
  const first = profiles[0];
  if (!first) return { ok: false, error: 'No Nuvio profile to push to' };
  return { ok: true, profile: first };
}

// ── Stremio helpers ──────────────────────────────────────────

async function stremioCall(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await axios.post(`${STREMIO_API}/${path}`, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: TIMEOUT,
  });
  const data = r.data as Record<string, unknown>;
  if (r.status === 429) throw new Error('Stremio rate limit reached');
  if (!String(r.status).startsWith('2') || data?.['error']) {
    throw new Error(((data?.['error'] as Record<string, unknown>)?.['message'] as string) || `Stremio API error (HTTP ${r.status})`);
  }
  return data;
}

async function pushToStremio(data: PushConnection, manifestUrl: string, manifest: { id?: string }): Promise<void> {
  const authKey = data.stremioAuth;
  if (!authKey) throw new Error('No Stremio session');
  const getData = await stremioCall('addonCollectionGet', { authKey });
  const addons = Array.isArray((getData['result'] as Record<string, unknown>)?.['addons'])
    ? ((getData['result'] as Record<string, unknown>)['addons'] as Record<string, unknown>[])
    : [];
  const ours = addons.filter((a) => ((a['manifest'] as Record<string, unknown>)?.['id'] || a['id']) !== manifest.id);
  ours.push({ transportUrl: manifestUrl, transportName: 'http', flags: {}, manifest });
  await stremioCall('addonCollectionSet', { authKey, addons: ours });
  log('Stremio addon upserted');
}

async function pushToNuvio(
  conn: PushConnection,
  manifestUrl: string,
  manifest: { id?: string },
  collections: unknown[],
  homeRows: HomeRowDoc[],
  sources: unknown[],
  options: PushOptions & { uuidKey: string; origin: string; port?: number; installToken: string },
): Promise<{ ok: boolean; connection: PushConnection; libraryPending: boolean }> {
  const collectionPlan = compileCollectionPlan({
    collections,
    homeRows,
    sources,
    externalSources: [],
    manifestId: manifest?.id || 'community.lelibrary.selfhosted',
    integration: 'nuvio',
    hideAnime: options.hideAnime === true,
  });
  const plannedCollections = collectionPlan.collections as Record<string, unknown>[];
  const plannedHomeRows = collectionPlan.homeRows as HomeRowDoc[];
  const franchiseCollectionEnabled = (collectionPlan.nativeFranchiseCollection as { enabled?: boolean } | undefined)?.enabled === true;
  const tokenId = new URL(manifestUrl).pathname.match(/^\/([^/]+)\/manifest\.json$/)?.[1];
  // Wait for the source rows used by this context before publishing its
  // folders. The requests are the standard addon catalogue requests, so they
  // land in the same Redis cache entries with the normal TTL.
  const loopback = internalOrigin(options.port);
  const warmCollections = cacheWarm.warmTokenLibraryCatalogs({
    origin: loopback,
    tokenId: tokenId || '',
    libraryIds: collectionPlan.libraryIds,
    request: (url: string) => axios.get(url, { timeout: 60000 }),
  });
  let data = conn;
  const refresh = await refreshNuvioToken(data);
  data = refresh.data;
  const token = savedNuvioAccessToken(data);
  if (!token) throw new Error('No Nuvio session');

  let franchiseCollection: Record<string, unknown> | null = null;
  try {
    if (tokenId) {
      // Owned folders need the built library. The route waits only a bounded
      // slice for a cold build, so this never holds the push open for minutes;
      // when the library is still building the push publishes everything else
      // and reports it as pending.
      const generated = await axios.get(`${loopback}/${encodeURIComponent(tokenId)}/collections.json?owned_only=1`, { timeout: 60000 });
      franchiseCollection = Array.isArray(generated.data)
        ? (generated.data as Record<string, unknown>[]).find((collection) => collection?.['id'] === libraryCollections.LIBRARY_COLLECTION_ID) || null
        : null;
    }
  } catch (err) {
    log('Could not build owned Nuvio franchise folders:', (err as Error).message);
  }

  // Resolve the target profile against the live list; a chosen profile that is
  // gone is an error, never a quiet push to somebody else's profile.
  const profiles = await pullNuvioProfiles(token);
  const resolved = resolveNuvioProfile(profiles, data.nuvioSelectedProfile);
  if (!resolved.ok) throw new Error(resolved.error);
  const profileIndex = resolved.profile.profile_index;

  // Warming is a speed-up only: Nuvio fetches each folder's content live, so the
  // push does not need every catalogue built before it can publish. A cold cache
  // can take a minute to warm all sources, which pushed the install response past
  // the client's request timeout and made successful pushes look like failures.
  // Give warming a short head start, then publish; the rest continues in the
  // background and lands in the same Redis cache entries.
  const warmCapMs = 8000;
  const warmResult = await Promise.race([
    warmCollections,
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), warmCapMs)),
  ]) as { timedOut?: boolean; requested?: number; warmed?: number };
  if (warmResult.timedOut) {
    log('Collection warming still in progress; publishing folders now');
  } else if (warmResult.requested) {
    log(`Warmed ${warmResult.warmed}/${warmResult.requested} collection catalogues`);
  }

  await ensureOwnAddons(token, profileIndex);

  const ownerId = await nuvioOwnerId(token);
  if (!ownerId) throw new Error('Could not resolve the Nuvio sync owner');

  const installManifestUrl = `${manifestUrl}${manifestUrl.includes('?') ? '&' : '?'}sync=${Date.now().toString(36)}`;
  await installAddonOnNuvio(token, ownerId, profileIndex, installManifestUrl, manifest?.id || '', options.origin);

  await new Promise((r) => setTimeout(r, 1500));

  // Build the collection structure from the stored config.
  const addonId = manifest?.id || 'community.lelibrary.selfhosted';
  const nuvioCollections = (plannedCollections as Record<string, unknown>[]).map((c, ci) => {
    const folders = (Array.isArray(c['folders']) ? c['folders'] : []).map((f, fi) => {
      const raw = f as Record<string, unknown>;
      const rawSources = Array.isArray(raw['catalogSources']) ? raw['catalogSources'] : [];
      const sources = rawSources.length
        ? (rawSources as Record<string, unknown>[]).map((s) => ({
          provider: 'addon',
          addonId: s['addonId'] || addonId,
          catalogId: s['catalogId'],
          type: s['type'] || 'movie',
          genre: s['genre'] || '',
        }))
        : [];
      if (!sources.length) return null;
      return {
        id: raw['id'] || `folder-${ci}-${fi}`,
        title: raw['title'] || 'Collection',
        tileShape: artwork.nuvioTileShape(raw['tileShape']),
        hideTitle: !!raw['hideTitle'],
        heroBackdropUrl: artwork.absoluteLocalArtwork(raw['heroBackdropUrl'], options.origin),
        heroVideoUrl: artwork.absoluteLocalArtwork(raw['heroVideoUrl'], options.origin),
        titleLogoUrl: artwork.absoluteLocalArtwork(raw['titleLogoUrl'], options.origin),
        ...artwork.normaliseNuvioArtwork(f, options.origin),
        sources,
      };
    }).filter(Boolean);
    if (!folders.length) return null;
    return {
      focusGlowEnabled: (c as Record<string, unknown>)['focusGlowEnabled'] !== false,
      id: String(c['id'] || '').startsWith('collection-lelibrary')
        ? c['id']
        : `collection-lelibrary-${c['id'] || ci}`,
      title: (c['title'] as string) || 'LeLibrary Collections',
      pinToTop: (c as Record<string, unknown>)['pinToTop'] === true,
      showAllTab: (c as Record<string, unknown>)['showAllTab'] !== false,
      viewMode: (c as Record<string, unknown>)['viewMode'] || 'TABBED_GRID',
      folders,
    };
  }).filter(Boolean);

  // Nuvio does not support nesting a collection inside another collection.
  // The Hub keeps one "Movie Collections" folder backed by torbox-collections;
  // do not flatten every franchise folder into the Hub.
  // The franchise collection keeps its own pinToTop (true: it leads Home) while
  // mergeCollectionsInPlace still slots it last on the Collections page. The Hub
  // is separately forced to false there, so a stale value cannot float it up.
  if (franchiseCollectionEnabled && (franchiseCollection?.['folders'] as unknown[] | undefined)?.length) {
    (nuvioCollections as Record<string, unknown>[]).push({ ...franchiseCollection });
  }

  await pushNuvioCollections(token, profileIndex, nuvioCollections, options.uuidKey, options.replaceOtherCollections === true);
  // Remember what this push sent, so the background update only acts on a
  // real change (setup/franchise-autopush.ts).
  if (franchiseCollection) {
    await require('./franchise-autopush.ts').recordPushed(options.uuidKey, franchiseCollection, options.origin).catch(() => {});
  }

  // Only the chosen profile is touched. Other profiles keep whatever they
  // have, including a different LeLibrary setup (one setup per person).
  if (manifest && Array.isArray((manifest as { catalogs?: unknown }).catalogs)) {
    await syncNuvioHomeOrder(
      token,
      profileIndex,
      manifest as { id?: string; catalogs?: { type?: string; id?: string; showInHome?: boolean }[] },
      plannedHomeRows,
      nuvioCollections as { id?: string }[],
      options.uuidKey,
      options.nuvioHideUnreleased ?? null,
    );
  }
  await syncNuvioBadgePack(token, profileIndex, {
    pack: options.badgePack,
    url: options.badgeUrl,
  }, options.uuidKey, options.origin);
  await enableNuvioTmdbEnrichment(token, profileIndex, options.uuidKey);
  // Playback settings are opt-in in the setup: absent means leave Nuvio alone.
  await syncNuvioPlaybackSettings(token, profileIndex, options.nuvioPlayback ?? null, options.uuidKey);

  // The owned franchise folders are the one part of a push that needs a built
  // library. When it was not ready in time this push still succeeded; say so,
  // so the page can tell the person to push again rather than leave them
  // wondering where their library folders went.
  const libraryPending = franchiseCollectionEnabled && !franchiseCollection;
  if (libraryPending) {
    log('Owned library was still building; telling the client to push again for library folders');
  }

  return { ok: true, connection: data, libraryPending };
}

// Install one setup's manifest on the platform connection. A one-time
// sign-in may be passed as the connection instead of the saved one; it is
// deliberately never persisted — the saved envelope stays intact and the
// credential disappears once the request has finished.
async function installSetup(input: InstallSetupInput): Promise<InstallSetupResult> {
  const { uuid, installToken, connection, platform, document, options = {}, origin, port } = input;
  if (platform !== 'nuvio' && platform !== 'stremio') return { ok: false, reason: 'invalid-platform' };
  if (platform === 'nuvio' && !input.internal && !allowPush(uuid)) {
    return { ok: false, reason: 'push-rate-limited', error: 'Please wait a minute before pushing to Nuvio again.' };
  }
  if (!origin) return { ok: false, reason: 'no-base-url' };
  const profileId = platform === 'nuvio' ? String(input.profileId || 'default') : 'default';
  const manifestUrl = `${origin}/${installToken}/manifest.json?${new URLSearchParams({
    integration: platform,
    ...(platform === 'nuvio' ? { profile_id: profileId } : {}),
  }).toString()}`;
  // The manifest handed to Nuvio/Stremio stays public; the fetch itself goes
  // over loopback (no TLS/proxy overhead, no Cloudflare timeout in front).
  const internalManifestUrl = `${internalOrigin(port)}/${installToken}/manifest.json?${new URLSearchParams({
    integration: platform,
    ...(platform === 'nuvio' ? { profile_id: profileId } : {}),
  }).toString()}`;
  let manifest: { id?: string };
  try {
    manifest = (await axios.get(internalManifestUrl, { timeout: 15000 })).data;
  } catch (err) {
    return { ok: false, reason: 'manifest-unavailable', error: (err as Error).message };
  }

  try {
    if (platform === 'nuvio') {
      const pushed = await pushToNuvio(connection, manifestUrl, manifest,
        Array.isArray(document.collections) ? document.collections : [],
        Array.isArray(document.homeRows) ? document.homeRows : [],
        Array.isArray(document.sources) ? document.sources : [],
        {
          hideAnime: options.hideAnime === true,
          badgePack: options.badgePack,
          badgeUrl: options.badgeUrl,
          nuvioPlayback: options.nuvioPlayback ?? null,
          nuvioHideUnreleased: options.nuvioHideUnreleased ?? null,
          replaceOtherCollections: options.replaceOtherCollections === true,
          uuidKey: uuid,
          origin,
          port,
          installToken,
        });
      return { ok: true, platform, profile_id: profileId, connection: pushed.connection, libraryPending: pushed.libraryPending === true };
    }
    await pushToStremio(connection, manifestUrl, manifest);
    return { ok: true, platform, profile_id: null, connection };
  } catch (err) {
    log(`Setup install to ${platform} failed:`, (err as Error).message);
    return { ok: false, reason: 'install-failed', error: (err as Error).message };
  }
}

export interface PushApi {
  allowPush: (key: string) => boolean;
  savedNuvioAccessToken: (data: PushConnection | null | undefined) => string;
  savedNuvioRefreshToken: (data: PushConnection | null | undefined) => string;
  isLeLibraryCollection: (collection: unknown) => boolean;
  nuvioHomeKey: (addonId: unknown, type: unknown, catalogId: unknown) => string;
  refreshNuvioToken: (data: PushConnection) => Promise<{ data: PushConnection; refreshed: boolean }>;
  pullNuvioProfiles: (token: string) => Promise<NuvioProfile[]>;
  resolveNuvioProfile: (profiles: NuvioProfile[], selected: unknown) =>
    { ok: true; profile: NuvioProfile } | { ok: false; error: string };
  installSetup: (input: InstallSetupInput) => Promise<InstallSetupResult>;
  pullNuvioCollections: (token: string, profileIndex: number) => Promise<Record<string, unknown>[]>;
  writeNuvioCollections: (token: string, profileIndex: number, collections: unknown[], uuidKey: string) => Promise<void>;
  pushOptionsFromConfig: (config: Record<string, unknown> | null | undefined) => PushOptions;
  syncNuvioPlaybackSettings: (
    token: string,
    profileIndex: number,
    settings: PlaybackSettings | null,
    uuidKey: string,
    deps?: { rpc?: typeof nuvioRpc; platforms?: readonly string[] },
  ) => Promise<void>;
}

module.exports = {
  allowPush,
  savedNuvioAccessToken,
  savedNuvioRefreshToken,
  isLeLibraryCollection,
  nuvioHomeKey,
  refreshNuvioToken,
  pullNuvioProfiles,
  resolveNuvioProfile,
  installSetup,
  pullNuvioCollections,
  writeNuvioCollections,
  pushOptionsFromConfig,
  syncNuvioPlaybackSettings,
} satisfies PushApi;
