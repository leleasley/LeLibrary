// Cache complete base rows, preserving a stale copy for non-blocking refresh.
// Flights are scoped to the cache instance as well as the credential-aware key.
const flights = new WeakMap();
function flight(store, key, work) {
  let active = flights.get(store);
  if (!active) { active = new Map(); flights.set(store, active); }
  if (!active.has(key)) active.set(key, Promise.resolve().then(work).finally(() => active.delete(key)));
  return active.get(key);
}

async function cachedRows({ store, key, staleKey = `${key}:stale`, ttl, load, allowStale = true }) {
  const started = Date.now();
  const respond = (rows, state) => {
    if (process.env.PROVIDER_TIMINGS === 'true') console.log(`[Catalog timing] state=${state} rows=${rows.length} responseMs=${Date.now() - started}`);
    return rows;
  };
  const fresh = await store.get(key);
  if (Array.isArray(fresh)) return respond(fresh, 'fresh');
  const stale = await store.get(staleKey);
  const refresh = () => flight(store, key, async () => {
    const again = await store.get(key);
    if (Array.isArray(again)) return again;
    const started = Date.now();
    try {
      const rows = await load();
      if (!Array.isArray(rows)) throw new Error('Invalid catalogue rows');
      await store.set(staleKey, rows, 7 * 24 * 3600);
      await store.set(key, rows, ttl);
      return rows;
    } catch (error) {
      const status = error.status || error.response?.status;
      const permanent = error.temporary === false || [401, 403, 404].includes(status);
      if (permanent) {
        // A known revoked/deleted source must never be served from this cache.
        await store.set(staleKey, null, 1);
        await store.set(key, null, 1);
        throw error;
      }
      if (Array.isArray(stale)) {
        // A short retry delay prevents every open folder retrying an outage.
        await store.set(key, stale, 30);
        return stale;
      }
      throw error;
    } finally {
      if (process.env.PROVIDER_TIMINGS === 'true') console.log(`[Catalog timing] refreshMs=${Date.now() - started}`);
    }
  });
  if (allowStale && Array.isArray(stale)) {
    refresh().catch(() => {});
    return respond(stale, 'stale');
  }
  return respond(await refresh(), 'rebuilt');
}
module.exports = { cachedRows, flight };
