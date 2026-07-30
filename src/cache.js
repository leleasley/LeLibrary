const Redis = require('ioredis');
const NodeCache = require('node-cache');

let redis = null;
let isConnected = false;

// In-memory fallback when Redis is not configured
const memCache = new NodeCache({ stdTTL: 3600, checkperiod: 600, useClones: false });

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
    const val = memCache.get(key);
    if (val !== undefined) { console.log(`[Cache] MEM HIT → ${key}`); return val; }
    return null;
  }
  try {
    const data = await client.get(key);
    if (!data) return null;
    console.log(`[Cache] HIT → ${key}`);
    return JSON.parse(data);
  } catch (err) {
    console.error(`[Cache] Error fetching ${key}:`, err.message);
    const val = memCache.get(key);
    return val !== undefined ? val : null;
  }
}

async function set(key, value, ttl = 3600) {
  const client = getRedisClient();
  if (!client) {
    memCache.set(key, value, ttl);
    return true;
  }
  try {
    await client.setex(key, ttl, JSON.stringify(value));
    console.log(`[Cache] SET → ${key} (TTL: ${ttl}s)`);
    memCache.set(key, value, ttl); // mirror in memory for fast reads
    return true;
  } catch (err) {
    console.error(`[Cache] Error storing ${key}:`, err.message);
    memCache.set(key, value, ttl);
    return false;
  }
}

async function del(key) {
  memCache.del(key);
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
  for (const k of memCache.keys()) { if (regex.test(k)) memCache.del(k); }

  const client = getRedisClient();
  if (!client) return 0;
  try {
    const keys = await client.keys(pattern);
    if (keys.length === 0) return 0;
    await client.del(...keys);
    console.log(`[Cache] DEL Pattern → ${pattern} (${keys.length} keys)`);
    return keys.length;
  } catch (err) {
    console.error(`[Cache] Error deleting pattern ${pattern}:`, err.message);
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
  del,
  delPattern,
  exists,
  expire,
  getStats,
  makeKey,
  getRedisClient,
};
