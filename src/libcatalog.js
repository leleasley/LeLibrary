// ── Catalog library runtime ─────────────────────────────────
// Serves rows for the catalog-library rows (src/catalogdefs.js). Each handler
// maps to TMDB/MDBList/Trakt fetchers that produce plain tt: rows (id = IMDb
// id, tmdbId kept), identical in shape to the discovery rows so external stream
// addons + Nuvio enrichment + poster providers all work for free.
//
// Rows are cached per catalog id + lang + poster fingerprint (shared across
// users where possible: the catalog content is not per-user, only the poster
// providers are, and those go into the cache key via posterFp).

const cache = require('./cache');
const axios = require('axios');
const { getTrending, getPopular, buildDiscoveryMetas, getImdbId } = require('./tmdb');
const { normalizeImdbId } = require('./identity');
const { buildErdbUrl, buildRpdbUrl, buildBetterPosterUrl, getFanartArt } = require('./builder');
const { applyRotation } = require('./catalog-rotation');

const TTL_LIB = 24 * 60 * 60; // 24h: these rows don't change often
const TMDB_IMAGE = 'https://image.tmdb.org/t/p';
const DISCOVER_PAGES = 2; // ~40 titles per row
const importedSingleFlight = new Map();

class ImportedSourceUpstreamError extends Error {
  constructor(message, { provider, status = 0, temporary = false, code = 'upstream_error' } = {}) {
    super(message);
    this.name = 'ImportedSourceUpstreamError';
    this.provider = provider;
    this.status = status;
    this.temporary = temporary;
    this.code = code;
  }
}

function hashShort(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Library-source rows are discovery rows too: they carry public IMDb ids and
// therefore need the same user-selected artwork precedence as Trending and
// Popular. This used to be missing, leaving every curated folder on TMDB art.
async function enhanceCatalogRows(rows, enhance = {}) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const { erdbToken, rpdbKey, fanartKey, posterProvider } = enhance;
  if (!erdbToken && !rpdbKey && !fanartKey && posterProvider !== 'betterposter') return rows;
  return Promise.all(rows.map(async (row) => {
    if (!row || typeof row !== 'object') return row;
    const imdbId = normalizeImdbId(row.id || row.imdbId);
    if (erdbToken && imdbId) return { ...row, poster: buildErdbUrl(erdbToken, 'poster', imdbId) };
    if (rpdbKey && imdbId) return { ...row, poster: buildRpdbUrl(rpdbKey, 'imdb', 'poster-default', imdbId) };
    if (posterProvider === 'betterposter' && imdbId) return { ...row, poster: buildBetterPosterUrl(imdbId, row.type), posterShape: 'poster' };
    if (fanartKey && row.tmdbId) {
      const art = await getFanartArt(fanartKey, row.tmdbId, row.type === 'movie' ? 'movie' : 'tv').catch(() => null);
      if (art?.poster) return { ...row, poster: art.poster };
    }
    return row;
  }));
}

// ── TMDB discover fetch (shared by provider/genre/company/person/network) ──
// Returns an array of raw TMDB items ({ id, title|name, poster_path, ... }).
async function discover(tmdbApiKey, apiType, params, lang = 'en-US') {
  const res = await axios.get(`https://api.themoviedb.org/3/discover/${apiType}`, {
    params: { api_key: tmdbApiKey, language: lang || 'en-US', sort_by: params.sort || 'popularity.desc', page: 1, ...params.tmdb },
    timeout: 15000,
  });
  return (res.data && res.data.results) || [];
}

// Poster path lookup with an in-process memo. trakt_list / mdb_list rows carry
// a tmdbId but no artwork; without this they rendered blank cards.
const _posterMemo = new Map();
async function tmdbPosterPath(tmdbApiKey, apiType, tmdbId) {
  if (!tmdbApiKey || !tmdbId) return null;
  const key = `${apiType}:${tmdbId}`;
  if (_posterMemo.has(key)) return _posterMemo.get(key);
  try {
    const res = await axios.get(`https://api.themoviedb.org/3/${apiType}/${tmdbId}`, { params: { api_key: tmdbApiKey }, timeout: 10000 });
    const path = (res.data && res.data.poster_path) || null;
    _posterMemo.set(key, path);
    return path;
  } catch { return null; }
}
// Bounded-concurrency enrichment so a 100-item list doesn't fire 100
// simultaneous TMDB calls (rate-limit ban risk for the owner's key).
async function backfillPosters(tmdbApiKey, apiType, rows, limit = 8) {
  let i = 0;
  async function worker() {
    while (i < rows.length) {
      const row = rows[i++];
      if (!row || row.poster || !row.tmdbId) continue;
      const path = await tmdbPosterPath(tmdbApiKey, apiType, row.tmdbId);
      if (path) row.poster = `${TMDB_IMAGE}/w500${path}`;
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, worker));
  return rows;
}

// ── Row builders ─────────────────────────────────────────────
// Build tt: rows from raw TMDB items (like buildDiscoveryMetas but without
// re-fetching imdb ids one-by-one: we batch them via getImdbId below).
async function tmdbItemsToRows(tmdbApiKey, apiType, items, type) {
  const input = Array.isArray(items) ? items : [];
  const enriched = new Array(input.length);
  let cursor = 0;
  async function worker() {
    while (cursor < input.length) {
      const index = cursor++;
      const item = input[index];
      let imdbId = null;
      try { imdbId = await getImdbId(tmdbApiKey, apiType, item.id); } catch {}
      enriched[index] = { item, imdbId };
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, input.length) }, worker));
  const rows = [];
  for (const { item, imdbId } of enriched) {
    if (!imdbId) continue;
    const name = item.title || item.name || item.original_title || item.original_name || '';
    const date = item.release_date || item.first_air_date || '';
    rows.push({
      id: imdbId,
      tmdbId: item.id,
      type,
      name,
      poster: item.poster_path ? `${TMDB_IMAGE}/w500${item.poster_path}` : null,
      background: item.backdrop_path ? `${TMDB_IMAGE}/w1280${item.backdrop_path}` : null,
      posterShape: 'poster',
      releaseInfo: date.slice(0, 4) || undefined,
      released: date ? new Date(date).toISOString() : undefined,
      year: date.slice(0, 4) || undefined,
      description: item.overview || undefined,
    });
  }
  return rows;
}

function classifyImportedError(error, provider) {
  const status = Number(error?.response?.status || 0);
  const temporary = !status || status === 408 || status === 425 || status === 429 || status >= 500;
  const code = status === 404 ? 'source_not_found'
    : status === 401 || status === 403 ? 'source_unavailable'
      : status === 429 ? 'rate_limited' : temporary ? 'temporary_upstream_error' : 'upstream_error';
  return new ImportedSourceUpstreamError(`${provider} source is unavailable`, { provider, status, temporary, code });
}

async function singleFlight(key, work) {
  if (importedSingleFlight.has(key)) return importedSingleFlight.get(key);
  const pending = Promise.resolve().then(work).finally(() => importedSingleFlight.delete(key));
  importedSingleFlight.set(key, pending);
  return pending;
}

function importedTtls(definition) {
  if (definition.provider === 'trakt') return { upstream: 30 * 60, rendered: 15 * 60 };
  if (definition.engine === 'collection') return { upstream: 6 * 60 * 60, rendered: 60 * 60 };
  return { upstream: 60 * 60, rendered: 30 * 60 };
}

async function fetchNormalizedImportedPage({ definition, page, tmdbApiKey, lang, request, convertTmdb }) {
  const mediaType = definition.mediaType;
  const apiType = mediaType === 'series' ? 'tv' : 'movie';
  try {
    if (definition.provider === 'tmdb' && definition.engine === 'discover') {
      const response = await request(`https://api.themoviedb.org/3/discover/${apiType}`, {
        params: { api_key: tmdbApiKey, language: lang, page, sort_by: definition.params.sortBy, ...definition.params.filters }, timeout: 15000,
      });
      const items = Array.isArray(response.data?.results) ? response.data.results : [];
      return {
        rows: await convertTmdb(tmdbApiKey, apiType, items, mediaType),
        terminal: page >= Number(response.data?.total_pages || page) || items.length < 20,
      };
    }
    if (definition.provider === 'tmdb' && definition.engine === 'list') {
      const response = await request(`https://api.themoviedb.org/4/list/${definition.params.listId}`, {
        params: { api_key: tmdbApiKey, language: lang, page }, timeout: 15000,
      });
      const mixed = Array.isArray(response.data?.results) ? response.data.results
        : Array.isArray(response.data?.items) ? response.data.items : [];
      const items = mixed.filter(item => {
        const kind = item.media_type || item.mediaType;
        return kind === apiType || (kind === 'tv' && mediaType === 'series');
      });
      return {
        rows: await convertTmdb(tmdbApiKey, apiType, items, mediaType),
        terminal: page >= Number(response.data?.total_pages || page) || mixed.length === 0,
      };
    }
    if (definition.provider === 'tmdb' && definition.engine === 'collection') {
      if (page > 1) return { rows: [], terminal: true };
      const response = await request(`https://api.themoviedb.org/3/collection/${definition.params.collectionId}`, {
        params: { api_key: tmdbApiKey, language: lang }, timeout: 15000,
      });
      const items = Array.isArray(response.data?.parts) ? response.data.parts : [];
      return { rows: await convertTmdb(tmdbApiKey, 'movie', items, 'movie'), terminal: true };
    }
    if (definition.provider === 'trakt' && definition.engine === 'list') {
      if (!process.env.TRAKT_CLIENT_ID) throw new ImportedSourceUpstreamError('Trakt is not configured', { provider: 'trakt', code: 'provider_not_configured' });
      const endpoint = mediaType === 'series' ? 'shows' : 'movies';
      const response = await request(`https://api.trakt.tv/lists/${definition.params.listId}/items/${endpoint}`, {
        params: { page, limit: 100 },
        headers: { 'trakt-api-version': '2', 'trakt-api-key': process.env.TRAKT_CLIENT_ID }, timeout: 15000,
      });
      const items = Array.isArray(response.data) ? response.data : [];
      const rows = [];
      for (const entry of items) {
        const item = entry.movie || entry.show || {};
        const ids = item.ids || {};
        const imdbId = normalizeImdbId(ids.imdb);
        if (!imdbId) continue;
        rows.push({ id: imdbId, tmdbId: ids.tmdb || undefined, type: mediaType, name: item.title || '', posterShape: 'poster', year: item.year ? String(item.year) : undefined, releaseInfo: item.year ? String(item.year) : undefined });
      }
      const pageCount = Number(response.headers?.['x-pagination-page-count'] || 0);
      return { rows, terminal: pageCount ? page >= pageCount : items.length < 100 };
    }
    return { rows: [], terminal: true };
  } catch (error) {
    if (error instanceof ImportedSourceUpstreamError) throw error;
    throw classifyImportedError(error, definition.provider);
  }
}

async function buildNormalizedImportedCatalog({
  definition, tmdbApiKey, lang = 'en-US', skip = 0, search = '', enhance = {}, posterFp = '',
  pageSize = 50, maxSkip = 5000, runtime = {},
}) {
  const { normalizeImportedSourceDefinition } = require('./import-sources/definition');
  const source = normalizeImportedSourceDefinition(definition);
  const logicalSkip = Math.max(0, Math.trunc(Number(skip) || 0));
  if (logicalSkip > maxSkip) return [];
  const logicalSize = Math.min(100, Math.max(1, Math.trunc(Number(pageSize) || 50)));
  const cacheStore = runtime.cache || cache;
  const request = runtime.request || axios.get;
  const convertTmdb = runtime.convertTmdb || tmdbItemsToRows;
  const backfill = runtime.backfillPosters || backfillPosters;
  const ttls = importedTtls(source);
  // Cache only public/base rows. Enhanced poster URLs can contain an account
  // token in their path and must never be persisted in an imported cache.
  const renderedKey = cache.makeKey('cat', 'imp-render-v1', source.signature, lang, String(logicalSkip), String(logicalSize));
  const rendered = await cacheStore.get(renderedKey);
  if (Array.isArray(rendered)) {
    let output = await enhanceCatalogRows(rendered, enhance);
    return search ? output.filter(row => (row.name || '').toLowerCase().includes(search.toLowerCase())) : output;
  }

  const wanted = logicalSkip + logicalSize;
  const rows = [];
  const seen = new Set();
  for (let page = 1; page <= 250 && rows.length < wanted; page++) {
    const upstreamKey = cache.makeKey('cat', 'imp-up-v1', source.signature, lang, String(page));
    const lkgKey = cache.makeKey('cat', 'imp-lkg-v1', source.signature, lang, String(page));
    let pageValue = await cacheStore.get(upstreamKey);
    if (!pageValue || !Array.isArray(pageValue.rows)) {
      try {
        pageValue = await singleFlight(upstreamKey, async () => {
          const again = await cacheStore.get(upstreamKey);
          if (again && Array.isArray(again.rows)) return again;
          const fresh = await fetchNormalizedImportedPage({ definition: source, page, tmdbApiKey, lang, request, convertTmdb });
          await cacheStore.set(upstreamKey, fresh, ttls.upstream);
          await cacheStore.set(lkgKey, fresh, 7 * 24 * 60 * 60);
          return fresh;
        });
      } catch (error) {
        const lkg = error.temporary ? await cacheStore.get(lkgKey) : null;
        if (lkg && Array.isArray(lkg.rows)) pageValue = lkg;
        else throw error;
      }
    }
    for (const row of pageValue.rows) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    if (pageValue.terminal) break;
  }
  let result = rows.slice(logicalSkip, logicalSkip + logicalSize);
  if (source.provider === 'trakt') result = await backfill(tmdbApiKey, source.mediaType === 'series' ? 'tv' : 'movie', result);
  await cacheStore.set(renderedKey, result, ttls.rendered);
  result = await enhanceCatalogRows(result, enhance);
  if (search) result = result.filter(row => (row.name || '').toLowerCase().includes(search.toLowerCase()));
  return result;
}

// ── Handler dispatcher ───────────────────────────────────────
async function buildCatalogRows(tmdbApiKey, def, lang = 'en-US', mdblistKey = '') {
  const p = def.params || {};
  const apiType = p.apiType || (def.type === 'movie' ? 'movie' : 'tv');
  const stremioType = def.type === 'movie' ? 'movie' : 'series';

  switch (def.handler) {
    case 'tmdb_source': {
      const { source, window = 'week' } = p;
      if (source === 'trending') {
        return await getTrending(tmdbApiKey, apiType, lang, window, DISCOVER_PAGES);
      }
      if (source === 'popular') {
        return await getPopular(tmdbApiKey, apiType, lang, DISCOVER_PAGES);
      }
      // now_playing / upcoming / airing_today / on_the_air / top_rated
      const endpoint = { now_playing: '/movie/now_playing', upcoming: '/movie/upcoming', airing_today: '/tv/airing_today', on_the_air: '/tv/on_the_air', top_rated: `/${apiType}/top_rated` }[source];
      if (!endpoint) return [];
      const all = [];
      for (let page = 1; page <= DISCOVER_PAGES; page++) {
        const res = await axios.get(`https://api.themoviedb.org/3${endpoint}`, { params: { api_key: tmdbApiKey, language: lang, page }, timeout: 15000 });
        all.push(...(res.data && res.data.results || []));
        if (!res.data || !res.data.results || res.data.results.length < 20) break;
      }
      return await tmdbItemsToRows(tmdbApiKey, apiType, all, stremioType);
    }

    case 'tmdb_provider':
      return await tmdbItemsToRows(tmdbApiKey, apiType, await discover(tmdbApiKey, apiType, { tmdb: { with_watch_providers: p.providerId, watch_region: 'US', ...(p.rotation || {}) } }, lang), stremioType);

    case 'tmdb_genre':
      return await tmdbItemsToRows(tmdbApiKey, apiType, await discover(tmdbApiKey, apiType, { sort: p.sort, tmdb: { with_genres: p.genreIds ? p.genreIds.join(',') : p.genreId, ...(p.rotation || {}) } }, lang), stremioType);

    case 'tmdb_company':
      return await tmdbItemsToRows(tmdbApiKey, apiType, await discover(tmdbApiKey, apiType, { sort: p.sort, tmdb: { with_companies: p.companyId, ...(p.rotation || {}) } }, lang), stremioType);

    case 'tmdb_person': {
      const tmdbParam = p.director ? { with_crew: p.personId } : { with_cast: p.personId };
      return await tmdbItemsToRows(tmdbApiKey, 'movie', await discover(tmdbApiKey, 'movie', { tmdb: tmdbParam }, lang), 'movie');
    }

    case 'tmdb_discover': {
      const apiType2 = p.apiType || apiType;
      const tmdbParams = p.tmdb || {};
      // discover helper expects sort separately; extract if present
      const sort = tmdbParams.sort_by || p.sort || undefined;
      const rest = { ...tmdbParams };
      delete rest.sort_by;
      return await tmdbItemsToRows(tmdbApiKey, apiType2, await discover(tmdbApiKey, apiType2, { sort, tmdb: { ...rest, ...(p.rotation || {}) } }, lang), stremioType);
    }

    case 'tmdb_keyword':
      return await tmdbItemsToRows(tmdbApiKey, apiType, await discover(tmdbApiKey, apiType, { sort: p.sort, tmdb: { with_keywords: p.keywordId, ...(p.rotation || {}) } }, lang), stremioType);

    case 'tmdb_network':
      return await tmdbItemsToRows(tmdbApiKey, 'tv', await discover(tmdbApiKey, 'tv', { sort: p.sort, tmdb: { with_networks: p.networkId, ...(p.rotation || {}) } }, lang), 'series');

    case 'tmdb_collection': {
      if (!p.collectionId) return [];
      const res = await axios.get(`https://api.themoviedb.org/3/collection/${p.collectionId}`, { params: { api_key: tmdbApiKey, language: lang }, timeout: 15000 });
      const parts = (res.data && res.data.parts) || [];
      return await tmdbItemsToRows(tmdbApiKey, 'movie', parts, 'movie');
    }

    case 'tmdb_list': {
      if (!p.listId) return [];
      const res = await axios.get(`https://api.themoviedb.org/3/list/${p.listId}`, { params: { api_key: tmdbApiKey, language: lang }, timeout: 15000 });
      return await tmdbItemsToRows(tmdbApiKey, apiType, (res.data && res.data.items) || [], stremioType);
    }

    case 'trakt_list': {
      if (!p.listId || !process.env.TRAKT_CLIENT_ID) return [];
      const endpoint = stremioType === 'series' ? 'shows' : 'movies';
      const res = await axios.get(`https://api.trakt.tv/lists/${p.listId}/items/${endpoint}`, {
        headers: { 'trakt-api-version': '2', 'trakt-api-key': process.env.TRAKT_CLIENT_ID },
        timeout: 15000,
      });
      const rows = [];
      const seen = new Set();
      for (const entry of Array.isArray(res.data) ? res.data : []) {
        const item = entry.movie || entry.show || {};
        const ids = item.ids || {};
        const imdbId = normalizeImdbId(ids.imdb);
        if (!imdbId || seen.has(imdbId)) continue;
        seen.add(imdbId);
        rows.push({ id: imdbId, tmdbId: ids.tmdb || undefined, type: stremioType, name: item.title || '', posterShape: 'poster', year: item.year ? String(item.year) : undefined, releaseInfo: item.year ? String(item.year) : undefined });
      }
      // Trakt rows have no artwork: fill posters from TMDB (memoised,
      // concurrency-capped) so the row doesn't render blank cards.
      await backfillPosters(tmdbApiKey, stremioType === 'series' ? 'tv' : 'movie', rows);
      return rows;
    }

    case 'mdb_list': {
      // Public slug → free JSON export (no API key needed). By id → the user's
      // MDBList key (config.mdblistKey). Returns items with imdb_id + tmdb id.
      const items = await fetchMdblistItems(def, mdblistKey);
      if (!items.length) return [];
      const rows = [];
      const seen = new Set();
      for (const it of items) {
        const imdbId = normalizeImdbId(it.imdb_id || it.imdbId);
        if (!imdbId || seen.has(imdbId)) continue;
        seen.add(imdbId);
        const name = it.title || it.name || '';
        const year = it.release_year || it.year || undefined;
        const posterPath = it.poster_path || it.poster || null;
        rows.push({
          id: imdbId,
          tmdbId: it.id != null ? Number(it.id) : undefined,
          type: stremioType,
          name,
          poster: posterPath && typeof posterPath === 'string' && posterPath.startsWith('/')
            ? `${TMDB_IMAGE}/w500${posterPath}`
            : null,
          posterShape: 'poster',
          releaseInfo: year ? String(year) : undefined,
          year: year ? String(year) : undefined,
        });
      }
      await backfillPosters(tmdbApiKey, stremioType === 'series' ? 'tv' : 'movie', rows);
      return rows;
    }

    case 'trakt':
      return []; // deferred (needs a Trakt app = VIP)

    default:
      return [];
  }
}

// Fetch a MDBList list's items. Public slug → the site's free JSON export (no
// key, works for anyone). Numeric id → the API with the user's mdblistKey.
async function fetchMdblistItems(def, mdblistKey = '') {
  const p = def.params || {};
  try {
    if (p.slug) {
      const user = p.user || 'snoak';
      const res = await axios.get(`https://mdblist.com/lists/${encodeURIComponent(user)}/${encodeURIComponent(p.slug)}/json/`, { timeout: 20000 });
      return Array.isArray(res.data) ? res.data : [];
    }
    if (p.listId) {
      const key = mdblistKey || '';
      if (!key) return [];
      const res = await axios.get(`https://api.mdblist.com/lists/${p.listId}/items`, {
        params: { apikey: key, limit: 100, unified: 'true' },
        timeout: 20000,
      });
      const d = res.data || {};
      return [...(d.movies || []), ...(d.shows || [])];
    }
    return [];
  } catch (err) {
    console.error(`[LibCat] mdblist fetch failed (${p.slug || p.listId}):`, err.message);
    return [];
  }
}

// ── Catalog entry point (called from handleCatalog) ──────────
async function buildLibraryCatalog({ tmdbApiKey, catalogId, lang = 'en-US', userKey, skip = 0, search = '', enhance = {}, posterFp = '', mdblistKey = '' }) {
  const { getSourceDefinition } = require('./catalog-source-registry');
  const def = getSourceDefinition(catalogId);
  if (!def) return [];
  if (def.params.needsSource && def.handler !== 'tmdb_source') {
    // No resolvable source yet: empty row (log once).
    return [];
  }
  const rotated = applyRotation(def);
  const effectiveDef = rotated.definition;
  const rotationSlot = rotated.rotation?.slot || 'stable';
  // Source families supported by the normalized importer share the exact same
  // paginated engine with static lib-* rows. This is what makes signature
  // matching an effective-runtime match rather than a name/first-page match.
  const staticEntry = require('./import-sources/static-index').staticDefinition(catalogId, def);
  // Rotating rows deliberately use the native dispatcher below: its effective
  // definition carries the daily TMDB filters, whereas the normalized static
  // recipe is intentionally stable for importer signature matching.
  if (!rotated.rotation && staticEntry && ['discover', 'list', 'collection'].includes(staticEntry.definition.engine)) {
    return buildNormalizedImportedCatalog({
      definition: staticEntry.definition, tmdbApiKey, lang, skip, search,
      enhance, posterFp, pageSize: 50,
    });
  }
  // Credential-scoped cache key: numeric MDBList lists are fetched WITH the
  // caller's paid API key, so two users sharing no poster providers used to
  // collide on one cache entry and be served each other's private lists.
  const credFp = (effectiveDef.handler === 'mdb_list' && effectiveDef.params && effectiveDef.params.listId) ? hashShort(mdblistKey || '') : '';
  // v3 invalidates source rows cached before the DC Universe source was moved
  // from an incomplete TMDB collection to the DCEU keyword catalogue.
  const libCacheKey = cache.makeKey('cat', 'lib4', catalogId, rotationSlot, lang, hashShort(JSON.stringify(enhance)), credFp);
  let rows = await cache.get(libCacheKey);
  if (!Array.isArray(rows)) {
    try {
      rows = await singleFlight(libCacheKey, async () => {
        const cached = await cache.get(libCacheKey);
        if (Array.isArray(cached)) return cached;
        const fresh = await buildCatalogRows(tmdbApiKey, effectiveDef, lang, mdblistKey);
        const enhanced = await enhanceCatalogRows(fresh, enhance);
        const lkgKey = cache.makeKey('cat', 'lib4-lkg', catalogId, lang, hashShort(JSON.stringify(enhance)), credFp);
        // Do not let a temporarily empty upstream response replace a useful
        // prior rotation; the next request can retry the same daily slot.
        if (!enhanced.length) {
          const lkg = await cache.get(lkgKey);
          return Array.isArray(lkg) ? lkg : [];
        }
        if (enhanced.length) {
          await cache.set(libCacheKey, enhanced, TTL_LIB);
          // A longer-lived last-known-good entry protects the next rotation
          // if TMDB is temporarily unavailable at the UTC boundary.
          await cache.set(lkgKey, enhanced, 7 * TTL_LIB);
        }
        return enhanced;
      });
    } catch (err) {
      console.error(`[LibCat] ${catalogId} error:`, err.message);
      rows = await cache.get(cache.makeKey('cat', 'lib4-lkg', catalogId, lang, hashShort(JSON.stringify(enhance)), credFp));
      if (!Array.isArray(rows)) rows = [];
    }
  }
  if (search) rows = rows.filter(m => (m.name || '').toLowerCase().includes(search.toLowerCase()));
  return rows.slice(skip, skip + 50);
}

// Imported folders use a small, constrained reference rather than one manifest
// catalog per source. It accepts only IDs already embedded in the collection
// export: static LeLibrary sources and numeric TMDB/Trakt resources.
async function buildImportedCatalog({ tmdbApiKey, ref, type, lang = 'en-US', userKey, skip = 0, search = '', enhance = {}, posterFp = '', mdblistKey = '' }) {
  let def = null;
  if (/^lib:[a-z0-9_]+$/.test(ref)) {
    return buildLibraryCatalog({ tmdbApiKey, catalogId: ref.slice(4), lang, userKey, skip, search, enhance, posterFp, mdblistKey });
  }
  let match = ref.match(/^tmdb-collection:(\d+)$/);
  if (match && type === 'movie') def = { id: ref, type: 'movie', handler: 'tmdb_collection', params: { collectionId: Number(match[1]) } };
  match = ref.match(/^tmdb-list:(\d+)$/);
  if (match) def = { id: ref, type, handler: 'tmdb_list', params: { listId: Number(match[1]), apiType: type === 'series' ? 'tv' : 'movie' } };
  match = ref.match(/^trakt-list:(\d+)$/);
  if (match) def = { id: ref, type, handler: 'trakt_list', params: { listId: Number(match[1]) } };
  // Nuvio community exports reference streaming platforms as TMDB networks
  // (TV-only) or production companies. Resolve them the same way as lists.
  match = ref.match(/^tmdb-network:(\d+)$/);
  if (match) def = { id: ref, type: 'series', handler: 'tmdb_network', params: { networkId: Number(match[1]) } };
  match = ref.match(/^tmdb-company:(\d+)$/);
  if (match) def = { id: ref, type: type === 'series' ? 'series' : 'movie', handler: 'tmdb_company', params: { companyId: Number(match[1]) } };
  match = ref.match(/^tmdb-person:(\d+)$/);
  if (match) def = { id: ref, type: 'movie', handler: 'tmdb_person', params: { personId: Number(match[1]) } };
  match = ref.match(/^tmdb-discover:([A-Za-z0-9_-]+)$/);
  if (match) {
    try {
      const raw = Buffer.from(match[1], 'base64url').toString('utf8');
      const payload = JSON.parse(raw);
      const filters = payload.filters && typeof payload.filters === 'object' ? payload.filters : {};
      const sortBy = typeof payload.sortBy === 'string' ? payload.sortBy : '';
      const kind = String(payload.kind || 'DISCOVER').toUpperCase();
      const tmdbId = payload.tmdbId != null ? Number(payload.tmdbId) : null;
      // Person/Director discover with specific TMDB ID
      if ((kind === 'PERSON' || kind === 'DIRECTOR') && Number.isFinite(tmdbId) && tmdbId > 0) {
        // Director uses with_crew, Person uses with_cast: reuse tmdb_person handler for now (cast)
        // Map DIRECTOR to person handler as well; TMDB discover supports with_crew for director
        def = { id: ref, type: 'movie', handler: 'tmdb_person', params: { personId: tmdbId } };
        if (kind === 'DIRECTOR') def.params.director = true;
      } else {
        // Generic discover: pass through sanitized filters
        const allowed = ['with_genres','without_genres','with_keywords','without_keywords','with_companies','without_companies','with_networks','with_cast','with_crew','with_people','with_original_language','with_origin_country','vote_average.gte','vote_average.lte','vote_count.gte','primary_release_date.gte','primary_release_date.lte','first_air_date.gte','first_air_date.lte','year','with_watch_providers','without_watch_providers','watch_region','without_genres','with_runtime.gte','with_runtime.lte'];
        const sanitized = {};
        for (const [key, value] of Object.entries(filters)) {
          const tmdbKey = String(key).replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`).replace(/^with_genres$/, 'with_genres').replace(/^without_genres$/, 'without_genres');
          // Map Nuvio filter keys to TMDB discover param keys
          const map = {
            withGenres: 'with_genres', withoutGenres: 'without_genres',
            withKeywords: 'with_keywords', withoutKeywords: 'without_keywords',
            withCompanies: 'with_companies', withoutCompanies: 'without_companies',
            withNetworks: 'with_networks', withCast: 'with_cast', withCrew: 'with_crew',
            withOriginalLanguage: 'with_original_language', withOriginCountry: 'with_origin_country',
            voteAverageGte: 'vote_average.gte', voteAverageLte: 'vote_average.lte',
            voteCountGte: 'vote_count.gte', releaseDateGte: payload.mediaType === 'TV' ? 'first_air_date.gte' : 'primary_release_date.gte',
            releaseDateLte: payload.mediaType === 'TV' ? 'first_air_date.lte' : 'primary_release_date.lte',
            year: payload.mediaType === 'TV' ? 'first_air_date_year' : 'year',
            withWatchProviders: 'with_watch_providers', withoutWatchProviders: 'without_watch_providers',
            watchRegion: 'watch_region'
          };
          const tmdbParam = map[key] || null;
          if (!tmdbParam) continue;
          const str = String(value || '').trim();
          if (!str) continue;
          sanitized[tmdbParam] = str.slice(0, 500);
        }
        if (sortBy) sanitized.sort_by = sortBy;
        // Default watch_region to US if watch providers used without region
        if ((sanitized.with_watch_providers || sanitized.without_watch_providers) && !sanitized.watch_region) sanitized.watch_region = 'US';
        const apiType = type === 'series' ? 'tv' : 'movie';
        def = { id: ref, type, handler: 'tmdb_discover', params: { apiType, tmdb: sanitized } };
      }
    } catch {}
  }
  if (!def) return [];
  const cacheId = `import-${ref}-${type}`;
  const cacheKey = cache.makeKey('cat', 'lib', cacheId, lang, hashShort(JSON.stringify(enhance)));
  let rows = await cache.get(cacheKey);
  if (!Array.isArray(rows)) {
    try { rows = await buildCatalogRows(tmdbApiKey, def, lang, mdblistKey); }
    catch (err) { console.error(`[LibCat] imported ${ref} error:`, err.message); rows = []; }
    if (rows.length) await cache.set(cacheKey, rows, TTL_LIB);
  }
  if (search) rows = rows.filter(m => (m.name || '').toLowerCase().includes(search.toLowerCase()));
  return rows.slice(skip, skip + 50);
}

module.exports = {
  buildLibraryCatalog, buildImportedCatalog, buildNormalizedImportedCatalog, buildCatalogRows,
  tmdbItemsToRows, enhanceCatalogRows, backfillPosters, fetchNormalizedImportedPage,
  classifyImportedError, ImportedSourceUpstreamError,
};
