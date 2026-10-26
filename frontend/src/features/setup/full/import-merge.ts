import { applySavedConfig } from '@/features/setup/shared/saved-config';
import type { FormattingDraft } from '@/features/setup/shared/FormattingSection';
import type { PostersDraft } from '@/features/setup/shared/PostersSection';
import type { MetadataExtrasDraft } from '@/features/setup/full/MetadataExtras';
import type { FilterSetsDraft } from '@/features/setup/full/FilterSets';
import type { CollectionDoc, HomeRowDoc } from '@/features/setup/shared/collection-doc';
import type { PlatformConnection } from '@/features/setup/full/platform-login';
import type { SetupKeysDraft } from '@/features/setup/shared/config-contract';
import type { OldSetupData } from '@/features/setup/resolver/api';
import { DEFAULT_NOTICE_TYPES } from '@/features/setup/full/MetadataExtras';
import { cleanTorboxSources } from '@/features/setup/shared/config-contract';

// Everything the import modal folds into the page draft the moment you pick
// a setup: keys stay server-side until creation, collections/home rows ride
// the migration itself (shape risk if mapped by hand), and the overlay at
// creation only ever sends pruned non-defaults, so untouched areas keep the
// migrated values.
export interface ImportMerge {
  name: string | null;
  platform: 'nuvio' | 'stremio' | null;
  rdCatalog: string | null;
  posters: PostersDraft;
  formatting: FormattingDraft;
  badgePack: string;
  customBadgeUrl: string;
  meta: Partial<MetadataExtrasDraft>;
  filterSets: Partial<FilterSetsDraft>;
  addons: string[];
  collections: CollectionDoc[];
  packs: string[];
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((entry): entry is string => typeof entry === 'string');
  return out;
}

export function mergeImportPreview(input: { config: Record<string, unknown>; sourceLabel: string | null }): ImportMerge {
  const preview = input;
  const cfg = preview.config ?? {};
  const drafts = applySavedConfig(cfg);

  const str = (value: unknown): string | null =>
    typeof value === 'string' && value ? value : null;

  const meta: Partial<MetadataExtrasDraft> = {};
  const lang = str(cfg.lang);
  if (lang) meta.lang = lang;
  const sortBy = str(cfg.sortBy);
  if (sortBy) meta.sortBy = sortBy;
  if (typeof cfg.libraryIdMode === 'string') meta.mainMetadata = cfg.libraryIdMode === 'tt';
  if (typeof cfg.hideAnime === 'boolean') meta.hideAnime = cfg.hideAnime;
  if (Array.isArray(cfg.torboxSources)) meta.torboxSources = cleanTorboxSources(cfg.torboxSources);
  const searchScope = str(cfg.searchScope);
  if (searchScope) meta.searchScope = searchScope;
  if (cfg.streamNotices === 'off') meta.notices = false;
  const noticeTypes = stringArray(cfg.streamNoticeTypes);
  if (noticeTypes) meta.noticeTypes = noticeTypes;

  const filterSets: Partial<FilterSetsDraft> = {};
  const resolutions = stringArray(cfg.filterResolutions);
  if (resolutions) filterSets.resolutions = resolutions;
  const resolutionOrder = stringArray(cfg.filterResOrder);
  if (resolutionOrder) filterSets.resolutionOrder = resolutionOrder;
  const qualities = stringArray(cfg.filterQualities);
  if (qualities) filterSets.qualities = qualities;
  const sources = stringArray(cfg.filterSources);
  if (sources) filterSets.sources = sources;
  if (typeof cfg.filterMinSize === 'number' && cfg.filterMinSize > 0) {
    filterSets.minSizeGb = String(cfg.filterMinSize);
  }
  if (typeof cfg.filterMaxSize === 'number' && cfg.filterMaxSize > 0) {
    filterSets.maxSizeGb = String(cfg.filterMaxSize);
  }
  if (cfg.filterCachedOnly === true) filterSets.cachedOnly = true;

  const rawCollections = Array.isArray(cfg.collections) ? cfg.collections : [];
  const collections = (rawCollections as unknown[]).filter(
    (entry): entry is CollectionDoc =>
      !!entry && typeof entry === 'object' &&
      typeof (entry as { id?: unknown }).id === 'string' &&
      Array.isArray((entry as { folders?: unknown }).folders),
  );

  return {
    name: preview.sourceLabel,
    platform: cfg.wizardPlatform === 'nuvio' || cfg.wizardPlatform === 'stremio' ? cfg.wizardPlatform : null,
    rdCatalog: cfg.rdCatalog === 'merge' || cfg.rdCatalog === 'separate' ? cfg.rdCatalog : null,
    posters: drafts.posters,
    formatting: drafts.formatting,
    badgePack: drafts.badgePack.pack,
    customBadgeUrl: drafts.badgePack.url,
    meta,
    filterSets,
    addons: stringArray(cfg.streamAddons) ?? [],
    collections,
    packs: stringArray(cfg.nuvioCollectionPacks) ?? [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isCollectionDoc(value: unknown): value is CollectionDoc {
  return isRecord(value)
    && typeof value.id === 'string'
    && Array.isArray(value.folders);
}

function isHomeRowDoc(value: unknown): value is HomeRowDoc {
  if (!isRecord(value) || typeof value.id !== 'string') return false;
  const source = value.source;
  return isRecord(source)
    && typeof source.id === 'string'
    && (source.type === 'movie' || source.type === 'series');
}

// Collection + home-row documents straight from a pre-v5.5 setup. The shapes
// match collection-doc.ts, but anything malformed is dropped rather than
// breaking the studio.
export function cleanImportedDocs(data: OldSetupData): { collections: CollectionDoc[]; homeRows: HomeRowDoc[] } {
  const collections = (Array.isArray(data.collections) ? data.collections : []).filter(isCollectionDoc);
  const homeRows = (Array.isArray(data.homeRows) ? data.homeRows : []).filter(isHomeRowDoc);
  return { collections, homeRows };
}

// Key values straight into the draft: every string-valued service fills its
// input (eye-masked like typed input), so verify and previews run at once.
const KEY_FIELDS = [
  'torboxApiKey', 'rdApiKey', 'adApiKey', 'pmApiKey', 'mdblistKey',
  'tmdbApiKey', 'tvdbApiKey', 'erdbToken', 'rpdbKey', 'omdbKey', 'fanartKey',
] as const;

export function importedKeys(data: OldSetupData): SetupKeysDraft {
  const out: SetupKeysDraft = {};
  const record = isRecord(data.keys) ? data.keys : {};
  const writable = out as Record<string, string | undefined>;
  for (const field of KEY_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value.trim()) writable[field] = value;
  }
  return out;
}

function firstString(record: Record<string, unknown>, fields: string[]): string {
  // Mirrors the old account reader: tokens also live one level down
  // (session.access_token, nuvio.accessToken, ...).
  const nestedKeys = ['session', 'nuvio', 'nuvioAuth', 'nuvioSession', 'tokens', 'auth'];
  const scopes = [record];
  for (const key of nestedKeys) {
    const nested = record[key];
    if (isRecord(nested)) scopes.push(nested);
  }
  for (const scope of scopes) {
    for (const field of fields) {
      const value = scope[field];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return '';
}

// Restores a saved platform login into the draft connection, so Nuvio /
// Stremio show connected without signing in again. Returns null when the old
// account holds no usable connection for that platform.
export function importPushConn(data: OldSetupData, platform: 'nuvio' | 'stremio'): PlatformConnection | null {
  const bag = isRecord(data.keys) ? data.keys : {};
  const push = isRecord(bag.push) ? (bag.push as Record<string, unknown>) : {};
  const raw = push[platform];
  if (!isRecord(raw)) return null;
  if (platform === 'nuvio') {
    const token = firstString(raw, ['nuvioToken', 'access_token', 'accessToken', 'token']);
    if (!token) return null;
    const conn: PlatformConnection = { platform, nuvioToken: token };
    const refresh = firstString(raw, ['nuvioRefresh', 'refresh_token', 'refreshToken', 'refresh']);
    if (refresh) conn.nuvioRefresh = refresh;
    if (isRecord(raw.nuvioUser) || typeof raw.nuvioUser === 'string') conn.nuvioUser = raw.nuvioUser;
    if (Array.isArray(raw.nuvioProfiles)) {
      const profiles = raw.nuvioProfiles
        .filter(isRecord)
        .map((profile) => ({
          profile_index: Math.trunc(Number(profile.profile_index ?? profile.id ?? profile.profileId)),
          name: String(profile.name ?? profile.profile_name ?? '').trim().slice(0, 120) || 'Profile',
          uses_primary_addons: !!(profile.uses_primary_addons ?? profile.usesPrimaryAddons),
        }))
        .filter((profile) => Number.isFinite(profile.profile_index) && profile.profile_index >= 1);
      if (profiles.length > 0) conn.nuvioProfiles = profiles;
    }
    const selected = Number(raw.nuvioSelectedProfile);
    if (Number.isFinite(selected) && selected >= 1) conn.nuvioSelectedProfile = selected;
    return conn;
  }
  const auth = firstString(raw, ['stremioAuth', 'access_token', 'accessToken', 'token']);
  if (!auth) return null;
  const conn: PlatformConnection = { platform, stremioAuth: auth };
  if (isRecord(raw.stremioUser) || typeof raw.stremioUser === 'string') conn.stremioUser = raw.stremioUser;
  return conn;
}

// Merges picker payload documents into existing studio state without
// duplicating what is already there. Returns nulls when the payload carries
// nothing, so callers skip the state update entirely.
export function mergeImportDocs(
  prevCollections: CollectionDoc[],
  prevHomeRows: HomeRowDoc[],
  payload: { collections: CollectionDoc[]; homeRows: HomeRowDoc[] },
): { collections: CollectionDoc[] | null; homeRows: HomeRowDoc[] | null } {
  let collections: CollectionDoc[] | null = null;
  let homeRows: HomeRowDoc[] | null = null;
  if (payload.collections.length > 0) {
    const known = new Set(prevCollections.map((collection) => collection.id));
    const fresh = payload.collections.filter((collection) => !known.has(collection.id));
    if (fresh.length > 0) collections = [...prevCollections, ...fresh];
    else if (prevCollections.length === 0) collections = [...payload.collections];
  }
  if (payload.homeRows.length > 0) {
    const known = new Set(prevHomeRows.map((row) => row.id));
    const fresh = payload.homeRows.filter((row) => !known.has(row.id));
    if (prevHomeRows.length === 0) homeRows = [...payload.homeRows];
    else if (fresh.length > 0) homeRows = [...prevHomeRows, ...fresh];
  }
  return { collections, homeRows };
}
