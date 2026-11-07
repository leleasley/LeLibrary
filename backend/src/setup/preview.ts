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
//
// Live draft preview (v6): a setup page that is not saved yet (creating, or
// editing with unsaved changes) sends its non-secret config. The SAME
// builder runs on it, tagged like a setup of that tier, with placeholder
// keys for the key names it says are filled (so provider and TMDB rows are
// declared exactly as they will be). No key value is ever accepted:
// draftConfig() drops every key-shaped or secret field before anything
// reads it. Row contents for a draft come from buildDraftCatalog(): only
// LeLibrary's own catalogue definitions, built with the server's own TMDB
// key into the shared catalogue caches; library rows are samples.
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

export interface DraftPreviewInput {
  tier: string;
  platform: PreviewPlatform;
  // The page's non-secret config (the create body's `config`).
  config: unknown;
  // Names (never values) of the keys the page has filled in.
  keyServices?: unknown;
  origin: string;
}

export interface DraftCatalogInput {
  // Only lang, hideAnime and the chosen packs are read from it.
  config?: unknown;
  type: unknown;
  catalogId: unknown;
  genre?: unknown;
}

export interface DraftMeta {
  id: string;
  type: string;
  name: string;
  poster: string;
  background?: string;
  logo?: string;
  releaseInfo?: string;
  genres?: string[];
  description?: string;
}

export type DraftCatalogResult =
  | { status: 200; body: { metas: DraftMeta[] } | { sample: true; reason: 'library' | 'key' | 'unavailable' } | { sample: true; reason: 'personal'; service: string; label: string } }
  | { status: 400; body: { error: string } };

export interface DraftCatalogDeps {
  // The server's own TMDB key (Live art's), never a user's.
  serverKey?: () => string;
  library?: (input: Record<string, unknown>) => Promise<unknown[]>;
  discovery?: (input: Record<string, unknown>) => Promise<unknown[]>;
}

export type DraftCatalogKind =
  | { kind: 'library' }
  | { kind: 'personal'; service: 'simkl' | 'mdblist' | 'anilist' | 'trakt' }
  | { kind: 'discovery'; list: 'trending' | 'popular'; apiType: 'movie' | 'tv' }
  | { kind: 'lib'; libId: string }
  | { kind: 'curated'; type: 'movie' | 'series'; source: string }
  | { kind: 'unknown' };

export interface PreviewApi {
  buildSetupPreview: (input: PreviewInput, deps?: PreviewDeps) => Promise<SetupPreview>;
  buildDraftPreview: (input: DraftPreviewInput, deps?: PreviewDeps) => Promise<SetupPreview>;
  buildDraftCatalog: (input: DraftCatalogInput, deps?: DraftCatalogDeps) => Promise<DraftCatalogResult>;
  classifyDraftCatalog: (type: string, catalogId: string) => DraftCatalogKind;
  draftConfig: (value: unknown) => Row;
  draftKeyServices: (value: unknown) => string[];
  secretsOf: (opened: OpenedConfig) => string[];
  scrubPreview: <T>(value: T, secrets: string[]) => T;
  DRAFT_ROW_CAP: number;
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

async function buildSetupPreview(input: PreviewInput, deps: PreviewDeps = {}): Promise<SetupPreview> {
  return buildPreview(input, deps, false);
}

// One builder for saved setups and drafts. A draft has no library behind it:
// no Hub genre counts and no Movie Collections fetch (it shows as pending).
async function buildPreview({ opened, platform, origin, port }: PreviewInput, deps: PreviewDeps, draft: boolean): Promise<SetupPreview> {
  if (!opened.secret) throw new Error('Install link unavailable');
  const token = `${opened.uuid}.${opened.secret}`;
  const config = setupEngineConfig(toEngineConfig(opened), opened);
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
  const contentFilters = require('../catalog/content-filters.ts');
  const filterState = contentFilters.normalizeContentFilters(config);
  const hideAnime = filterState.hideAnime;
  const saved = Array.isArray(config['collections']) ? config['collections'] as unknown[] : [];
  const withGenres = draft ? saved : await push.withHubGenreTabs(saved, token, [
    ...(filterState.hideAnime ? ['anime'] : []),
    ...filterState.excludeCategories,
  ]);
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
  if (native?.enabled === true && draft) {
    franchisePending = true;
  } else if (native?.enabled === true) {
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
        // TMDB / Trakt: Nuvio loads these itself, the preview cannot.
        if (source['provider'] === 'tmdb' || source['provider'] === 'trakt') {
          const name = text(source['title'], 120) || text(folder['title'], 120);
          return {
            catalogId: '',
            type: source['mediaType'] === 'TV' ? 'series' : 'movie',
            genre: '',
            name,
            catalogName: name,
            external: true,
          };
        }
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

// ── Live draft preview ──────────────────────────────────────────────────

const crypto = require('crypto') as typeof import('crypto');

// A fixed, never-issued setup id for drafts (version 4 shape, all zeros).
const DRAFT_UUID = '00000000-0000-4000-8000-000000000000';
// What a filled-in key becomes inside the draft: never a real value. Any
// output string that contains it is dropped like any other secret.
const KEY_PLACEHOLDER = 'lelibrary-preview-placeholder';
// Key names whose presence changes the rows a setup declares. Only these
// names are accepted, and only as names.
const DRAFT_KEY_SERVICES = new Set([
  'torboxApiKey', 'rdApiKey', 'adApiKey', 'pmApiKey',
  'tmdbApiKey', 'tvdbApiKey', 'omdbKey', 'mdblistKey',
  'erdbToken', 'rpdbKey', 'fanartKey', 'postersPlusUrl',
  // Connected list services (keys.watchlist.*): their personal rows are
  // declared, then shown as samples until the setup is saved.
  'simkl', 'anilist',
]);
const DRAFT_CONNECTIONS = new Set(['simkl', 'anilist']);
// Fields a draft never carries, at any depth: every key, login and link
// that can hold someone's credentials (other addons' links included), plus
// poster/badge links and custom stream links the preview has no use for.
const SECRET_FIELDS = new Set([
  ...DRAFT_KEY_SERVICES, 'customAddon1', 'customAddon2', 'customAddon3',
  'webdavUrl', 'webdavUser', 'webdavPassword',
  'keys', 'push', 'watchlist', 'connection', 'pushConn', 'password', 'installToken', 'editToken',
  'customPosterTemplate', 'nuvioBadgeUrl', 'customStreams', 'externalSources',
  'addonUrl', 'manifestUrl', 'transportUrl',
]);
const SECRET_NAME = /api_?key|token|secret|passw|auth|session|cookie|credential|refresh/i;
// A link carrying a login or a key-like query parameter.
const SECRET_LINK = /^[a-z][a-z0-9+.-]*:\/\/[^/?#\s]*@|[?&](?:api_?key|key|token|auth|secret|password)=/i;
const DRAFT_MAX_DEPTH = 12;
const DRAFT_MAX_ITEMS = 500;
const DRAFT_MAX_STRING = 2048;
const DRAFT_ROW_CAP = 60;

// The draft's config with every secret removed (and sizes capped). Pure.
function draftConfig(value: unknown): Row {
  const walk = (input: unknown, depth: number): unknown => {
    if (depth > DRAFT_MAX_DEPTH) return undefined;
    if (typeof input === 'string') {
      if (input.length > DRAFT_MAX_STRING || SECRET_LINK.test(input)) return undefined;
      return input;
    }
    if (typeof input === 'number') return Number.isFinite(input) ? input : undefined;
    if (typeof input === 'boolean' || input === null) return input;
    if (Array.isArray(input)) {
      return input.slice(0, DRAFT_MAX_ITEMS).map((child) => walk(child, depth + 1)).filter((child) => child !== undefined);
    }
    if (!input || typeof input !== 'object') return undefined;
    const out: Row = {};
    for (const [key, child] of Object.entries(input as Row).slice(0, DRAFT_MAX_ITEMS)) {
      if (key.startsWith('__') || SECRET_FIELDS.has(key) || SECRET_NAME.test(key)) continue;
      const kept = walk(child, depth + 1);
      if (kept !== undefined) out[key] = kept;
    }
    return out;
  };
  const out = walk(value, 0);
  return out && typeof out === 'object' && !Array.isArray(out) ? out as Row : {};
}

// The allowlisted key names from a draft's list; anything else is ignored.
function draftKeyServices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((name): name is string => typeof name === 'string' && DRAFT_KEY_SERVICES.has(name)))];
}

async function buildDraftPreview({ tier, platform, config, keyServices, origin }: DraftPreviewInput, deps: PreviewDeps = {}): Promise<SetupPreview> {
  const { normaliseSetupConfigCollections } = require('./collections.ts') as { normaliseSetupConfigCollections: <T>(config: T) => T };
  const names = draftKeyServices(keyServices);
  const keys: Row = Object.fromEntries(names.filter((name) => !DRAFT_CONNECTIONS.has(name)).map((name) => [name, KEY_PLACEHOLDER]));
  const connected = names.filter((name) => DRAFT_CONNECTIONS.has(name));
  if (connected.length) keys['watchlist'] = Object.fromEntries(connected.map((name) => [name, { access_token: KEY_PLACEHOLDER }]));
  const opened: OpenedConfig = {
    uuid: DRAFT_UUID,
    tier: tier as OpenedConfig['tier'],
    name: null,
    // Normalised exactly like a create.
    config: normaliseSetupConfigCollections(draftConfig(config)),
    keys,
    hasPassword: false,
    // A throwaway per request: it only names the draft inside the builder
    // and is scrubbed from the output like a real install secret.
    secret: crypto.randomBytes(18).toString('hex'),
    createdAt: null,
    updatedAt: null,
  };
  return buildPreview({ opened, platform, origin }, deps, true);
}

// Which kind of row one draft catalogue is. Library rows (the debrid
// library and everything built from it) can only be shown once the setup
// exists; LeLibrary's own catalogue definitions and the Trending/Popular
// rows can be built now; anything else is not ours.
function classifyDraftCatalog(type: string, catalogId: string): DraftCatalogKind {
  const providers = require('../providers/index.ts') as { PROVIDER_META: Record<string, { cat: string }> };
  const cats = Object.values(providers.PROVIDER_META).map((meta) => meta.cat).join('|');
  if (new RegExp(`^(?:${cats})-(?:movies|series|anime)(?:-(?:4k|hdr|genres|g-[a-z0-9-]+))?$`).test(catalogId)) return { kind: 'library' };
  // Personal lists (and the old watchlist ids) need the setup's own
  // connection or key: never read for a draft.
  const personal = catalogId.match(/^(?:lelibrary-user-(simkl|mdblist|anilist)-[a-z.0-9]+|torbox-watchlist-([a-z]+))-(?:movie|series)$/);
  if (personal) {
    const service = personal[1] || personal[2] || '';
    if (service === 'simkl' || service === 'mdblist' || service === 'anilist' || service === 'trakt') return { kind: 'personal', service };
  }
  if (/^(?:torbox-collections|torbox-collection-[A-Za-z0-9_-]+|collection-\d+|torbox-watchlist-[a-z]+-(?:movie|series)|lelibrary-import-(?:movie|series)(?:,imp_[a-f0-9]{64})?|lelibrary-search-[a-z-]+)$/.test(catalogId)) {
    return { kind: 'library' };
  }
  const discovery = catalogId.match(/^torbox-(trending|popular)-(movies|series)$/);
  if (discovery) return { kind: 'discovery', list: discovery[1] as 'trending' | 'popular', apiType: discovery[2] === 'movies' ? 'movie' : 'tv' };
  const curated = catalogId.match(/^lelibrary-curated-(movie|series)(?:,(lib-[a-z0-9_]+))?$/);
  if (curated) return { kind: 'curated', type: curated[1] as 'movie' | 'series', source: curated[2] || '' };
  if (catalogId.startsWith('lib-')) {
    const { getSourceDefinition, canonicalSourceId } = require('../catalog/catalog-source-registry.ts');
    const def = getSourceDefinition(canonicalSourceId(catalogId.slice(4)));
    if (def && (def.type === 'movie' ? 'movie' : 'series') === (type === 'movie' ? 'movie' : 'series')) return { kind: 'lib', libId: catalogId.slice(4) };
  }
  return { kind: 'unknown' };
}

function draftLang(config: Row): string {
  const lang = typeof config['lang'] === 'string' ? config['lang'] : '';
  return /^[a-z]{2}(?:-[A-Z]{2})?$/.test(lang) ? lang : 'en-US';
}

// Display fields only, items with a poster, capped.
function draftMetas(rows: unknown): DraftMeta[] {
  const out: DraftMeta[] = [];
  for (const raw of Array.isArray(rows) ? rows as Row[] : []) {
    if (out.length >= DRAFT_ROW_CAP) break;
    if (!raw || typeof raw !== 'object') continue;
    const poster = artLink(raw['poster']);
    const id = text(raw['id'], 120);
    if (!poster || !id) continue;
    const genres = Array.isArray(raw['genres']) ? (raw['genres'] as unknown[]).filter((g): g is string => typeof g === 'string').slice(0, 4) : [];
    const background = artLink(raw['background']);
    const logo = artLink(raw['logo']);
    const releaseInfo = text(raw['releaseInfo'], 20);
    const description = text(raw['description'], 600);
    out.push({
      id, type: text(raw['type'], 20), name: text(raw['name'], 200), poster,
      ...(background ? { background } : {}),
      ...(logo ? { logo } : {}),
      ...(releaseInfo ? { releaseInfo } : {}),
      ...(genres.length ? { genres } : {}),
      ...(description ? { description } : {}),
    });
  }
  return out;
}

// The curated folder source's own catalogue id (lib-<id> or a folder label
// in the genre extra), resolved exactly like the addon's catalogue route.
function curatedLibId(type: 'movie' | 'series', raw: string, config: Row): string {
  if (raw.startsWith('lib-')) return raw.slice(4);
  const label = raw.trim();
  if (!label) return '';
  const { resolveCuratedSourceLabel, curatedSourceIds, curatedSourceDisplayName } = require('../catalog/curated-collections.ts');
  const canonical = resolveCuratedSourceLabel(label, type);
  if (canonical) return canonical;
  const { catalogs } = require('../catalog/catalogdefs.ts');
  const packs = Array.isArray(config['nuvioCollectionPacks']) ? config['nuvioCollectionPacks'] : [];
  return (curatedSourceIds(packs) as string[]).find((id) => (
    (catalogs[id]?.type === 'movie' ? 'movie' : 'series') === type
    && curatedSourceDisplayName(`lib-${id}`, catalogs[id]?.type) === label
  )) || '';
}

// What a draft personal row says instead of titles.
const PERSONAL_LABEL: Record<string, string> = {
  simkl: 'Your Simkl rows show here once the setup is saved',
  mdblist: 'Your MDBList rows show here once the setup is saved',
  anilist: 'Your AniList rows show here once the setup is saved',
  trakt: 'Your list shows here once the setup is saved',
};

async function buildDraftCatalog(input: DraftCatalogInput, deps: DraftCatalogDeps = {}): Promise<DraftCatalogResult> {
  const { type, catalogId } = input;
  const genre = input.genre === undefined || input.genre === null ? '' : input.genre;
  if (type !== 'movie' && type !== 'series') return { status: 400, body: { error: 'Unknown type' } };
  if (typeof catalogId !== 'string' || !catalogId || catalogId.length > 200 || !/^[A-Za-z0-9_.,:-]+$/.test(catalogId)) {
    return { status: 400, body: { error: 'Unknown catalogue' } };
  }
  if (typeof genre !== 'string' || genre.length > 160) return { status: 400, body: { error: 'Unknown genre' } };
  const kind = classifyDraftCatalog(type, catalogId);
  if (kind.kind === 'unknown') return { status: 400, body: { error: 'Unknown catalogue' } };
  if (kind.kind === 'library') return { status: 200, body: { sample: true, reason: 'library' } };
  if (kind.kind === 'personal') {
    return { status: 200, body: { sample: true, reason: 'personal', service: kind.service, label: PERSONAL_LABEL[kind.service] || PERSONAL_LABEL['trakt'] as string } };
  }

  const config = draftConfig(input.config);
  const lang = draftLang(config);
  const contentFilters = require('../catalog/content-filters.ts');
  const filterState = contentFilters.normalizeContentFilters(config);
  const hideAnime = filterState.hideAnime;
  const { getSourceDefinition, canonicalSourceId } = require('../catalog/catalog-source-registry.ts');
  let libId = '';
  if (kind.kind === 'lib') libId = kind.libId;
  if (kind.kind === 'curated') {
    libId = curatedLibId(kind.type, kind.source || genre, config);
    const def = libId ? getSourceDefinition(libId) : null;
    if (!def || (def.type === 'movie' ? 'movie' : 'series') !== kind.type) return { status: 200, body: { metas: [] } };
  }
  if (libId) {
    const def = getSourceDefinition(canonicalSourceId(libId));
    // Private MDBList lists need the person's own MDBList key.
    if (def?.handler === 'mdb_list' && def.params?.listId) return { status: 200, body: { sample: true, reason: 'key' } };
  }

  const key = (deps.serverKey || (() => (require('../catalog/own-art.ts') as { liveArtKey: () => string }).liveArtKey()))();
  if (!key) return { status: 200, body: { sample: true, reason: 'unavailable' } };
  // Plain TMDB posters (no enhance, empty poster fingerprint), first page,
  // no user key of any kind: the rows land in the shared catalogue caches
  // (cat:lib8-base per definition, cat:discovery4 per list and language).
  let rows: unknown[] = [];
  try {
    if (kind.kind === 'discovery') {
      const discovery = deps.discovery
        || (require('../catalog/discovery.ts') as { buildDiscoveryCatalog: (i: Record<string, unknown>) => Promise<unknown[]> }).buildDiscoveryCatalog;
      rows = await discovery({ tmdbApiKey: key, kind: kind.list, apiType: kind.apiType, lang, userKey: '', skip: 0, search: '', enhance: {}, posterFp: '', hideAnime, filters: filterState });
    } else {
      const library = deps.library
        || (require('../catalog/libcatalog.ts') as { buildLibraryCatalog: (i: Record<string, unknown>) => Promise<unknown[]> }).buildLibraryCatalog;
      rows = await library({ tmdbApiKey: key, catalogId: libId, lang, userKey: '', skip: 0, search: '', enhance: {}, posterFp: '', mdblistKey: '', hideAnime, filters: filterState });
    }
  } catch {
    rows = [];
  }
  return { status: 200, body: { metas: draftMetas(rows) } };
}

module.exports = {
  buildSetupPreview, buildDraftPreview, buildDraftCatalog, classifyDraftCatalog, draftConfig, draftKeyServices,
  secretsOf, scrubPreview, DRAFT_ROW_CAP,
} satisfies PreviewApi;
