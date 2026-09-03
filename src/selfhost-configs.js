// ── Self-hosted saved configs (public/tracked: SELF-HOST ONLY) ──
// Lets a self-hosted operator keep a list of saved addon configs on their own
// instance and load one from the configure page with a click.
//
// IMPORTANT: this is deliberately SELF-HOST ONLY. The routes are mounted only
// when the hosted account area is absent (see web-routes.js). On the hosted
// instance (lelibrary.uk) saved configs = account tokens in Postgres; this
// Redis-backed list is never used or mounted there.
//
// Storage: a single Redis key holding a JSON array of
//   { id, label, config, created_at }
// Redis has a named volume on self-hosted installs (redis_data), so the list
// survives container rebuilds. No TTL: these are the operator's own configs.
// Falls back to in-memory if Redis is unavailable (configs lost on restart).

const crypto = require('crypto');
const cache = require('./cache');

const KEY = 'selfhost:saved_configs';
const MAX_CONFIGS = 100;
const MAX_CONFIG_BYTES = 256 * 1024;

function normalize(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r && r.id && r.config && typeof r.config === 'object');
}

async function list() {
  const rows = await cache.get(KEY);
  return normalize(rows);
}

async function save({ label, config }) {
  if (!config || typeof config !== 'object') throw new Error('Missing config');
  if (Buffer.byteLength(JSON.stringify(config), 'utf8') > MAX_CONFIG_BYTES) throw new Error('Config is too large');
  const rows = normalize(await cache.get(KEY));
  if (rows.length >= MAX_CONFIGS) throw new Error(`At most ${MAX_CONFIGS} saved configs are supported`);
  const id = crypto.randomBytes(6).toString('hex');
  rows.push({
    id,
    label: String(label || 'My setup').slice(0, 120),
    config,
    created_at: new Date().toISOString(),
  });
  // Persist without TTL (Redis SET: survives restarts via the named volume).
  const client = cache.getRedisClient();
  if (client) {
    await client.set(KEY, JSON.stringify(rows));
  }
  cache.set(KEY, rows, 365 * 24 * 60 * 60); // mirror in memory (long TTL)
  return { id };
}

async function remove(id) {
  const rows = normalize(await cache.get(KEY));
  const next = rows.filter((r) => r.id !== id);
  const client = cache.getRedisClient();
  if (client) {
    if (next.length) await client.set(KEY, JSON.stringify(next));
    else await client.del(KEY);
  }
  cache.set(KEY, next, 365 * 24 * 60 * 60);
  return true;
}

module.exports = { list, save, remove, KEY };
