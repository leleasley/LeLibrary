// Shared Nuvio badge-pack catalogue for Node. The browser picker lives in
// website/public/badge-packs.js; the pack table here must stay in sync with
// the PACKS list there (same ids and official community URLs). Only LeLibrary
// artwork is bundled locally — community packs are always fetched from their
// maintainers' official URLs and never copied in.

const LOCAL_PATH = '/api/nuvio-badges/lelibrary-premium.json';

const PACKS = [
  { id: 'lelibrary-premium', name: 'LeLibrary Premium', path: LOCAL_PATH, local: true },
  { id: 'nard-full', name: 'NardBadges Full', url: 'https://raw.githubusercontent.com/vowl313/NardBadges/refs/heads/main/NardBadges.json' },
  { id: 'nard-slim', name: 'NardBadges Slim', url: 'https://raw.githubusercontent.com/vowl313/NardBadges/refs/heads/main/NardBadges_Slim.json' },
  { id: 'better-colored', name: 'BetterFormatter Colored', url: 'https://raw.githubusercontent.com/9mousaa/BetterFormatter/main/presets/colored-bgb-combo-always.json' },
  { id: 'better-mono', name: 'BetterFormatter Mono', url: 'https://raw.githubusercontent.com/9mousaa/BetterFormatter/main/presets/mono-bgb-combo-nodv.json' },
  { id: 'elite', name: 'Elite Badges', url: 'https://raw.githubusercontent.com/leonevz/Elite-Badges/main/badges.json' },
  { id: 'minimal-white', name: 'Minimalist White', url: 'https://raw.githubusercontent.com/sweatycab/nuvio-minimalist-badges/main/badges-white.json' },
  { id: 'minimal-mixed', name: 'Minimalist Mixed', url: 'https://raw.githubusercontent.com/sweatycab/nuvio-minimalist-badges/main/badges-mixed.json' },
  { id: 'custom', name: 'Custom URL', url: '' },
];

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;

// Nuvio syncs profile settings per platform client family. The TV client
// uses 'tv'; the Apple mobile app uses 'mobile' (verified against live
// blobs). Badge packs must be written to each existing platform blob or the
// corresponding app keeps showing its old pack.
const SETTINGS_PLATFORMS = ['tv', 'mobile'];

// Resolve the absolute badge JSON URL for a saved picker choice. Returns ''
// when the choice has no usable URL (caller should then skip the sync).
function resolveBadgePackUrl(pack, customUrl, baseUrl) {
  const id = String(pack || '').trim() || 'lelibrary-premium';
  if (id === 'custom') {
    try {
      const u = new URL(String(customUrl || '').trim());
      if (!['http:', 'https:'].includes(u.protocol)) return '';
      return u.toString();
    } catch { return ''; }
  }
  const preset = PACKS.find((p) => p.id === id) || PACKS[0];
  if (preset.local) {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    if (!base) return '';
    return base + LOCAL_PATH;
  }
  return preset.url || '';
}

const FILTER_FIELDS = ['id', 'groupId', 'name', 'pattern', 'imageURL', 'imageUrl', 'isEnabled', 'tagColor', 'borderColor', 'tagStyle', 'textColor'];
const GROUP_FIELDS = ['id', 'name', 'color', 'borderColor', 'tagColor'];

// Build the single active badge import Nuvio stores. Filters/groups are
// sanitised to the known Nuvio fields and bounded so a hostile manifest
// cannot bloat a user's settings blob.
function buildBadgeImport(manifest, sourceUrl) {
  const filters = (Array.isArray(manifest?.filters) ? manifest.filters : [])
    .filter((f) => f && typeof f === 'object' && String(f.pattern || '').trim() && String(f.imageURL || f.imageUrl || '').trim())
    .slice(0, 200)
    .map((f) => {
      const out = {};
      for (const key of FILTER_FIELDS) {
        if (f[key] === undefined) continue;
        out[key] = typeof f[key] === 'boolean' ? f[key] : String(f[key]).slice(0, 2000);
      }
      if (out.imageUrl && !out.imageURL) { out.imageURL = out.imageUrl; delete out.imageUrl; }
      if (out.isEnabled === undefined) out.isEnabled = true;
      return out;
    });
  if (!filters.length) throw new Error('That badge pack has no usable badges.');
  const groups = (Array.isArray(manifest?.groups) ? manifest.groups : [])
    .filter((g) => g && typeof g === 'object')
    .slice(0, 50)
    .map((g) => {
      const out = {};
      for (const key of GROUP_FIELDS) {
        if (g[key] === undefined) continue;
        out[key] = String(g[key]).slice(0, 500);
      }
      return out;
    });
  return { sourceUrl: String(sourceUrl), filters, groups, isActive: true };
}

// Splice one active import into a pulled settings blob. Only the badge rules
// value is replaced; every other feature passes through untouched.
function applyBadgeImportToBlob(blob, badgeImport) {
  const next = JSON.parse(JSON.stringify(blob || {}));
  next.features = next.features && typeof next.features === 'object' ? next.features : {};
  const badge = next.features.stream_badge_settings && typeof next.features.stream_badge_settings === 'object'
    ? next.features.stream_badge_settings
    : {};
  badge.stream_badge_rules = { type: 'string', value: JSON.stringify({ imports: [badgeImport] }) };
  next.features.stream_badge_settings = badge;
  return next;
}

// SSRF-hardened JSON fetch for badge manifests: public http(s) hosts only,
// no redirects (a public URL must not bounce to an internal one).
async function fetchBadgeManifest(sourceUrl) {
  let parsed;
  try { parsed = new URL(String(sourceUrl || '').trim()); }
  catch { throw new Error('Enter a valid badge JSON URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS badge URLs are supported.');
  const net = require('node:net');
  const dns = require('node:dns').promises;
  const isPublicIp = (address) => {
    const family = net.isIP(address);
    if (family === 4) {
      const [a, b] = address.split('.').map(Number);
      return !(a === 0 || a === 10 || a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19)) || a >= 224);
    }
    if (family === 6) {
      const ip = address.toLowerCase();
      if (ip === '::' || ip === '::1' || ip.startsWith('::ffff:')) return false;
      const first = parseInt(ip.split(':')[0] || '0', 16);
      return !((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00);
    }
    return false;
  };
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  const records = net.isIP(hostname)
    ? [{ address: hostname, family: net.isIP(hostname) }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some(({ address }) => !isPublicIp(address))) {
    throw new Error('That URL resolves to a private or non-public network.');
  }
  const { address, family } = records[0];
  const axios = require('axios');
  const response = await axios.get(parsed.toString(), {
    timeout: FETCH_TIMEOUT_MS,
    responseType: 'json',
    maxContentLength: MAX_MANIFEST_BYTES,
    maxBodyLength: MAX_MANIFEST_BYTES,
    maxRedirects: 0,
    lookup: (_hostname, _options, callback) => callback(null, address, family),
    validateStatus: (status) => status >= 200 && status < 300,
  });
  if (!response.data || typeof response.data !== 'object' || !Array.isArray(response.data.filters)) {
    throw new Error('That URL did not return a badge manifest.');
  }
  return response.data;
}

module.exports = { LOCAL_PATH, PACKS, SETTINGS_PLATFORMS, MAX_MANIFEST_BYTES, resolveBadgePackUrl, buildBadgeImport, applyBadgeImportToBlob, fetchBadgeManifest };
