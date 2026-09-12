// ── Server-side per-user config store (Redis) ─────────────────────────
// Configure pages save the “heavy” stream settings here (the stream-addon
// list plus the stream-format preset/templates) under a configuration scope,
// so the install token stays small and the settings survive page
// reloads, device switches and re-pushes. The addon merges these back into
// the decoded token on every stream request.
//
// The store is deliberately a SUPPLEMENT, never the source of truth: if Redis
// is flushed or the key expires, everything keeps working from the token alone
// (just without the server-side stream settings). It holds ONLY stream
// settings: never API keys or account/session tokens. Direct stream URLs may
// contain signed parameters, so hosted installs encrypt Custom Streams before
// they reach Redis; self-hosted instances without an encryption key retain
// them only in their local store.

const cache = require('./cache');
const { getUserKey } = require('./providers');
const { validateCustomStreamsConfig } = require('./custom-streams');
const crypto = require('crypto');

const STREAM_FIELDS = ['streamAddons', 'streamPreset', 'streamNameTemplate', 'streamDescTemplate', 'nuvioBadgePack', 'nuvioBadgeUrl', 'customStreams', 'streamNotices', 'filterResolutions', 'filterResOrder', 'filterQualities', 'filterSources', 'filterCodecs', 'filterHdr', 'filterAudio', 'filterMinSize', 'filterMaxSize', 'filterCachedOnly', 'nuvioCollectionPacks', 'nuvioCollectionOverrides', 'importedRows', 'libraryCatalogs', 'libHomeHidden', 'posterProvider', 'pictoriumUrl', 'pictoriumOptions'];
// Object-valued fields are stored as JSON strings so the store stays a flat
// key/value shape; they are parsed back on load.
const OBJECT_FIELDS = new Set(['pictoriumOptions']);
// Fields where an empty string is a meaningful value (clears a previous
// setting) and must therefore survive the "skip empty" rule.
const CLEARABLE_FIELDS = new Set(['posterProvider', 'pictoriumUrl']);
const TOGGLE_FIELDS = ['libraryIdMode'];
const CONFIG_TTL = 60 * 60 * 24 * 90; // 90 days, refreshed on every save

function storeScope(config = {}) {
  const accountToken = config.__configScope?.type === 'account'
    ? config.__configScope.token
    : '';
  if (accountToken) {
    const digest = crypto.createHash('sha256').update(String(accountToken)).digest('hex');
    return `account:${digest}`;
  }
  return `legacy:${getUserKey(config)}`;
}

function storeKey(config = {}) {
  return `userconfig:${storeScope(config)}`;
}

// Extract just the stream-settings subset from a config object. Fields that
// are absent are SKIPPED (so a partial save never clobbers the store); an
// explicitly empty streamAddons list IS kept, so "cleared all addons" sticks.
function streamSettings(config = {}) {
  const out = {};
  for (const f of STREAM_FIELDS) {
    const v = config[f];
    if (v === undefined || v === null) continue;
    if (OBJECT_FIELDS.has(f)) {
      if (typeof v === 'object') out[f] = JSON.stringify(v);
      continue;
    }
    if (Array.isArray(v)) out[f] = v;
    else if (typeof v === 'string' && (v || CLEARABLE_FIELDS.has(f))) out[f] = v;
  }
  for (const f of TOGGLE_FIELDS) {
    if (config[f] === undefined) continue;
    out[f] = config[f] || '';
  }
  return out;
}

// Persist a config's stream settings under its configuration scope. Returns the
// userKey, or null if the config has no usable provider keys. A config with
// NO stream-settings fields leaves the existing store untouched: this keeps
// the configure page's initial restore POST from wiping the user's saved
// addons while their settings are still loading.
async function saveStreamSettings(config = {}) {
  config = validateCustomStreamsConfig(config);
  const userKey = getUserKey(config);
  const accountScoped = config.__configScope?.type === 'account' && config.__configScope?.token;
  if (!userKey && !accountScoped) return null;
  const subset = streamSettings(config);
  if (Object.keys(subset).length === 0) return userKey || 'account';
  // Hosted mapping URLs can contain private hosts or signed query parameters.
  // Encrypt that one field before it reaches Redis. Self-hosted instances that
  // do not configure the private account encryption key keep their local-only
  // store behavior; an account scope must always be encryptable.
  const canEncrypt = /^[0-9a-f]{64}$/i.test(process.env.ENCRYPTION_KEY || '');
  if ((accountScoped || canEncrypt) && Array.isArray(subset.customStreams)) {
    try {
      const enc = require('./accounts/encrypt');
      subset.customStreamsSealed = enc.sealJson(subset.customStreams);
      delete subset.customStreams;
    } catch (err) {
      // Account-backed hosted storage must never downgrade to plaintext.
      // Public self-host builds intentionally omit src/accounts entirely, so
      // a legacy local store falls back to its operator-controlled boundary.
      if (accountScoped) throw new Error(`Could not protect Custom Streams: ${err.message}`);
    }
  }
  await cache.set(storeKey(config), subset, CONFIG_TTL);
  return userKey || 'account';
}

async function loadStreamSettings(userKeyOrConfig) {
  if (!userKeyOrConfig) return null;
  if (typeof userKeyOrConfig === 'object') {
    let scoped = await cache.get(storeKey(userKeyOrConfig));
    if (scoped?.customStreamsSealed) {
      try {
        const enc = require('./accounts/encrypt');
        const customStreams = enc.unsealJson(scoped.customStreamsSealed);
        scoped = { ...scoped };
        delete scoped.customStreamsSealed;
        if (Array.isArray(customStreams)) scoped.customStreams = customStreams;
      } catch {
        scoped = { ...scoped };
        delete scoped.customStreamsSealed;
      }
    }
    if (scoped || userKeyOrConfig.__configScope?.type === 'account') return scoped;
    // Compatibility read for legacy settings written before scoping was added.
    const userKey = getUserKey(userKeyOrConfig);
    return userKey ? cache.get(`userconfig:${userKey}`) : null;
  }
  return cache.get(`userconfig:legacy:${userKeyOrConfig}`);
}

// Merge server-side stream settings into a decoded token config (a copy).
// Stored values win over the token's own fields when present.
async function mergeStoredConfig(config = {}) {
  if (!config || typeof config !== 'object') return config;
  const userKey = getUserKey(config);
  if (!userKey && config.__configScope?.type !== 'account') return config;
  const stored = await loadStreamSettings(config);
  if (!stored || typeof stored !== 'object') return config;
  const merged = { ...config };
  if (config.__configScope) {
    Object.defineProperty(merged, '__configScope', {
      value: config.__configScope, enumerable: false, configurable: true,
    });
  }
  // The manifest token is what lets the poster proxy build its URL. It is a
  // non-enumerable internal, so the spread above would drop it and Pictorium
  // posters would silently fall back to TMDB on every merged request path.
  if (config.__pictoriumToken) {
    Object.defineProperty(merged, '__pictoriumToken', {
      value: config.__pictoriumToken, enumerable: false, configurable: true,
    });
  }
  for (const f of STREAM_FIELDS) {
    let v = stored[f];
    if (v === undefined || v === null) continue;
    if (OBJECT_FIELDS.has(f)) {
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch { continue; } }
    } else if (v === '' && !CLEARABLE_FIELDS.has(f)) {
      continue;
    }
    merged[f] = v;
  }
  // Toggle fields: a stored value is authoritative once present ('tt' on,
  // '' off) so the server-side switch can override an older pushed token.
  for (const f of TOGGLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(stored, f)) continue;
    if (stored[f] === 'tt') merged[f] = 'tt';
    else delete merged[f];
  }
  return merged;
}

module.exports = {
  STREAM_FIELDS,
  TOGGLE_FIELDS,
  saveStreamSettings,
  loadStreamSettings,
  mergeStoredConfig,
};
