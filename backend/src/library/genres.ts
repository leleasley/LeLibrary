'use strict';
// "Your genres": My Movies / My Shows narrowed to one genre, theme or world
// cinema, as Home rows (`torbox-movies-g-horror`) and as the Hub's Genres
// folder (`torbox-movies-genres` + a genre name).
//
// Library matching never stored genres, so they are filled in the
// background: ONE TMDB details read per title (genres, keywords and original
// language in the same reply via append_to_response), kept in
// lib_tmdb_genres. That is a fact about the title, the same for everyone, so
// the table is shared by every library and a title is fetched once. Key: the
// server's own TMDB key when it has one (hosted), else the setup's own key,
// exactly like matching. Only a TMDB id is ever sent.

const axios = require('axios');
const store = require('./store.ts');
import type { BoundedMapApi } from '../runtime/bounded-map.ts';
const { boundedSet } = require('../runtime/bounded-map.ts') as BoundedMapApi;

const TMDB = 'https://api.themoviedb.org/3';

// A title belongs to a genre when it has one of `genres` or `keywords`
// (TMDB ids; omit both for a language-only rule), its original language is
// one of `langs` (when given), it has one of `needGenres` (when given) and
// none of `notGenres`.
export interface GenreRule {
  genres?: number[];
  keywords?: number[];
  langs?: string[];
  needGenres?: number[];
  notGenres?: number[];
}

export type GenreGroup = 'genre' | 'theme' | 'world';

export interface GenreDef {
  slug: string;
  name: string;
  group: GenreGroup;
  movie?: GenreRule;
  tv?: GenreRule;
  // Show rows named differently (TMDB merges "Action & Adventure" for TV).
  tvName?: string;
}

// Keyword ids were checked against TMDB on 2026-11-02, each with how many
// titles TMDB has tagged (unused keywords such as "romantic comedy" were
// swapped for the one editors actually use, "romcom"). Slugs are saved in
// catalogue ids: never rename one.
const GENRES: readonly GenreDef[] = [
  // ── TMDB's own genres ──
  { slug: 'action', name: 'Action', group: 'genre', movie: { genres: [28] }, tv: { genres: [10759] }, tvName: 'Action & Adventure' },
  { slug: 'adventure', name: 'Adventure', group: 'genre', movie: { genres: [12] } },
  { slug: 'animation', name: 'Animation', group: 'genre', movie: { genres: [16] }, tv: { genres: [16] } },
  { slug: 'comedy', name: 'Comedy', group: 'genre', movie: { genres: [35] }, tv: { genres: [35] } },
  { slug: 'crime', name: 'Crime', group: 'genre', movie: { genres: [80] }, tv: { genres: [80] } },
  { slug: 'documentary', name: 'Documentary', group: 'genre', movie: { genres: [99] }, tv: { genres: [99] } },
  { slug: 'drama', name: 'Drama', group: 'genre', movie: { genres: [18] }, tv: { genres: [18] } },
  { slug: 'family', name: 'Family', group: 'genre', movie: { genres: [10751] }, tv: { genres: [10751] } },
  { slug: 'fantasy', name: 'Fantasy', group: 'genre', movie: { genres: [14] } },
  { slug: 'history', name: 'History', group: 'genre', movie: { genres: [36] } },
  { slug: 'horror', name: 'Horror', group: 'genre', movie: { genres: [27] } },
  { slug: 'kids', name: 'Kids', group: 'genre', tv: { genres: [10762] } },
  { slug: 'music', name: 'Music', group: 'genre', movie: { genres: [10402] } },
  { slug: 'mystery', name: 'Mystery', group: 'genre', movie: { genres: [9648] }, tv: { genres: [9648] } },
  { slug: 'news', name: 'News', group: 'genre', tv: { genres: [10763] } },
  { slug: 'reality', name: 'Reality', group: 'genre', tv: { genres: [10764] } },
  { slug: 'romance', name: 'Romance', group: 'genre', movie: { genres: [10749] } },
  { slug: 'scifi', name: 'Sci-Fi', group: 'genre', movie: { genres: [878] }, tv: { genres: [10765] }, tvName: 'Sci-Fi & Fantasy' },
  { slug: 'soap', name: 'Soap', group: 'genre', tv: { genres: [10766] } },
  { slug: 'talk', name: 'Talk', group: 'genre', tv: { genres: [10767] } },
  { slug: 'thriller', name: 'Thriller', group: 'genre', movie: { genres: [53] } },
  { slug: 'tvmovie', name: 'TV Movie', group: 'genre', movie: { genres: [10770] } },
  { slug: 'war', name: 'War', group: 'genre', movie: { genres: [10752] }, tv: { genres: [10768] }, tvName: 'War & Politics' },
  { slug: 'western', name: 'Western', group: 'genre', movie: { genres: [37] }, tv: { genres: [37] } },

  // ── Themes (TMDB keywords) ──
  { slug: 'superhero', name: 'Superheroes', group: 'theme', movie: { keywords: [9715] }, tv: { keywords: [9715] } },
  { slug: 'comicbook', name: 'Comic Book Adaptations', group: 'theme', movie: { keywords: [9717] }, tv: { keywords: [9717] } },
  { slug: 'zombie', name: 'Zombies', group: 'theme', movie: { keywords: [12377, 186565] }, tv: { keywords: [12377, 186565] } },
  { slug: 'vampire', name: 'Vampires', group: 'theme', movie: { keywords: [3133] }, tv: { keywords: [3133] } },
  { slug: 'werewolf', name: 'Werewolves', group: 'theme', movie: { keywords: [12564] }, tv: { keywords: [12564] } },
  { slug: 'slasher', name: 'Slashers', group: 'theme', movie: { keywords: [12339] } },
  { slug: 'foundfootage', name: 'Found Footage', group: 'theme', movie: { keywords: [163053] } },
  { slug: 'monster', name: 'Monsters & Kaiju', group: 'theme', movie: { keywords: [1299, 11100, 161791, 158126] }, tv: { keywords: [1299, 11100, 161791] } },
  { slug: 'ghost', name: 'Ghosts & Hauntings', group: 'theme', movie: { keywords: [162846, 3358] }, tv: { keywords: [162846, 3358] } },
  { slug: 'possession', name: 'Possession & Exorcism', group: 'theme', movie: { keywords: [2626] } },
  { slug: 'witch', name: 'Witches', group: 'theme', movie: { keywords: [616] }, tv: { keywords: [616] } },
  { slug: 'supernatural', name: 'Supernatural', group: 'theme', movie: { keywords: [6152] }, tv: { keywords: [6152] } },
  { slug: 'psychhorror', name: 'Psychological Horror', group: 'theme', movie: { keywords: [295907] } },
  { slug: 'bodyhorror', name: 'Body Horror', group: 'theme', movie: { keywords: [283085] } },
  { slug: 'folkhorror', name: 'Folk Horror', group: 'theme', movie: { keywords: [209568] } },
  { slug: 'gothic', name: 'Gothic', group: 'theme', movie: { keywords: [33505] } },
  { slug: 'heist', name: 'Heists', group: 'theme', movie: { keywords: [10051] }, tv: { keywords: [10051] } },
  { slug: 'spy', name: 'Spies', group: 'theme', movie: { keywords: [470, 5265] }, tv: { keywords: [470, 5265] } },
  { slug: 'martialarts', name: 'Martial Arts', group: 'theme', movie: { keywords: [779] }, tv: { keywords: [779] } },
  { slug: 'samurai', name: 'Samurai', group: 'theme', movie: { keywords: [1462] }, tv: { keywords: [1462] } },
  { slug: 'gangster', name: 'Gangsters & Mafia', group: 'theme', movie: { keywords: [3149, 10391, 9730] }, tv: { keywords: [3149, 10391, 9730] } },
  { slug: 'serialkiller', name: 'Serial Killers', group: 'theme', movie: { keywords: [10714] }, tv: { keywords: [10714] } },
  { slug: 'police', name: 'Cops & Police', group: 'theme', movie: { keywords: [6149] }, tv: { keywords: [6149] } },
  { slug: 'detective', name: 'Detectives', group: 'theme', movie: { keywords: [703] }, tv: { keywords: [703] } },
  { slug: 'legal', name: 'Courtroom & Legal', group: 'theme', movie: { keywords: [33519, 214780] }, tv: { keywords: [33519, 214780] } },
  { slug: 'prison', name: 'Prison', group: 'theme', movie: { keywords: [378] }, tv: { keywords: [378] } },
  { slug: 'hitman', name: 'Hitmen', group: 'theme', movie: { keywords: [2708] } },
  { slug: 'revenge', name: 'Revenge', group: 'theme', movie: { keywords: [9748] }, tv: { keywords: [9748] } },
  { slug: 'kidnapping', name: 'Kidnapping', group: 'theme', movie: { keywords: [1930] } },
  { slug: 'conspiracy', name: 'Conspiracy', group: 'theme', movie: { keywords: [10410] }, tv: { keywords: [10410] } },
  { slug: 'politics', name: 'Politics', group: 'theme', movie: { keywords: [6078] }, tv: { keywords: [6078] } },
  { slug: 'psychthriller', name: 'Psychological Thrillers', group: 'theme', movie: { keywords: [12565] }, tv: { keywords: [12565] } },
  { slug: 'noir', name: 'Noir', group: 'theme', movie: { keywords: [9807, 207268] }, tv: { keywords: [207268] } },
  { slug: 'timetravel', name: 'Time Travel', group: 'theme', movie: { keywords: [4379] }, tv: { keywords: [4379] } },
  { slug: 'space', name: 'Space', group: 'theme', movie: { keywords: [9882, 1612, 161176] }, tv: { keywords: [9882, 1612, 161176] } },
  { slug: 'aliens', name: 'Aliens', group: 'theme', movie: { keywords: [9951] }, tv: { keywords: [9951] } },
  { slug: 'dystopia', name: 'Dystopia', group: 'theme', movie: { keywords: [4565] }, tv: { keywords: [4565] } },
  { slug: 'postapoc', name: 'Post-Apocalyptic', group: 'theme', movie: { keywords: [4458] }, tv: { keywords: [4458] } },
  { slug: 'cyberpunk', name: 'Cyberpunk', group: 'theme', movie: { keywords: [12190] }, tv: { keywords: [12190] } },
  { slug: 'ai', name: 'AI & Robots', group: 'theme', movie: { keywords: [310, 14544] }, tv: { keywords: [310, 14544] } },
  { slug: 'parallel', name: 'Parallel Worlds', group: 'theme', movie: { keywords: [33465, 336874, 4563] }, tv: { keywords: [33465, 336874, 4563] } },
  { slug: 'dinosaur', name: 'Dinosaurs', group: 'theme', movie: { keywords: [12616] }, tv: { keywords: [12616] } },
  { slug: 'mecha', name: 'Mecha', group: 'theme', movie: { keywords: [10046] }, tv: { keywords: [10046] } },
  { slug: 'isekai', name: 'Isekai', group: 'theme', movie: { keywords: [237451] }, tv: { keywords: [237451] } },
  { slug: 'steampunk', name: 'Steampunk', group: 'theme', movie: { keywords: [10028] } },
  { slug: 'magic', name: 'Magic', group: 'theme', movie: { keywords: [2343] }, tv: { keywords: [2343] } },
  { slug: 'dragon', name: 'Dragons', group: 'theme', movie: { keywords: [12554] }, tv: { keywords: [12554] } },
  { slug: 'fairytale', name: 'Fairy Tales', group: 'theme', movie: { keywords: [3205] }, tv: { keywords: [3205] } },
  { slug: 'mythology', name: 'Mythology', group: 'theme', movie: { keywords: [2035] }, tv: { keywords: [2035] } },
  { slug: 'medieval', name: 'Medieval & Knights', group: 'theme', movie: { keywords: [161257, 10466] }, tv: { keywords: [161257, 10466] } },
  { slug: 'pirate', name: 'Pirates & Swashbucklers', group: 'theme', movie: { keywords: [12988, 157186] }, tv: { keywords: [12988, 157186] } },
  { slug: 'romcom', name: 'Rom-Coms', group: 'theme', movie: { keywords: [9799] }, tv: { keywords: [9799] } },
  { slug: 'comingofage', name: 'Coming of Age', group: 'theme', movie: { keywords: [10683] }, tv: { keywords: [10683] } },
  { slug: 'teen', name: 'High School & Teens', group: 'theme', movie: { keywords: [6270, 296608] }, tv: { keywords: [6270, 296608] } },
  { slug: 'parody', name: 'Parody & Spoof', group: 'theme', movie: { keywords: [9755, 11931] }, tv: { keywords: [9755, 11931] } },
  { slug: 'satire', name: 'Satire', group: 'theme', movie: { keywords: [8201] }, tv: { keywords: [8201] } },
  { slug: 'darkcomedy', name: 'Dark Comedy', group: 'theme', movie: { keywords: [10123] }, tv: { keywords: [10123] } },
  { slug: 'mockumentary', name: 'Mockumentary', group: 'theme', movie: { keywords: [11800] }, tv: { keywords: [11800] } },
  { slug: 'standup', name: 'Stand-Up Comedy', group: 'theme', movie: { keywords: [9716] }, tv: { keywords: [9716] } },
  { slug: 'buddy', name: 'Buddy Comedy', group: 'theme', movie: { keywords: [167541] } },
  { slug: 'roadtrip', name: 'Road Trips', group: 'theme', movie: { keywords: [7312, 167043] } },
  { slug: 'sitcom', name: 'Sitcoms', group: 'theme', tv: { keywords: [193171] } },
  { slug: 'musical', name: 'Musicals', group: 'theme', movie: { keywords: [4344] }, tv: { keywords: [4344] } },
  { slug: 'concert', name: 'Concerts', group: 'theme', movie: { keywords: [6029] } },
  { slug: 'sports', name: 'Sports', group: 'theme', movie: { keywords: [6075] }, tv: { keywords: [6075] } },
  { slug: 'boxing', name: 'Boxing', group: 'theme', movie: { keywords: [209476] } },
  { slug: 'football', name: 'Football', group: 'theme', movie: { keywords: [13042] }, tv: { keywords: [13042] } },
  { slug: 'racing', name: 'Motor Racing', group: 'theme', movie: { keywords: [830] } },
  { slug: 'biopic', name: 'Biopics', group: 'theme', movie: { keywords: [5565, 196751] }, tv: { keywords: [5565, 196751] } },
  { slug: 'truestory', name: 'Based on a True Story', group: 'theme', movie: { keywords: [9672] }, tv: { keywords: [9672] } },
  { slug: 'book', name: 'Book Adaptations', group: 'theme', movie: { keywords: [818] }, tv: { keywords: [818] } },
  { slug: 'videogame', name: 'Video Game Adaptations', group: 'theme', movie: { keywords: [41645] }, tv: { keywords: [41645] } },
  { slug: 'ww2', name: 'World War II', group: 'theme', movie: { keywords: [1956] }, tv: { keywords: [1956] } },
  { slug: 'coldwar', name: 'Cold War', group: 'theme', movie: { keywords: [2106] }, tv: { keywords: [2106] } },
  { slug: 'vietnam', name: 'Vietnam War', group: 'theme', movie: { keywords: [2957] } },
  { slug: 'period', name: 'Period Drama', group: 'theme', movie: { keywords: [15060, 192772] }, tv: { keywords: [15060, 192772] } },
  { slug: 'disaster', name: 'Disaster', group: 'theme', movie: { keywords: [10617, 5096] }, tv: { keywords: [10617, 5096] } },
  { slug: 'survival', name: 'Survival', group: 'theme', movie: { keywords: [10349] }, tv: { keywords: [10349] } },
  { slug: 'outbreak', name: 'Pandemics & Outbreaks', group: 'theme', movie: { keywords: [188973] }, tv: { keywords: [188973] } },
  { slug: 'shark', name: 'Sharks', group: 'theme', movie: { keywords: [15097] } },
  { slug: 'christmas', name: 'Christmas', group: 'theme', movie: { keywords: [207317] }, tv: { keywords: [207317] } },
  { slug: 'halloween', name: 'Halloween', group: 'theme', movie: { keywords: [3335] }, tv: { keywords: [3335] } },
  { slug: 'anthology', name: 'Anthologies', group: 'theme', movie: { keywords: [9706] }, tv: { keywords: [9706] } },
  { slug: 'cooking', name: 'Food & Cooking', group: 'theme', movie: { keywords: [1918] }, tv: { keywords: [1918] } },
  { slug: 'lgbtq', name: 'LGBTQ+', group: 'theme', movie: { keywords: [158718] }, tv: { keywords: [158718] } },

  // ── World cinema (original language) ──
  { slug: 'anime', name: 'Anime', group: 'world', movie: { genres: [16], keywords: [210024], langs: ['ja'] }, tv: { genres: [16], keywords: [210024], langs: ['ja'] } },
  { slug: 'kdrama', name: 'Korean', group: 'world', movie: { langs: ['ko'] }, tv: { langs: ['ko'], needGenres: [18] }, tvName: 'K-Drama' },
  { slug: 'japanese', name: 'Japanese', group: 'world', movie: { langs: ['ja'], notGenres: [16] }, tv: { langs: ['ja'], notGenres: [16] } },
  { slug: 'chinese', name: 'Chinese & Hong Kong', group: 'world', movie: { langs: ['zh', 'cn'] }, tv: { langs: ['zh', 'cn'] } },
  { slug: 'indian', name: 'Indian', group: 'world', movie: { langs: ['hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'pa'] }, tv: { langs: ['hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'pa'] } },
  { slug: 'french', name: 'French', group: 'world', movie: { langs: ['fr'] }, tv: { langs: ['fr'] } },
  { slug: 'spanish', name: 'Spanish-Language', group: 'world', movie: { langs: ['es'] }, tv: { langs: ['es'] } },
  { slug: 'italian', name: 'Italian', group: 'world', movie: { langs: ['it'] }, tv: { langs: ['it'] } },
  { slug: 'german', name: 'German', group: 'world', movie: { langs: ['de'] }, tv: { langs: ['de'] } },
  { slug: 'nordic', name: 'Nordic', group: 'world', movie: { langs: ['sv', 'da', 'no', 'nb', 'nn', 'fi', 'is'] }, tv: { langs: ['sv', 'da', 'no', 'nb', 'nn', 'fi', 'is'] } },
  { slug: 'turkish', name: 'Turkish', group: 'world', movie: { langs: ['tr'] }, tv: { langs: ['tr'] } },
  { slug: 'thai', name: 'Thai', group: 'world', movie: { langs: ['th'] }, tv: { langs: ['th'] } },
];
const BY_SLUG = new Map(GENRES.map((genre) => [genre.slug, genre]));

type Kind = 'movies' | 'series';

function genreBySlug(slug: unknown): GenreDef | null {
  return BY_SLUG.get(String(slug || '')) || null;
}

function ruleFor(genre: GenreDef | null, kind: Kind): GenreRule | null {
  if (!genre) return null;
  return (kind === 'movies' ? genre.movie : genre.tv) || null;
}

// Genres that exist for a library kind (Horror has no TV genre on TMDB).
function genresFor(kind: Kind): GenreDef[] {
  return GENRES.filter((genre) => ruleFor(genre, kind) !== null);
}

function nameFor(genre: GenreDef, kind: Kind): string {
  return kind === 'series' && genre.tvName ? genre.tvName : genre.name;
}

// The Hub's Genres folder passes the genre as the catalogue's genre extra,
// by the name the player shows.
function genreByName(kind: Kind, name: unknown): GenreDef | null {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;
  return genresFor(kind).find((genre) => nameFor(genre, kind).toLowerCase() === wanted) || null;
}

interface GenreFacts { genre_ids: number[]; keyword_ids: number[] | null; orig_lang: string | null }

function matchesRule(rule: GenreRule, facts: GenreFacts): boolean {
  const genres = facts.genre_ids || [];
  const keywords = facts.keyword_ids || [];
  const any = (list: number[] | undefined, have: number[]) => !!list && list.some((id) => have.includes(id));
  if (rule.genres || rule.keywords) {
    if (!any(rule.genres, genres) && !any(rule.keywords, keywords)) return false;
  }
  if (rule.langs && !rule.langs.includes(String(facts.orig_lang || ''))) return false;
  if (rule.needGenres && !any(rule.needGenres, genres)) return false;
  if (rule.notGenres && any(rule.notGenres, genres)) return false;
  return true;
}

// The same rule as SQL over lib_tmdb_genres (GIN indexes on both arrays).
function ruleSql(rule: GenreRule, params: unknown[]): string {
  const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const parts: string[] = [];
  const either: string[] = [];
  if (rule.genres?.length) either.push(`genre_ids && ${add(rule.genres)}::int[]`);
  if (rule.keywords?.length) either.push(`keyword_ids && ${add(rule.keywords)}::int[]`);
  if (either.length) parts.push(`(${either.join(' OR ')})`);
  if (rule.langs?.length) parts.push(`orig_lang = ANY(${add(rule.langs)}::text[])`);
  if (rule.needGenres?.length) parts.push(`genre_ids && ${add(rule.needGenres)}::int[]`);
  if (rule.notGenres?.length) parts.push(`NOT (genre_ids && ${add(rule.notGenres)}::int[])`);
  return parts.length ? parts.join(' AND ') : 'false';
}

// Server key first: on the hosted site no setup's key is spent on a fact
// shared by everyone.
function serverKey(): string {
  return String(process.env['ART_TMDB_API_KEY'] || process.env['RELEASES_TMDB_API_KEY'] || '').trim();
}

function auth(apiKey: string): { headers: Record<string, string>; params: Record<string, string> } {
  return apiKey.startsWith('eyJ')
    ? { headers: { Authorization: `Bearer ${apiKey}` }, params: {} }
    : { headers: {}, params: { api_key: apiKey } };
}

// Keys TMDB rejected are left alone for an hour (matching has its own gate).
const rejected = new Map<string, number>();
const REJECT_MS = 60 * 60 * 1000;
const REJECTED_MAX = 1000;

const FILL_PER_TICK = Math.max(1, Number(process.env['LIBRARY_GENRE_FILL'] || 150));
const CONCURRENCY = 4;

// Titles in this library without facts yet, or stored before keywords and
// language were kept (keyword_ids IS NULL).
async function missing(scopeId: string, limit: number): Promise<{ apiType: 'movie' | 'tv'; tmdbId: number }[]> {
  const pool = await store.ensure();
  const { rows } = await pool.query(
    `SELECT DISTINCT CASE WHEN i.media_type = 'movie' THEN 'movie' ELSE 'tv' END AS api_type, i.tmdb_id
       FROM lib_items i
      WHERE i.scope_id = $1 AND i.removed_at IS NULL AND i.match_status = 'matched' AND i.tmdb_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM lib_tmdb_genres g
                         WHERE g.media_type = CASE WHEN i.media_type = 'movie' THEN 'movie' ELSE 'tv' END
                           AND g.tmdb_id = i.tmdb_id AND g.keyword_ids IS NOT NULL)
      LIMIT $2`,
    [scopeId, limit]
  );
  return rows.map((row: Record<string, unknown>) => ({ apiType: row['api_type'] === 'movie' ? 'movie' : 'tv', tmdbId: Number(row['tmdb_id']) }));
}

type Facts = { genreIds: number[]; keywordIds: number[]; lang: string | null };

async function fetchFacts(apiKey: string, apiType: 'movie' | 'tv', tmdbId: number, get = axios.get): Promise<Facts | null | 'rejected'> {
  const { headers, params } = auth(apiKey);
  try {
    const res = await get(`${TMDB}/${apiType}/${tmdbId}`, { headers, params: { ...params, append_to_response: 'keywords' }, timeout: 8000 });
    const data = res?.data || {};
    const ids = (list: unknown) => (Array.isArray(list) ? list : [])
      .map((entry: { id?: unknown }) => Number(entry?.id)).filter((id: number) => Number.isInteger(id) && id > 0);
    // Films list keywords under `keywords`, shows under `results`.
    const keywordList = data.keywords?.keywords ?? data.keywords?.results;
    const lang = typeof data.original_language === 'string' && /^[a-z]{2,3}$/.test(data.original_language) ? data.original_language : null;
    return { genreIds: ids(data.genres), keywordIds: ids(keywordList), lang };
  } catch (err: any) {
    const status = Number(err?.response?.status) || 0;
    if (status === 401) return 'rejected';
    // Gone from TMDB: store "nothing" so it is never asked again.
    if (status === 404) return { genreIds: [], keywordIds: [], lang: null };
    return null; // try again on a later pass
  }
}

// One background pass for one library. Returns how many titles were filled.
async function fillForScope(scopeId: string, setupKey: string | null | undefined, options: { limit?: number; get?: typeof axios.get } = {}): Promise<number> {
  const apiKey = serverKey() || String(setupKey || '').trim();
  if (!apiKey) return 0;
  const until = rejected.get(apiKey);
  if (until && until > Date.now()) return 0;
  const todo = await missing(scopeId, options.limit ?? FILL_PER_TICK);
  if (!todo.length) return 0;
  const pool = await store.ensure();
  let filled = 0;
  let stop = false;
  let index = 0;
  async function worker() {
    while (!stop && index < todo.length) {
      const job = todo[index++]!;
      const facts = await fetchFacts(apiKey, job.apiType, job.tmdbId, options.get);
      if (facts === 'rejected') {
        const at = Date.now();
        boundedSet(rejected, apiKey, at + REJECT_MS, REJECTED_MAX, (until) => until <= at);
        stop = true;
        return;
      }
      if (facts === null) continue;
      await pool.query(
        `INSERT INTO lib_tmdb_genres (media_type, tmdb_id, genre_ids, keyword_ids, orig_lang, fetched_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (media_type, tmdb_id) DO UPDATE
           SET genre_ids = EXCLUDED.genre_ids, keyword_ids = EXCLUDED.keyword_ids,
               orig_lang = EXCLUDED.orig_lang, fetched_at = now()`,
        [job.apiType, job.tmdbId, facts.genreIds, facts.keywordIds, facts.lang]
      );
      filled++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  if (filled) bumpVersion();
  return filled;
}

// TMDB ids of one kind in one genre. Cached briefly: a catalogue page asks
// once per request, and the set only grows as the fill runs.
const idCache = new Map<string, { at: number; ids: Set<number> }>();
const ID_TTL_MS = 5 * 60 * 1000;

async function tmdbIdsWithGenre(kind: Kind, slug: string): Promise<Set<number>> {
  const rule = ruleFor(genreBySlug(slug), kind);
  if (!rule) return new Set();
  const key = `${kind}:${slug}:${version}`;
  const hit = idCache.get(key);
  if (hit && Date.now() - hit.at < ID_TTL_MS) return hit.ids;
  const pool = await store.ensure();
  const params: unknown[] = [kind === 'movies' ? 'movie' : 'tv'];
  const { rows } = await pool.query(`SELECT tmdb_id FROM lib_tmdb_genres WHERE media_type = $1 AND ${ruleSql(rule, params)}`, params);
  const ids = new Set<number>(rows.map((row: Record<string, unknown>) => Number(row['tmdb_id'])));
  idCache.set(key, { at: Date.now(), ids });
  return ids;
}

// How many titles this library owns per genre and kind, most first. Used for
// the Hub's Genres folder, decided at push time.
async function ownedGenreCounts(scopeId: string): Promise<{ slug: string; kind: Kind; name: string; count: number }[]> {
  const pool = await store.ensure();
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (g.media_type, g.tmdb_id) g.media_type, g.genre_ids, g.keyword_ids, g.orig_lang
       FROM lib_items i
       JOIN lib_tmdb_genres g
         ON g.media_type = CASE WHEN i.media_type = 'movie' THEN 'movie' ELSE 'tv' END AND g.tmdb_id = i.tmdb_id
      WHERE i.scope_id = $1 AND i.removed_at IS NULL AND i.match_status = 'matched'`,
    [scopeId]
  );
  const out: { slug: string; kind: Kind; name: string; count: number }[] = [];
  for (const kind of ['movies', 'series'] as const) {
    const facts = rows.filter((row: Record<string, unknown>) => (row['media_type'] === 'movie') === (kind === 'movies')) as GenreFacts[];
    for (const genre of genresFor(kind)) {
      const rule = ruleFor(genre, kind)!;
      const count = facts.reduce((total, row) => total + (matchesRule(rule, row) ? 1 : 0), 0);
      if (count) out.push({ slug: genre.slug, kind, name: nameFor(genre, kind), count });
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

// Changes whenever the fill adds titles, so cached genre pages are rebuilt
// instead of staying empty while the first fill runs.
let version = 0;
function bumpVersion() { version++; idCache.clear(); }
function genreVersion(): number { return version; }

export interface GenresApi {
  GENRES: readonly GenreDef[];
  genreBySlug: typeof genreBySlug;
  genreByName: typeof genreByName;
  genresFor: typeof genresFor;
  nameFor: typeof nameFor;
  matchesRule: typeof matchesRule;
  ruleSql: typeof ruleSql;
  fillForScope: typeof fillForScope;
  fetchFacts: typeof fetchFacts;
  tmdbIdsWithGenre: typeof tmdbIdsWithGenre;
  ownedGenreCounts: typeof ownedGenreCounts;
  genreVersion: typeof genreVersion;
}

module.exports = { GENRES, genreBySlug, genreByName, genresFor, nameFor, matchesRule, ruleSql, fillForScope, fetchFacts, tmdbIdsWithGenre, ownedGenreCounts, genreVersion } satisfies GenresApi;
