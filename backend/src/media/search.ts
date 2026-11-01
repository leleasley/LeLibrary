// @ts-nocheck
const cache = require('../runtime/cache.ts');
const { searchCandidates, searchPersonCredits, discoverByGenre, getRecommendations, findByImdbId, getImdbId, getImdbIds, titleScore } = require('./tmdb.ts');

const LIMIT = 20;
const CACHE_TTL = 1800;

// Search options a setup can choose (config.searchOptions). Everything off or
// at its default keeps search exactly as it was before 5.9.
const SEARCH_ORDERS = ['relevance', 'popular', 'newest', 'rating'];
const SEARCH_ROW_NAMES = ['movies', 'series', 'anime', 'similar', 'people'];
// Below this many TMDB votes a title counts as little-known. An exact title
// match is always kept: someone typing the full name wants that title.
const OBSCURE_VOTES = 30;

function normalizeSearchOptions(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const names = {};
  const rawNames = value.names && typeof value.names === 'object' ? value.names : {};
  for (const key of SEARCH_ROW_NAMES) {
    const name = typeof rawNames[key] === 'string' ? rawNames[key].trim().slice(0, 60) : '';
    if (name) names[key] = name;
  }
  return {
    enabled: value.enabled !== false,
    animeRow: value.animeRow === true,
    similar: value.similar === true,
    people: value.people === true,
    collections: value.collections === true,
    order: SEARCH_ORDERS.includes(value.order) ? value.order : 'relevance',
    hideObscure: value.hideObscure === true,
    names,
  };
}

// Rows the user picked how to see: drop little-known titles, then order.
// "relevance" keeps the ranking the search already made.
function applySearchOptions(rows, { order = 'relevance', hideObscure = false } = {}) {
  let out = hideObscure
    ? rows.filter((row) => (Number(row._votes) || 0) >= OBSCURE_VOTES || (Number(row._score) || 0) >= 1_000_000)
    : rows.slice();
  const byYear = (row) => String(row.released || row.year || '');
  if (order === 'popular') out.sort((a, b) => (b._pop || 0) - (a._pop || 0));
  else if (order === 'newest') out.sort((a, b) => byYear(b).localeCompare(byYear(a)));
  else if (order === 'rating') {
    // A 10/10 from three votes is not a top-rated film: rated titles with
    // enough votes first, by rating, then the rest by rating.
    const rated = (row) => (Number(row._votes) || 0) >= OBSCURE_VOTES;
    out.sort((a, b) => Number(rated(b)) - Number(rated(a)) || (b._rating || 0) - (a._rating || 0));
  }
  return out;
}

// "tom hanks" names Tom Hanks; "batman" does not name an actor called
// Batman Smith. Every query word must be one of the person's name words (the
// last may be a prefix while typing).
function nameMatchesQuery(name, query) {
  const words = normalize(name).split(' ').filter(Boolean);
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (!tokens.length || !words.length) return false;
  return tokens.every((token, index) => (index === tokens.length - 1
    ? words.some((word) => word.startsWith(token))
    : words.includes(token)));
}

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

// Standard TMDB genre ids by normalized genre name. `movie`/`tv` hold the
// TMDB genre id for each media type (null = genre not available there).
const GENRES = {
  action:     { movie: 28,    tv: 10759 },
  adventure:  { movie: 12,    tv: null },
  animation:  { movie: 16,    tv: 16 },
  comedy:     { movie: 35,    tv: 35 },
  crime:      { movie: 80,    tv: 80 },
  documentary:{ movie: 99,    tv: 99 },
  drama:      { movie: 18,    tv: 18 },
  family:     { movie: 10751, tv: 10751 },
  fantasy:    { movie: 14,    tv: null },
  history:    { movie: 36,    tv: null },
  horror:     { movie: 27,    tv: null },
  kids:       { movie: null,  tv: 10762 },
  music:      { movie: 10402, tv: null },
  mystery:    { movie: 9648,  tv: 9648 },
  reality:    { movie: null,  tv: 10764 },
  romance:    { movie: 10749, tv: null },
  scifi:      { movie: 878,   tv: 10765 },
  'sci fi':   { movie: 878,   tv: 10765 },
  soap:       { movie: null,  tv: 10766 },
  thriller:   { movie: 53,    tv: null },
  war:        { movie: 10752, tv: null },
  western:    { movie: 37,    tv: 37 },
};

function resultScore(query, item) {
  const { text, year } = extractYear(query);
  const q = normalize(text);
  if (!q) return 0;
  const primary = normalize(item.title || item.name || item.original_title || item.original_name);
  const names = [primary].filter(Boolean);
  let best = 0;
  for (const name of names) {
    if (name === q) best = Math.max(best, 1_000_000);
    else if (name.startsWith(q) || name.replace(/^(?:the|a|an)\s+/, '').startsWith(q)) {
      // Among incidental prefix hits, prefer the closest completion. This
      // treats a leading article as optional, keeping "The Matrix" ahead of
      // the more popular "Matriarch" for "Matr" without promoting arbitrary
      // suffix words above a true title prefix.
      const comparable = name.startsWith(q) ? name : name.replace(/^(?:the|a|an)\s+/, '');
      const remaining = Math.max(0, comparable.length - q.length);
      best = Math.max(best, 800_000 + Math.round(100_000 / (remaining + 1)));
    }
    else if (name.includes(q)) best = Math.max(best, 600_000);
    else if (q.split(' ').every((token) => name.split(' ').includes(token))) best = Math.max(best, 400_000);
  }
  for (const alias of [item.original_title, item.original_name].filter(Boolean).map(normalize)) {
    if (alias === q) best = Math.max(best, 200_000);
    else if (alias.includes(q)) best = Math.max(best, 100_000);
  }
  // Keep the title-match tier dominant, then use year as a ranking signal.
  // A requested year should steer results without hiding the right title when
  // release dates differ or the year was mistyped. The two-year mismatch
  // penalty is intentionally bounded below an exact-title tier.
  const requestedYear = year ? Number(year) : 0;
  const date = item.release_date || item.first_air_date || '';
  const actualYear = Number(String(date).slice(0, 4));
  let yearSignal = 0;
  if (requestedYear > 0 && Number.isInteger(requestedYear) && Number.isInteger(actualYear) && actualYear > 0) {
    const difference = Math.abs(requestedYear - actualYear);
    yearSignal = difference === 0 ? 20_000 : difference === 1 ? 10_000 : difference === 2 ? -10_000 : -30_000;
  }
  // titleScore adds fine-grained signal (e.g. "&" ≡ "and") without changing
  // the exact / prefix / contains tier ordering above.
  return best + yearSignal + (Number(titleScore(text, item)) || 0);
}

function bestTitleScore(query, items) {
  let best = 0;
  for (const item of items) {
    const s = titleScore(query, item);
    if (s > best) best = s;
  }
  return best;
}

// "batman 2022" / "ghost in the shell 1995" → { text, year }
function extractYear(query) {
  const m = String(query || '').trim().match(/^(.*?)\s+(1[89]\d{2}|20\d{2})$/);
  if (m && m[1].trim().length > 0) return { text: m[1].trim(), year: m[2] };
  return { text: String(query || '').trim(), year: null };
}

function pLimit(tasks, limit = 6) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try { results[idx] = await tasks[idx](); }
      catch (err) { results[idx] = { error: err }; }
    }
  }
  return Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker)).then(() => results);
}

function buildRow(item, type) {
  const date = item.release_date || item.first_air_date || '';
  const released = date ? new Date(date) : null;
  const row = {
    type: type === 'series' ? 'series' : 'movie',
    name: item.title || item.name || item.original_title || item.original_name,
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
    background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
    posterShape: 'poster',
    releaseInfo: date.slice(0, 4) || undefined,
    year: date.slice(0, 4) || undefined,
    released: released && Number.isFinite(released.getTime()) ? released.toISOString() : undefined,
    description: item.overview || undefined,
    tmdbId: item.id || undefined,
    _score: 0,
    _pop: Number(item.popularity) || 0,
    _votes: Number(item.vote_count) || 0,
    _rating: Number(item.vote_average) || 0,
    _anime: item.isJapaneseAnimation === true,
  };
  return row;
}

function rankRows(rows) {
  rows.sort((a, b) =>
    (Number(b._score) || 0) - (Number(a._score) || 0)
    || (Number(b._pop) || 0) - (Number(a._pop) || 0)
    || (Number(b._votes) || 0) - (Number(a._votes) || 0)
    || String(a.name || '').localeCompare(String(b.name || '')));
}

function cleanRows(rows) {
  const seen = new Set();
  return rows
    .filter(r => {
      if (!r || !r.id || seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    })
    .map(({ _score, _pop, _votes, _rating, _anime, ...result }) => result);
}

async function resolveRows(apiKey, items, type, apiType, lang, q, scored) {
  // One batched IMDb lookup for the whole result page instead of a per-title
  // Redis GET and possible TMDB external_ids call.
  const imdbIds = await getImdbIds(apiKey, apiType, items.map((item) => item.id));
  const rows = [];
  for (const item of items) {
    const imdbId = imdbIds.get(item.id);
    if (!imdbId || !/^tt\d+$/.test(imdbId)) continue;
    const row = buildRow(item, type);
    row.id = imdbId;
    if (scored) row._score = resultScore(q, item);
    rows.push(row);
  }
  rankRows(rows);
  return rows;
}

async function enhanceSearchRows(rows, enhance = {}) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  // Pictorium is a poster provider too, but it is not one of the key/token
  // branches below: it enables itself via `enhance.pictorium.enabled`. Missing
  // that made search return plain TMDB art for Pictorium users while every
  // other catalogue used their Pictorium posters.
  const pictoriumOn = !!(enhance.pictorium && enhance.pictorium.enabled);
  if (!pictoriumOn && !enhance.erdbToken && !enhance.rpdbKey && !enhance.omdbKey && !enhance.fanartKey && !['betterposter', 'custom'].includes(enhance.posterProvider)) return rows;
  // Lazy-load the enhancement module: its library-cache housekeeping interval
  // is unnecessary for plain search/unit-test calls.
  const { enhanceMeta } = require('../catalog/builder.ts');
  // Bounded so a 20-row search cannot fire 20 parallel OMDb/Fanart lookups.
  return pLimit(rows.map((row) => async () => {
    const enhanced = { ...row, imdbId: row.imdbId || row.id };
    await enhanceMeta(enhanced, enhance);
    return enhanced;
  }), 8);
}

// Interactive search is requested several times concurrently by Stremio/Nuvio
// while the user types and while the results screen retries. Coalesce identical
// in-flight searches so a slow TMDB moment triggers ONE upstream attempt shared
// by every duplicate, instead of a retry storm that all fail together.
const inFlightSearches = new Map();

// What a search returns besides the plain title rows: anime split out (or
// only anime), titles like the best match, or the work of a person.
const VARIANTS = ['', 'no-anime', 'anime', 'similar', 'people'];

function optionsFingerprint(opts) {
  const variant = VARIANTS.includes(opts && opts.variant) ? opts.variant : '';
  const order = SEARCH_ORDERS.includes(opts && opts.order) ? opts.order : 'relevance';
  return `${variant || 'all'}|${order}|${opts && opts.hideObscure ? 1 : 0}|${opts && opts.mergePeople === false ? 0 : 1}`;
}

async function searchCatalog(opts) {
  const raw = String((opts && opts.query) || '').trim().toLowerCase().slice(0, 120);
  const key = `${(opts && opts.type) || ''}:${(opts && opts.lang) || ''}:${(opts && opts.limit) || ''}:${(opts && opts.enhanceFingerprint) || ''}:${optionsFingerprint(opts)}:${raw}`;
  const existing = inFlightSearches.get(key);
  if (existing) return existing;
  const pending = searchCatalogInner(opts).finally(() => inFlightSearches.delete(key));
  inFlightSearches.set(key, pending);
  return pending;
}

async function searchCatalogInner({ apiKey, query, type, lang = 'en-US', limit = LIMIT, enhance = {}, enhanceFingerprint = '', variant = '', order = 'relevance', hideObscure = false, mergePeople = true }) {
  if (!VARIANTS.includes(variant)) variant = '';
  const raw = String(query || '').trim().slice(0, 120);
  if (raw.length < 2 || !apiKey) return [];
  const apiType = type === 'series' ? 'tv' : 'movie';
  const metaType = type === 'series' ? 'series' : 'movie';

  const q = normalize(raw);
  if (!q) return [];
  limit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : LIMIT;
  // v5 invalidates cached rankings from before year-aware title ranking and
  // closest-prefix scoring. It continues preserving non-Latin queries,
  // separating result limits and isolating poster/rating fingerprints.
  const optFp = optionsFingerprint({ variant, order, hideObscure, mergePeople });
  const keyParts = (part) => cache.makeKey('search5', apiType, lang, enhanceFingerprint, limit, optFp, part, q);
  const shape = (rows) => {
    let out = rows;
    if (variant === 'anime') out = out.filter((row) => row._anime);
    else if (variant === 'no-anime') out = out.filter((row) => !row._anime);
    return applySearchOptions(out, { order, hideObscure });
  };
  const cached = (key) => cache.get(key).then(hit => (Array.isArray(hit) ? hit : null));
  const store = (key, rows) => cache.set(key, cleanRows(rows).slice(0, limit), CACHE_TTL);
  const finalize = (key, rows) => {
    const clean = cleanRows(rows).slice(0, limit);
    store(key, rows).catch(() => {});
    return clean;
  };
  const finish = async (key, rows) => finalize(key, await enhanceSearchRows(shape(rows), enhance));

  // People row: the films or shows of the person the query names, and only
  // when it really names them (see nameMatchesQuery).
  if (variant === 'people') {
    if (/^tt\d{4,}$/.test(raw) || GENRES[q]) return [];
    const key = keyParts('p');
    const hit = await cached(key);
    if (hit) return hit;
    try {
      const person = await searchPersonCredits(apiKey, raw, type, lang);
      if (!person || !person.results.length || !nameMatchesQuery(person.name || '', raw)) return finish(key, []);
      const rows = await resolveRows(apiKey, person.results, type, apiType, lang, q, false);
      console.log(`[Search] ${type} people "${raw}" -> ${rows.length} results`);
      return finish(key, rows);
    } catch (err) { console.error(`[Search] ${type} people failed:`, err.message); return []; }
  }

  // Similar titles: TMDB recommendations for the one title the query clearly
  // names (an IMDb id, or an exact / prefix title match). A vague query gives
  // no row rather than a guess.
  if (variant === 'similar') {
    if (GENRES[q]) return [];
    const key = keyParts('s');
    const hit = await cached(key);
    if (hit) return hit;
    try {
      let base = null;
      if (/^tt\d{4,}$/.test(raw)) base = await findByImdbId(apiKey, raw);
      else {
        const { text, year } = extractYear(raw);
        const candidates = await searchCandidates(apiKey, text, metaType, year || undefined, lang, limit);
        let best = 0;
        for (const item of candidates) {
          const score = resultScore(raw, item);
          if (score > best) { best = score; base = item; }
        }
        if (best < 800_000) base = null;
      }
      if (!base || !base.id) return finish(key, []);
      const recs = (await getRecommendations(apiKey, base.id, type, lang)).filter((item) => item.id !== base.id);
      const rows = await resolveRows(apiKey, recs, type, apiType, lang, q, false);
      console.log(`[Search] ${type} similar "${raw}" -> ${rows.length} results`);
      return finish(key, rows);
    } catch (err) { console.error(`[Search] ${type} similar failed:`, err.message); return []; }
  }

  // Direct IMDb-id queries ("tt1375666") resolve through the Find API.
  const ttMatch = raw.match(/^tt\d{4,}$/);
  if (ttMatch) {
    const key = keyParts(`i:${raw}`);
    const hit = await cached(key);
    if (hit) return hit;
    try {
      const found = await findByImdbId(apiKey, raw);
      if (!found) return [];
      const row = buildRow(found, type);
      row.id = raw;
      const rows = [row];
      console.log(`[Search] ${type} imdb "${raw}" → 1 result`);
      return finish(key, rows);
    } catch (err) { console.error(`[Search] ${type} imdb failed:`, err.message); return []; }
  }

  // Genre queries: the whole query is a genre name → discover-by-genre rows.
  const genre = GENRES[q];
  if (genre && genre[apiType]) {
    const key = keyParts(`g:${genre[apiType]}`);
    const hit = await cached(key);
    if (hit) return hit;
    try {
      const items = await discoverByGenre(apiKey, genre[apiType], type, lang);
      const rows = await resolveRows(apiKey, items, type, apiType, lang, q, false);
      console.log(`[Search] ${type} genre "${raw}" (id ${genre[apiType]}) → ${rows.length} results`);
      return finish(key, rows);
    } catch (err) { console.error(`[Search] ${type} genre failed:`, err.message); return []; }
  }

  // Title search, with trailing-year support ("batman 2022").
  const { text, year } = extractYear(raw);
  const tKey = keyParts('');
  const hit = await cached(tKey);
  if (hit) return hit;
  try {
    let candidates = await searchCandidates(apiKey, text, metaType, year || undefined, lang, limit);
    if (year) {
      const withYearBest = bestTitleScore(text, candidates);
      const withoutYear = await searchCandidates(apiKey, text, metaType, undefined, lang, limit);
      if (withYearBest < 600 || candidates.length === 0) {
        // Keep both search surfaces. The year-constrained API request can find
        // a remake while the year-free request finds the intended title (or
        // vice versa); resultScore applies a bounded year penalty at ranking.
        const byId = new Map();
        for (const item of [...candidates, ...withoutYear]) {
          if (item && item.id != null && !byId.has(String(item.id))) byId.set(String(item.id), item);
        }
        candidates = [...byId.values()];
      }
    }
    let rows = await resolveRows(apiKey, candidates, type, apiType, lang, raw, true);

    // Person fallback: multi-word queries with no exact title match ("tom hanks").
    // Person-driven rows are merged BELOW title matches (they carry _score 0), so
    // a genuine title search ("harry potter") can never be hijacked by a person
    // sharing the name: title rows always outrank and dedupe wins.
    if (mergePeople && variant !== 'anime' && bestTitleScore(text, candidates) < 100 && q.split(' ').length >= 2) {
      try {
        const person = await searchPersonCredits(apiKey, text, type, lang);
        if (person && person.results.length > 0) {
          const pRows = await resolveRows(apiKey, person.results, type, apiType, lang, q, false);
          if (pRows.length > 0) {
            const seen = new Set(rows.map(r => r.id));
            const merged = [...rows];
            let added = 0;
            for (const pr of pRows) {
              if (seen.has(pr.id)) continue;
              seen.add(pr.id);
              merged.push(pr);
              added++;
            }
            rows = merged;
            console.log(`[Search] ${type} person merged "${raw}" → +${added} rows`);
          }
        }
      } catch (err) { console.error(`[Search] ${type} person failed:`, err.message); }
    }

    console.log(`[Search] ${type} "${raw}" → ${rows.length} results`);
    return finish(tKey, rows);
  } catch (err) { console.error(`[Search] ${type} failed:`, err.message); return []; }
}

export interface SearchApi {
  searchCatalog: any;
  normalizeSearchOptions: any;
  applySearchOptions: any;
  nameMatchesQuery: any;
  SEARCH_ORDERS: string[];
  normalize: any;
  resultScore: any;
  extractYear: any;
  GENRES: any;
}

module.exports = { searchCatalog, normalizeSearchOptions, applySearchOptions, nameMatchesQuery, SEARCH_ORDERS, normalize, resultScore, extractYear, GENRES } satisfies SearchApi;
