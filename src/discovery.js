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

const cache = require('./cache');
const providers = require('./providers');
const { getMetadata, getTrending, getPopular, imdbToTmdb } = require('./tmdb');
const { buildStreams, reformatExternalStream, enhanceMeta } = require('./builder');
const { fetchExternalStreams } = require('./streamAddons');

const TTL_CATALOG = parseInt(process.env.CACHE_TTL_CATALOG) || 3600;
const TTL_STREAM  = parseInt(process.env.CACHE_TTL_STREAM)  || 600;

function hashShort(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Trending / Popular catalog rows (tt: ids). Cached per user + language.
async function buildDiscoveryCatalog({ tmdbApiKey, kind, apiType, lang, userKey, skip = 0, search = '' }) {
  const discCacheKey = cache.makeKey('cat', 'discovery', kind, apiType, lang, userKey);
  let metas = await cache.get(discCacheKey);
  if (!Array.isArray(metas)) {
    metas = kind === 'trending'
      ? await getTrending(tmdbApiKey, apiType, lang)
      : await getPopular(tmdbApiKey, apiType, lang);
    await cache.set(discCacheKey, metas, TTL_CATALOG);
  }
  if (search) metas = metas.filter(m => (m.name || '').toLowerCase().includes(search.toLowerCase()));
  return metas.slice(skip, skip + 50);
}

// Rich discovery meta for a tt: id: full TMDB episodes with tt:-based episode
// ids, trailers, clickable cast and network links (no owned stripping).
async function buildDiscoveryMeta({ tmdbApiKey, tmdbId, type, lang, enhance = {} }) {
  const meta = await getMetadata(tmdbApiKey, tmdbId, type, lang, { discovery: true });
  if (!meta) return meta;
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

    // Resolution filter — match against both raw and normalized values
    if (resAllowed.length > 0) {
      const streamRes = normalizeRes(q);
      if (streamRes && !resAllowed.includes(streamRes)) return false;
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

async function buildDiscoveryStreams({ config, tmdbApiKey, type, id, lang, customStreams, userKey, externalAddons }) {
  const parts = String(id).split(':');
  const imdbId = parts[0];
  const season = parts[1];
  const episode = parts[2];
  const mapped = await cachedImdbToTmdb(tmdbApiKey, imdbId);
  if (!mapped) return { streams: [], ownedCount: 0, externalCount: 0 };
  const tmdbId = mapped.tmdbId;

  const filters = (config && typeof config.streamFilters === 'object') ? { ...config.streamFilters } : {};
  // Merge resolution + size + cache filters from the new Filters step
  if (Array.isArray(config?.filterResolutions)) filters.resolutions = config.filterResolutions;
  if (config?.filterMaxSize) filters.maxSizeGB = config.filterMaxSize;
  if (config?.filterCachedOnly) filters.cachedOnly = true;
  const sortKey = (config && config.streamSort) || 'owned-size';

  // Include the stream-format + filter/sort fingerprint so changing the preset,
  // templates, filters or sort invalidates cached streams for the TTL.
  const fmtFp = ':' + hashShort([config.streamPreset || '', config.streamNameTemplate || '', config.streamDescTemplate || '', JSON.stringify(filters), sortKey].join('|'));

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
    return { streams: ownedStreams, ownedCount: ownedStreams.length, externalCount: 0 };
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

module.exports = { buildDiscoveryCatalog, buildDiscoveryMeta, buildDiscoveryStreams };
