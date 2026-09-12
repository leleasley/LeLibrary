const crypto = require('node:crypto');
const cache = require('./cache');
const axios = require('axios');
const { flight } = require('./catalog-cache');

function fanartKey(apiKey, tmdbId, type) {
  const scope = crypto.createHash('sha256').update(String(apiKey)).digest('hex').slice(0, 24);
  return `artwork:fanart-v1:${scope}:${type}:${tmdbId}`;
}

function createFanartLookup({ store = cache, request = options => axios.get(options.url, options), concurrency = 4 } = {}) {
  let running = 0;
  const queue = [];
  async function limited(work) {
    if (running >= concurrency) await new Promise(resolve => queue.push(resolve));
    else running++;
    try { return await work(); }
    finally { if (queue.length) queue.shift()(); else running--; }
  }
  return async function lookup(apiKey, tmdbId, type, { background = false } = {}) {
    if (!apiKey || !tmdbId) return null;
    const key = fanartKey(apiKey, tmdbId, type);
    const hit = await store.get(key);
    if (hit && Object.hasOwn(hit, 'art')) return hit.art;
    // Optional artwork must not grow an unbounded queue on a busy Home screen.
    if (background && queue.length >= 256) return null;
    const work = flight(store, key, async () => {
      const again = await store.get(key);
      if (again && Object.hasOwn(again, 'art')) return again.art;
      if (background && running >= concurrency && queue.length >= 256) return null;
      return limited(async () => {
        try {
          const family = type === 'movie' ? 'movies' : 'tv';
          const res = await request({ url: `https://webservice.fanart.tv/v3/${family}/${tmdbId}`, params: { api_key: apiKey }, timeout: 8000 });
          const art = {
            poster: res.data.movieposter?.[0]?.url || res.data.tvposter?.[0]?.url || null,
            background: res.data.moviebackground?.[0]?.url || res.data.showbackground?.[0]?.url || null,
            logo: res.data.hdmovieclearart?.[0]?.url || res.data.hdtvlogo?.[0]?.url || null,
          };
          await store.set(key, { art }, 24 * 3600);
          return art;
        } catch {
          await store.set(key, { art: null }, 60);
          return null;
        }
      });
    });
    if (background) { work.catch(() => {}); return null; }
    return work;
  };
}
module.exports = { fanartKey, createFanartLookup, getFanartArt: createFanartLookup() };
