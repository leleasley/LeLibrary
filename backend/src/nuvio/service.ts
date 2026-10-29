// The Nuvio manager's operations, one per route. Every write follows the same
// order: read the parts it touches fresh from Nuvio, validate against that
// read, store it as an automatic backup, apply the change to what was read,
// write it, and return the state as Nuvio now holds it.
//
// Nothing here returns an addon link, a token or a PIN hash: responses are
// built from projection.ts only.
import type { NuvioClient, NuvioClientApi, Row } from './client.ts';
import type { Addon, CollectionSummary, Home, OwnContext, Profile, ProjectionApi } from './projection.ts';
import type { SettingValues, SettingsMapApi } from './settings-map.ts';
import type { BackupReason, BackupStore, BackupSummary, BackupsApi, Capture, Part } from './backups.ts';

const { NuvioManagerError, MAX_PROFILES } = require('./client.ts') as NuvioClientApi;
const projection = require('./projection.ts') as ProjectionApi;
const settingsMap = require('./settings-map.ts') as SettingsMapApi;
const backupsModule = require('./backups.ts') as BackupsApi;

export interface Settings {
  values: SettingValues;
  platforms: { tv: boolean; mobile: boolean };
}

export interface ProfileState {
  profile: Profile;
  addons: Addon[];
  addonsFrom: number;
  collections: CollectionSummary[];
  home: Home;
  settings: Settings;
  readAt: string;
}

export interface NuvioServiceOptions {
  client: NuvioClient;
  backups: BackupStore;
  own: OwnContext;
  // Display name from an addon's manifest, or null. Never throws.
  fetchManifestName?: (url: string) => Promise<string | null>;
  // Catalogue names for Home rows, keyed "<manifestId>:<type>:<catalogId>",
  // read from the profile's addon manifests. Never throws.
  catalogNames?: (addonRows: Row[]) => Promise<Map<string, string>>;
  // Each addon row's manifest (keyed by Nuvio row id), read through the same
  // cache as catalogNames. Never throws; missing rows simply have no facts.
  addonManifests?: (addonRows: Row[]) => Promise<Map<string, unknown>>;
}

const MAX_NAME = 40;
const MAX_ADDON_NAME = 80;
const MAX_URL = 2048;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

function fail(status: number, code: string, message: string): never {
  throw new NuvioManagerError(status, code, message);
}

function invalid(message: string): never {
  return fail(400, 'invalid', message);
}

function notFound(message: string): never {
  return fail(404, 'not-found', message);
}

function cleanName(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name && name.length <= max ? name : null;
}

// An addon link the browser sends once: https, no credentials in the
// authority, ends with /manifest.json (a query string is allowed).
function validAddonUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > MAX_URL) return null;
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
  if (!/\/manifest\.json$/i.test(url.pathname)) return null;
  return text;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  return left.size === a.length && b.every((value) => left.has(value));
}

function stringList(value: unknown, max = 500): string[] | null {
  if (!Array.isArray(value) || value.length > max || !value.every((entry) => typeof entry === 'string' && entry.length <= 300)) return null;
  return value as string[];
}

function settingsFrom(tv: Row | null, mobile: Row | null, home: Row | null): Settings {
  const values = settingsMap.readSettings(tv, mobile);
  const flag = home ? home['hide_unreleased_content'] : undefined;
  // The Home settings win over the TV's layout copy (both apps read them).
  if (typeof flag === 'boolean') values.hideUnreleased = flag;
  return { values, platforms: { tv: Boolean(tv), mobile: Boolean(mobile) } };
}

function createNuvioService(options: NuvioServiceOptions) {
  const { client, backups, own } = options;
  const fetchName = options.fetchManifestName || (async () => null);

  async function profiles(): Promise<Profile[]> {
    return projection.projectProfiles(await client.pullProfiles());
  }

  async function requireProfile(index: number): Promise<Profile> {
    const found = (await profiles()).find((profile) => profile.index === index);
    if (!found) notFound('That Nuvio profile no longer exists.');
    return found;
  }

  async function backup(index: number, reason: BackupReason, parts: Part[], capture: Capture): Promise<BackupSummary> {
    const snapshot = { v: 1 as const } as Capture['snapshot'];
    for (const part of parts) {
      if (part === 'addons') snapshot.addons = capture.snapshot.addons;
      if (part === 'collections') snapshot.collections = capture.snapshot.collections;
      if (part === 'home') snapshot.home = capture.snapshot.home;
      if (part === 'settings') snapshot.settings = capture.snapshot.settings;
    }
    return backups.take({ setupUuid: own.uuid, profileIndex: index, reason, parts, snapshot });
  }

  // Addon writes act on the profile's own rows; a profile on the primary
  // profile's addons is managed on profile 1.
  function requireOwnAddons(profile: Profile): void {
    if (profile.usesPrimaryAddons) {
      invalid('This profile uses the main profile\'s addons. Change them on the main profile, or turn that off first.');
    }
  }

  async function manifestsFor(rows: Row[]): Promise<Map<string, unknown>> {
    if (!options.addonManifests) return new Map();
    try { return await options.addonManifests(rows); } catch { return new Map(); }
  }

  async function addonList(index: number): Promise<Addon[]> {
    const rows = await client.listAddons(index);
    return projection.projectAddons(rows, own, await manifestsFor(rows));
  }

  // One addon's settings page, for the unlocked owner's explicit click. The
  // link can hold the addon's keys: it goes back to that request only.
  async function configureLink(index: number, id: string): Promise<{ url: string }> {
    const profile = await requireProfile(index);
    const rows = await client.listAddons(profile.usesPrimaryAddons ? 1 : index);
    const row = rows.find((entry) => String(entry['id']) === id);
    if (!row) notFound('That addon is no longer on this profile.');
    const manifests = await manifestsFor([row]);
    const url = projection.configureLink(row, manifests.get(id));
    if (!url) fail(422, 'not-configurable', 'This addon has no settings page.');
    return { url };
  }

  async function overview(): Promise<{ profiles: Profile[]; maxProfiles: number }> {
    return { profiles: await profiles(), maxProfiles: MAX_PROFILES };
  }

  async function namesFor(rows: Row[]): Promise<Map<string, string>> {
    if (!options.catalogNames) return new Map();
    try { return await options.catalogNames(rows); } catch { return new Map(); }
  }

  async function profileState(index: number): Promise<ProfileState> {
    const profile = await requireProfile(index);
    const addonsFrom = profile.usesPrimaryAddons ? 1 : index;
    const [addonRows, collections, home, tv, mobile] = await Promise.all([
      client.listAddons(addonsFrom),
      client.pullCollections(index),
      client.pullHome(index),
      client.pullSettings(index, 'tv'),
      client.pullSettings(index, 'mobile'),
    ]);
    const [names, manifests] = await Promise.all([namesFor(addonRows), manifestsFor(addonRows)]);
    return {
      profile,
      addons: projection.projectAddons(addonRows, own, manifests),
      addonsFrom,
      collections: projection.projectCollections(collections.items, home.doc),
      home: projection.projectHome(home.doc, collections.items, names),
      settings: settingsFrom(tv.blob, mobile.blob, home.doc),
      readAt: new Date().toISOString(),
    };
  }

  // ── Profiles ────────────────────────────────────────────────

  async function createProfile(body: Row): Promise<{ profile: Profile }> {
    const name = cleanName(body['name'], MAX_NAME);
    if (!name) invalid('Give the profile a name (up to 40 characters).');
    const color = body['color'] === undefined ? projection.DEFAULT_COLOR : String(body['color']);
    if (!COLOR_RE.test(color)) invalid('Pick a colour as #RRGGBB.');
    let copy: { index: number; parts: Part[] } | null = null;
    if (body['copyFrom'] !== undefined && body['copyFrom'] !== null) {
      const from = body['copyFrom'] as Row;
      const parts = backupsModule.normaliseParts(from?.['parts']);
      const source = Number(from?.['index']);
      if (!parts || !Number.isInteger(source)) invalid('Choose a profile and what to copy from it.');
      copy = { index: source, parts };
    }
    if (copy) await requireProfile(copy.index);
    const index = await client.createProfile({ name, color: color.toUpperCase() });
    if (copy) await copyProfile(copy.index, { target: index, parts: copy.parts });
    return { profile: await requireProfile(index) };
  }

  async function patchProfile(index: number, body: Row): Promise<{ profile: Profile }> {
    const patch: { name?: string; color?: string; usesPrimaryAddons?: boolean } = {};
    if (body['name'] !== undefined) {
      const name = cleanName(body['name'], MAX_NAME);
      if (!name) invalid('Give the profile a name (up to 40 characters).');
      patch.name = name;
    }
    if (body['color'] !== undefined) {
      if (typeof body['color'] !== 'string' || !COLOR_RE.test(body['color'])) invalid('Pick a colour as #RRGGBB.');
      patch.color = body['color'].toUpperCase();
    }
    if (body['usesPrimaryAddons'] !== undefined) {
      if (typeof body['usesPrimaryAddons'] !== 'boolean') invalid('Invalid addon choice.');
      if (index === 1 && body['usesPrimaryAddons']) invalid('The main profile always has its own addons.');
      patch.usesPrimaryAddons = body['usesPrimaryAddons'];
    }
    if (!Object.keys(patch).length) invalid('Nothing to change.');
    await requireProfile(index);
    await client.patchProfile(index, patch);
    return { profile: await requireProfile(index) };
  }

  // Deleting wipes the profile on Nuvio for good (watch history, trackers,
  // debrid logins): the main profile never, and only with its exact name.
  async function deleteProfile(index: number, body: Row): Promise<{ ok: true }> {
    if (index === 1) fail(409, 'profile-protected', 'The main profile cannot be deleted.');
    const profile = await requireProfile(index);
    if (typeof body['confirmName'] !== 'string' || body['confirmName'] !== profile.name) {
      invalid('Type the profile\'s name exactly to delete it.');
    }
    const capture = await backupsModule.captureParts(client, index, backupsModule.PARTS);
    await backup(index, 'delete-profile', backupsModule.PARTS, capture);
    await client.deleteProfile(index);
    return { ok: true };
  }

  async function copyProfile(source: number, body: Row): Promise<{ ok: true; copied: Part[] }> {
    const target = Number(body['target']);
    const parts = backupsModule.normaliseParts(body['parts']);
    if (!Number.isInteger(target) || !parts) invalid('Choose a profile and what to copy to it.');
    if (target === source) invalid('Choose a different profile to copy to.');
    const all = await profiles();
    const from = all.find((profile) => profile.index === source);
    const to = all.find((profile) => profile.index === target);
    if (!from || !to) notFound('That Nuvio profile no longer exists.');
    const capture = await backupsModule.captureParts(client, target, parts);
    await backup(target, 'copy', parts, capture);
    const copied: Part[] = [];
    if (parts.includes('settings')) {
      await client.copyProfileSetup(source, target);
      copied.push('settings');
    }
    if (parts.includes('addons')) {
      const rows = projection.sortedAddonRows(await client.listAddons(from.usesPrimaryAddons ? 1 : source));
      if (rows.length) {
        if (to.usesPrimaryAddons) await client.patchProfile(target, { usesPrimaryAddons: false });
        await backupsModule.applyAddonRows(client, target, rows.map((row, order) => ({
          url: String(row['url'] ?? ''),
          name: typeof row['name'] === 'string' ? row['name'] as string : null,
          enabled: row['enabled'] !== false,
          sort_order: order,
        })), own);
        copied.push('addons');
      }
    }
    if (parts.includes('collections')) {
      const pulled = await client.pullCollections(source);
      await client.pushCollections(target, pulled.items);
      copied.push('collections');
    }
    if (parts.includes('home')) {
      const pulled = await client.pullHome(source);
      if (pulled.doc) {
        await client.pushHome(target, pulled.doc);
        copied.push('home');
      }
    }
    return { ok: true, copied };
  }

  // ── Settings ────────────────────────────────────────────────

  async function updateSettings(index: number, body: Row): Promise<{ settings: Settings }> {
    const { values, errors } = settingsMap.normaliseValues(body['values']);
    if (errors.length) invalid(`These settings are not valid: ${errors.join(', ')}.`);
    if (!Object.keys(values).length) invalid('Nothing to change.');
    await requireProfile(index);
    const touchesHome = values.hideUnreleased !== undefined;
    const parts: Part[] = touchesHome ? ['settings', 'home'] : ['settings'];
    const capture = await backupsModule.captureParts(client, index, parts);
    await backup(index, 'auto', parts, capture);
    const blobs = capture.snapshot.settings || { tv: null, mobile: null };
    for (const platform of ['tv', 'mobile'] as const) {
      const result = settingsMap.applySettings(blobs[platform], platform, values);
      if (!result.blob || !result.changed.length) continue;
      await client.pushSettings(index, platform, result.blob, capture.settingsUpdatedAt[platform]);
    }
    if (touchesHome) {
      const doc = capture.snapshot.home;
      // Every other Home field (rows, show_catalog_type, unknown keys) is
      // kept. With no Home settings yet, only the flag is written: both apps
      // keep their own rows when the list is empty.
      const next = doc ? { ...doc, hide_unreleased_content: values.hideUnreleased } : { hide_unreleased_content: values.hideUnreleased };
      if (!doc || doc['hide_unreleased_content'] !== values.hideUnreleased) await client.pushHome(index, next);
    }
    const [tv, mobile, home] = await Promise.all([
      client.pullSettings(index, 'tv'),
      client.pullSettings(index, 'mobile'),
      client.pullHome(index),
    ]);
    return { settings: settingsFrom(tv.blob, mobile.blob, home.doc) };
  }

  // ── Addons ──────────────────────────────────────────────────

  async function addAddon(index: number, body: Row): Promise<{ addon: Addon }> {
    const url = validAddonUrl(body['url']);
    if (!url) invalid('Paste the addon\'s https link ending in /manifest.json.');
    requireOwnAddons(await requireProfile(index));
    const capture = await backupsModule.captureParts(client, index, ['addons']);
    const rows = capture.addonRows;
    const canonical = projection.canonicalAddonUrl(url);
    if (rows.some((row) => projection.canonicalAddonUrl(row['url']) === canonical)) {
      invalid('That addon is already on this profile.');
    }
    const name = cleanName(await fetchName(url).catch(() => null), MAX_ADDON_NAME) || projection.addonHost(url);
    const sortOrder = rows.reduce((max, row) => Math.max(max, Number(row['sort_order']) || 0), -1) + 1;
    await backup(index, 'auto', ['addons'], capture);
    const inserted = await client.insertAddon(index, { url, name, enabled: true, sort_order: sortOrder });
    const list = await addonList(index);
    const id = inserted ? String(inserted['id'] ?? '') : '';
    const addon = list.find((entry) => entry.id === id)
      || projection.projectAddon(inserted || { url, name, enabled: true }, list.length, own);
    return { addon };
  }

  async function updateAddon(index: number, id: string, body: Row): Promise<{ addon: Addon }> {
    const patch: { enabled?: boolean; name?: string | null } = {};
    if (body['enabled'] !== undefined) {
      if (typeof body['enabled'] !== 'boolean') invalid('Invalid on/off value.');
      patch.enabled = body['enabled'];
    }
    if (body['name'] !== undefined) {
      if (body['name'] === null || body['name'] === '') {
        patch.name = null;
      } else {
        const name = cleanName(body['name'], MAX_ADDON_NAME);
        if (!name) invalid('Addon names can be up to 80 characters.');
        patch.name = name;
      }
    }
    if (!Object.keys(patch).length) invalid('Nothing to change.');
    requireOwnAddons(await requireProfile(index));
    const capture = await backupsModule.captureParts(client, index, ['addons']);
    if (!capture.addonRows.some((row) => String(row['id']) === id)) notFound('That addon is no longer on this profile.');
    await backup(index, 'auto', ['addons'], capture);
    await client.updateAddon(index, id, patch);
    const addon = (await addonList(index)).find((entry) => entry.id === id);
    if (!addon) notFound('That addon is no longer on this profile.');
    return { addon };
  }

  async function reorderAddons(index: number, body: Row): Promise<{ addons: Addon[] }> {
    const ids = stringList(body['ids']);
    if (!ids) invalid('Send every addon id in the new order.');
    requireOwnAddons(await requireProfile(index));
    const capture = await backupsModule.captureParts(client, index, ['addons']);
    const rows = capture.addonRows;
    if (!sameSet(ids, rows.map((row) => String(row['id'])))) {
      fail(409, 'nuvio-conflict', 'The addons changed on a device since they were loaded. Reload and try again.');
    }
    await backup(index, 'auto', ['addons'], capture);
    const byId = new Map(rows.map((row) => [String(row['id']), row]));
    for (let order = 0; order < ids.length; order += 1) {
      const row = byId.get(ids[order] as string) as Row;
      if (Number(row['sort_order']) !== order) await client.updateAddon(index, String(row['id']), { sort_order: order });
    }
    return { addons: await addonList(index) };
  }

  async function deleteAddon(index: number, id: string): Promise<{ ok: true }> {
    requireOwnAddons(await requireProfile(index));
    const capture = await backupsModule.captureParts(client, index, ['addons']);
    const row = capture.addonRows.find((entry) => String(entry['id']) === id);
    if (!row) notFound('That addon is no longer on this profile.');
    if (projection.isOwnAddon(row, own)) invalid('LeLibrary\'s own addon cannot be removed here.');
    if (capture.addonRows.length <= 1) invalid('A profile needs at least one addon.');
    await backup(index, 'auto', ['addons'], capture);
    await client.deleteAddon(index, id);
    return { ok: true };
  }

  // ── Collections and Home ────────────────────────────────────

  async function collectionsNow(index: number): Promise<CollectionSummary[]> {
    const [collections, home] = await Promise.all([client.pullCollections(index), client.pullHome(index)]);
    return projection.projectCollections(collections.items, home.doc);
  }

  // Hiding is a Home setting (`collection_<id>` off); the collection stays.
  async function setCollectionHidden(index: number, id: string, body: Row): Promise<{ collections: CollectionSummary[] }> {
    if (typeof body['hidden'] !== 'boolean') invalid('Invalid hidden value.');
    const hidden = body['hidden'];
    await requireProfile(index);
    const capture = await backupsModule.captureParts(client, index, ['collections', 'home']);
    const collections = capture.snapshot.collections || [];
    if (!collections.some((collection) => String(collection['id']) === id)) notFound('That collection is no longer on this profile.');
    const doc = capture.snapshot.home;
    const items = projection.homeItems(doc);
    // An empty Home list is ignored by the apps; writing one row would make
    // the TV replace its whole Home order with just that row.
    if (!doc || !items.length) invalid('Nuvio has no Home order for this profile yet. Open Nuvio on a device once, then try again.');
    const key = `collection_${id}`;
    const matches = items.filter((item) => projection.homeItemKey(item) === key);
    if (matches.length && matches.every((item) => (item['enabled'] !== false) === !hidden)) {
      return { collections: projection.projectCollections(collections, doc) };
    }
    await backup(index, 'auto', ['home'], capture);
    const rawItems = Array.isArray(doc['items']) ? doc['items'] as unknown[] : [];
    const nextItems = rawItems.map((item) => (
      item && typeof item === 'object' && projection.homeItemKey(item as Row) === key ? { ...(item as Row), enabled: !hidden } : item
    ));
    if (!matches.length) {
      const order = items.reduce((max, item) => Math.max(max, Number(item['order']) || 0), -1) + 1;
      nextItems.push({ addon_id: '', type: '', catalog_id: '', enabled: !hidden, order, custom_title: '', is_collection: true, collection_id: id, key });
    }
    await client.pushHome(index, { ...doc, items: nextItems });
    return { collections: await collectionsNow(index) };
  }

  async function reorderCollections(index: number, body: Row): Promise<{ collections: CollectionSummary[] }> {
    const ids = stringList(body['ids']);
    if (!ids) invalid('Send every collection id in the new order.');
    await requireProfile(index);
    const capture = await backupsModule.captureParts(client, index, ['collections']);
    const collections = capture.snapshot.collections || [];
    if (!sameSet(ids, collections.map((collection) => String(collection['id'])))) {
      fail(409, 'nuvio-conflict', 'The collections changed on a device since they were loaded. Reload and try again.');
    }
    await backup(index, 'auto', ['collections'], capture);
    const byId = new Map(collections.map((collection) => [String(collection['id']), collection]));
    await client.pushCollections(index, ids.map((id) => byId.get(id)));
    return { collections: await collectionsNow(index) };
  }

  // Only LeLibrary's own collections can be deleted here; others can be hidden.
  async function deleteCollection(index: number, id: string): Promise<{ collections: CollectionSummary[] }> {
    await requireProfile(index);
    const capture = await backupsModule.captureParts(client, index, ['collections']);
    const collections = capture.snapshot.collections || [];
    if (!collections.some((collection) => String(collection['id']) === id)) notFound('That collection is no longer on this profile.');
    if (!projection.isLeLibraryCollectionId(id)) invalid('Only LeLibrary\'s own collections can be deleted here. Hide the others instead.');
    await backup(index, 'auto', ['collections'], capture);
    await client.pushCollections(index, collections.filter((collection) => String(collection['id']) !== id));
    return { collections: await collectionsNow(index) };
  }

  async function setHome(index: number, body: Row): Promise<{ home: Home }> {
    const wanted = body['items'];
    if (!Array.isArray(wanted) || wanted.length > 1000) invalid('Send every Home row in the new order.');
    const entries: { key: string; enabled: boolean }[] = [];
    for (const entry of wanted) {
      const record = (entry && typeof entry === 'object' ? entry : {}) as Row;
      if (typeof record['key'] !== 'string' || typeof record['enabled'] !== 'boolean') invalid('Each Home row needs a key and enabled.');
      entries.push({ key: record['key'], enabled: record['enabled'] });
    }
    await requireProfile(index);
    const capture = await backupsModule.captureParts(client, index, ['home', 'collections']);
    const doc = capture.snapshot.home;
    if (!doc) invalid('Nuvio has no Home order for this profile yet. Open Nuvio on a device once, then try again.');
    const items = projection.sortedHomeItems(doc);
    const currentKeys = Array.from(new Set(items.map((item) => projection.homeItemKey(item))));
    if (!sameSet(entries.map((entry) => entry.key), currentKeys)) {
      fail(409, 'nuvio-conflict', 'The Home rows changed on a device since they were loaded. Reload and try again.');
    }
    await backup(index, 'auto', ['home'], capture);
    const byKey = new Map<string, Row[]>();
    for (const item of items) {
      const key = projection.homeItemKey(item);
      byKey.set(key, [...(byKey.get(key) || []), item]);
    }
    const nextItems: Row[] = [];
    for (const entry of entries) {
      for (const item of byKey.get(entry.key) || []) {
        nextItems.push({ ...item, enabled: entry.enabled, order: nextItems.length });
      }
    }
    await client.pushHome(index, { ...doc, items: nextItems });
    const [home, collections] = await Promise.all([client.pullHome(index), client.pullCollections(index)]);
    const profile = await requireProfile(index);
    const rows = await client.listAddons(profile.usesPrimaryAddons ? 1 : index).catch(() => []);
    return { home: projection.projectHome(home.doc, collections.items, await namesFor(rows as Row[])) };
  }

  // ── Backups ─────────────────────────────────────────────────

  async function listBackups(profileIndex: number | null): Promise<{ backups: BackupSummary[] }> {
    return { backups: await backups.list(own.uuid, profileIndex) };
  }

  async function backupNow(index: number): Promise<{ backup: BackupSummary }> {
    await requireProfile(index);
    const capture = await backupsModule.captureParts(client, index, backupsModule.PARTS);
    return { backup: await backup(index, 'manual', backupsModule.PARTS, capture) };
  }

  // Into the same profile or another one; only the parts the backup holds.
  // The target is backed up first ('restore', or 'undo' for an undo), never
  // as an automatic backup, so "Undo" keeps stepping back through real changes.
  async function restore(id: string, body: Row, reason: BackupReason = 'restore'): Promise<{ ok: true; restored: Part[] }> {
    const found = await backups.get(own.uuid, id);
    if (!found) notFound('That backup no longer exists.');
    const target = body['target'] === undefined || body['target'] === null ? found.summary.profileIndex : Number(body['target']);
    if (!Number.isInteger(target)) invalid('Choose a profile to restore into.');
    await requireProfile(target);
    const parts = found.summary.parts;
    const capture = await backupsModule.captureParts(client, target, parts);
    await backup(target, reason, parts, capture);
    const restored = await backupsModule.restoreSnapshot(client, found.snapshot, target, parts, own);
    return { ok: true, restored };
  }

  // Restore the newest automatic backup, then drop it, so the next undo
  // goes one step further back.
  async function undo(index: number): Promise<{ ok: true; restored: Part[] }> {
    const id = await backups.newestAutomatic(own.uuid, index);
    if (!id) notFound('There is nothing to undo on this profile.');
    const result = await restore(id, { target: index }, 'undo');
    await backups.remove(own.uuid, id);
    return result;
  }

  return {
    overview,
    profileState,
    createProfile,
    patchProfile,
    deleteProfile,
    copyProfile,
    updateSettings,
    addAddon,
    updateAddon,
    reorderAddons,
    deleteAddon,
    configureLink,
    setCollectionHidden,
    reorderCollections,
    deleteCollection,
    setHome,
    listBackups,
    backupNow,
    restore: (id: string, body: Row) => restore(id, body),
    undo,
  };
}

export type NuvioService = ReturnType<typeof createNuvioService>;

export interface NuvioServiceApi {
  createNuvioService: (options: NuvioServiceOptions) => NuvioService;
  validAddonUrl: (value: unknown) => string | null;
  settingsFrom: (tv: Row | null, mobile: Row | null, home: Row | null) => Settings;
}

module.exports = { createNuvioService, validAddonUrl, settingsFrom } satisfies NuvioServiceApi;
