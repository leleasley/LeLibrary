// ── Collections catalog builder ──────────────────────────────
// Groups the user's owned movies into TMDB franchise/collection rows for the
// addon. Each collection becomes a "series"-type meta whose "episodes" are the
// owned movies; clicking an episode resolves to the owned movie's stream (via
// the existing buildStreams path in builder.js). Entirely additive — existing
// movie/series/anime catalogs, meta and streams are untouched.
//
// TMDB has no batch endpoint, so each unique movie costs a search + a detail
// call on first build. Both are cached (tmdb.js NodeCache + our own detail
// cache + Redis catalog cache) so repeat builds are fast.

const axios = require('axios');
const NodeCache = require('node-cache');
const { searchMetadata } = require('./tmdb');
const { guessMediaInfo } = require('./parser');

const detailCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
// `${userKey}:${lang}` → Map(collectionId → full meta) so meta requests don't
// re-run the whole build.
const collMetaCache = new Map();

const MIN_OWNED = 2; // only show collections with ≥2 owned movies

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
  try {
    const res = await axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}`, {
      params: { api_key: apiKey, language: lang },
      timeout: 8000,
    });
    const d = res.data;
    const col = d.belongs_to_collection || null;
    const out = {
      collectionId: col ? col.id : null,
      collectionName: col ? col.name : null,
      collectionPoster: col ? col.poster_path : null,
      backdrop: d.backdrop_path || null,
      genres: (d.genres || []).map(g => g.name),
    };
    detailCache.set(ck, out);
    return out;
  } catch {
    detailCache.set(ck, null);
    return null;
  }
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
  return String(s || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[0-9]+/, '')
    .slice(0, 40) || 'collection';
}
function collectionKey(name, id) {
  // e.g. "childs-play-collection-bxgqk" — no numeric segment anywhere.
  return `${slugify(name)}-${lettersHash(id)}`;
}

// Build collection metas for a user's downloads. Returns [{ id, type, name,
// poster, background, description, videos }].
async function buildCollectionsCatalog(downloads, tmdbApiKey, lang = 'pt-BR') {
  // 1. Collect unique movie titles (movies only, deduped by title+year)
  const seen = new Set();
  const movies = [];
  for (const item of downloads || []) {
    const name = item.name || item.filename || '';
    const info = guessMediaInfo(name);
    if (!info || info.isSeries || info.isAnime) continue;
    const key = titleKey(info.title, info.year);
    if (seen.has(key)) continue;
    seen.add(key);
    movies.push({ title: info.title, year: info.year });
  }

  // 2. Match each unique title to TMDB (searchMetadata has its own NodeCache)
  const searchResults = await pLimit(movies.map(m => async () => {
    try {
      const r = await searchMetadata(tmdbApiKey, m.title, 'movie', m.year || undefined, lang);
      return { ...m, result: r };
    } catch {
      return { ...m, result: null };
    }
  }), 6);

  const matched = searchResults.filter(m => m.result && !m.result.error);
  if (matched.length === 0) return [];

  // 3. Fetch collection info per unique movie
  const detailResults = await pLimit(matched.map(m => async () => {
    const detail = await getMovieDetail(tmdbApiKey, m.result.id, lang);
    return { ...m, detail };
  }), 6);

  // 4. Group by collection
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
        movies: [],
      });
    }
    byCol.get(cid).movies.push({ result: m.result, detail: m.detail, title: m.title });
  }

  // 5. Build metas (only collections with ≥2 owned movies), movies sorted by release
  const metas = [];
  for (const c of byCol.values()) {
    if (c.movies.length < MIN_OWNED) continue;
    c.movies.sort((a, b) => (a.result.release_date || '').localeCompare(b.result.release_date || ''));
    const years = c.movies.map(m => (m.result.release_date || '').slice(0, 4)).filter(Boolean);
    const genres = [...new Set(c.movies.flatMap(m => m.detail.genres || []))].slice(0, 6);
    const key = collectionKey(c.name, c.id);
    metas.push({
      id: `torbox:collection:${key}`,
      type: 'series',
      name: c.name,
      poster: c.poster ? `https://image.tmdb.org/t/p/w500${c.poster}` : null,
      background: c.backdrop ? `https://image.tmdb.org/t/p/w1280${c.backdrop}` : null,
      description: `${c.movies.length} films in your library — ${years[0] || ''}${years[0] && years[years.length - 1] !== years[0] ? '-' + years[years.length - 1] : ''}`,
      year: years[years.length - 1] || '',
      releaseInfo: years[0] ? `${years[0]}${years[years.length - 1] !== years[0] ? '-' + years[years.length - 1] : ''}` : '',
      genres,
      status: 'Ended',
      videos: c.movies.map((m, i) => {
        const year = (m.result.release_date || '').slice(0, 4);
        return {
          id: `torbox:collection:${key}:${m.result.id}`,
          title: `${m.result.title || m.title}${year ? ` (${year})` : ''}`,
          season: 1,
          episode: i + 1,
          released: m.result.release_date || undefined,
          thumbnail: m.result.poster_path
            ? `https://image.tmdb.org/t/p/w300${m.result.poster_path}`
            : undefined,
        };
      }),
    });
  }

  metas.sort((a, b) => a.name.localeCompare(b.name));
  return metas;
}

// Cache the built metas per user+lang so meta requests are instant. Keyed by
// the full non-numeric meta token (the part after "torbox:collection:").
function cacheCollections(userKey, lang, metas) {
  const map = new Map();
  for (const m of metas) {
    const token = m.id.split(':')[2];
    if (token) map.set(token, m);
  }
  collMetaCache.set(`${userKey}:${lang}`, map);
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

module.exports = { buildCollectionsCatalog, cacheCollections, getCollectionMeta, getCollections, getMovieDetail };
