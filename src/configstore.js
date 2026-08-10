// ── Server-side per-user config store (Redis) ─────────────────────────
// The configure page saves the "heavy" stream settings here (the stream-addon
// list plus the stream-format preset/templates) keyed by the user's stable
// hash, so the install token stays small and the settings survive page
// reloads, device switches and re-pushes. The addon merges these back into
// the decoded token on every stream request.
//
// The store is deliberately a SUPPLEMENT, never the source of truth: if Redis
// is flushed or the key expires, everything keeps working from the token alone
// (just without the server-side stream settings). It holds ONLY stream
// settings — never API keys, tokens or catalog config — so nothing sensitive
// lands in Redis.

const cache = require('./cache');
const { getUserKey } = require('./providers');

const STREAM_FIELDS = ['streamAddons', 'streamPreset', 'streamNameTemplate', 'streamDescTemplate', 'customStreams'];
const CONFIG_TTL = 60 * 60 * 24 * 90; // 90 days, refreshed on every save

function storeKey(userKey) {
  return `userconfig:${userKey}`;
}

// Extract just the stream-settings subset from a config object. Fields that
// are absent are SKIPPED (so a partial save never clobbers the store); an
// explicitly empty streamAddons list IS kept, so "cleared all addons" sticks.
function streamSettings(config = {}) {
  const out = {};
  for (const f of STREAM_FIELDS) {
    const v = config[f];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) out[f] = v;
    else if (typeof v === 'string' && v) out[f] = v;
  }
  return out;
}

// Persist a config's stream settings keyed by the user hash. Returns the
// userKey, or null if the config has no usable provider keys. A config with
// NO stream-settings fields leaves the existing store untouched — this keeps
// the configure page's initial restore POST from wiping the user's saved
// addons while their settings are still loading.
async function saveStreamSettings(config = {}) {
  const userKey = getUserKey(config);
  if (!userKey) return null;
  const subset = streamSettings(config);
  if (Object.keys(subset).length === 0) return userKey;
  await cache.set(storeKey(userKey), subset, CONFIG_TTL);
  return userKey;
}

async function loadStreamSettings(userKey) {
  if (!userKey) return null;
  return cache.get(storeKey(userKey));
}

// Merge server-side stream settings into a decoded token config (a copy).
// Stored values win over the token's own fields when present.
async function mergeStoredConfig(config = {}) {
  if (!config || typeof config !== 'object') return config;
  const userKey = getUserKey(config);
  if (!userKey) return config;
  const stored = await loadStreamSettings(userKey);
  if (!stored || typeof stored !== 'object') return config;
  const merged = { ...config };
  for (const f of STREAM_FIELDS) {
    const v = stored[f];
    if (v !== undefined && v !== null && v !== '') merged[f] = v;
  }
  return merged;
}

module.exports = {
  STREAM_FIELDS,
  saveStreamSettings,
  loadStreamSettings,
  mergeStoredConfig,
};
