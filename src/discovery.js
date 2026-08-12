// ── Discovery (tt:) builders ────────────────────────────────────────────────
// Everything that routes through plain IMDb (tt:) ids so external stream
// addons (Torrentio, Comet, Meteor, MediaFusion) can answer: the Trending /
// Popular catalogues and any future IMDB-routed rows. Owned / library rows
// (torbox:tmdbId) stay in src/builder.js.
//
// The discovery namespace:
//   • catalog rows carry tt: ids
//   • metas are rich (trailers, clickable cast, networks) with tt: episode ids
//   • streams = owned-copy-first bridge, then external addon streams

const axios = require('axios');
const cache = require('./cache');
const providers = require('./providers');
const { getMetadata, getTrending, getPopular, imdbToTmdb } = require('./tmdb');
const { buildStreams, reformatExternalStream, enhanceMeta, buildErdbUrl, buildRpdbUrl, buildBetterPosterUrl, getFanartArt } = require('./builder');
const { fetchExternalStreams } = require('./streamAddons');

const TTL_CATALOG = parseInt(process.env.CACHE_TTL_CATALOG) || 3600;
const TTL_STREAM  = parseInt(process.env.CACHE_TTL_STREAM)  || 600;

// Pages of TMDB results per Trending/Popular row (20 titles per page).
// More pages = longer first fetch (each title needs one external_ids call),
// then cached 24h. 3 pages ≈ 60 titles per row.
const DISCOVERY_PAGES = 3;

function hashShort(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Apply the user's configured poster providers (erdb/rpdb/betterposter/fanart)
// to a discovery catalog row set. Rows carry plain tt: ids (= IMDb id), which
// is all erdb/rpdb/betterposter need; fanart is TMDB-keyed and uses the row's
// tmdbId. Mirrors enhanceMeta's precedence: erdb > rpdb > betterposter > fanart.
async function enhanceDiscoveryMetas(metas, enhance = {}) {
  if (!Array.isArray(metas) || metas.length === 0) return metas;
  const { erdbToken, rpdbKey, fanartKey, posterProvider } = enhance;
  if (!erdbToken && !rpdbKey && fanartKey === undefined && posterProvider !== 'betterposter') return metas;
  return Promise.all(metas.map(async (m) => {
    if (!m || typeof m !== 'object') return m;
    const imdbId = typeof m.id === 'string' && m.id.startsWith('tt') ? m.id : null;
    const type = m.type === 'movie' ? 'movie' : 'tv';
    if (erdbToken && imdbId) return { ...m, poster: buildErdbUrl(erdbToken, 'poster', imdbId) };
    if (rpdbKey && imdbId) return { ...m, poster: buildRpdbUrl(rpdbKey, 'imdb', 'poster-default', imdbId) };
    if (posterProvider === 'betterposter' && imdbId) return { ...m, poster: buildBetterPosterUrl(imdbId, m.type), posterShape: 'poster' };
    if (fanartKey && m.tmdbId) {
      const art = await getFanartArt(fanartKey, m.tmdbId, type).catch(() => null);
      if (art && art.poster) return { ...m, poster: art.poster };
    }
    return m;
  }));
}

// Trending / Popular catalog rows (tt: ids). Cached per user + language +
// poster fingerprint (so changing the poster provider refreshes the grid).
async function buildDiscoveryCatalog({ tmdbApiKey, kind, apiType, lang, userKey, skip = 0, search = '', enhance = {}, posterFp = '' }) {
  const discCacheKey = cache.makeKey('cat', 'discovery', kind, apiType, lang, userKey, posterFp);
  let metas = await cache.get(discCacheKey);
  if (!Array.isArray(metas)) {
    metas = kind === 'trending'
      ? await getTrending(tmdbApiKey, apiType, lang, 'week', DISCOVERY_PAGES)
      : await getPopular(tmdbApiKey, apiType, lang, DISCOVERY_PAGES);
    metas = await enhanceDiscoveryMetas(metas, enhance);
    await cache.set(discCacheKey, metas, TTL_CATALOG);
  }
  if (search) metas = metas.filter(m => (m.name || '').toLowerCase().includes(search.toLowerCase()));
  return metas.slice(skip, skip + 50);
}

// Proxy the TMDB metadata addon (mrcanelas/tmdb-addon, hosted at tmdb.elfhosted.com)
// for all tt: metas. This is the exact rich metadata source Xperience serves:
// app_extras.cast with actor photos, full credits, trailers and tt:-based
// episode ids, plus imdb_id for scrobbling. Its default manifest is public, so
// no per-user key is needed. Cached raw (shared across users) for 24h; the
// app.js meta route re-caches per user with their poster providers layered on
// top. Falls back to the TMDB-built meta if the addon is unreachable.
const TMDB_ADDON_BASE = 'https://tmdb.elfhosted.com';
const TMDB_ADDON_TTL  = 24 * 60 * 60;

async function getTmdbAddonMeta(type, tmdbId) {
  if (!tmdbId) return null;
  const cacheKey = cache.makeKey('meta', 'tmdbaddon', type, tmdbId);
  const hit = await cache.get(cacheKey);
  if (hit) return hit;
  const stremioType = type === 'movie' ? 'movie' : 'series';
  try {
    const res = await axios.get(`${TMDB_ADDON_BASE}/meta/${stremioType}/tmdb%3A${tmdbId}.json`, { timeout: 10000 });
    const meta = res.data && res.data.meta;
    if (!meta || !meta.id) return null;
    await cache.set(cacheKey, meta, TMDB_ADDON_TTL);
    return meta;
  } catch (err) {
    console.error(`[TmdbAddon] meta fetch failed for tmdb:${tmdbId}:`, err.message);
    return null;
  }
}

// Rich discovery meta for a tt: id. Served from the TMDB metadata addon (the
// same source AIOStreams' tmdb preset and Xperience proxy), with the response
// id rewritten back to tt: so external stream addons and scrobbling keep
// working. The user's poster/rating providers are layered on top. TMDB build
// is only the fallback when the addon is down.
async function buildDiscoveryMeta({ tmdbApiKey, tmdbId, type, lang, enhance = {}, imdbId }) {
  let meta = await getTmdbAddonMeta(type, tmdbId);
  if (!meta) {
    meta = await getMetadata(tmdbApiKey, tmdbId, type, lang, { discovery: true });
  }
  if (!meta) return meta;
  if (imdbId) meta.id = imdbId;
  meta.imdbId = imdbId || meta.imdbId;
  if (!meta.tmdbId) meta.tmdbId = tmdbId;
  if (meta.poster && !meta.posterShape) meta.posterShape = 'poster';
  await enhanceMeta(meta, enhance);
  return meta;
}

// ── Streams 2.0 (discovery only) ──────────────────────────────────────────
// Filters tame the external addon noise; dedup collapses identical files
// (owned copy preferred); sort reorders the final list. Config comes from the
// user's settings: config.streamFilters ({ minQuality, maxQuality, minSizeGB,
// cachedOnly, excludeQualities }) and config.streamSort ('', 'cached-quality',
// 'quality', 'size', 'cached-size').

const QUALITY_ORDER = { '4k': 5, '1440p': 4, '1080p': 3, '720p': 2, '576p': 1, '480p': 1 };

function streamQuality(name = '') {
  const u = String(name || '').toUpperCase();
  if (/\b(2160P|4K|UHD)\b/.test(u)) return '4K';
  if (/\b1440P\b/.test(u)) return '1440p';
  if (/\b1080P\b/.test(u)) return '1080p';
  if (/\b720P\b/.test(u)) return '720p';
  if (/\b576P\b/.test(u)) return '576p';
  if (/\b480P\b/.test(u)) return '480p';
  return '';
}

// CAM / TS / screener family — the low-quality releases users exclude.
function streamQualityType(name = '') {
  const u = String(name || '').toUpperCase();
  if (/\b(CAM|CAMRIP|HDCAM|TELECINE|TELESYNC|TS|HDTS)\b/.test(u)) return 'CAM';
  if (/\b(SCREENER|DVDSCR|WEBSCR|R5|R6)\b/.test(u)) return 'SCR';
  return '';
}

function streamFilename(stream) {
  return (stream && stream.behaviorHints && stream.behaviorHints.filename)
    || stream.name || '';
}

function streamSize(stream) {
  return Number(stream && (stream.size || (stream.behaviorHints && stream.behaviorHints.videoSize))) || 0;
}

// Owned copies are always instantly available; external addons mark cached
// streams in their own way (⚡/✅/CACHED vs ⏳/⬇/UNCACHED). Unknown → keep.
function streamIsCached(stream) {
  if (stream && stream._owned === true) return true;
  if (stream && stream.isCached === true) return true;
  if (stream && stream.isCached === false) return false;
  const n = String(streamFilename(stream) || '').toUpperCase();
  if (/\b(⚡|✅|INSTANT|CACHED)\b/.test(n)) return true;
  if (/\b(⏳|⬇|UNCACHED|NOT.*CACHED)\b/.test(n)) return false;
  return null;
}

// Normalize resolution labels: "4K" ↔ "2160p", "2K" ↔ "1440p"
const RES_ALIASES = { '4k': '2160p', '2160p': '2160p', '1440p': '1440p', '2k': '1440p', '1080p': '1080p', 'fhd': '1080p', '720p': '720p', 'hd': '720p', '480p': '480p', 'sd': '480p', '360p': '360p', '240p': '240p' };
function normalizeRes(label) { return RES_ALIASES[String(label).toLowerCase().trim()] || ''; }

function applyStreamFilters(streams, filters = {}) {
  if (!Array.isArray(streams) || streams.length === 0) return streams;
  const minQ = String(filters.minQuality || '').toLowerCase();
  const maxQ = String(filters.maxQuality || '').toLowerCase();
  const minBytes = (Number(filters.minSizeGB) || 0) * 1024 * 1024 * 1024;
  const maxBytes = (Number(filters.maxSizeGB) || 0) * 1024 * 1024 * 1024;
  const cachedOnly = !!filters.cachedOnly;
  const exclude = (Array.isArray(filters.excludeQualities) ? filters.excludeQualities : [])
    .map(s => String(s).toUpperCase());
  // Resolution include filter — only keep streams whose resolution is in the allowed set
  const resAllowed = Array.isArray(filters.resolutions) ? filters.resolutions.map(normalizeRes).filter(Boolean) : [];

  return streams.filter(stream => {
    const fname = streamFilename(stream);
    const q = streamQuality(fname).toLowerCase();

    const size = streamSize(stream);
    if (minBytes && size < minBytes) return false;
    if (maxBytes && size > maxBytes) return false;

    if (minQ && (QUALITY_ORDER[q] || 0) < (QUALITY_ORDER[minQ] || 0)) return false;
    if (maxQ && (QUALITY_ORDER[q] || 99) > (QUALITY_ORDER[maxQ] || 99)) return false;

    const qtype = streamQualityType(fname);
    if (qtype && exclude.includes(qtype)) return false;

    if (cachedOnly && streamIsCached(stream) === false) return false;

    // Resolution filter — match against both raw and normalized values.
    // When a filter is set, streams with NO detectable resolution are dropped
    // too (the 💩Unknown rows): the user asked for specific resolutions, so
    // an unidentifiable file is noise.
    if (resAllowed.length > 0) {
      const streamRes = normalizeRes(q);
      if (!streamRes || !resAllowed.includes(streamRes)) return false;
    }

    return true;
  });
}

// Dedup by url / infohash / name, plus same-size (identical file from another
// addon) — preferring the earlier stream, so the owned copy wins.
function dedupeStreamsV2(streams) {
  const seen = new Set();
  const seenSize = new Map();
  const out = [];
  for (const s of streams) {
    if (!s || typeof s !== 'object') continue;
    const key = s.infoHash || s.url || s.name || '';
    if (key && seen.has(key)) continue;
    const size = streamSize(s);
    if (size > 0) {
      if (seenSize.has(size)) continue;
      seenSize.set(size, true);
    }
    if (key) seen.add(key);
    out.push(s);
  }
  return out;
}

function applyStreamSort(streams, sort = 'cached-quality') {
  const key = sort || 'cached-quality';
  const q = s => QUALITY_ORDER[streamQuality(streamFilename(s)).toLowerCase()] || 0;
  const sz = s => streamSize(s);
  const cached = s => (streamIsCached(s) === true ? 1 : 0);
  return streams.slice().sort((a, b) => {
    if (key === 'quality') { const d = q(b) - q(a); return d !== 0 ? d : sz(b) - sz(a); }
    if (key === 'size') return sz(b) - sz(a);
    if (key === 'cached-size') { const d = cached(b) - cached(a); return d !== 0 ? d : sz(b) - sz(a); }
    if (key === 'owned-size') { const d = (b._owned ? 1 : 0) - (a._owned ? 1 : 0); return d !== 0 ? d : sz(b) - sz(a); }
    // cached-quality (default)
    const d = cached(b) - cached(a);
    if (d !== 0) return d;
    const dq = q(b) - q(a);
    return dq !== 0 ? dq : sz(b) - sz(a);
  });
}

// Streams for a tt: id — the owned library copy first (owned bridge), then the
// enabled external addons. Returns { streams, ownedCount, externalCount }.
// IMDb→TMDB mapping is global (same for every user) — cache it long-term so
// the discovery bridge doesn't pay a TMDB API call on every tt: stream request.
const IMDB_CACHE_TTL = 60 * 60 * 24 * 30; // 30 days
async function cachedImdbToTmdb(tmdbApiKey, imdbId) {
  const key = cache.makeKey('imdb2tmdb', imdbId);
  const hit = await cache.get(key);
  if (hit) return hit;
  const mapped = await imdbToTmdb(tmdbApiKey, imdbId);
  if (mapped) await cache.set(key, mapped, IMDB_CACHE_TTL);
  return mapped;
}

// The discovery stream path depends on the format preset/templates AND the
// discovery filters + sort order, so they all go into the cache-key fingerprint
// (changing any of them must invalidate cached streams). Shared with app.js so
// the cached-response key and the builder's fmtFp always agree.
function discoveryStreamKeyParts(config = {}) {
  const filters = (config && typeof config.streamFilters === 'object') ? { ...config.streamFilters } : {};
  // Merge resolution + size + cache filters from the new Filters step
  if (Array.isArray(config?.filterResolutions)) filters.resolutions = config.filterResolutions;
  if (config?.filterMaxSize) filters.maxSizeGB = config.filterMaxSize;
  if (config?.filterCachedOnly) filters.cachedOnly = true;
  const sortKey = (config && config.streamSort) || 'owned-size';
  const fmtFp = ':' + hashShort([config.streamPreset || '', config.streamNameTemplate || '', config.streamDescTemplate || '', JSON.stringify(filters), sortKey].join('|'));
  return { filters, sortKey, fmtFp };
}

async function buildDiscoveryStreams({ config, tmdbApiKey, type, id, lang, customStreams, userKey, externalAddons }) {
  const parts = String(id).split(':');
  const imdbId = parts[0];
  const season = parts[1];
  const episode = parts[2];
  const mapped = await cachedImdbToTmdb(tmdbApiKey, imdbId);
  if (!mapped) return { streams: [], ownedCount: 0, externalCount: 0 };
  const tmdbId = mapped.tmdbId;

  const { filters, sortKey, fmtFp } = discoveryStreamKeyParts(config);

  // Owned bridge: the user's library copy is ALWAYS listed for a tt: id, even
  // when no external stream addons are configured. (v4.6.0 accidentally gated
  // this behind externalAddons.length > 0 — see regressions/4.6.0.)
  const ownedKey = cache.makeKey('stream', type, tmdbId, season || '', episode || '', userKey + fmtFp);
  const ownedHit  = await cache.get(ownedKey);
  let ownedStreams;
  if (ownedHit) {
    ownedStreams = ownedHit.streams || [];
  } else {
    // skipTmdbFallback: the discovery owned-bridge only answers "do I own this?"
    // — it must NOT trigger the slow per-candidate TMDB search (that's for the
    // library path). Cached downloads + cached matches make this near-instant.
    ownedStreams = await buildStreams(config, tmdbApiKey, type, tmdbId, season, episode, lang, customStreams, userKey, { skipTmdbFallback: true });
    await cache.set(ownedKey, { streams: ownedStreams }, ownedStreams.length > 0 ? TTL_STREAM : 60);
  }

  // No external addons configured — only the owned copy can answer.
  if (externalAddons.length === 0) {
    const owned = sortKey ? applyStreamSort(ownedStreams, sortKey) : ownedStreams;
    return { streams: owned, ownedCount: owned.length, externalCount: 0 };
  }

  const allExternal = await fetchExternalStreams(externalAddons, config, type, id);

  // Tag owned streams so dedup prefers them and they're always "cached".
  const ownedTagged = (ownedStreams || []).map(s => ({ ...s, _owned: true }));

  // Filter the external noise BEFORE capping — the resolution/quality filter
  // needs to see ALL resolutions to pick the right ones (e.g. 1080p when 4K
  // is excluded). The total cap is applied AFTER filtering.
  const externalFiltered = applyStreamFilters(allExternal, filters);
  // No total cap: the resolution filter is the only gate, matching AIOStreams.
  const externalCapped = externalFiltered;
  const providerSrc = providers.activeProviders(config)[0] || 'torbox';
  const externalFmt = externalCapped.map(s => reformatExternalStream(s, providerSrc, config));

  let streams = dedupeStreamsV2([...ownedTagged, ...externalFmt]);
  if (sortKey) streams = applyStreamSort(streams, sortKey);

  return { streams, ownedCount: ownedStreams.length, externalCount: allExternal.length };
}

module.exports = { buildDiscoveryCatalog, buildDiscoveryMeta, buildDiscoveryStreams, discoveryStreamKeyParts };
