// Setup Preview: what Nuvio or Stremio will show for one saved setup, built
// from the same code paths the addon and the push use, and nothing else.
//
// - Rows and their names come from the configured manifest exactly as
//   /:token/manifest.json serves it (routes/manifest.ts).
// - Nuvio collections, their folders and covers come from the collection plan
//   and the push's own collection builder (setup/push.ts), and the Home order
//   is the push's own Home item list for a fresh profile.
// - Stremio's board is the manifest's catalogues without a required extra,
//   in manifest order (Stremio ignores showInHome).
//
// Read-only: nothing is pushed and nothing is written. The result is display
// data only: no keys, no tokens, no install or manifest link, no addon links.
// The browser loads row contents from the addon itself with the install
// token it already holds.
import type { OpenedConfig } from './config-store.ts';
import type { HomeRowDoc } from './push.ts';

type Row = Record<string, unknown>;

export type PreviewPlatform = 'nuvio' | 'stremio';

export interface PreviewRow {
  key: string;
  type: string;
  catalogId: string;
  name: string;
  // The row's name is the user's own title (Nuvio shows it as is, without
  // the "- Type" suffix it adds to catalogue names).
  custom?: boolean;
  // From another addon: the preview cannot load it, the player can.
  external?: boolean;
}

export interface PreviewSource {
  catalogId: string;
  type: string;
  genre: string;
  name: string;
  // The source catalogue's own name, for the folder's tab labels.
  catalogName: string;
  external?: boolean;
}

export interface PreviewFolder {
  id: string;
  title: string;
  cover: string;
  // The animated cover Nuvio shows on focus (mobile: always), when enabled.
  focusGif: string;
  shape: 'POSTER' | 'LANDSCAPE' | 'SQUARE';
  hideTitle: boolean;
  sources: PreviewSource[];
}

export interface PreviewCollection {
  id: string;
  title: string;
  backdrop: string;
  pinToTop: boolean;
  folders: PreviewFolder[];
}

export type PreviewHomeEntry = ({ kind: 'row' } & PreviewRow) | { kind: 'collection'; id: string };

export interface SetupPreview {
  platform: PreviewPlatform;
  // The addon's display name (manifest name), for "from ..." subtitles.
  addonName: string;
  // Home in order: Nuvio = collections then rows (the push's order), Stremio
  // = board rows.
  home: PreviewHomeEntry[];
  // Nuvio's hero sources: the first two Home catalogues (this addon's, no
  // required extra); collections never feed the hero.
  hero: PreviewRow[];
  collections: PreviewCollection[];
  // Movie Collections is on but the library has not built it yet.
  franchisePending: boolean;
}

export interface PreviewInput {
  opened: OpenedConfig;
  platform: PreviewPlatform;
  // Public origin, for full art links (as the push makes them).
  origin: string;
  port?: number;
}

export interface PreviewDeps {
  manifestFor?: (config: Row, token: string, integration: string, baseUrl: string) => Promise<Row>;
  fetchFranchise?: (token: string) => Promise<Row | null>;
}

export interface PreviewApi {
  buildSetupPreview: (input: PreviewInput, deps?: PreviewDeps) => Promise<SetupPreview>;
  secretsOf: (opened: OpenedConfig) => string[];
  scrubPreview: <T>(value: T, secrets: string[]) => T;
}

const push = require('./push.ts') as import('./push.ts').PushApi;
const { compileCollectionPlan } = require('../catalog/collection-plan.ts') as {
  compileCollectionPlan: (input: Record<string, unknown>) => {
    collections: unknown[];
    homeRows: HomeRowDoc[];
    nativeFranchiseCollection?: { enabled?: boolean; slot?: number | null; title?: string | null };
  };
};
const { toEngineConfig } = require('./config-store.ts') as { toEngineConfig: (opened: OpenedConfig) => Row };
const { setupEngineConfig } = require('../config/resolve-config.ts') as import('../config/resolve-config.ts').ResolveConfigApi;

const FALLBACK_ADDON_ID = 'community.lelibrary.selfhosted';
const FRANCHISE_TIMEOUT_MS = 8000;

function text(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function hasRequiredExtra(catalog: Row): boolean {
  if (Array.isArray(catalog['extraRequired']) && (catalog['extraRequired'] as unknown[]).length) return true;
  return Array.isArray(catalog['extra']) && (catalog['extra'] as Row[]).some((extra) => extra?.['isRequired'] === true);
}

// Every secret the setup holds: the install secret and every key-shaped
// string in its sealed keys (nested connection objects included). Any output
// string that contains one is dropped.
function secretsOf(opened: OpenedConfig): string[] {
  const out = new Set<string>();
  if (opened.secret) {
    out.add(opened.secret);
    out.add(`${opened.uuid}.${opened.secret}`);
  }
  const walk = (value: unknown, depth: number) => {
    if (depth > 6 || value == null) return;
    if (typeof value === 'string') { if (value.length >= 8) out.add(value); return; }
    if (typeof value !== 'object') return;
    for (const child of Array.isArray(value) ? value : Object.values(value as Row)) walk(child, depth + 1);
  };
  walk(opened.keys, 0);
  return [...out];
}

function scrubPreview<T>(value: T, secrets: string[]): T {
  const walk = (input: unknown): unknown => {
    if (typeof input === 'string') return secrets.some((secret) => input.includes(secret)) ? '' : input;
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input as Row).map(([key, child]) => [key, walk(child)]));
    }
    return input;
  };
  return walk(value) as T;
}

// Art links only: full http(s) links, never a manifest link.
function artLink(value: unknown): string {
  const link = text(value, 2048).trim();
  if (!/^https?:\/\//i.test(link) || /manifest\.json/i.test(link)) return '';
  return link;
}

function shapeOf(value: unknown): PreviewFolder['shape'] {
  return value === 'LANDSCAPE' || value === 'SQUARE' ? value : 'POSTER';
}

async function buildSetupPreview({ opened, platform, origin, port }: PreviewInput, deps: PreviewDeps = {}): Promise<SetupPreview> {
  if (!opened.secret) throw new Error('Install link unavailable');
  const token = `${opened.uuid}.${opened.secret}`;
  const config = setupEngineConfig(toEngineConfig(opened), opened, token);
  const manifestFor = deps.manifestFor
    || (require('../routes/manifest.ts') as import('../routes/manifest.ts').ManifestApi).buildConfiguredManifest;
  const manifest = await manifestFor(config, token, platform, origin);
  const manifestId = text(manifest['id']) || FALLBACK_ADDON_ID;
  const addonName = text(manifest['name'], 80);
  const catalogs = (Array.isArray(manifest['catalogs']) ? manifest['catalogs'] : []) as Row[];
  const catalogName = new Map<string, string>();
  for (const catalog of catalogs) catalogName.set(`${catalog['type']}\u0000${catalog['id']}`, text(catalog['name']));
  const listed = catalogs.filter((catalog) => catalog && !hasRequiredExtra(catalog)).map((catalog): PreviewRow => ({
    key: `${manifestId}:${catalog['type']}:${catalog['id']}`,
    type: text(catalog['type']),
    catalogId: text(catalog['id']),
    name: text(catalog['name']) || text(catalog['id']),
  }));
  const secrets = secretsOf(opened);

  if (platform === 'stremio') {
    return scrubPreview({ platform, addonName, home: listed.map((row) => ({ kind: 'row' as const, ...row })), hero: [], collections: [], franchisePending: false }, secrets);
  }

  // Nuvio: the same inputs pushToNuvio compiles.
  const hideAnime = config['hideAnime'] === true;
  const saved = Array.isArray(config['collections']) ? config['collections'] as unknown[] : [];
  const withGenres = await push.withHubGenreTabs(saved, token, hideAnime);
  const plan = compileCollectionPlan({
    collections: withGenres,
    homeRows: Array.isArray(config['collectionHomeRows']) ? config['collectionHomeRows'] : [],
    sources: Array.isArray(config['collectionSources']) ? config['collectionSources'] : [],
    externalSources: [],
    manifestId,
    integration: 'nuvio',
    hideAnime,
  });
  let nuvioCollections = push.nuvioCollectionsFromPlan(plan.collections, manifestId, origin);
  const native = plan.nativeFranchiseCollection;
  let franchisePending = false;
  if (native?.enabled === true) {
    const fetchFranchise = deps.fetchFranchise
      || ((installToken: string) => push.fetchOwnedFranchiseCollection(push.internalOrigin(port), installToken, FRANCHISE_TIMEOUT_MS));
    const franchise = await fetchFranchise(token).catch(() => null);
    franchisePending = !franchise;
    nuvioCollections = push.withFranchiseCollection(nuvioCollections, franchise, native);
  }
  const items = push.planNuvioHomeItems({
    items: [],
    manifest: manifest as { id?: string; catalogs?: { type?: string; id?: string; showInHome?: boolean }[] },
    homeRows: plan.homeRows,
    collections: nuvioCollections as { id?: string }[],
    franchiseSlot: native?.slot ?? null,
  });

  const collections: PreviewCollection[] = nuvioCollections.map((collection) => ({
    id: text(collection['id']),
    title: text(collection['title'], 120),
    backdrop: artLink(collection['backdropImageUrl']),
    pinToTop: collection['pinToTop'] === true,
    folders: (Array.isArray(collection['folders']) ? collection['folders'] as Row[] : []).map((folder) => ({
      id: text(folder['id']),
      title: text(folder['title'], 120),
      cover: artLink(folder['coverImageUrl']) || artLink(folder['heroBackdropUrl']),
      focusGif: folder['focusGifEnabled'] === true ? artLink(folder['focusGifUrl']) : '',
      shape: shapeOf(folder['tileShape']),
      hideTitle: folder['hideTitle'] === true,
      sources: (Array.isArray(folder['sources']) ? folder['sources'] as Row[] : []).map((source) => {
        const own = !source['addonId'] || source['addonId'] === manifestId;
        const ownName = catalogName.get(`${source['type']}\u0000${source['catalogId']}`) || '';
        const name = text(source['genre']) || ownName || text(folder['title'], 120);
        return {
          catalogId: text(source['catalogId']),
          type: text(source['type']) || 'movie',
          genre: text(source['genre']),
          name,
          catalogName: ownName || text(folder['title'], 120),
          ...(own ? {} : { external: true }),
        };
      }),
    })),
  }));
  const known = new Set(collections.map((collection) => collection.id));

  let home: PreviewHomeEntry[] = items
    .filter((item) => item['enabled'] !== false)
    .map((item): PreviewHomeEntry | null => {
      if (item['is_collection'] === true) {
        const id = text(item['collection_id']);
        return known.has(id) ? { kind: 'collection', id } : null;
      }
      const addonId = text(item['addon_id']);
      const type = text(item['type']);
      const catalogId = text(item['catalog_id']);
      if (!type || !catalogId) return null;
      const custom = text(item['custom_title']);
      const name = custom || catalogName.get(`${type}\u0000${catalogId}`) || catalogId;
      return {
        kind: 'row', key: `${addonId}:${type}:${catalogId}`, type, catalogId, name,
        ...(custom ? { custom: true } : {}),
        ...(addonId && addonId !== manifestId ? { external: true } : {}),
      };
    })
    .filter((entry): entry is PreviewHomeEntry => entry !== null);
  // No Home rows chosen (Quick Look has no Home picker and cannot push):
  // Nuvio shows every catalogue without a required extra, after collections.
  if (!plan.homeRows.length && !home.some((entry) => entry.kind === 'row')) {
    home = [...home, ...listed.map((row) => ({ kind: 'row' as const, ...row }))];
  }
  // Nuvio draws pinned collections first, ahead of everything else on Home.
  const pinned = new Set(collections.filter((collection) => collection.pinToTop).map((collection) => collection.id));
  if (pinned.size) {
    const isPinned = (entry: PreviewHomeEntry) => entry.kind === 'collection' && pinned.has(entry.id);
    home = [...home.filter(isPinned), ...home.filter((entry) => !isPinned(entry))];
  }
  // Hero sources: the first two Home catalogues the preview can load and
  // that need no required extra (manifest order when Home has none).
  const heroable = new Set(listed.map((row) => `${row.type}\u0000${row.catalogId}`));
  const homeRows = home.filter((entry): entry is { kind: 'row' } & PreviewRow => entry.kind === 'row'
    && !entry.external && heroable.has(`${entry.type}\u0000${entry.catalogId}`));
  const hero = (homeRows.length ? homeRows : listed).slice(0, 2).map((row): PreviewRow => ({
    key: row.key, type: row.type, catalogId: row.catalogId, name: row.name, ...(row.custom ? { custom: true } : {}),
  }));

  return scrubPreview({ platform, addonName, home, hero, collections, franchisePending }, secrets);
}

module.exports = { buildSetupPreview, secretsOf, scrubPreview } satisfies PreviewApi;
