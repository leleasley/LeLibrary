// What the browser may see of a Nuvio account. Allowlisted fields only:
// other addons' links are secrets (debrid keys, AIOStreams configs), so an
// addon leaves the server as name, hostname, on/off, order and Nuvio's row id.
// Profile rows never carry PIN state beyond "has a PIN", collections leave as
// a summary, Home rows as their catalogue identity.

export interface Profile {
  index: number;
  name: string;
  color: string;
  avatarUrl: string | null;
  usesPrimaryAddons: boolean;
  pinEnabled: boolean;
  isPrimary: boolean;
}

export interface Addon {
  id: string;
  name: string;
  host: string;
  enabled: boolean;
  order: number;
  isLeLibrary: boolean;
}

export interface CollectionSummary {
  id: string;
  title: string;
  folders: number;
  isLeLibrary: boolean;
  hidden: boolean;
}

export interface HomeItem {
  key: string;
  title: string;
  type: string;
  catalogId: string;
  addonId: string;
  isCollection: boolean;
  enabled: boolean;
  order: number;
}

export interface Home {
  items: HomeItem[];
  hideUnreleased: boolean | null;
}

// Who "we" are, to mark this setup's own addon row.
export interface OwnContext {
  origin: string;
  uuid: string;
}

const DEFAULT_COLOR = '#1E88E5';
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function profileIndexOf(row: Record<string, unknown>): number {
  return Math.trunc(Number(row['profile_index'] ?? row['profile_id']));
}

function projectProfile(raw: unknown): Profile | null {
  if (!isRecord(raw)) return null;
  const index = profileIndexOf(raw);
  if (!Number.isInteger(index) || index < 1 || index > 6) return null;
  const color = text(raw['avatar_color_hex']);
  const avatar = text(raw['avatar_url']);
  return {
    index,
    name: text(raw['name']) || `Profile ${index}`,
    color: COLOR_RE.test(color) ? color.toUpperCase() : DEFAULT_COLOR,
    avatarUrl: /^https?:\/\//i.test(avatar) && avatar.length <= 2048 ? avatar : null,
    usesPrimaryAddons: index > 1 && raw['uses_primary_addons'] === true,
    pinEnabled: raw['pin_enabled'] === true,
    isPrimary: index === 1,
  };
}

function projectProfiles(rows: unknown): Profile[] {
  const list = Array.isArray(rows) ? rows : [];
  const out = new Map<number, Profile>();
  for (const row of list) {
    const profile = projectProfile(row);
    if (profile) out.set(profile.index, profile);
  }
  return Array.from(out.values()).sort((a, b) => a.index - b.index);
}

function addonHost(url: unknown): string {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// Nuvio's own identity rule for an addon link (both apps): trimmed, without a
// trailing "/" or "/manifest.json", query kept, compared case-insensitively.
function canonicalAddonUrl(url: unknown): string {
  return String(url ?? '').trim()
    .replace(/\/+$/, '')
    .replace(/\/manifest\.json$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function ownHost(ctx: OwnContext): string {
  return addonHost(ctx.origin);
}

// This setup's own row: its install link (origin + "/" + uuid + ".secret"),
// or a row called LeLibrary on our host (an older install of this setup).
function isOwnAddon(row: unknown, ctx: OwnContext): boolean {
  if (!isRecord(row) || !ctx.origin || !ctx.uuid) return false;
  const url = String(row['url'] ?? '');
  const prefix = `${ctx.origin.replace(/\/+$/, '')}/${ctx.uuid.toLowerCase()}`;
  if (url.toLowerCase().startsWith(prefix.toLowerCase())) return true;
  return text(row['name']).toLowerCase() === 'lelibrary' && addonHost(url) !== '' && addonHost(url) === ownHost(ctx);
}

function sortedAddonRows(rows: unknown): Record<string, unknown>[] {
  const list = (Array.isArray(rows) ? rows : []).filter(isRecord);
  return list
    .map((row, position) => ({ row, position }))
    .sort((a, b) => (Number(a.row['sort_order']) || 0) - (Number(b.row['sort_order']) || 0) || a.position - b.position)
    .map((entry) => entry.row);
}

function projectAddon(row: Record<string, unknown>, order: number, ctx: OwnContext): Addon {
  const host = addonHost(row['url']);
  return {
    id: String(row['id'] ?? ''),
    name: text(row['name']).slice(0, 120) || host || 'Addon',
    host,
    enabled: row['enabled'] !== false,
    order,
    isLeLibrary: isOwnAddon(row, ctx),
  };
}

function projectAddons(rows: unknown, ctx: OwnContext): Addon[] {
  return sortedAddonRows(rows).map((row, order) => projectAddon(row, order, ctx));
}

function isLeLibraryCollectionId(id: unknown): boolean {
  return String(id ?? '').startsWith('collection-lelibrary');
}

function homeItemKey(item: Record<string, unknown>): string {
  const collectionId = item['collection_id'] ?? item['collectionId'];
  if (item['is_collection'] === true || item['isCollection'] === true || (collectionId && !item['catalog_id'])) {
    return `collection_${String(collectionId ?? '')}`;
  }
  return `${String(item['addon_id'] ?? '')}:${String(item['type'] ?? '')}:${String(item['catalog_id'] ?? '')}`;
}

function homeItems(doc: unknown): Record<string, unknown>[] {
  const items = isRecord(doc) ? doc['items'] : null;
  return (Array.isArray(items) ? items : []).filter(isRecord);
}

function sortedHomeItems(doc: unknown): Record<string, unknown>[] {
  return homeItems(doc)
    .map((item, position) => ({ item, position }))
    .sort((a, b) => (Number(a.item['order']) || 0) - (Number(b.item['order']) || 0) || a.position - b.position)
    .map((entry) => entry.item);
}

function projectCollections(collections: unknown, homeDoc: unknown): CollectionSummary[] {
  const hidden = new Set<string>();
  for (const item of homeItems(homeDoc)) {
    const key = homeItemKey(item);
    if (key.startsWith('collection_') && item['enabled'] === false) hidden.add(key.slice('collection_'.length));
  }
  return (Array.isArray(collections) ? collections : []).filter(isRecord).map((collection) => {
    const id = String(collection['id'] ?? '');
    return {
      id,
      title: text(collection['title']).slice(0, 160) || id,
      folders: Array.isArray(collection['folders']) ? collection['folders'].length : 0,
      isLeLibrary: isLeLibraryCollectionId(id),
      hidden: hidden.has(id),
    };
  });
}

// Fallback for a catalogue no manifest names: "torbox-watchlist-mdblist-movie"
// reads "Torbox watchlist mdblist movie" instead of the raw id.
function humanizeCatalogId(id: string): string {
  const words = String(id || '').replace(/^lib-/, '').split(/[-_.:\s]+/).filter(Boolean);
  if (!words.length) return id;
  const out = words.join(' ').toLowerCase();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

const TYPE_LABEL: Record<string, string> = { movie: 'Movies', series: 'Series', anime: 'Anime', tv: 'TV', channel: 'Channels' };

// names: "<manifestId>:<type>:<catalogId>" -> catalogue name from that addon's manifest.
function projectHome(doc: unknown, collections: unknown, names: Map<string, string> = new Map()): Home {
  const titles = new Map<string, string>();
  for (const collection of (Array.isArray(collections) ? collections : []).filter(isRecord)) {
    titles.set(String(collection['id'] ?? ''), text(collection['title']));
  }
  const seen = new Set<string>();
  const items: HomeItem[] = [];
  for (const item of sortedHomeItems(doc)) {
    const key = homeItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    const isCollection = key.startsWith('collection_');
    const collectionId = isCollection ? key.slice('collection_'.length) : '';
    const catalogId = isCollection ? collectionId : String(item['catalog_id'] ?? '');
    items.push({
      key,
      title: (text(item['custom_title'])
        || (isCollection ? titles.get(collectionId) || '' : names.get(key) || '')
        || (isCollection ? collectionId : humanizeCatalogId(catalogId))).slice(0, 160),
      type: isCollection ? 'collection' : String(item['type'] ?? ''),
      catalogId,
      addonId: isCollection ? '' : String(item['addon_id'] ?? ''),
      isCollection,
      enabled: item['enabled'] !== false,
      order: items.length,
    });
  }
  // Two rows with the same name (a catalogue in Movies and Series) get their type.
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.title, (counts.get(item.title) || 0) + 1);
  for (const item of items) {
    const label = TYPE_LABEL[item.type];
    if (!item.isCollection && label && (counts.get(item.title) || 0) > 1) item.title = `${item.title} (${label})`.slice(0, 160);
  }
  const flag = isRecord(doc) ? doc['hide_unreleased_content'] : undefined;
  return { items, hideUnreleased: typeof flag === 'boolean' ? flag : null };
}

export interface ProjectionApi {
  DEFAULT_COLOR: string;
  projectProfile: (raw: unknown) => Profile | null;
  projectProfiles: (rows: unknown) => Profile[];
  profileIndexOf: (row: Record<string, unknown>) => number;
  addonHost: (url: unknown) => string;
  canonicalAddonUrl: (url: unknown) => string;
  isOwnAddon: (row: unknown, ctx: OwnContext) => boolean;
  sortedAddonRows: (rows: unknown) => Record<string, unknown>[];
  projectAddon: (row: Record<string, unknown>, order: number, ctx: OwnContext) => Addon;
  projectAddons: (rows: unknown, ctx: OwnContext) => Addon[];
  isLeLibraryCollectionId: (id: unknown) => boolean;
  homeItemKey: (item: Record<string, unknown>) => string;
  homeItems: (doc: unknown) => Record<string, unknown>[];
  sortedHomeItems: (doc: unknown) => Record<string, unknown>[];
  projectCollections: (collections: unknown, homeDoc: unknown) => CollectionSummary[];
  projectHome: (doc: unknown, collections: unknown, names?: Map<string, string>) => Home;
  humanizeCatalogId: (id: string) => string;
}

module.exports = {
  DEFAULT_COLOR,
  projectProfile,
  projectProfiles,
  profileIndexOf,
  addonHost,
  canonicalAddonUrl,
  isOwnAddon,
  sortedAddonRows,
  projectAddon,
  projectAddons,
  isLeLibraryCollectionId,
  homeItemKey,
  homeItems,
  humanizeCatalogId,
  sortedHomeItems,
  projectCollections,
  projectHome,
} satisfies ProjectionApi;
