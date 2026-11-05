'use strict';
// Personal list items -> Stremio metas.
//
// Like every discovery row (lib-*, Trending, Popular), these rows carry plain
// `tt` IMDb ids, so other stream addons answer them, Nuvio enriches them and
// the owned-copy bridge finds the user's own files. An item with only a TMDB
// id gets its IMDb id from TMDB (batched, cached); one with neither is left
// out, never guessed. `libraryIdMode` does not apply: it only rewrites
// library (torbox:) rows. Posters follow the setup's poster style.

export interface ListItem {
  type: 'movie' | 'series';
  title: string;
  imdb?: string | null;
  tmdb?: number | null;
  year?: number | null;
  // A TMDB poster path ("/abc.jpg") or a full https link.
  poster?: string | null;
  // One short line shown under the title (next episode, air date).
  note?: string | null;
}

export interface MetaDeps {
  imdbIds?: (tmdbApiKey: string, apiType: string, ids: number[]) => Promise<Map<number, string | null>>;
  backfill?: (tmdbApiKey: string, apiType: string, rows: Record<string, unknown>[]) => Promise<unknown>;
  enhance?: (rows: Record<string, unknown>[], enhance: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
}

const TMDB_IMAGE = 'https://image.tmdb.org/t/p';
const IMDB = /^tt\d{5,12}$/;

function cleanImdb(value: unknown): string {
  const id = String(value || '').trim();
  return IMDB.test(id) ? id : '';
}

function cleanTmdb(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function posterLink(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  if (raw.startsWith('/')) return `${TMDB_IMAGE}/w342${raw}`;
  return /^https:\/\/[^\s]+$/.test(raw) ? raw : null;
}

async function itemsToMetas(items: ListItem[], type: 'movie' | 'series', options: {
  tmdbApiKey?: string; enhance?: Record<string, unknown>; skip?: number; limit?: number; search?: string;
} = {}, deps: MetaDeps = {}): Promise<Record<string, unknown>[]> {
  const apiType = type === 'movie' ? 'movie' : 'tv';
  const wanted = (Array.isArray(items) ? items : []).filter((item) => item && item.type === type);
  const tmdbApiKey = String(options.tmdbApiKey || '');
  const needImdb = [...new Set(wanted.filter((item) => !cleanImdb(item.imdb) && cleanTmdb(item.tmdb)).map((item) => cleanTmdb(item.tmdb) as number))];
  let looked = new Map<number, string | null>();
  if (needImdb.length && tmdbApiKey) {
    const imdbIds = deps.imdbIds || require('../media/tmdb.ts').getImdbIds;
    looked = await imdbIds(tmdbApiKey, apiType, needImdb).catch(() => new Map());
  }
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const item of wanted) {
    const tmdbId = cleanTmdb(item.tmdb);
    const imdbId = cleanImdb(item.imdb) || cleanImdb(tmdbId ? looked.get(tmdbId) : '');
    if (!imdbId || seen.has(imdbId)) continue;
    seen.add(imdbId);
    const year = Number(item.year) || 0;
    const note = typeof item.note === 'string' && item.note.trim() ? item.note.trim().slice(0, 200) : '';
    rows.push({
      id: imdbId,
      type,
      name: String(item.title || '').slice(0, 200),
      ...(tmdbId ? { tmdbId } : {}),
      poster: posterLink(item.poster),
      posterShape: 'poster',
      ...(year ? { releaseInfo: String(year), year: String(year) } : {}),
      ...(note ? { description: note } : {}),
    });
  }
  const search = String(options.search || '').trim().toLowerCase();
  const filtered = search ? rows.filter((row) => String(row['name'] || '').toLowerCase().includes(search)) : rows;
  const skip = Math.max(0, Math.floor(Number(options.skip) || 0));
  const page = filtered.slice(skip, skip + Math.max(1, Math.floor(Number(options.limit) || 50)));
  if (!page.length) return page;
  // TMDB posters for items that came without one (memoised, capped), then
  // the setup's own poster style.
  if (tmdbApiKey) {
    const backfill = deps.backfill || require('../catalog/libcatalog.ts').backfillPosters;
    await Promise.resolve(backfill(tmdbApiKey, apiType, page)).catch(() => {});
  }
  const enhance = deps.enhance || require('../catalog/libcatalog.ts').enhanceCatalogRows;
  const out = await Promise.resolve(enhance(page, options.enhance || {})).catch(() => page);
  return (Array.isArray(out) ? out : page).map((row) => {
    if (row && row['poster'] === null) {
      const { poster: _poster, ...rest } = row;
      return rest;
    }
    return row;
  });
}

export interface UserListMetasApi {
  itemsToMetas: typeof itemsToMetas;
  cleanImdb: typeof cleanImdb;
  cleanTmdb: typeof cleanTmdb;
  posterLink: typeof posterLink;
}

module.exports = { itemsToMetas, cleanImdb, cleanTmdb, posterLink } satisfies UserListMetasApi;
