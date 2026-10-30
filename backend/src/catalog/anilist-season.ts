// "Anime This Season": the current anime season ranked by AniList, as tt rows.
//
// AniList (public GraphQL, no key) gives the season's shows by popularity.
// Its ids are mapped to IMDb / TMDB through the community anime-lists map
// (github.com/Fribb/anime-lists, updated weekly), fetched at runtime and
// kept compact in memory and Redis. Titles the map cannot place are dropped,
// never guessed. One AniList read per season per 6 hours, shared by every
// user; nothing user-specific is sent anywhere.
const axios = require('axios');

const ANILIST = 'https://graphql.anilist.co';
const ANIME_LISTS = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json';
const SEASON_TTL = 6 * 60 * 60;
const MAP_TTL = 7 * 24 * 60 * 60;
const MAP_KEY = 'animeids:anilist:v2';
const PAGES = 2;
const PER_PAGE = 50;

type Season = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';
type Mapped = { imdb?: string; tv?: number; movie?: number };
interface SeasonItem { anilistId: number; title: string; year?: number }
interface SeasonRow { imdbId: string | null; tmdbId: number | null; title: string; year?: number }

function store() { return require('../runtime/cache.ts'); }

// AniList seasons: Winter = Jan-Mar, Spring = Apr-Jun, Summer = Jul-Sep, Fall = Oct-Dec.
function currentSeason(now = new Date()): { season: Season; year: number; key: string } {
  const month = now.getUTCMonth();
  const season: Season = month < 3 ? 'WINTER' : month < 6 ? 'SPRING' : month < 9 ? 'SUMMER' : 'FALL';
  const year = now.getUTCFullYear();
  return { season, year, key: `${year}-${season.toLowerCase()}` };
}

const QUERY = `query ($season: MediaSeason, $year: Int, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $year, type: ANIME, isAdult: false, sort: POPULARITY_DESC, format_in: [TV, TV_SHORT, ONA]) {
      id title { english romaji } startDate { year }
    }
  }
}`;

async function fetchSeason(season: Season, year: number, request = axios.post): Promise<SeasonItem[]> {
  const out: SeasonItem[] = [];
  for (let page = 1; page <= PAGES; page++) {
    const res = await request(ANILIST, { query: QUERY, variables: { season, year, page, perPage: PER_PAGE } }, {
      timeout: 15000, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    const data = res?.data?.data?.Page;
    for (const media of Array.isArray(data?.media) ? data.media : []) {
      const id = Number(media?.id);
      if (!Number.isInteger(id)) continue;
      out.push({ anilistId: id, title: String(media?.title?.english || media?.title?.romaji || ''), year: media?.startDate?.year || undefined });
    }
    if (!data?.pageInfo?.hasNextPage) break;
  }
  return out;
}

// anilist id -> { imdb, tv, movie }, from the full anime-lists file. Only the
// fields used here are kept (about 20k small entries).
function compactMap(list: unknown): Record<string, Mapped> {
  const out: Record<string, Mapped> = {};
  for (const entry of Array.isArray(list) ? list : []) {
    const id = Number(entry?.anilist_id);
    if (!Number.isInteger(id)) continue;
    const tmdb = entry?.themoviedb_id;
    const mapped: Mapped = {};
    // `imdb_id` is a list (one id per show, occasionally several); older
    // copies of the file used a plain string.
    const imdbRaw = Array.isArray(entry?.imdb_id) ? entry.imdb_id[0] : entry?.imdb_id;
    const imdb = typeof imdbRaw === 'string' ? imdbRaw.trim() : '';
    if (/^tt\d{5,}$/.test(imdb)) mapped.imdb = imdb;
    if (tmdb && typeof tmdb === 'object') {
      if (Number.isInteger(Number(tmdb.tv))) mapped.tv = Number(tmdb.tv);
      const movie = Array.isArray(tmdb.movie) ? tmdb.movie[0] : tmdb.movie;
      if (Number.isInteger(Number(movie))) mapped.movie = Number(movie);
    } else if (Number.isInteger(Number(tmdb)) && entry?.type === 'TV') {
      mapped.tv = Number(tmdb);
    }
    if (mapped.imdb || mapped.tv) out[String(id)] = mapped;
  }
  return out;
}

let memoryMap: { at: number; map: Record<string, Mapped> } | null = null;
let mapLoad: Promise<Record<string, Mapped>> | null = null;

async function idMap(get = axios.get): Promise<Record<string, Mapped>> {
  if (memoryMap && Date.now() - memoryMap.at < MAP_TTL * 1000) return memoryMap.map;
  if (mapLoad) return mapLoad;
  mapLoad = (async () => {
    try {
      const saved = await store().get(MAP_KEY).catch(() => null);
      if (saved && typeof saved === 'object' && Object.keys(saved).length) {
        memoryMap = { at: Date.now(), map: saved as Record<string, Mapped> };
        return memoryMap.map;
      }
      const res = await get(ANIME_LISTS, { timeout: 60000, maxContentLength: 40 * 1024 * 1024 });
      const map = compactMap(res?.data);
      if (Object.keys(map).length < 1000) throw new Error('anime id map looks incomplete');
      memoryMap = { at: Date.now(), map };
      await store().set(MAP_KEY, map, MAP_TTL).catch(() => {});
      return map;
    } finally { mapLoad = null; }
  })();
  return mapLoad;
}

// Season items -> rows with an IMDb id and/or a TMDB tv id, in AniList's
// order, one per show (later seasons map to the same show).
function mapItems(items: SeasonItem[], map: Record<string, Mapped>): SeasonRow[] {
  const rows: SeasonRow[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const mapped = map[String(item.anilistId)];
    if (!mapped || (!mapped.imdb && !mapped.tv)) continue;
    const key = mapped.imdb || `tmdb:${mapped.tv}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ imdbId: mapped.imdb || null, tmdbId: mapped.tv ?? null, title: item.title, ...(item.year ? { year: item.year } : {}) });
  }
  return rows;
}

// The current season's rows, shared (Redis) and coalesced.
const inflight = new Map<string, Promise<SeasonRow[]>>();
async function seasonRows(now = new Date()): Promise<SeasonRow[]> {
  const { season, year, key } = currentSeason(now);
  const cacheKey = `anilist:season:v2:${key}`;
  const cached = await store().get(cacheKey).catch(() => null);
  if (Array.isArray(cached) && cached.length) return cached as SeasonRow[];
  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      const [items, map] = await Promise.all([fetchSeason(season, year), idMap()]);
      const rows = mapItems(items, map);
      if (rows.length) await store().set(cacheKey, rows, SEASON_TTL).catch(() => {});
      return rows;
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

export interface AnilistSeasonApi {
  currentSeason: typeof currentSeason;
  fetchSeason: typeof fetchSeason;
  compactMap: typeof compactMap;
  mapItems: typeof mapItems;
  seasonRows: typeof seasonRows;
}

module.exports = { currentSeason, fetchSeason, compactMap, mapItems, seasonRows } satisfies AnilistSeasonApi;
