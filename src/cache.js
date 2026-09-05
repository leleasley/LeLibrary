const Redis = require('ioredis');
const NodeCache = require('node-cache');

let redis = null;
let isConnected = false;

// In-memory fallback when Redis is not configured.
// useClones:true: values handed out by get()/set() must not be live
// references: callers mutate returned objects (metas especially), and with
// shared refs one request's edits leaked into every later reader until the
// entry expired.
const MEM_CACHE_MAX_KEYS = Math.max(100, parseInt(process.env.MEM_CACHE_MAX_KEYS, 10) || 3000);
const memCache = new NodeCache({ stdTTL: 3600, checkperiod: 600, useClones: true });
// NodeCache has no eviction policy: its optional maxKeys limit throws instead
// of evicting. Keep a small LRU-style index ourselves so the hot in-process
// mirror cannot steadily consume process memory. Redis remains authoritative;
// an evicted mirror entry is simply read from Redis again.
const memKeyOrder = new Map();

function rememberMemKey(key) {
  if (memKeyOrder.has(key)) memKeyOrder.delete(key);
  memKeyOrder.set(key, true);
}

function setMemCache(key, value, ttl) {
  if (!memCache.has(key)) {
    while (memKeyOrder.size >= MEM_CACHE_MAX_KEYS) {
      const oldest = memKeyOrder.keys().next().value;
      if (oldest === undefined) break;
      memKeyOrder.delete(oldest);
      memCache.del(oldest);
    }
  }
  memCache.set(key, value, ttl);
  rememberMemKey(key);
}

// Memory-mirror-only write: updates the in-process cache without touching
// Redis. For operator data that Redis holds WITHOUT expiry (self-hosted saved
// setups), where the normal set() would wrongly apply SETEX to the durable
// copy.
function setMem(key, value, ttl) {
  setMemCache(key, value, ttl);
  return true;
}

function getMemCache(key) {
  const value = memCache.get(key);
  if (value === undefined) memKeyOrder.delete(key);
  else rememberMemKey(key);
  return value;
}

function delMemCache(key) {
  memKeyOrder.delete(key);
  memCache.del(key);
}

async function scanPattern(client, pattern, onBatch) {
  let cursor = '0';
  let matched = 0;
  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 250);
    cursor = nextCursor;
    if (keys.length) {
      matched += keys.length;
      await onBatch(keys);
    }
  } while (cursor !== '0');
  return matched;
}

function getRedisClient() {
  if (!redis) {
    const url      = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL;
    const host     = process.env.REDIS_HOST;
    const port     = parseInt(process.env.REDIS_PORT) || 6379;
    const password = process.env.REDIS_PASSWORD;
    const tls      = process.env.REDIS_TLS === 'true' || (url && url.startsWith('rediss://'));

    if (!url && !host) return null;

    const opts = {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 50, 2000);
      },
      ...(tls ? { tls: {} } : {}),
    };

    console.log(`[Redis] Connecting via ${url ? 'URL' : `${host}:${port}`}...`);
    redis = url
      ? new Redis(url, opts)
      : new Redis({ host, port, password, ...opts });

    redis.on('error',   (err) => { console.error('[Redis] Error:', err.message); isConnected = false; });
    redis.on('connect', ()    => { console.log('[Redis] Connected'); isConnected = true; });
    redis.on('close',   ()    => { console.log('[Redis] Connection closed'); isConnected = false; });
  }
  return redis;
}

async function get(key) {
  const client = getRedisClient();
  if (!client) {
    const val = getMemCache(key);
    if (val !== undefined) return val;
    return null;
  }
  try {
    const data = await client.get(key);
    if (!data) return null;
    return JSON.parse(data);
  } catch (err) {
    console.error(`[Cache] Error fetching ${key}:`, err.message);
    const val = getMemCache(key);
    return val !== undefined ? val : null;
  }
}

async function set(key, value, ttl = 3600) {
  const client = getRedisClient();
  if (!client) {
    setMemCache(key, value, ttl);
    return true;
  }
  try {
    await client.setex(key, ttl, JSON.stringify(value));
    setMemCache(key, value, ttl); // mirror in memory for fast reads
    return true;
  } catch (err) {
    console.error(`[Cache] Error storing ${key}:`, err.message);
    setMemCache(key, value, ttl);
    return false;
  }
}

async function del(key) {
  delMemCache(key);
  const client = getRedisClient();
  if (!client) return true;
  try {
    await client.del(key);
    return true;
  } catch (err) {
    console.error(`[Cache] Error deleting ${key}:`, err.message);
    return false;
  }
}

async function delPattern(pattern) {
  // Clear memCache by pattern
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  for (const k of memCache.keys()) { if (regex.test(k)) delMemCache(k); }

  const client = getRedisClient();
  if (!client) return 0;
  try {
    const count = await scanPattern(client, pattern, (keys) => client.del(...keys));
    if (count) console.log(`[Cache] DEL Pattern → ${pattern} (${count} keys)`);
    return count;
  } catch (err) {
    console.error(`[Cache] Error deleting pattern ${pattern}:`, err.message);
    return 0;
  }
}

// Extend TTL on all keys matching a glob pattern (does not touch values).
// Used to keep long-TTL caches warm on unchanged-data refreshes.
async function touchPattern(pattern, ttl) {
  const client = getRedisClient();
  if (!client) {
    // memCache: bump the TTL on matching in-memory keys
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    for (const k of memCache.keys()) {
      if (regex.test(k)) { const v = getMemCache(k); if (v !== undefined) setMemCache(k, v, ttl); }
    }
    return 0;
  }
  try {
    const count = await scanPattern(client, pattern, async (keys) => {
      const pipe = client.pipeline();
      for (const k of keys) pipe.expire(k, ttl);
      await pipe.exec();
    });
    // Mirror in memCache
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    for (const k of memCache.keys()) {
      if (regex.test(k)) { const v = getMemCache(k); if (v !== undefined) setMemCache(k, v, ttl); }
    }
    if (count) console.log(`[Cache] TOUCH → ${pattern} (${count} keys, TTL ${ttl}s)`);
    return count;
  } catch (err) {
    console.error(`[Cache] Error touching pattern ${pattern}:`, err.message);
    return 0;
  }
}

async function exists(key) {
  const client = getRedisClient();
  if (!client) return false;
  
  try {
    const result = await client.exists(key);
    return result === 1;
  } catch (err) {
    console.error(`[Cache] Error checking ${key}:`, err.message);
    return false;
  }
}

async function expire(key, ttl) {
  const client = getRedisClient();
  if (!client) return false;
  
  try {
    await client.expire(key, ttl);
    return true;
  } catch (err) {
    console.error(`[Cache] Error setting TTL for ${key}:`, err.message);
    return false;
  }
}

async function getStats() {
  const client = getRedisClient();
  if (!client) return { connected: false };
  
  try {
    const info = await client.info('stats');
    const dbsize = await client.dbsize();
    
    return {
      connected: isConnected,
      dbsize,
      info: info.split('\r\n').reduce((acc, line) => {
        const [key, value] = line.split(':');
        if (key && value) acc[key] = value;
        return acc;
      }, {}),
    };
  } catch (err) {
    console.error('[Cache] Error getting stats:', err.message);
    return { connected: false, error: err.message };
  }
}

function makeKey(prefix, ...parts) {
  return `${prefix}:${parts.filter(Boolean).join(':')}`;
}

module.exports = {
  get,
  set,
  setMem,
  del,
  delPattern,
  touchPattern,
  exists,
  expire,
  getStats,
  makeKey,
  getRedisClient,
};
