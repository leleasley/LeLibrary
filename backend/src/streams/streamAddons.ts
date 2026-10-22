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
const streamCache = require('../runtime/cache.ts');
const { fetchAioStreams } = require('./aiostreams.ts');

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
  knaben:       ['realdebrid', 'torbox', 'alldebrid', 'premiumize'],
};

function activePairs(config: any, addonId: any) {
  const supported = (SUPPORTED_SERVICES as Record<string, string[]>)[addonId] || [];
  const pairs = [];
  for (const providerId of Object.keys(SERVICE_NAMES)) {
    const key = config[(SERVICE_KEY_FIELDS as Record<string, any>)[providerId]];
    if (!key) continue;
    if (supported.includes(providerId)) pairs.push([(SERVICE_NAMES as Record<string, any>)[providerId], key]);
  }
  return pairs;
}

function base64Url(s: any) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// Jackettio accepts one debrid service per configured manifest. Mirroring
// AIOStreams, make one manifest for each active compatible service rather
// than arbitrarily choosing one when a user has more than one provider.
function buildJackettioConfigUrls(config: any) {
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
    buildConfigUrl(config: any) {
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
    buildConfigUrl(config: any) {
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
    // Meteor can also search usenet, resolved through TorBox. TorBox only
    // includes usenet on its Pro plan, so it is switched on only when the
    // user's TorBox key is on Pro (looked up once, cached; unknown = off).
    async prepare(config: any) {
      const torbox = activePairs(config, 'meteor').find(([service]: any) => service === 'torbox');
      if (!torbox) return { usenet: false };
      const tb = require('../providers/torbox.ts');
      try { return { usenet: tb.hasTorBoxUsenet(await tb.getTorBoxPlan(torbox[1])) }; }
      catch { return { usenet: false }; }
    },
    // https://meteorfortheweebs.midnightignite.me/{base64urlJSON}/manifest.json
    buildConfigUrl(config: any, extras: any = {}) {
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
        enableUsenet: extras.usenet === true,
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
    buildHeaders(config: any) {
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
  { id: 'meteor',       name: 'Meteor',       logo: ADDONS.meteor.logo,       desc: 'Torrent and debrid streams, plus Usenet with TorBox Pro.' },
  { id: 'mediafusion',  name: 'MediaFusion',  logo: ADDONS.mediafusion.logo,  desc: 'Universal streams for movies, series and anime.' },
  { id: 'jackettio',    name: 'Jackettio',    logo: ADDONS.jackettio.logo,    desc: 'Extra tracker results, configured with your existing debrid account.' },
  { id: 'knaben',       name: 'KNABEN',       logo: '/addon-logos/knaben.png', desc: 'Public torrent index search, resolved through your debrid account.' },
];

// No hard caps: the resolution filter and total cap in discovery.js handle
// stream selection. AIOStreams has no cap either; the filter is the gate.

// Fetch one addon's streams for a `tt:` id. Returns [] on any failure: one
// slow/broken addon must never fail the whole response.
async function fetchAddonStreams(addonId: any, config: any, type: any, ttId: any, timeoutMs = 15000) {
  const addon = (ADDONS as Record<string, any>)[addonId];
  if (!addon) return [];
  try {
    const extras = typeof addon.prepare === 'function' ? await addon.prepare(config) : {};
    const manifestUrls = typeof addon.buildConfigUrls === 'function'
      ? addon.buildConfigUrls(config)
      : [addon.buildConfigUrl(config, extras)];
    if (!manifestUrls.length) return [];
    const responses = await Promise.all(manifestUrls.map((manifestUrl: any) => {
      const streamUrl = manifestUrl.replace(/\/manifest\.json$/, '') + `/stream/${type}/${ttId}.json`;
      const headers = {
        'User-Agent': 'LeLibrary/2.0 (+https://github.com/leleasley/LeLibrary)',
        Accept: 'application/json',
        ...(typeof addon.buildHeaders === 'function' ? addon.buildHeaders(config) : {}),
      };
      return axios.get(streamUrl, { headers, timeout: timeoutMs, validateStatus: (s: any) => s < 500 })
        .then((res: any) => Array.isArray(res.data?.streams) ? res.data.streams : [])
        .catch(() => []);
    }));
    const streams = responses.flat();
    if (streams.length === 0) return [];
    // Tag each stream with its source addon so reformatting can show WHERE it
    // came from (name for display, id for the formatter's service badge);
    // capped per addon to the best few (addons sort best-first).
    return streams.map((s: any) => ({
      ...s,
      _sourceAddon: addon.name,
      _sourceAddonId: addonId,
      name: s.name ? `${s.name}` : addon.name,
      description: s.description ? `${s.description}\n⚡ ${addon.name}` : `⚡ ${addon.name}`,
    }));
  } catch (err: any) {
    console.warn(`[StreamAddons] ${addon.name} fetch failed for ${ttId}: ${err.message}`);
    return [];
  }
}

async function fetchKnabenStreams(config: any, type: any, title: any, year: any, season: any, episode: any, token: any, requestOrigin: any) {
  if (!title || !token || !requestOrigin) return [];
  const query = [title, year, type === 'series' ? `S${String(season || '').padStart(2, '0')}E${String(episode || '').padStart(2, '0')}` : '']
    .filter(Boolean).join(' ');
  try {
    const res = await axios.post('https://api.knaben.org/v1', {
      search_type: 'score', search_field: 'title', query,
      order_by: 'seeders', order_direction: 'desc', size: 30,
      hide_unsafe: true, hide_xxx: true,
    }, { timeout: 5000, headers: { 'User-Agent': 'LeLibrary/2.0 (+https://github.com/leleasley/LeLibrary)', Accept: 'application/json' } });
    const hits = Array.isArray(res.data?.hits) ? res.data.hits : [];
    const providers = require('../providers/index.ts').activeProviders(config);
    const origin = String(requestOrigin).replace(/\/+$/, '');
    const out = [];
    const magnets = new Map();
    const seenProviderHashes = new Set();
    for (const hit of hits) {
      const hash = String(hit?.hash || '').trim().toLowerCase();
      if (!/^[a-f0-9]{40}$/.test(hash)) continue;
      const name = String(hit.title || '').slice(0, 300);
      if (!name) continue;
      const rawMagnet = typeof hit.magnetUrl === 'string' && hit.magnetUrl.startsWith('magnet:?') ? hit.magnetUrl : '';
      const magnet = rawMagnet || `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}`;
      magnets.set(hash, magnet);
      for (const provider of providers) {
        const providerHash = `${provider}:${hash}`;
        if (seenProviderHashes.has(providerHash)) continue;
        seenProviderHashes.add(providerHash);
        out.push({
          name: `${name} [${provider.toUpperCase()}]`,
          description: `🧲 KNABEN · ${hit.tracker || 'Torrent'} · ${Number(hit.seeders) || 0} seeders${hit.bytes ? ` · ${(Number(hit.bytes) / 1073741824).toFixed(1)} GB` : ''}`,
          url: `${origin}/${encodeURIComponent(token)}/knaben/play/${provider}/${hash}.json?name=${encodeURIComponent(name)}&season=${encodeURIComponent(season || '')}&episode=${encodeURIComponent(episode || '')}`,
          behaviorHints: { filename: name, videoSize: Number(hit.bytes) || undefined },
          _sourceAddon: 'KNABEN', _sourceAddonId: 'knaben', _debridProviderId: provider,
          _knabenSeeders: Number(hit.seeders) || 0,
        });
      }
    }
    await streamCache.mset([...magnets].map(([hash, magnet]) => ({ key: streamCache.makeKey('knabenmagnet', hash), value: magnet, ttl: 24 * 60 * 60 }))).catch(() => {});
    return out;
  } catch (err: any) {
    console.warn(`[StreamAddons] KNABEN search failed: ${err.message}`);
    return [];
  }
}

// Deduplicate merged streams by their URL / infoHash / name.
function dedupeStreams(streams: any) {
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
function compareExternalProviderPriority(a: any, b: any) {
  const priority = (stream: any) => Number.isFinite(stream?._externalPriority)
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
const EXTERNAL_TIME_BUDGET_MS = Math.max(4000, Math.min(15000, parseInt(process.env.EXTERNAL_STREAM_BUDGET_MS ?? '', 10) || 6000));
// "Your own" stream addons (StreamNZB, a personal AIOStreams, ...). The link
// is secret: it lives in the sealed keys as customAddon1..3 and only reaches
// here through the runtime config. The plain config holds just the display
// name ({ id: 'custom-1', name }). Fetching goes through the AIOStreams
// connector core: HTTPS, public hosts only (unless the operator opts in),
// pinned DNS, no redirects, bounded size, cooldown and a recursion fuse.
const CUSTOM_ADDON_IDS = ['custom-1', 'custom-2', 'custom-3'];
const MAX_CUSTOM_ADDONS = CUSTOM_ADDON_IDS.length;

function customAddonSlot(id: any): number | null {
  const match = /^custom-([1-3])$/.exec(String(id || ''));
  return match ? Number(match[1]) : null;
}

function customAddonName(config: any, id: any): string {
  const list = Array.isArray(config?.customAddons) ? config.customAddons : [];
  const entry = list.find((row: any) => row && row.id === id);
  const name = entry && typeof entry.name === 'string' ? entry.name.trim() : '';
  return name ? name.slice(0, 60) : 'Your addon';
}

async function fetchExternalStreams(addonIds: any, config: any, type: any, ttId: string | undefined, timeBudgetMs = EXTERNAL_TIME_BUDGET_MS, runtime: any = {}) {
  const AIOSTREAMS_ID = 'aiostreams';
  if (!ttId) return [];
  const ids = Array.isArray(addonIds) ? addonIds.filter((id: any) => (ADDONS as Record<string, any>)[id] || id === AIOSTREAMS_ID || id === 'knaben' || customAddonSlot(id) !== null) : [];
  if (ids.length === 0) return [];
  const normType = type === 'anime' ? 'series' : type;
  const budgetMs = Number.isFinite(timeBudgetMs)
    ? Math.max(2000, Math.min(EXTERNAL_TIME_BUDGET_MS, timeBudgetMs))
    : EXTERNAL_TIME_BUDGET_MS;
  const deadline = Date.now() + budgetMs;

  // Fetch in parallel, but assemble in the configured order. Appending each
  // response as it completes made faster providers (usually Comet) jump ahead
  // of a user's first choice. `_externalPriority` is intentionally retained
  // until discovery.js has applied the final per-provider stream ordering.
  const responses = await Promise.all(ids.map(async (id, priority) => {
    let span = `external:${String(id).toLowerCase().replace(/[^a-z0-9]/g, '') || 'unknown'}`;
    let timed: <T>(name: string, fn: () => Promise<T> | T) => Promise<T>;
    try {
      const perf = require('../middleware/perf-timing.ts');
      timed = (name, fn) => perf.timeSpan(runtime.trace, name, fn);
    } catch { timed = (_name: string, fn: () => Promise<any> | any) => fn(); }
    try {
      const remaining = Math.max(2000, deadline - Date.now());
      if (id === AIOSTREAMS_ID) {
        // Personal AIOStreams connector. Its configured URL is server-held, so
        // it arrives via runtime (never config/token/cache). The connector core
        // handles coalescing, cooldown, SSRF checks and the recursion fuse.
        const url = runtime.aioStreams && runtime.aioStreams.url;
        if (!url) return [];
        const { streams } = await timed(span, () => fetchAioStreams({
          url, type: normType, id: ttId,
          timeoutMs: remaining,
          userKeyHash: runtime.aioStreams.userKeyHash || '',
        }));
        return streams.map((stream: any) => ({
          ...stream,
          _sourceAddon: 'AIOStreams',
          _sourceAddonId: AIOSTREAMS_ID,
          name: stream.name ? `${stream.name}` : 'AIOStreams',
          description: stream.description ? `${stream.description}\n⚡ AIOStreams` : '⚡ AIOStreams',
          _externalPriority: priority,
        }));
      }
      const slot = customAddonSlot(id);
      if (slot !== null) {
        const url = typeof config?.[`customAddon${slot}`] === 'string' ? config[`customAddon${slot}`] : '';
        if (!url) return [];
        const label = customAddonName(config, id);
        const { streams } = await timed(span, () => fetchAioStreams({
          url, type: normType, id: ttId,
          timeoutMs: remaining,
          userKeyHash: String(runtime.aioStreams?.userKeyHash || (() => { try { return require('../providers/index.ts').getUserKey(config); } catch { return 'anon'; } })()),
        }));
        return streams.map((stream: any) => ({
          ...stream,
          _sourceAddon: label,
          _sourceAddonId: id,
          name: stream.name ? `${stream.name}` : label,
          description: stream.description ? `${stream.description}\n⚡ ${label}` : `⚡ ${label}`,
          _externalPriority: priority,
        }));
      }
      if (id === 'knaben') {
        const meta = await runtime.knabenMetadata;
        const streams = await timed(span, () => fetchKnabenStreams(config, normType, meta?.title, meta?.year, runtime.season, runtime.episode, runtime.token, runtime.origin));
        return streams.map((stream: any) => ({ ...stream, _externalPriority: priority }));
      }
      const streams = await timed(span, () => fetchAddonStreams(id, config, normType, ttId, remaining));
      return streams.map((stream: any) => ({ ...stream, _externalPriority: priority }));
    } catch (err: any) {
      console.warn(`[StreamAddons] ${id} error: ${err.message}`);
      return [];
    }
  }));
  const deduped = dedupeStreams(responses.flat());
  return deduped;
}

export interface StreamAddonsApi {
  CUSTOM_ADDON_IDS: any;
  MAX_CUSTOM_ADDONS: any;
  customAddonSlot: any;
  ADDON_LIST: any;
  ADDONS: any;
  buildJackettioConfigUrls: any;
  fetchExternalStreams: any;
  dedupeStreams: any;
  compareExternalProviderPriority: any;
}

module.exports = {
  CUSTOM_ADDON_IDS,
  MAX_CUSTOM_ADDONS,
  customAddonSlot,
  ADDON_LIST,
  ADDONS,
  buildJackettioConfigUrls,
  fetchExternalStreams,
  dedupeStreams,
  compareExternalProviderPriority,
} satisfies StreamAddonsApi;
