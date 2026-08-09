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
const { fetchExternalStreams, dedupeStreams } = require('./streamAddons');

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

// Streams for a tt: id — the owned library copy first (owned bridge), then the
// enabled external addons. Returns { streams, ownedCount, externalCount }.
async function buildDiscoveryStreams({ config, tmdbApiKey, type, id, lang, customStreams, userKey, externalAddons }) {
  const parts = String(id).split(':');
  const imdbId = parts[0];
  const season = parts[1];
  const episode = parts[2];
  const mapped = await imdbToTmdb(tmdbApiKey, imdbId);
  if (!mapped) return { streams: [], ownedCount: 0, externalCount: 0 };
  const tmdbId = mapped.tmdbId;

  // Include the stream-format fingerprint so changing the preset/templates
  // invalidates cached streams instead of serving stale names for the TTL.
  const fmtFp = ':' + hashShort([config.streamPreset || '', config.streamNameTemplate || '', config.streamDescTemplate || ''].join('|'));

  // Owned bridge: the user's library copy whenever stream addons are on, so
  // owned discovery titles keep their own file listed first.
  let ownedStreams = [];
  if (externalAddons.length > 0) {
    const ownedKey = cache.makeKey('stream', type, tmdbId, season || '', episode || '', userKey + fmtFp);
    const ownedHit = await cache.get(ownedKey);
    if (ownedHit) {
      ownedStreams = ownedHit.streams || [];
    } else {
      ownedStreams = await buildStreams(config, tmdbApiKey, type, tmdbId, season, episode, lang, customStreams, userKey);
      await cache.set(ownedKey, { streams: ownedStreams }, ownedStreams.length > 0 ? TTL_STREAM : 60);
    }
  }

  // No external addons configured — only the owned copy can answer.
  if (externalAddons.length === 0) {
    return { streams: ownedStreams, ownedCount: ownedStreams.length, externalCount: 0 };
  }

  const external = await fetchExternalStreams(externalAddons, config, type, id);
  // Reformat the external addon streams with the user's chosen preset so a
  // Torrentio/Comet/Meteor/MediaFusion stream doesn't keep its own format —
  // the user picks the look, not the source addon. Streams without a raw
  // filename are left as the addon returned them.
  const providerSrc = providers.activeProviders(config)[0] || 'torbox';
  const externalFmt = external.map(s => reformatExternalStream(s, providerSrc, config));
  const streams = dedupeStreams([...(ownedStreams || []), ...externalFmt]);

  return { streams, ownedCount: ownedStreams.length, externalCount: external.length };
}

module.exports = { buildDiscoveryCatalog, buildDiscoveryMeta, buildDiscoveryStreams };
