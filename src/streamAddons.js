// ── External stream addons (Trending/Popular only) ─────────────────
// Aggregates streams from other Stremio stream addons for `tt:` (IMDb) ids,
// mirroring how AIOStreams fetches from configured addons server-side.
//
// IMPORTANT: isolation: this module is ONLY ever called for `tt:` ids (the
// Trending/Popular discovery rows). Library rows (My Movies / My Series /
// LeLibrary Collections) use `torbox:*` ids and never reach this code, so the
// external addons can never interfere with owned-content streams.
//
// Each addon's configured manifest URL is rebuilt on every request from the
// user's own debrid keys already present in their config token (nothing extra
// is stored, keeping the ~2KB token limit). Only the addon id list
// (config.streamAddons, e.g. ["torrentio","comet"]) is stored.

const axios = require('axios');

const SERVICE_NAMES = {
  torbox: 'torbox',
  realdebrid: 'realdebrid',
  alldebrid: 'alldebrid',
  premiumize: 'premiumize',
};

// Config field names intentionally retain their short legacy forms for the
// latter three providers. Keep that translation here so every upstream addon
// receives the active service credential correctly.
const SERVICE_KEY_FIELDS = {
  torbox: 'torboxApiKey',
  realdebrid: 'rdApiKey',
  alldebrid: 'adApiKey',
  premiumize: 'pmApiKey',
};

// Which of the user's active providers a given addon supports (by its own
// service naming). Unknown/unsupported providers are skipped silently.
const SUPPORTED_SERVICES = {
  torrentio:    ['torbox', 'realdebrid', 'alldebrid', 'premiumize'],
  comet:        ['realdebrid', 'torbox', 'alldebrid', 'premiumize'],
  meteor:       ['realdebrid', 'alldebrid', 'torbox', 'premiumize'],
  mediafusion:  ['realdebrid', 'torbox', 'alldebrid', 'premiumize'],
  jackettio:    ['realdebrid', 'torbox', 'alldebrid', 'premiumize'],
};

function activePairs(config, addonId) {
  const supported = SUPPORTED_SERVICES[addonId] || [];
  const pairs = [];
  for (const providerId of Object.keys(SERVICE_NAMES)) {
    const key = config[SERVICE_KEY_FIELDS[providerId]];
    if (!key) continue;
    if (supported.includes(providerId)) pairs.push([SERVICE_NAMES[providerId], key]);
  }
  return pairs;
}

function base64Url(s) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// Jackettio accepts one debrid service per configured manifest. Mirroring
// AIOStreams, make one manifest for each active compatible service rather
// than arbitrarily choosing one when a user has more than one provider.
function buildJackettioConfigUrls(config) {
  return activePairs(config, 'jackettio').map(([debridId, debridApiKey]) => {
    const settings = {
      maxTorrents: 30,
      priotizePackTorrents: 2,
      excludeKeywords: [],
      debridId,
      debridApiKey,
      hideUncached: false,
      sortCached: [['quality', true], ['size', true]],
      sortUncached: [['seeders', true]],
      forceCacheNextEpisode: false,
      priotizeLanguages: [],
      indexerTimeoutSec: 60,
      metaLanguage: '',
      enableMediaFlow: false,
      mediaflowProxyUrl: '',
      mediaflowApiPassword: '',
      mediaflowPublicIp: '',
      useStremThru: true,
      stremthruUrl: 'https://stremthru.13377001.xyz',
      qualities: [0, 360, 480, 720, 1080, 2160],
      indexers: ['eztv', 'thepiratebay', 'therarbg', 'yts'],
    };
    return `https://jackettio.elfhosted.com/${Buffer.from(JSON.stringify(settings)).toString('base64')}/manifest.json`;
  });
}

const ADDONS = {
  torrentio: {
    name: 'Torrentio',
    logo: 'https://torrentio.strem.fun/images/logo_v1.png',
    baseUrl: 'https://torrentio.strem.fun',
    supportedServices: ['torbox', 'realdebrid', 'alldebrid', 'premiumize'],
    // Torrentio moved to a config-path URL: /{key}={value}[|{key}={value}]/manifest.json
    // (e.g. /torbox=<key>/manifest.json). The old /torbox/{key}/ format 404s.
    buildConfigUrl(config) {
      const pairs = activePairs(config, 'torrentio');
      if (pairs.length === 0) return `${this.baseUrl}/manifest.json`;
      return `${this.baseUrl}/${pairs.map(([service, key]) => `${service}=${key}`).join('|')}/manifest.json`;
    },
  },
  comet: {
    name: 'Comet',
    logo: 'https://raw.githubusercontent.com/g0ldyy/comet/refs/heads/main/comet/assets/icon.png',
    baseUrl: 'https://comet.feels.legal',
    supportedServices: ['realdebrid', 'torbox', 'alldebrid', 'premiumize'],
    // https://comet.feels.legal/{base64config}/manifest.json
    buildConfigUrl(config) {
      const debridServices = activePairs(config, 'comet').map(([service, apiKey]) => ({ service, apiKey }));
      if (debridServices.length === 0) return `${this.baseUrl}/manifest.json`;
      const cfg = {
        maxResultsPerResolution: 0,
        maxSize: 0,
        cachedOnly: false,
        removeTrash: true,
        resultFormat: ['all'],
        debridServices,
        enableTorrent: false,
        scrapeDebridAccountTorrents: false,
        debridStreamProxyPassword: '',
        languages: { required: [], exclude: [], preferred: [] },
        resolutions: {},
        options: { remove_ranks_under: -10000000000, allow_english_in_languages: false, remove_unknown_languages: false },
      };
      // Comet's API validates the config with Python's base64.b64decode, which
      // needs STANDARD base64 with padding (URL-safe encoding fails with
      // "Incorrect padding" → every request returns "OBSOLETE CONFIGURATION").
      // The JSON is ASCII-heavy so the output never contains URL-breaking + or /.
      return `${this.baseUrl}/${Buffer.from(JSON.stringify(cfg)).toString('base64')}/manifest.json`;
    },
  },
  meteor: {
    name: 'Meteor',
    logo: 'https://meteorfortheweebs.midnightignite.me/static/icon.png',
    baseUrl: 'https://meteorfortheweebs.midnightignite.me',
    supportedServices: ['realdebrid', 'alldebrid', 'torbox', 'premiumize'],
    // https://meteorfortheweebs.midnightignite.me/{base64urlJSON}/manifest.json
    buildConfigUrl(config) {
      const debridServices = activePairs(config, 'meteor').map(([service, apiKey]) => ({ service, apiKey }));
      if (debridServices.length === 0) return `${this.baseUrl}/manifest.json`;
      const single = debridServices.length === 1 ? debridServices[0] : null;
      const cfg = {
        debridService: single ? single.service : undefined,
        debridApiKey: single ? single.apiKey : undefined,
        debridServices: single ? undefined : debridServices,
        cachedOnly: false,
        removeTrash: false,
        enableYourMedia: false,
        yourMediaLegacyMode: false,
        showYourMediaStreams: false,
        yourMediaSources: ['torrent'],
        enableUsenet: false,
        usenetCustomEngines: false,
        removeSamples: false,
        removeAdult: false,
        exclude3D: false,
        enableSeaDex: false,
        minSeeders: 0,
        maxResults: 0,
        maxResultsPerRes: 0,
        maxSize: 0,
        resolutions: [],
        languages: { preferred: [], required: [], exclude: [] },
        resultFormat: ['title', 'quality', 'size', 'audio', 'seeders', 'source', 'sublang', 'audiolang'],
        sortOrder: ['pack', 'cached', 'seadex', 'resolution', 'size', 'quality', 'seeders', 'language'],
      };
      return `${this.baseUrl}/${base64Url(JSON.stringify(cfg))}/manifest.json`;
    },
  },
  mediafusion: {
    name: 'MediaFusion',
    logo: 'https://raw.githubusercontent.com/mhdzumair/MediaFusion/refs/heads/main/resources/images/mediafusion_logo.png',
    baseUrl: 'https://mediafusion.elfhosted.com',
    supportedServices: ['realdebrid', 'torbox', 'alldebrid', 'premiumize'],
    // MediaFusion's config is NOT in the URL: it is sent as an
    // `encoded_user_data` header on every request (this is how its own client
    // works). The manifest URL stays plain.
    buildConfigUrl() {
      return `${this.baseUrl}/manifest.json`;
    },
    buildHeaders(config) {
      const providers = activePairs(config, 'mediafusion').map(([service, token], i) => ({
        name: i === 0 ? 'Provider' : `Provider ${i + 1}`,
        service,
        token,
        enable_watchlist_catalogs: false,
        qbittorrent_config: null,
        only_show_cached_streams: false,
        use_mediaflow: true,
        sabnzbd_config: null,
        nzbget_config: null,
        nzbdav_config: null,
        easynews_config: null,
        priority: i,
        enabled: true,
      }));
      if (providers.length === 0) return {};
      const cfg = {
        streaming_providers: providers,
        streaming_provider: providers[0],
        stream_template: {
          title: '{addon.name} {if stream.type = torrent }[{service.shortName} {if service.cached}⚡️{else}⏳{/if}]{elif stream.type = usenet}[{service.shortName}{if service.cached}⚡️{else}⏳{/if}]{elif stream.type = telegram}📱{elif stream.type = youtube}▶️{elif stream.type = http}🌐{else}🔗{/if} {if stream.resolution}{stream.resolution}{/if}',
          description: '📂 {stream.name}\n{if stream.filename}📄 {stream.filename} {/if}\n{if stream.type = torrent}🧲 Torrent{elif stream.type = usenet}📰 Usenet/NZB{elif stream.type = http}🔗 Direct Stream{else}📺 {stream.type|title}{/if}\n{if stream.quality}🎥 {stream.quality} {/if}{if stream.codec}🎞️ {stream.codec} {/if}{if stream.bit_depth}{stream.bit_depth}-bit {/if}\n{if stream.hdr_formats}🎨 {stream.hdr_formats|join(\' \')} {/if}{if stream.audio_formats}🎧 {stream.audio_formats|join(\' \')} {/if}{if stream.channels}🔊 {stream.channels|join(\' \')} {/if}\n{if stream.size > 0}📦 {stream.size|bytes}{if stream.folderSize > stream.size} / {stream.folderSize|bytes}{/if} {/if}{if stream.seeders > 0}👤 {stream.seeders} seeders {/if}\n{if stream.languages}🌐 {stream.languages|join(\' | \')}{/if}\n🔗 {stream.source}{if stream.release_group} | 🏷️ {stream.release_group}{/if}{if stream.uploader} | 🧑‍💻 {stream.uploader}{/if}',
        },
        selected_catalogs: [],
        selected_resolutions: ['4k', '2160p', '1440p', '1080p', '720p', '576p', '480p', '360p', '240p', null],
        enable_catalogs: true,
        enable_imdb_metadata: false,
        min_size: 0,
        max_size: 'inf',
        max_streams_per_resolution: 500,
        max_streams: 100,
        torrent_sorting_priority: [
          { key: 'cached', direction: 'desc' },
          { key: 'resolution', direction: 'desc' },
          { key: 'quality', direction: 'desc' },
          { key: 'size', direction: 'desc' },
          { key: 'language', direction: 'desc' },
          { key: 'seeders', direction: 'desc' },
          { key: 'created_at', direction: 'desc' },
        ],
        nudity_filter: ['Disable'],
        certification_filter: ['Disable'],
        language_sorting: ['English', 'Spanish', 'Portuguese', 'French', 'German', null],
        quality_filter: ['BluRay/UHD', 'WEB/HD', 'DVD/TV/SAT', 'CAM/Screener', 'Unknown'],
        hdr_filter: ['HDR10', 'HDR10+', 'Dolby Vision', 'HLG', 'SDR', 'Unknown'],
        api_password: '',
        live_search_streams: true,
        include_anime: true,
        enable_telegram_streams: false,
        enable_acestream_streams: false,
        stream_type_grouping: 'separate',
        stream_type_order: ['torrent', 'usenet', 'telegram', 'http', 'acestream', 'youtube'],
        provider_grouping: 'separate',
        stream_name_filter_mode: 'disabled',
        stream_name_filter_patterns: [],
        stream_name_filter_use_regex: false,
        telegram_config: null,
      };
      return { encoded_user_data: base64Url(JSON.stringify(cfg)) };
    },
  },
  jackettio: {
    name: 'Jackettio',
    logo: 'https://raw.githubusercontent.com/Jackett/Jackett/bbea5febd623f6e536e11aa1fa8d6674d8d4043f/src/Jackett.Common/Content/jacket_medium.png',
    baseUrl: 'https://jackettio.elfhosted.com',
    supportedServices: ['realdebrid', 'torbox', 'alldebrid', 'premiumize'],
    buildConfigUrls: buildJackettioConfigUrls,
  },
};

const ADDON_LIST = [
  { id: 'torrentio',    name: 'Torrentio',    logo: ADDONS.torrentio.logo,    desc: 'Torrent + debrid streams from a wide provider network.' },
  { id: 'comet',        name: 'Comet',        logo: ADDONS.comet.logo,        desc: "Stremio's fast torrent/debrid stream addon." },
  { id: 'meteor',       name: 'Meteor',       logo: ADDONS.meteor.logo,       desc: 'Torrent + debrid streams with usenet support.' },
  { id: 'mediafusion',  name: 'MediaFusion',  logo: ADDONS.mediafusion.logo,  desc: 'Universal streams for movies, series and anime.' },
  { id: 'jackettio',    name: 'Jackettio',    logo: ADDONS.jackettio.logo,    desc: 'Extra tracker results, configured with your existing debrid account.' },
];

// No hard caps: the resolution filter and total cap in discovery.js handle
// stream selection. AIOStreams has no cap either; the filter is the gate.

// Fetch one addon's streams for a `tt:` id. Returns [] on any failure: one
// slow/broken addon must never fail the whole response.
async function fetchAddonStreams(addonId, config, type, ttId, timeoutMs = 15000) {
  const addon = ADDONS[addonId];
  if (!addon) return [];
  try {
    const manifestUrls = typeof addon.buildConfigUrls === 'function'
      ? addon.buildConfigUrls(config)
      : [addon.buildConfigUrl(config)];
    if (!manifestUrls.length) return [];
    const responses = await Promise.all(manifestUrls.map(manifestUrl => {
      const streamUrl = manifestUrl.replace(/\/manifest\.json$/, '') + `/stream/${type}/${ttId}.json`;
      const headers = {
        'User-Agent': 'LeLibrary/2.0 (+https://github.com/leleasley/LeLibrary)',
        Accept: 'application/json',
        ...(typeof addon.buildHeaders === 'function' ? addon.buildHeaders(config) : {}),
      };
      return axios.get(streamUrl, { headers, timeout: timeoutMs, validateStatus: s => s < 500 })
        .then(res => Array.isArray(res.data?.streams) ? res.data.streams : [])
        .catch(() => []);
    }));
    const streams = responses.flat();
    if (streams.length === 0) return [];
    // Tag each stream with its source addon so reformatting can show WHERE it
    // came from (name for display, id for the formatter's service badge);
    // capped per addon to the best few (addons sort best-first).
    return streams.map(s => ({
      ...s,
      _sourceAddon: addon.name,
      _sourceAddonId: addonId,
      name: s.name ? `${s.name}` : addon.name,
      description: s.description ? `${s.description}\n⚡ ${addon.name}` : `⚡ ${addon.name}`,
    }));
  } catch (err) {
    console.warn(`[StreamAddons] ${addon.name} fetch failed for ${ttId}: ${err.message}`);
    return [];
  }
}

// Deduplicate merged streams by their URL / infoHash / name.
function dedupeStreams(streams) {
  const seen = new Set();
  const out = [];
  for (const s of streams) {
    if (!s || typeof s !== 'object') continue;
    const key = s.infoHash || s.url || s.name || '';
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// Returns the configured provider-order difference for two external streams.
// A non-prioritised stream sorts after a configured provider. Kept independent
// of the network code so the final stream sorter can honour this invariant.
function compareExternalProviderPriority(a, b) {
  const priority = stream => Number.isFinite(stream?._externalPriority)
    ? stream._externalPriority
    : Number.MAX_SAFE_INTEGER;
  return priority(a) - priority(b);
}

// Aggregate streams from all enabled addons for a `tt:` id, in parallel.
// Use one shared deadline so a hung upstream cannot hold the player forever.
// Do not return merely because the first fast addons produced enough rows:
// that made Comet/MediaFusion hide slower enabled addons such as Torrentio and
// Jackettio. The response now includes every selected addon that answers
// before the deadline.
const EXTERNAL_TIME_BUDGET_MS = 15000;
async function fetchExternalStreams(addonIds, config, type, ttId) {
  const ids = Array.isArray(addonIds) ? addonIds.filter(id => ADDONS[id]) : [];
  if (ids.length === 0) return [];
  const normType = type === 'anime' ? 'series' : type;
  const budgetMs = EXTERNAL_TIME_BUDGET_MS;
  const deadline = Date.now() + budgetMs;

  // Fetch in parallel, but assemble in the configured order. Appending each
  // response as it completes made faster providers (usually Comet) jump ahead
  // of a user's first choice. `_externalPriority` is intentionally retained
  // until discovery.js has applied the final per-provider stream ordering.
  const responses = await Promise.all(ids.map(async (id, priority) => {
    try {
      const remaining = Math.max(2000, deadline - Date.now());
      const streams = await fetchAddonStreams(id, config, normType, ttId, remaining);
      return streams.map(stream => ({ ...stream, _externalPriority: priority }));
    } catch (err) {
      console.warn(`[StreamAddons] ${id} error: ${err.message}`);
      return [];
    }
  }));
  const deduped = dedupeStreams(responses.flat());
  return deduped;
}

module.exports = {
  ADDON_LIST,
  ADDONS,
  buildJackettioConfigUrls,
  fetchExternalStreams,
  dedupeStreams,
  compareExternalProviderPriority,
};
