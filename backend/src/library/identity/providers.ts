// @ts-nocheck
// Background-only metadata/identity providers for the indexed engine.
//
// None of these are ever called from a Nuvio request. The worker resolves an
// entity once and persists the result; request paths read Postgres/Redis only.
//
// Providers:
//   - Kitsu   (no key)  : anime identity + metadata + external mappings
//   - AniList (no key)  : anime identity + metadata (GraphQL)
//   - MAL     (no key)  : anime identity via Jikan v4
//   - TVDB    (key)     : TV identity/metadata/episodes, only when TVDB_API_KEY set
//   - AniDB   (skipped) : requires client registration; not implemented (see docs)
const axios = require('axios');
const cache = require('../../runtime/cache.ts');

const TIMEOUT = parseInt(process.env.IDENTITY_HTTP_TIMEOUT, 10) || 12000;
const POS_TTL = 30 * 24 * 60 * 60;   // 30 days
const NEG_TTL = 24 * 60 * 60;        // 1 day

const inFlight = new Map();

function coalesce(key, fn) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = Promise.resolve().then(fn).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

async function cachedGet(key, ttl, fn) {
  const hit = await cache.get(key).catch(() => null);
  if (hit !== null && hit !== undefined) return hit === '__none__' ? null : hit;
  return coalesce(key, async () => {
    let value;
    try {
      value = await fn();
    } catch (err) {
      // Negative-cache failures briefly so a flaky upstream is not hammered.
      await cache.set(key, '__none__', NEG_TTL).catch(() => {});
      throw err;
    }
    await cache.set(key, value === null || value === undefined ? '__none__' : value, value == null ? NEG_TTL : ttl).catch(() => {});
    return value == null ? null : value;
  });
}

async function getJson(url, { headers = {}, params, method = 'get', data, timeout = TIMEOUT } = {}) {
  const res = await axios({ url, method, headers, params, data, timeout, maxContentLength: 8 * 1024 * 1024, validateStatus: () => true });
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.data;
}

// ── Kitsu ──────────────────────────────────────────────────────────────────
const KITSU_BASE = 'https://kitsu.io/api/edge';
const KITSU_HEADERS = { Accept: 'application/vnd.api+json' };

async function kitsuSearch(title, year) {
  if (!title) return [];
  const key = `idprov:kitsu:search:${(title || '').toLowerCase()}:${year || ''}`;
  return cachedGet(key, POS_TTL, async () => {
    const data = await getJson(`${KITSU_BASE}/anime`, {
      headers: KITSU_HEADERS,
      params: { 'filter[text]': title, 'page[limit]': 5 },
    });
    return (data?.data || []).map((row) => ({
      id: Number(row.id),
      canonicalTitle: row.attributes?.canonicalTitle || null,
      titles: row.attributes?.titles || {},
      startDate: row.attributes?.startDate || null,
      episodeCount: row.attributes?.episodeCount ?? null,
      subtype: row.attributes?.subtype || null,
    }));
  });
}

async function kitsuAnime(id) {
  const key = `idprov:kitsu:anime:${id}`;
  return cachedGet(key, POS_TTL, async () => {
    const data = await getJson(`${KITSU_BASE}/anime/${id}`, { headers: KITSU_HEADERS });
    const a = data?.data?.attributes || {};
    const titles = a.titles || {};
    return {
      id: Number(id),
      canonicalTitle: a.canonicalTitle || null,
      titles,
      titlesList: [titles.en, titles.en_jp, titles.ja_jp, a.canonicalTitle, a.abbreviatedTitles].flat().filter(Boolean),
      synopsis: a.synopsis || a.description || null,
      poster: a.posterImage?.large || a.posterImage?.original || a.posterImage?.medium || null,
      background: a.coverImage?.large || a.coverImage?.original || null,
      status: a.status || null,
      subtype: a.subtype || null,
      episodeCount: a.episodeCount ?? null,
      episodeLength: a.episodeLength ?? null,
      startDate: a.startDate || null,
      endDate: a.endDate || null,
      averageRating: a.averageRating || null,
    };
  });
}

async function kitsuMappings(id) {
  const key = `idprov:kitsu:mappings:${id}`;
  return cachedGet(key, POS_TTL, async () => {
    // Kitsu caps page[limit] at 20 for this endpoint (higher returns HTTP 400),
    // so gather a few pages to reach AniList/MAL mappings which are not always
    // on the first page.
    const out = {};
    for (let offset = 0; offset < 80; offset += 20) {
      const data = await getJson(`${KITSU_BASE}/anime/${id}/mappings`, {
        headers: KITSU_HEADERS,
        params: { 'page[limit]': 20, 'page[offset]': offset },
      });
      const rows = data?.data || [];
      for (const row of rows) {
        const site = String(row.attributes?.externalSite || '').toLowerCase();
        const value = String(row.attributes?.externalId || '');
        if (site.startsWith('anilist')) out.anilist = Number(value) || null;
        else if (site.startsWith('myanimelist') || site === 'mal') out.mal = Number(value) || null;
        else if (site.startsWith('thetvdb')) out.tvdb = Number(value) || null;
        else if (site.startsWith('themoviedb')) out.tmdb = Number(value) || null;
        else if (site.startsWith('imdb')) out.imdb = /^tt\d+$/i.test(value) ? value.toLowerCase() : null;
        else if (site.startsWith('anidb')) out.anidb = Number(value) || null;
      }
      if (rows.length < 20) break;
    }
    return out;
  });
}

// One page (20) of Kitsu episodes with anime absolute + relative numbering.
async function kitsuAnimeEpisodes(id, offset = 0) {
  const key = `idprov:kitsu:episodes:${id}:${offset}`;
  return cachedGet(key, POS_TTL, async () => {
    const data = await getJson(`${KITSU_BASE}/anime/${id}/episodes`, {
      headers: KITSU_HEADERS,
      params: { 'page[limit]': 20, 'page[offset]': offset, sort: 'number' },
    });
    return (data?.data || []).map((row) => {
      const a = row.attributes || {};
      return {
        id: Number(row.id),
        number: a.number ?? null,
        relativeNumber: a.relativeNumber ?? null,
        seasonNumber: a.seasonNumber ?? null,
        airdate: a.airdate || null,
        canonicalTitle: a.canonicalTitle || null,
        synopsis: a.synopsis || null,
        length: a.length ?? null,
      };
    });
  });
}

// ── AniList ────────────────────────────────────────────────────────────────
const ANILIST_URL = 'https://graphql.anilist.co';
const ANILIST_FIELDS = `id idMal title{romaji english native} synonyms description coverImage{extraLarge large} bannerImage startDate{year month day} episodes duration status genres`;

async function anilistQuery(query, variables) {
  const res = await axios({ url: ANILIST_URL, method: 'post', data: { query, variables }, timeout: TIMEOUT, validateStatus: () => true });
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err;
  }
  return res.data?.data;
}

async function anilistSearch(title, year) {
  if (!title) return [];
  const key = `idprov:anilist:search:${title.toLowerCase()}:${year || ''}`;
  return cachedGet(key, POS_TTL, async () => {
    const data = await anilistQuery(
      `query($search:String){Page(perPage:5){media(search:$search,type:ANIME){${ANILIST_FIELDS}}}}`,
      { search: title },
    );
    return (data?.Page?.media || []).map(normalizeAnilist);
  });
}

async function anilistById(id) {
  const key = `idprov:anilist:id:${id}`;
  return cachedGet(key, POS_TTL, async () => {
    const data = await anilistQuery(`query($id:Int){Media(id:$id,type:ANIME){${ANILIST_FIELDS}}}`, { id: Number(id) });
    return data?.Media ? normalizeAnilist(data.Media) : null;
  });
}

function normalizeAnilist(m) {
  if (!m) return null;
  const titles = [m.title?.romaji, m.title?.english, m.title?.native, ...(m.synonyms || [])].filter(Boolean);
  return {
    id: m.id,
    malId: m.idMal || null,
    titles,
    title: m.title?.english || m.title?.romaji || m.title?.native || null,
    overview: m.description ? String(m.description).replace(/<[^>]+>/g, '') : null,
    poster: m.coverImage?.extraLarge || m.coverImage?.large || null,
    background: m.bannerImage || null,
    startYear: m.startDate?.year || null,
    episodes: m.episodes ?? null,
    duration: m.duration ?? null,
    status: m.status || null,
    genres: m.genres || [],
  };
}

// ── MAL (Jikan v4, no key) ─────────────────────────────────────────────────
const JIKAN = 'https://api.jikan.moe/v4';

async function jikanSearch(title) {
  if (!title) return [];
  const key = `idprov:jikan:search:${title.toLowerCase()}`;
  return cachedGet(key, POS_TTL, async () => {
    const data = await getJson(`${JIKAN}/anime`, { params: { q: title, limit: 5, sfw: true } });
    return (data?.data || []).map((a) => ({
      malId: a.mal_id,
      titles: [a.title, a.title_english, a.title_japanese, ...(a.titles || []).map((t) => t.title)].filter(Boolean),
      title: a.title_english || a.title || null,
      poster: a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || null,
      episodes: a.episodes ?? null,
      year: a.year || (a.aired?.prop?.from?.year ?? null),
    }));
  });
}

async function jikanById(malId) {
  const key = `idprov:jikan:id:${malId}`;
  return cachedGet(key, POS_TTL, async () => {
    const data = await getJson(`${JIKAN}/anime/${malId}`);
    const a = data?.data;
    if (!a) return null;
    return {
      malId: a.mal_id,
      titles: [a.title, a.title_english, a.title_japanese, ...(a.titles || []).map((t) => t.title)].filter(Boolean),
      title: a.title_english || a.title || null,
      overview: a.synopsis || null,
      poster: a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || null,
      episodes: a.episodes ?? null,
      year: a.year || null,
    };
  });
}

// ── TVDB v4 (optional; per-user key with TVDB_API_KEY fallback) ────────────
// The key normally comes from the user's saved settings (config.tvdbApiKey).
// Cache entries are scoped by a key hash so one account's responses can never
// be served to another.
const crypto = require('crypto');
const tvdbTokens = new Map(); // keyHash -> { value, exp }

function tvdbKeyHash(apiKey) {
  return crypto.createHash('sha1').update(String(apiKey || '')).digest('hex').slice(0, 12);
}
function resolveTvdbKey(apiKey) {
  return apiKey || process.env.TVDB_API_KEY || '';
}
function tvdbConfigured(apiKey) {
  return !!resolveTvdbKey(apiKey);
}

// TVDB free keys are rate limited. Space calls out slightly so a backfill
// across a whole library cannot burst into 429s.
let tvdbLastCall = 0;
const TVDB_MIN_GAP_MS = Math.max(0, parseInt(process.env.TVDB_MIN_GAP_MS, 10) || 150);
async function tvdbGet(url, opts) {
  const wait = tvdbLastCall + TVDB_MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  tvdbLastCall = Date.now();
  return getJson(url, opts);
}

async function tvdbLogin(apiKey) {
  const key = resolveTvdbKey(apiKey);
  if (!key) return null;
  const hash = tvdbKeyHash(key);
  const now = Date.now();
  const hit = tvdbTokens.get(hash);
  if (hit && now < hit.exp) return hit.value;
  const data = await tvdbGet('https://api4.thetvdb.com/v4/login', {
    method: 'post', data: { apikey: key },
  });
  const token = data?.data?.token || null;
  if (token) tvdbTokens.set(hash, { value: token, exp: now + 20 * 24 * 60 * 60 * 1000 });
  return token;
}

// Key validation for the settings UI.
async function tvdbVerifyKey(apiKey) {
  const token = await tvdbLogin(apiKey);
  return !!token;
}

async function tvdbSearch(apiKey, title) {
  if (!tvdbConfigured(apiKey) || !title) return [];
  const key = `idprov:tvdb:${tvdbKeyHash(resolveTvdbKey(apiKey))}:search:${title.toLowerCase()}`;
  return cachedGet(key, POS_TTL, async () => {
    const token = await tvdbLogin(apiKey);
    const data = await tvdbGet('https://api4.thetvdb.com/v4/search', {
      headers: { Authorization: `Bearer ${token}` },
      params: { query: title, type: 'series', limit: 5 },
    });
    return (data?.data || []).map((r) => ({
      tvdbId: Number(r.tvdb_id) || null,
      title: r.name || null,
      year: r.year ? Number(r.year) : null,
      overview: r.overview || null,
      poster: r.image_url || null,
    }));
  });
}

async function tvdbSeriesExtended(apiKey, tvdbId) {  if (!tvdbConfigured(apiKey) || !tvdbId) return null;
  const key = `idprov:tvdb:${tvdbKeyHash(resolveTvdbKey(apiKey))}:series:${tvdbId}`;
  return cachedGet(key, POS_TTL, async () => {
    const token = await tvdbLogin(apiKey);
    const data = await tvdbGet(`https://api4.thetvdb.com/v4/series/${tvdbId}/extended`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { meta: 'translations' },
    });
    const s = data?.data;
    if (!s) return null;
    return {
      tvdbId: Number(tvdbId),
      title: s.name || null,
      aliases: (s.aliases || []).map((a) => (typeof a === 'string' ? a : (a && (a.name || a.title)) || '')).filter(Boolean),
      overview: s.overview || null,
      poster: s.image || null,
      year: s.year ? Number(s.year) : null,
      status: s.status?.name || null,
      genres: (s.genres || []).map((g) => g.name).filter(Boolean),
      remoteIds: s.remoteIds || [],
    };
  });
}

// TVDB episodes for a series (bounded pages). Only used when a TVDB key is
// configured; results are persisted locally by the worker so no request ever
// needs TVDB.
const TVDB_EPISODE_PAGES = Math.max(1, parseInt(process.env.TVDB_EPISODE_PAGES, 10) || 3);
async function tvdbSeriesEpisodes(apiKey, tvdbId) {
  if (!tvdbConfigured(apiKey) || !tvdbId) return [];
  const key = `idprov:tvdb:${tvdbKeyHash(resolveTvdbKey(apiKey))}:episodes:${tvdbId}`;
  return cachedGet(key, POS_TTL, async () => {
    const token = await tvdbLogin(apiKey);
    const out = [];
    let next = `https://api4.thetvdb.com/v4/series/${tvdbId}/episodes/default?page=0`;
    for (let page = 0; page < TVDB_EPISODE_PAGES && next; page++) {
      const data = await tvdbGet(next, { headers: { Authorization: `Bearer ${token}` } });
      const rows = Array.isArray(data?.data?.episodes) ? data.data.episodes
        : (Array.isArray(data?.data) ? data.data : []);
      for (const ep of rows) {
        if (!ep || ep.number == null) continue;
        out.push({
          season: ep.seasonNumber ?? 0,
          episode: ep.number,
          absolute: ep.absoluteNumber ?? null,
          title: ep.name || null,
          airDate: ep.aired || null,
          runtime: ep.runtime ?? null,
          overview: ep.overview || null,
          ids: { tvdb: ep.id },
        });
      }
      next = data?.links?.next || null;
      if (!Array.isArray(rows) || rows.length === 0) break;
    }
    return out;
  });
}

function status() {
  return { kitsu: true, anilist: true, mal: true, tvdb: tvdbConfigured(), anidb: false };
}

export interface ProvidersApi {
  kitsuSearch: any;
  kitsuAnime: any;
  kitsuMappings: any;
  kitsuAnimeEpisodes: any;
  anilistSearch: any;
  anilistById: any;
  jikanSearch: any;
  jikanById: any;
  tvdbSearch: any;
  tvdbSeriesExtended: any;
  tvdbSeriesEpisodes: any;
  tvdbVerifyKey: any;
  tvdbConfigured: any;
  status: any;
}

module.exports = {
  kitsuSearch, kitsuAnime, kitsuMappings, kitsuAnimeEpisodes,
  anilistSearch, anilistById,
  jikanSearch, jikanById,
  tvdbSearch, tvdbSeriesExtended, tvdbSeriesEpisodes, tvdbVerifyKey,
  tvdbConfigured,
  status,
} satisfies ProvidersApi;