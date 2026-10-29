import { apiClient } from '@/api/client';

// Nuvio manager API (/api/setup/:uuid/nuvio/*), built to
// Docs/plans/5.8-nuvio-api-contract.md. Every call carries the bearer edit
// token from unlock. The server works with the setup's sealed Nuvio
// connection and only ever returns display fields: never tokens, PIN hashes
// or other addons' links. An addon link is sent once (add) and never comes back.

export interface NuvioProfile {
  index: number;
  name: string;
  color: string;
  avatarUrl: string | null;
  usesPrimaryAddons: boolean;
  pinEnabled: boolean;
  isPrimary: boolean;
}

export interface NuvioAddon {
  id: string;
  name: string;
  host: string;
  enabled: boolean;
  order: number;
  isLeLibrary: boolean;
  // From the addon's manifest; absent or empty when it could not be read.
  logo?: string | null;
  description?: string;
  version?: string;
  types?: string[];
  catalogs?: number;
  configurable?: boolean;
  kind?: 'this-setup' | 'lelibrary' | 'other';
}

export interface NuvioCollection {
  id: string;
  title: string;
  folders: number;
  isLeLibrary: boolean;
  hidden: boolean;
}

export interface NuvioHomeItem {
  key: string;
  title: string;
  type: string;
  catalogId: string;
  addonId: string;
  isCollection: boolean;
  enabled: boolean;
  order: number;
}

export interface NuvioHome {
  items: NuvioHomeItem[];
  hideUnreleased: boolean | null;
}

export type SettingId =
  | 'autoPlayMode'
  | 'autoPlayRegex'
  | 'autoPlaySource'
  | 'autoPlayTimeout'
  | 'nextEpisode'
  | 'preloadNextEpisode'
  | 'nextEpisodeThresholdMode'
  | 'nextEpisodeThresholdPercent'
  | 'nextEpisodeThresholdMinutes'
  | 'stillWatching'
  | 'stillWatchingEpisodes'
  | 'skipSegments'
  | 'audioLanguage'
  | 'audioLanguage2'
  | 'subtitleLanguage'
  | 'subtitleLanguage2'
  | 'forcedSubtitles'
  | 'hideUnreleased';

export type SettingValues = Partial<Record<SettingId, unknown>>;

export interface NuvioSettings {
  values: SettingValues;
  platforms: { tv: boolean; mobile: boolean };
}

export type NuvioPart = 'settings' | 'addons' | 'collections' | 'home';
export const NUVIO_PARTS: readonly NuvioPart[] = ['settings', 'addons', 'collections', 'home'];

export interface NuvioBackup {
  id: string;
  profileIndex: number;
  createdAt: string;
  reason: string;
  parts: string[];
}

export interface NuvioOverview {
  user: string;
  profiles: NuvioProfile[];
  selected: number | null;
  maxProfiles: number;
}

export interface NuvioProfileDetail {
  profile: NuvioProfile;
  addons: NuvioAddon[];
  addonsFrom: number;
  collections: NuvioCollection[];
  home: NuvioHome;
  settings: NuvioSettings;
  readAt: string;
}

export type NuvioErrorCode =
  | 'nuvio-not-connected'
  | 'nuvio-session-expired'
  | 'nuvio-conflict'
  | 'not-found'
  | 'invalid'
  | 'profile-limit'
  | 'profile-protected'
  | 'nuvio-error';

function auth(editToken: string): { headers: Record<string, string> } {
  return { headers: { Authorization: `Bearer ${editToken}` } };
}

function base(uuid: string): string {
  return `/api/setup/${encodeURIComponent(uuid)}/nuvio`;
}

function profilePath(uuid: string, index: number): string {
  return `${base(uuid)}/profiles/${encodeURIComponent(String(index))}`;
}

export function fetchNuvioOverview(uuid: string, editToken: string): Promise<NuvioOverview> {
  return apiClient.get<NuvioOverview>(base(uuid), auth(editToken));
}

export function fetchNuvioProfile(uuid: string, editToken: string, index: number): Promise<NuvioProfileDetail> {
  return apiClient.get<NuvioProfileDetail>(profilePath(uuid, index), auth(editToken));
}

export function createNuvioProfile(
  uuid: string,
  editToken: string,
  body: { name: string; color?: string; copyFrom?: { index: number; parts: NuvioPart[] } },
): Promise<{ profile: NuvioProfile }> {
  return apiClient.post<{ profile: NuvioProfile }>(`${base(uuid)}/profiles`, body, auth(editToken));
}

export function updateNuvioProfile(
  uuid: string,
  editToken: string,
  index: number,
  body: { name?: string; color?: string; usesPrimaryAddons?: boolean },
): Promise<{ profile: NuvioProfile }> {
  return apiClient.patch<{ profile: NuvioProfile }>(profilePath(uuid, index), body, auth(editToken));
}

export function deleteNuvioProfile(uuid: string, editToken: string, index: number, confirmName: string): Promise<{ ok: true }> {
  return apiClient.delete<{ ok: true }>(profilePath(uuid, index), { confirmName }, auth(editToken));
}

export function copyNuvioProfile(
  uuid: string,
  editToken: string,
  index: number,
  body: { target: number; parts: NuvioPart[] },
): Promise<{ ok: true; copied: NuvioPart[] }> {
  return apiClient.post<{ ok: true; copied: NuvioPart[] }>(`${profilePath(uuid, index)}/copy`, body, auth(editToken));
}

export function saveNuvioSettings(uuid: string, editToken: string, index: number, values: SettingValues): Promise<{ settings: NuvioSettings }> {
  return apiClient.patch<{ settings: NuvioSettings }>(`${profilePath(uuid, index)}/settings`, { values }, auth(editToken));
}

export function addNuvioAddon(uuid: string, editToken: string, index: number, url: string): Promise<{ addon: NuvioAddon }> {
  return apiClient.post<{ addon: NuvioAddon }>(`${profilePath(uuid, index)}/addons`, { url }, auth(editToken));
}

export function updateNuvioAddon(
  uuid: string,
  editToken: string,
  index: number,
  id: string,
  body: { enabled?: boolean; name?: string },
): Promise<{ addon: NuvioAddon }> {
  return apiClient.patch<{ addon: NuvioAddon }>(`${profilePath(uuid, index)}/addons/${encodeURIComponent(id)}`, body, auth(editToken));
}

export function orderNuvioAddons(uuid: string, editToken: string, index: number, ids: string[]): Promise<{ addons: NuvioAddon[] }> {
  return apiClient.put<{ addons: NuvioAddon[] }>(`${profilePath(uuid, index)}/addons/order`, { ids }, auth(editToken));
}

// The addon's settings page, asked for on click only: the link can carry the
// addon's own keys, so it is never part of the profile listing.
export function nuvioAddonConfigureLink(uuid: string, editToken: string, index: number, id: string): Promise<{ url: string }> {
  return apiClient.post<{ url: string }>(`${profilePath(uuid, index)}/addons/${encodeURIComponent(id)}/configure`, {}, auth(editToken));
}

export function removeNuvioAddon(uuid: string, editToken: string, index: number, id: string): Promise<{ ok: true }> {
  return apiClient.delete<{ ok: true }>(`${profilePath(uuid, index)}/addons/${encodeURIComponent(id)}`, undefined, auth(editToken));
}

export function setNuvioCollectionHidden(
  uuid: string,
  editToken: string,
  index: number,
  id: string,
  hidden: boolean,
): Promise<{ collections: NuvioCollection[] }> {
  return apiClient.patch<{ collections: NuvioCollection[] }>(
    `${profilePath(uuid, index)}/collections/${encodeURIComponent(id)}`, { hidden }, auth(editToken),
  );
}

export function orderNuvioCollections(uuid: string, editToken: string, index: number, ids: string[]): Promise<{ collections: NuvioCollection[] }> {
  return apiClient.put<{ collections: NuvioCollection[] }>(`${profilePath(uuid, index)}/collections/order`, { ids }, auth(editToken));
}

export function deleteNuvioCollection(uuid: string, editToken: string, index: number, id: string): Promise<{ collections: NuvioCollection[] }> {
  return apiClient.delete<{ collections: NuvioCollection[] }>(
    `${profilePath(uuid, index)}/collections/${encodeURIComponent(id)}`, undefined, auth(editToken),
  );
}

export function saveNuvioHome(
  uuid: string,
  editToken: string,
  index: number,
  items: { key: string; enabled: boolean }[],
): Promise<{ home: NuvioHome }> {
  return apiClient.put<{ home: NuvioHome }>(`${profilePath(uuid, index)}/home`, { items }, auth(editToken));
}

export function fetchNuvioBackups(uuid: string, editToken: string, profile: number): Promise<{ backups: NuvioBackup[] }> {
  return apiClient.get<{ backups: NuvioBackup[] }>(`${base(uuid)}/backups?profile=${encodeURIComponent(String(profile))}`, auth(editToken));
}

export function createNuvioBackup(uuid: string, editToken: string, index: number): Promise<{ backup: NuvioBackup }> {
  return apiClient.post<{ backup: NuvioBackup }>(`${profilePath(uuid, index)}/backups`, undefined, auth(editToken));
}

export function restoreNuvioBackup(uuid: string, editToken: string, id: string, target?: number): Promise<{ ok: true; restored: NuvioPart[] }> {
  return apiClient.post<{ ok: true; restored: NuvioPart[] }>(
    `${base(uuid)}/backups/${encodeURIComponent(id)}/restore`, target == null ? {} : { target }, auth(editToken),
  );
}

export function undoNuvioChange(uuid: string, editToken: string, index: number): Promise<{ ok: true; restored: NuvioPart[] }> {
  return apiClient.post<{ ok: true; restored: NuvioPart[] }>(`${profilePath(uuid, index)}/undo`, undefined, auth(editToken));
}
