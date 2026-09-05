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
// In-memory mirror TTL: 7 days in seconds. Deliberately short: Node's
// setTimeout (which backs the in-memory cache) overflows past ~24.8 days and
// would drop the entry immediately, and Redis below is the durable copy.
const MEM_TTL = 7 * 24 * 60 * 60;

function normalize(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r && r.id && r.config && typeof r.config === 'object');
}

// Single writer: Redis holds the durable copy with NO expiry (operator data,
// not a cache entry) and the in-memory cache only mirrors it for fast reads.
// Never use cache.set() here: it writes Redis with SETEX, which would put an
// expiry on the durable copy.
async function persist(rows) {
  const client = cache.getRedisClient();
  if (client) {
    if (rows.length) await client.set(KEY, JSON.stringify(rows));
    else await client.del(KEY);
  }
  cache.setMem(KEY, rows, MEM_TTL);
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
  await persist(rows);
  return { id };
}

async function remove(id) {
  const rows = normalize(await cache.get(KEY));
  const next = rows.filter((r) => r.id !== id);
  await persist(next);
  return true;
}

module.exports = { list, save, remove, KEY };
