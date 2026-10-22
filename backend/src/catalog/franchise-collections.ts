// @ts-nocheck
// ── LeLibrary franchise collections (owned TMDB franchises) ──
// Groups the user's OWNED movies into TMDB franchise/collection metas. This is
// the "LeLibrary Collections" / movie-collection domain: the `torbox:collection:*`
// metas, the single `torbox-collections` movie catalog that serves their films,
// and the saga reverse-index behind "More from this saga" links.
//
// This module is deliberately separate from the Nuvio-native collection
// machinery, which is a different domain: `collection-plan.ts` compiles wizard
// folders/Home rows, `nuvio-library-collections.ts` projects THESE franchise
// metas into native Nuvio folders (it is the only bridge between the two),
// `setup/push.ts` pushes them, and `curated-collections.ts` / `libcatalog.ts`
// serve public curated rows. Do not mix the two: franchise code answers "what
// do I own", Nuvio code answers "how is it displayed".
//
// Matching is TMDB-id only (no IMDb ids in the matching pipeline). The filename
// year can be stale or wrong (e.g. "Toy Story 2" tagged 1995 makes TMDB's
// year-filtered search return Toy Story 1, silently dropping Toy Story 2 from
// the franchise), so when the year-filtered hit isn't an exact title match we
// retry the search without the year and keep the best-scoring result.
//
// A movie's belongs_to_collection discovers candidate folders. For each such
// folder, the collection endpoint /collection/{id}.parts is the membership
// authority: a missing part is excluded even when movie detail claims it;
// when the parts endpoint is unavailable, retain the movie-detail grouping.
// The public website page is a presentation surface, not a membership source.
// The collection object also supplies the official name/overview/poster/art.

const axios = require('axios');
const NodeCache = require('node-cache');
const crypto = require('crypto');
const cache = require('../runtime/cache.ts');
const { searchMetadata, titleScore, getImdbId } = require('../media/tmdb.ts');
const { guessMediaInfo } = require('../media/parser.ts');
const { isJunkVideo } = require('../providers/torbox.ts');

const detailCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
// `${userKey}:${lang}` → Map(collectionId → full meta) so meta requests don't
// re-run the whole build.
const collMetaCache = new Map();
// `${userKey}:${lang}` → Map(movieTmdbId → { key, name, collectionId }) so a
// movie meta/stream request can add a "more from this saga" link/row without
// scanning every collection.
const movieSagaCache = new Map();

const MIN_OWNED = 2; // only show collections with ≥2 owned movies
// Per-user meta/saga maps are bounded: a server with many accounts should not
// accumulate every account's built collections forever. Eviction only forces a
// rebuild when that account is next seen.
const COLL_META_MAX_KEYS = Math.max(100, parseInt(process.env.COLL_META_MAX, 10) || 2000);
function capMapSize(map) {
  while (map.size > COLL_META_MAX_KEYS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

async function pLimit(tasks, limit) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try { results[idx] = await tasks[idx](); }
      catch (err) { results[idx] = { error: err }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// Lightweight /movie/{id} fetch for belongs_to_collection (cached 24h).
async function getMovieDetail(apiKey, tmdbId, lang) {
  const ck = `coll:${tmdbId}:${lang}`;
  const hit = detailCache.get(ck);
  if (hit !== undefined) return hit;
  const redisKey = cache.makeKey('mdetail', 'v1', tmdbId, lang);
  try {
    const persisted = await cache.get(redisKey);
    if (persisted) { detailCache.set(ck, persisted); return persisted; }
  } catch { /* fall through to API */ }
  try {
    const [detailRes, creditsRes] = await Promise.allSettled([
      axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}`, {
        params: { api_key: apiKey, language: lang },
        timeout: 8000,
      }),
      axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}/credits`, {
        params: { api_key: apiKey, language: lang },
        timeout: 8000,
      }),
    ]);
    const d = detailRes.status === 'fulfilled' ? detailRes.value.data : null;
    if (!d) { detailCache.set(ck, null); return null; }
    const credits = creditsRes.status === 'fulfilled' ? creditsRes.value.data : null;
    const cast = (credits?.cast || []).slice(0, 10).map(c => ({
      id: c.id,
      name: c.name,
      character: c.character || '',
      photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
    }));
    const col = d.belongs_to_collection || null;
    const out = {
      collectionId: col ? col.id : null,
      collectionName: col ? col.name : null,
      collectionPoster: col ? col.poster_path : null,
      backdrop: d.backdrop_path || null,
      genres: (d.genres || []).map(g => g.name),
      cast,
    };
    detailCache.set(ck, out);
    cache.set(redisKey, out, 7 * 24 * 60 * 60).catch(() => {});
    return out;
  } catch {
    detailCache.set(ck, null);
    return null;
  }
}

// Authoritative franchise membership + artwork (cached 24h). parts[] is the
// ground truth for what belongs to a collection.
async function getCollectionDetails(apiKey, collectionId, lang) {
  const ck = `collparts:${collectionId}:${lang}`;
  const hit = detailCache.get(ck);
  if (hit !== undefined) return hit;
  const redisKey = cache.makeKey('collparts', 'v1', collectionId, lang);
  try {
    const persisted = await cache.get(redisKey);
    if (persisted) { detailCache.set(ck, persisted); return persisted; }
  } catch { /* fall through to API */ }
  try {
    const res = await axios.get(`https://api.themoviedb.org/3/collection/${collectionId}`, {
      params: { api_key: apiKey, language: lang },
      timeout: 8000,
    });
    const d = res.data || {};
    const out = {
      id: d.id,
      name: d.name || 'Collection',
      overview: d.overview || '',
      poster: d.poster_path || null,
      backdrop: d.backdrop_path || null,
      parts: (d.parts || []).map(p => ({
        id: p.id,
        title: p.title || p.name || p.original_title || p.original_name || '',
        release_date: p.release_date || '',
      })),
    };
    detailCache.set(ck, out);
    cache.set(redisKey, out, 7 * 24 * 60 * 60).catch(() => {});
    return out;
  } catch {
    detailCache.set(ck, null);
    return null;
  }
}

// A movie detail's belongs_to_collection field can be stale or inconsistent
// with the collection endpoint. When the official parts list is available, it
// is the membership authority for the owned-franchise projection.
function filterOfficialCollectionMembers(ownedMovies, parts) {
  if (!Array.isArray(parts)) return ownedMovies;
  const officialIds = new Set(parts.map(part => String(part?.id || '')).filter(id => /^\d+$/.test(id)));
  return ownedMovies.filter(movie => officialIds.has(String(movie?.result?.id || '')));
}

// Match a movie title to a TMDB movie. The filename year can be wrong/stale
// (TMDB's year filter then returns a different film with the same title), so
// a year-filtered hit that isn't an exact title match is retried without the
// year and the best-scoring result wins. Returns the TMDB result object.
async function matchMovie(tmdbApiKey, title, year, lang) {
  const s = r => (r ? titleScore(title, r) : 0);
  if (year) {
    const withYear = await searchMetadata(tmdbApiKey, title, 'movie', year, lang);
    if (s(withYear) >= 90) return withYear; // exact title + year: trust it
    const withoutYear = await searchMetadata(tmdbApiKey, title, 'movie', undefined, lang);
    if (s(withoutYear) > s(withYear)) return withoutYear;
    return withYear || null;
  }
  return searchMetadata(tmdbApiKey, title, 'movie', undefined, lang);
}

function titleKey(title, year) {
  return (title || '').toLowerCase().replace(/[^a-z0-9]/g, '') + '|' + (year || '');
}

// Non-numeric id tokens so the client can't misresolve a collection id as a
// TMDB movie/TV id. TMDB collection ids collide with TMDB tv/movie ids (e.g.
// Child's Play collection = 10455, which is also the TV show "Singled Out"),
// and Stremio/Nuvio then show that unrelated title. A slug + letters-only hash
// can never be looked up as a TMDB id.
const HASH_CHARS = 'abcdefghijklmnopqrstuvwxyz';
function lettersHash(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  let n = h >>> 0, out = '';
  for (let i = 0; i < 5; i++) { out += HASH_CHARS[n % 26]; n = Math.floor(n / 26); }
  return out;
}
function slugify(s) {
  // Digit-led franchises ("101 Dalmatians") must not leave a leading dash
  // after the numeric strip: Stremio shows these ids in Discover URLs.
  // NOTE: this changes keys for digit-prefixed franchises only; the hash
  // suffix is stable, and saga links regenerate from the current index.
  return String(s || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[0-9]+/, '').replace(/^-+/, '')
    .slice(0, 40) || 'collection';
}
function collectionKey(name, id) {
  // e.g. "toy-story-collection-bxgqk": no numeric segment anywhere.
  return `${slugify(name)}-${lettersHash(id)}`;
}

// Poster providers applied to the films inside collections (TMDB ids only -
// matching and poster URLs never depend on IMDb ids). Same services and URL
// shapes the movie catalog rows already use.
function enhancedPosterUrl(tmdbId, imdbId, enhance) {
  const { erdbToken, rpdbKey, posterProvider, customPosterTemplate } = enhance || {};
  if (posterProvider === 'custom') {
    return require('../media/poster-template.ts').resolve(customPosterTemplate, { tmdbId, imdbId, type: 'movie' });
  }
  if (enhance?.pictorium?.enabled && enhance.pictorium.token) {
    const url = require('./builder.ts').buildPictoriumPosterUrl(enhance, { type: 'movie', id: tmdbId || imdbId, imdbId, fallback: '' });
    if (url) return url;
  }
  if (erdbToken && tmdbId) return `https://easyratingsdb.com/${erdbToken}/poster/tmdb:movie:${tmdbId}`;
  if (rpdbKey && tmdbId) return `https://api.ratingposterdb.com/${rpdbKey}/tmdb/poster-default/movie-${tmdbId}.jpg?fallback=true`;
  return null;
}

const collectionsBuildInFlight = new Map();

// Coalesce identical concurrent builds. The signature hashes poster settings
// too because built metas embed per-user poster URLs (ERDB/RPDB tokens), so
// two different users must never share a build.
function collectionsBuildSignature(movies, lang, enhance) {
  const h = crypto.createHash('sha1');
  for (const m of movies) h.update(`${String(m.title || '').toLowerCase()}|${m.year || ''}\n`);
  h.update(lang || '');
  h.update(JSON.stringify(enhance || {}));
  return h.digest('hex');
}

// Build collection metas for a user's downloads. Returns [{ id, type, name,
// poster, background, description, videos }].
async function buildCollectionsCatalog(downloads, tmdbApiKey, lang = 'en-US', enhance = {}) {
  // 1. Collect unique movie titles (movies only, deduped by title+year)
  const seen = new Set();
  const movies = [];
  for (const item of downloads || []) {
    const name = item.name || item.filename || '';
    if (isJunkVideo(name)) continue;
    const info = guessMediaInfo(name);
    if (!info || info.isSeries || info.isAnime) continue;
    const key = titleKey(info.title, info.year);
    if (seen.has(key)) continue;
    seen.add(key);
    movies.push({ title: info.title, year: info.year });
  }

  const signature = collectionsBuildSignature(movies, lang, enhance);
  const running = collectionsBuildInFlight.get(signature);
  if (running) return running;
  const work = buildCollectionsInner(movies, tmdbApiKey, lang, enhance)
    .finally(() => collectionsBuildInFlight.delete(signature));
  collectionsBuildInFlight.set(signature, work);
  return work;
}

async function buildCollectionsInner(movies, tmdbApiKey, lang = 'en-US', enhance = {}) {

  // 2. Match each unique title to TMDB (robust to a wrong/stale filename year)
  const searchResults = await pLimit(movies.map(m => async () => {
    try {
      const r = await matchMovie(tmdbApiKey, m.title, m.year || undefined, lang);
      return { ...m, result: r };
    } catch {
      return { ...m, result: null };
    }
  }), 6);

  const matched = searchResults.filter(m => m.result && titleScore(m.title, m.result) > 0);
  if (matched.length === 0) return [];

  // 3. Fetch collection info per unique movie (belongs_to_collection)
  const detailResults = await pLimit(matched.map(m => async () => {
    const detail = await getMovieDetail(tmdbApiKey, m.result.id, lang);
    return { ...m, detail };
  }), 6);

  // 4. Group by collection, deduping movies by TMDB id so a film owned in
  // multiple files/releases never becomes duplicate episodes.
  const byCol = new Map();
  for (const m of detailResults) {
    if (!m.detail || !m.detail.collectionId) continue;
    const cid = m.detail.collectionId;
    if (!byCol.has(cid)) {
      byCol.set(cid, {
        id: cid,
        name: m.detail.collectionName || 'Collection',
        poster: m.detail.collectionPoster || m.result.poster_path || '',
        backdrop: m.detail.backdrop || m.result.backdrop_path || '',
        genres: new Set(m.detail.genres || []),
        movies: new Map(),
      });
    }
    const col = byCol.get(cid);
    for (const g of (m.detail.genres || [])) col.genres.add(g);
    if (!col.movies.has(m.result.id)) {
      col.movies.set(m.result.id, { result: m.result, detail: m.detail, title: m.title });
    }
  }

  // 5. Build metas (only collections with ≥2 owned movies). The collection
  // endpoint supplies the official name/overview/artwork and the franchise's
  // full film count, so the row shows how many films are owned vs total.
  // Build eligible franchises in parallel: each franchise needs one collection
  // endpoint call plus its owned films' IMDb ids. Collection data is global and
  // now Redis-cached, so this is mostly cache lookups after warm-up.
  const eligible = [...byCol.values()].filter(c => c.movies.size >= MIN_OWNED);
  const built = await pLimit(eligible.map(c => async () => {
    const coll = await getCollectionDetails(tmdbApiKey, c.id, lang);
    const name = (coll && coll.name) || c.name;
    const totalParts = coll ? coll.parts.length : c.movies.size;
    // The collection endpoint is canonical within this candidate collection.
    // Keep movie-level claims only when its parts list is unavailable.
    const ownedMovies = filterOfficialCollectionMembers([...c.movies.values()], coll?.parts);
    if (ownedMovies.length < MIN_OWNED) return null;
    ownedMovies.sort((a, b) => (a.result.release_date || '9999').localeCompare(b.result.release_date || '9999'));
    // IMDb ids for each owned film (cached): lets the "Use Main Meta" flat film
    // catalog emit tt: rows so the films get the full main-metadata/external experience.
    const imdbIds = await pLimit(ownedMovies.map(m => async () => {
      const imdbId = await getImdbId(tmdbApiKey, 'movie', m.result.id).catch(() => null);
      return { id: m.result.id, imdbId };
    }), 6);
    const imdbByTmdb = new Map(imdbIds.filter(x => x && x.imdbId).map(x => [String(x.id), x.imdbId]));
    const years = ownedMovies.map(m => (m.result.release_date || '').slice(0, 4)).filter(Boolean);
    const key = collectionKey(name, c.id);
    const genres = [...c.genres].slice(0, 6);
    const yearRange = years.length
      ? `${years[0]}${years[years.length - 1] !== years[0] ? '-' + years[years.length - 1] : ''}`
      : '';
    const ownedCount = ownedMovies.length;
    const description = ownedCount === totalParts
      ? `All ${ownedCount} films in this franchise are in your library${yearRange ? ` (${yearRange})` : ''}.`
      : `${ownedCount} of ${totalParts} films in this franchise are in your library${yearRange ? ` (${yearRange})` : ''}.`;
    const castMap = new Map();
    for (const m of ownedMovies) {
      for (const cc of (m.detail?.cast || [])) {
        if (!castMap.has(cc.id)) castMap.set(cc.id, cc);
      }
    }
    const cast = [...castMap.values()].slice(0, 20);
    return {
      id: `torbox:collection:${key}`,
      type: 'series',
      name,
      // Raw TMDB collection id (e.g. 10194 for Toy Story): harmless extra
      // field, used for the movie → saga reverse index and by NuvioWeb's native
      // "Collection" tab on detail pages.
      collectionId: c.id,
      poster: (coll && coll.poster)
        ? `https://image.tmdb.org/t/p/w500${coll.poster}`
        : (c.poster ? `https://image.tmdb.org/t/p/w500${c.poster}` : null),
      background: (coll && coll.backdrop)
        ? `https://image.tmdb.org/t/p/w1280${coll.backdrop}`
        : (c.backdrop ? `https://image.tmdb.org/t/p/w1280${c.backdrop}` : null),
      description,
      year: years[years.length - 1] || '',
      releaseInfo: yearRange,
      genres,
      status: 'Ended',
      app_extras: cast.length ? { cast } : undefined,
      videos: ownedMovies.map((m, i) => {
        const year = (m.result.release_date || '').slice(0, 4);
        const imdbId = imdbByTmdb.get(String(m.result.id)) || null;
        const enhanced = enhancedPosterUrl(m.result.id, imdbId, enhance);
        return {
          id: `torbox:collection:${key}:${m.result.id}`,
          title: `${m.result.title || m.title}${year ? ` (${year})` : ''}`,
          tmdbId: m.result.id,
          imdbId,
          season: 1,
          episode: i + 1,
          released: m.result.release_date || undefined,
          thumbnail: enhanced
            || (m.result.poster_path ? `https://image.tmdb.org/t/p/w300${m.result.poster_path}` : undefined),
        };
      }),
    };
  }), 6);
  const metas = built.filter(m => m && !m.error);

  metas.sort((a, b) => a.name.localeCompare(b.name));
  return metas;
}

// Cache the built metas per user+lang so meta requests are instant. Keyed by
// the full non-numeric meta token (the part after "torbox:collection:").
function cacheCollections(userKey, lang, metas) {
  const map = new Map();
  const sagaIndex = new Map();
  for (const m of metas) {
    const token = m.id.split(':')[2];
    if (token) map.set(token, m);
    if (m.collectionId && Array.isArray(m.videos)) {
      for (const v of m.videos) {
        if (v.tmdbId) {
          sagaIndex.set(String(v.tmdbId), { key: token, name: m.name, collectionId: m.collectionId });
        }
      }
    }
  }
  collMetaCache.set(`${userKey}:${lang}`, map);
  movieSagaCache.set(`${userKey}:${lang}`, sagaIndex);
  capMapSize(collMetaCache);
  capMapSize(movieSagaCache);
}

// The saga a movie belongs to, for the current user's built collections. Used
// by the addon to add a "more from this saga" link/stream row on movie metas
// and streams. Returns null when the movie isn't in a built saga (e.g. it's
// the only owned film of a franchise, or collections aren't built yet).
function getCollectionForMovie(userKey, lang, tmdbId) {
  const idx = movieSagaCache.get(`${userKey}:${lang}`);
  return idx ? idx.get(String(tmdbId)) || null : null;
}

function getCollectionMeta(userKey, lang, token) {
  const map = collMetaCache.get(`${userKey}:${lang}`);
  return map ? map.get(String(token)) || null : null;
}

// All collection metas for a user+lang (empty if not built yet).
function getCollections(userKey, lang) {
  const map = collMetaCache.get(`${userKey}:${lang}`);
  return map ? [...map.values()] : [];
}

// In-flight guard for background refreshes (per user+lang+poster config).
const collectionsRefreshInFlight = new Set();

// Background projection refresh for the indexed engine: rebuild the owned
// franchise metas from a provider snapshot the caller already holds (the sync
// worker calls this right after a sync) and publish them to BOTH the
// in-memory maps the routes read AND the persistent Redis key cold routes
// restore from. Fire-and-forget only: routes never block on this, which is
// what keeps a 4000-title library from timing out Stremio on first view.
// The key shape MUST match the persistentKey the catalog routes restore;
// sortBy/posterFp are the caller's so this stays a pure function of them.
async function refreshCollectionsProjection({ userKey, downloads, tmdbApiKey, lang = 'en-US', enhance = {}, sortBy = 'data_adicao', posterFp = '' }) {
  if (!userKey || !tmdbApiKey || !Array.isArray(downloads) || downloads.length === 0) return null;
  const flightKey = `${userKey}:${lang}:${posterFp}`;
  if (collectionsRefreshInFlight.has(flightKey)) return null;
  collectionsRefreshInFlight.add(flightKey);
  try {
    const metas = await buildCollectionsCatalog(downloads, tmdbApiKey, lang, enhance);
    if (metas.length > 0) {
      cacheCollections(userKey, lang, metas);
      // Lazy: routes/shared pulls the addon router chain; a top-level import
      // here would cycle back through the routes that require this module.
      const { TTL_CATALOG } = require('../runtime/refresh.ts');
      const persistentKey = cache.makeKey('cat', 'collections', 'collections', sortBy, '', '0', userKey, lang, posterFp);
      await cache.set(persistentKey, { metas }, TTL_CATALOG).catch(() => {});
      console.log(`[Collections] background refresh → ${metas.length} items`);
    }
    return metas;
  } catch (err) {
    console.warn(`[Collections] background refresh failed: ${err.message}`);
    return null;
  } finally {
    collectionsRefreshInFlight.delete(flightKey);
  }
}

export interface FranchiseCollectionsApi {
  buildCollectionsCatalog: any;
  cacheCollections: any;
  getCollectionMeta: any;
  getCollections: any;
  getCollectionForMovie: any;
  getMovieDetail: any;
  refreshCollectionsProjection: any;
  collectionKey: any;
  filterOfficialCollectionMembers: any;
}

module.exports = { buildCollectionsCatalog, cacheCollections, getCollectionMeta, getCollections, getCollectionForMovie, getMovieDetail, refreshCollectionsProjection, collectionKey, filterOfficialCollectionMembers } satisfies FranchiseCollectionsApi;
