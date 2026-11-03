// Bounded in-memory maps for module-level caches keyed by user or request
// input (setup UUIDs, API keys, OAuth states).
//
// `boundedSet` deletes the key before setting it, so the map stays in insert
// order (oldest first). Each insert then drops entries from the front while
// they are stale or the map is at its cap, and stops at the first fresh entry.
// That keeps the sweep amortised O(1) and needs no timer. When every entry
// shares one TTL, insert order is expiry order and the sweep removes every
// expired entry; otherwise an old entry is at worst dropped early, which only
// costs a cache miss.
export interface BoundedMapApi {
  boundedSet: <K, V>(map: Map<K, V>, key: K, value: V, max: number, isStale?: (value: V) => boolean) => Map<K, V>;
}

function boundedSet<K, V>(map: Map<K, V>, key: K, value: V, max: number, isStale?: (value: V) => boolean): Map<K, V> {
  map.delete(key);
  const limit = Math.max(1, Math.floor(max) || 1);
  for (const [k, v] of map) {
    if (map.size < limit && !(isStale && isStale(v))) break;
    map.delete(k);
  }
  map.set(key, value);
  return map;
}

module.exports = { boundedSet } satisfies BoundedMapApi;
