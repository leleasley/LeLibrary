import { apiClient } from '@/api/client';

// Library page API (/api/setup/:uuid/library/*). Every call carries the bearer
// edit token from unlock; the server only ever returns display fields for the
// setup's own library, never provider ids, hashes or links.

export type LibraryView = 'attention' | 'matched' | 'ignored';
export type FixMediaType = 'movie' | 'series' | 'anime';

export interface LibrarySummary {
  files: number;
  matched: number;
  attention: number;
  ignored: number;
  pending: number;
  films: number;
  shows: number;
  providers: { provider: string; files: number; matched: number; attention: number }[];
  lastSyncAt: string | null;
  lastStatus: string | null;
  hasPassword: boolean;
  canFix: boolean;
}

export interface LibraryItem {
  id: number;
  provider: string;
  kind: string | null;
  name: string;
  size: number | null;
  mediaType: string | null;
  season: number | null;
  episode: number | null;
  seasonStart: number | null;
  seasonEnd: number | null;
  status: string;
  reason: string | null;
  title: string | null;
  year: string | null;
  poster: string | null;
  tmdbId: number | null;
  fixed: boolean;
  guess: string | null;
  guessYear: number | null;
  inner: string | null;
  innerCount: number;
}

export interface TmdbChoice {
  tmdbId: number;
  type: 'movie' | 'tv';
  title: string;
  originalTitle: string | null;
  year: string | null;
  poster: string | null;
  overview: string;
  anime: boolean;
}

function auth(editToken: string): { headers: Record<string, string> } {
  return { headers: { Authorization: `Bearer ${editToken}` } };
}

function base(uuid: string): string {
  return `/api/setup/${encodeURIComponent(uuid)}/library`;
}

export function fetchLibrarySummary(uuid: string, editToken: string): Promise<LibrarySummary> {
  return apiClient.get<LibrarySummary>(base(uuid), auth(editToken));
}

export function fetchLibraryItems(uuid: string, editToken: string, params: { view: LibraryView; q?: string; offset?: number }): Promise<{ total: number; items: LibraryItem[] }> {
  const query = new URLSearchParams({ view: params.view });
  if (params.q) query.set('q', params.q);
  if (params.offset) query.set('offset', String(params.offset));
  return apiClient.get<{ total: number; items: LibraryItem[] }>(`${base(uuid)}/items?${query}`, auth(editToken));
}

export function searchTmdb(uuid: string, editToken: string, params: { q: string; type: 'movie' | 'tv' }): Promise<{ results: TmdbChoice[] }> {
  const query = new URLSearchParams({ q: params.q, type: params.type });
  return apiClient.get<{ results: TmdbChoice[] }>(`${base(uuid)}/search?${query}`, auth(editToken));
}

export function fixItem(uuid: string, editToken: string, id: number, body: { tmdbId: number; mediaType: FixMediaType; season: number | null; episode: number | null }): Promise<{ ok: boolean }> {
  return apiClient.post<{ ok: boolean }>(`${base(uuid)}/items/${id}/fix`, body, auth(editToken));
}

export function ignoreItem(uuid: string, editToken: string, id: number): Promise<{ ok: boolean }> {
  return apiClient.post<{ ok: boolean }>(`${base(uuid)}/items/${id}/ignore`, {}, auth(editToken));
}

export function undoFix(uuid: string, editToken: string, id: number): Promise<{ ok: boolean }> {
  return apiClient.delete<{ ok: boolean }>(`${base(uuid)}/items/${id}/fix`, undefined, auth(editToken));
}

export function retryMatching(uuid: string, editToken: string): Promise<{ ok: boolean; requeued: number }> {
  return apiClient.post<{ ok: boolean; requeued: number }>(`${base(uuid)}/retry`, {}, auth(editToken));
}

// Hash-only names make a useless search box: start empty instead.
export function searchSeed(item: Pick<LibraryItem, 'guess' | 'title'>): string {
  const guess = (item.guess || '').trim();
  if (!guess || /^[a-f0-9]{32,}$/i.test(guess.replace(/\s+/g, ''))) return item.title || '';
  return guess;
}

export function episodeLabel(item: Pick<LibraryItem, 'season' | 'episode' | 'seasonStart' | 'seasonEnd'>): string | null {
  const pad = (n: number) => String(n).padStart(2, '0');
  if (item.seasonStart != null && item.seasonEnd != null && item.seasonEnd > item.seasonStart) return `S${pad(item.seasonStart)}-S${pad(item.seasonEnd)}`;
  if (item.season != null && item.episode != null) return `S${pad(item.season)}E${pad(item.episode)}`;
  if (item.season != null) return `S${pad(item.season)}`;
  return null;
}

export function formatSize(bytes: number | null, language: string): string | null {
  if (!bytes || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: value >= 100 ? 0 : 1 }).format(value)} ${units[unit]}`;
}
